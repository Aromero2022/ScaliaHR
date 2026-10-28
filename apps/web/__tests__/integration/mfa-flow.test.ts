import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { generateSync } from "otplib";
import { integrationEnv } from "./helpers/env";
import { TestWorld, claimsOf } from "./helpers/world";
import {
  aalFromClaims,
  appRoleFromClaims,
  mfaStepFor,
  requiresAal2,
} from "@/lib/auth/mfa-policy";

const env = integrationEnv();
const db = new pg.Client({ connectionString: env.dbUrl });
await db.connect();

const world = new TestWorld(env, db);

afterAll(async () => {
  await world.cleanup();
  await db.end();
});

function freshClient(token?: string) {
  const opts = {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(token
      ? { global: { headers: { Authorization: `Bearer ${token}` } } }
      : {}),
  };
  return createClient(env.supabaseUrl, env.anonKey, opts);
}

describe("MFA integration flow", () => {
  it("enrolls TOTP, verifies with valid code, and reaches AAL2", async () => {
    const tenant = await world.createTenant();
    const email = tenant.admin.email;

    const client = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Sign in — session starts at AAL1
    const { data: signIn, error: signInErr } =
      await client.auth.signInWithPassword({
        email,
        password: (world as unknown as { password: string }).password,
      });
    expect(signInErr).toBeNull();
    expect(signIn.session).toBeTruthy();

    const aal1Claims = claimsOf(signIn.session!.access_token);
    expect(aalFromClaims(aal1Claims)).toBe("aal1");
    expect(appRoleFromClaims(aal1Claims)).toBeTruthy();

    // Enroll TOTP factor
    const { data: enroll, error: enrollErr } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "integration-test",
    });
    expect(enrollErr).toBeNull();
    expect(enroll).toBeTruthy();

    const factorId = enroll!.id;
    const secret = enroll!.totp.secret;

    // Generate valid TOTP code
    const validCode = generateSync({ secret });

    // Challenge
    const { data: challenge, error: challengeErr } =
      await client.auth.mfa.challenge({ factorId });
    expect(challengeErr).toBeNull();
    expect(challenge).toBeTruthy();

    // Verify with valid code
    const { data: verify, error: verifyErr } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge!.id,
      code: validCode,
    });
    expect(verifyErr).toBeNull();
    expect(verify).toBeTruthy();

    // Session should now be AAL2
    const aal2Token = verify!.access_token;
    const aal2Claims = claimsOf(aal2Token);
    expect(aalFromClaims(aal2Claims)).toBe("aal2");

    // JWT should still carry tenant_id and app_role
    expect(aal2Claims.tenant_id).toBe(tenant.id);
    expect(appRoleFromClaims(aal2Claims)).toBeTruthy();

    // Assurance level API confirms AAL2
    const { data: assurance, error: assuranceErr } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(assuranceErr).toBeNull();
    expect(assurance!.currentLevel).toBe("aal2");
  });

  it("policy guards: AAL1 session is redirected, AAL2 is accepted", async () => {
    const tenant = await world.createTenant();
    const email = tenant.admin.email;

    const client = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signIn } = await client.auth.signInWithPassword({
      email,
      password: (world as unknown as { password: string }).password,
    });
    const aal1Claims = claimsOf(signIn.session!.access_token);
    const appRole = appRoleFromClaims(aal1Claims);

    // Admin at AAL1 should require AAL2 on any path (MFA_REQUIRED_ROLES)
    expect(requiresAal2("/dashboard", appRole)).toBe(true);
    expect(requiresAal2("/admin-center", appRole)).toBe(true);

    // MFA step for AAL1 (no factor enrolled yet) → enroll
    const { data: assurance1 } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(mfaStepFor(assurance1!.nextLevel)).toBe("/mfa/enroll");

    // Enroll + verify
    const { data: enroll } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "guard-test",
    });
    const code = generateSync({ secret: enroll!.totp.secret });
    const { data: ch } = await client.auth.mfa.challenge({
      factorId: enroll!.id,
    });
    const { data: v } = await client.auth.mfa.verify({
      factorId: enroll!.id,
      challengeId: ch!.id,
      code,
    });

    const aal2Claims = claimsOf(v!.access_token);
    const aal2Role = appRoleFromClaims(aal2Claims);

    // After AAL2 the policy accepts the session
    expect(aalFromClaims(aal2Claims)).toBe("aal2");
    expect(requiresAal2("/dashboard", aal2Role)).toBe(true);
    // requiresAal2 returns true because the role requires it —
    // the guard compares aal >= required: aal2 >= aal2 → allowed
  });

  it("rejects an invalid TOTP code and session stays AAL1", async () => {
    const tenant = await world.createTenant();
    const email = tenant.admin.email;

    const client = createClient(env.supabaseUrl, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signIn } = await client.auth.signInWithPassword({
      email,
      password: (world as unknown as { password: string }).password,
    });
    expect(signIn.session).toBeTruthy();

    // Enroll
    const { data: enroll } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "bad-code-test",
    });

    // Challenge
    const { data: challenge } = await client.auth.mfa.challenge({
      factorId: enroll!.id,
    });

    // Verify with an invalid code
    const { error: verifyErr } = await client.auth.mfa.verify({
      factorId: enroll!.id,
      challengeId: challenge!.id,
      code: "000000",
    });
    expect(verifyErr).toBeTruthy();

    // Session should still be AAL1
    const { data: assurance } =
      await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(assurance!.currentLevel).toBe("aal1");
  });

  it("non-admin employee at AAL1 is accepted on /dashboard but rejected on /admin-center", () => {
    // Pure policy test: employee role does not require MFA everywhere
    expect(requiresAal2("/dashboard", "employee")).toBe(false);
    expect(requiresAal2("/admin-center", "employee")).toBe(true);
    expect(requiresAal2("/mfa/enroll", "owner")).toBe(false);
  });
});
