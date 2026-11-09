// e2e accounts (D44), LOCAL stack only. Three accounts linked to employees of
// the demo tenant of supabase/seed.sql, created before the Playwright run and
// deleted after it (with their sessions and MFA factors), so the run repeats
// without `supabase db reset`.
//   node scripts/e2e-accounts.mjs setup   <db-url> <supabase-url> <service-role-key> <anon-key>
//   node scripts/e2e-accounts.mjs scan    <artifacts-dir> <extract-dir>
//   node scripts/e2e-accounts.mjs cleanup <db-url>
// The password (new and random on every run), the TOTP secret and the browser
// sessions live only in E2E_PRIVATE_DIR: mode 700, outside the repository and
// outside the artifacts. Nothing here prints them. `scan` fails if any of them
// shows up in the artifacts, including inside the HTML report's embedded zip.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { generateSync } from "otplib";
import { assertLocalStack } from "../load/seed.mjs";
import { assertLocalDbUrl } from "./set-local-role-passwords.mjs";

export const E2E_EMAIL_DOMAIN = "e2e.scaliahr.test";
const DEMO_TENANT = "a0000000-0000-0000-0000-000000000001";
const employee = (n) => `e0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** Who signs in. Each one is an employee of the demo tenant with no account of its own. */
export const E2E_ACCOUNTS = {
  // Gabriela Morales (e11), Frontend Developer: All Employees, no admin rights.
  empleada: { email: `empleada@${E2E_EMAIL_DOMAIN}`, userId: employee(11), appRole: "employee", totp: false },
  // Ana Torres (e04), HR Director: All Administrators. hr_admin needs AAL2 everywhere.
  admin: { email: `admin@${E2E_EMAIL_DOMAIN}`, userId: employee(4), appRole: "hr_admin", totp: true },
  // Valeria Gutiérrez (e23): hr_admin without a factor, sent to the forced enrollment.
  adminSinFactor: { email: `admin-sin-factor@${E2E_EMAIL_DOMAIN}`, userId: employee(23), appRole: "hr_admin", totp: false },
};

/**
 * D46: what the e2e saves on demo data, so it can be found and undone. The job
 * change keeps the employee's title and department (no other screen changes)
 * and is told apart by its reason; the self-assessment goes to a skill the
 * setup adds with a seed-shaped id (not RFC 4122, like 5c000000-…), which is
 * what z.uuid() refused.
 */
export const E2E_MARK = "[e2e]";
export const E2E_DEMO = {
  // Patricia Castro (e13), QA Engineer: not in the closing screenshots.
  jobChangeEmployeeId: employee(13),
  reason: `${E2E_MARK} Prueba de guardado con datos demo`,
  skill: { id: "5c000000-0000-0000-0000-00000000e2e0", code: "E2E_PRUEBA", name: "Prueba e2e de autoevaluación" },
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ACCOUNTS_FILE = "accounts.json";
/** Secrets a test saw on screen (the enrollment page's), one per line, for `scan`. */
export const RUNTIME_SECRETS_FILE = "runtime-secrets.txt";

/**
 * E2E_PRIVATE_DIR must exist, be private and sit outside the repository.
 * @param {Record<string, string | undefined>} [env]
 */
export function privateDir(env = process.env) {
  const dir = env.E2E_PRIVATE_DIR;
  if (!dir) throw new Error("E2E_PRIVATE_DIR is not set");
  const resolved = path.resolve(dir);
  const fromRepo = path.relative(REPO_ROOT, resolved);
  if (!fromRepo.startsWith("..") && !path.isAbsolute(fromRepo)) {
    throw new Error("E2E_PRIVATE_DIR must be outside the repository");
  }
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  chmodSync(resolved, 0o700);
  return resolved;
}

/**
 * D46: undoes what the e2e saved on demo data. The job changes marked with
 * E2E_MARK go, and the record each one closed is current again (the effective
 * dating closes it with end_date = the new record's start_date). The e2e skill
 * goes with its assessments. Runs as postgres, like the rest of the cleanup.
 */
async function cleanupDemoWrites(db) {
  await db.query("BEGIN");
  try {
    const { rows: jobs } = await db.query(
      "DELETE FROM public.ec_job_information WHERE tenant_id = $1 AND event_reason LIKE $2 RETURNING user_id, start_date::text AS start_date",
      [DEMO_TENANT, `${E2E_MARK}%`],
    );
    const byUser = new Map();
    for (const job of jobs) byUser.set(job.user_id, [...(byUser.get(job.user_id) ?? []), job.start_date]);
    for (const [userId, starts] of byUser) {
      await db.query(
        `UPDATE public.ec_job_information SET end_date = NULL
         WHERE id = (SELECT id FROM public.ec_job_information
                     WHERE tenant_id = $1 AND user_id = $2 AND end_date = ANY($3::date[])
                     ORDER BY start_date DESC LIMIT 1)
           AND NOT EXISTS (SELECT 1 FROM public.ec_job_information
                           WHERE tenant_id = $1 AND user_id = $2 AND end_date IS NULL)`,
        [DEMO_TENANT, userId, starts],
      );
    }
    const skills = await db.query("DELETE FROM public.employee_skills WHERE tenant_id = $1 AND skill_id = $2", [DEMO_TENANT, E2E_DEMO.skill.id]);
    await db.query("DELETE FROM public.skill_ontology WHERE tenant_id = $1 AND id = $2", [DEMO_TENANT, E2E_DEMO.skill.id]);
    await db.query("COMMIT");
    const { rows: left } = await db.query(
      `SELECT (SELECT count(*) FROM public.ec_job_information WHERE tenant_id = $1 AND event_reason LIKE $2)::int AS jobs,
              (SELECT count(*) FROM public.skill_ontology WHERE id = $3)::int AS skills,
              (SELECT count(*) FROM public.ec_job_information j WHERE j.tenant_id = $1 AND j.user_id = $4 AND j.end_date IS NULL)::int AS current`,
      [DEMO_TENANT, `${E2E_MARK}%`, E2E_DEMO.skill.id, E2E_DEMO.jobChangeEmployeeId],
    );
    if (left[0].jobs + left[0].skills > 0 || left[0].current !== 1) {
      throw new Error(`demo-data cleanup left the data changed: ${JSON.stringify(left[0])}`);
    }
    return { jobChanges: jobs.length, assessments: skills.rowCount };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanup(db) {
  const demo = await cleanupDemoWrites(db);
  const { rows } = await db.query("SELECT id FROM auth.users WHERE email LIKE $1", [`%@${E2E_EMAIL_DOMAIN}`]);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { accounts: 0, factors: 0, ...demo };
  const { rows: factors } = await db.query("SELECT count(*)::int AS n FROM auth.mfa_factors WHERE user_id = ANY($1::uuid[])", [ids]);
  await db.query("BEGIN");
  try {
    // The employees go back to having no account, as in seed.sql.
    await db.query("UPDATE public.users SET auth_uid = NULL WHERE auth_uid = ANY($1::uuid[])", [ids]);
    // Memberships, settings, identities, sessions, refresh tokens and MFA factors cascade.
    await db.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [ids]);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const { rows: left } = await db.query(
    `SELECT (SELECT count(*) FROM auth.users WHERE id = ANY($1::uuid[]))::int AS users,
            (SELECT count(*) FROM auth.mfa_factors WHERE user_id = ANY($1::uuid[]))::int AS factors,
            (SELECT count(*) FROM auth.sessions WHERE user_id = ANY($1::uuid[]))::int AS sessions,
            (SELECT count(*) FROM public.user_tenant_memberships WHERE user_id = ANY($1::uuid[]))::int AS memberships`,
    [ids],
  );
  const remaining = left[0];
  if (remaining.users + remaining.factors + remaining.sessions + remaining.memberships > 0) {
    throw new Error(`cleanup left rows behind: ${JSON.stringify(remaining)}`);
  }
  return { accounts: ids.length, factors: factors[0].n, ...demo };
}

async function auth(supabaseUrl, apiKey, route, { method = "POST", token, body } = {}) {
  const res = await fetch(`${supabaseUrl}/auth/v1${route}`, {
    method,
    headers: { apikey: apiKey, Authorization: `Bearer ${token ?? apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  // Only the status: the body of some of these calls holds tokens or the TOTP secret.
  if (!res.ok) throw new Error(`auth ${method} ${route.split("?")[0]} failed: ${res.status}`);
  return text ? JSON.parse(text) : {};
}

/** Enrolls and verifies a TOTP factor for the account; returns its secret. */
async function enrollTotp(supabaseUrl, anonKey, email, password) {
  const session = await auth(supabaseUrl, anonKey, "/token?grant_type=password", { body: { email, password } });
  const factor = await auth(supabaseUrl, anonKey, "/factors", {
    token: session.access_token,
    body: { factor_type: "totp", friendly_name: "e2e" },
  });
  const secret = factor.totp.secret;
  const challenge = await auth(supabaseUrl, anonKey, `/factors/${factor.id}/challenge`, { token: session.access_token, body: {} });
  const verified = await auth(supabaseUrl, anonKey, `/factors/${factor.id}/verify`, {
    token: session.access_token,
    body: { challenge_id: challenge.id, code: generateSync({ secret }) },
  });
  // The setup's own session ends here; the browser signs in on its own.
  await auth(supabaseUrl, anonKey, "/logout?scope=local", { token: verified.access_token, body: {} });
  return { secret };
}

async function setup([dbUrl, supabaseUrl, serviceKey, anonKey]) {
  if (!anonKey) throw new Error("usage: e2e-accounts.mjs setup <db-url> <supabase-url> <service-role-key> <anon-key>");
  const dir = privateDir();
  const db = new pg.Client({ connectionString: assertLocalStack(dbUrl, supabaseUrl) });
  await db.connect();
  try {
    await cleanup(db); // leftovers of a run that did not finish
    const ids = Object.values(E2E_ACCOUNTS).map((a) => a.userId);
    const { rows } = await db.query(
      "SELECT id, auth_uid FROM public.users WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL",
      [DEMO_TENANT, ids],
    );
    if (rows.length !== ids.length) throw new Error("the demo employees are missing: run supabase db reset (seed.sql) first");
    const taken = rows.filter((r) => r.auth_uid !== null);
    if (taken.length > 0) throw new Error(`demo employees already linked to another account: ${taken.map((r) => r.id).join(", ")}`);

    const password = randomBytes(24).toString("base64url");
    const accounts = {};
    for (const [key, spec] of Object.entries(E2E_ACCOUNTS)) {
      const user = await auth(supabaseUrl, serviceKey, "/admin/users", {
        body: { email: spec.email, password, email_confirm: true },
      });
      await db.query("BEGIN");
      try {
        const linked = await db.query(
          "UPDATE public.users SET auth_uid = $1 WHERE id = $2 AND tenant_id = $3 AND auth_uid IS NULL",
          [user.id, spec.userId, DEMO_TENANT],
        );
        if (linked.rowCount !== 1) throw new Error(`could not link ${spec.email}`);
        await db.query(
          "INSERT INTO public.user_tenant_memberships (user_id, tenant_id, app_role) VALUES ($1, $2, $3)",
          [user.id, DEMO_TENANT, spec.appRole],
        );
        await db.query("INSERT INTO public.user_settings (user_id, active_tenant_id) VALUES ($1, $2)", [user.id, DEMO_TENANT]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
      accounts[key] = { email: spec.email, userId: spec.userId };
      if (spec.totp) Object.assign(accounts[key], { totp: await enrollTotp(supabaseUrl, anonKey, spec.email, password) });
      console.log(`e2e account ready: ${spec.email} (${spec.appRole}${spec.totp ? ", TOTP" : ""})`);
    }
    // D46: the skill the employee assesses, with a seed-shaped id.
    await db.query(
      `INSERT INTO public.skill_ontology (id, tenant_id, code, name, description, category, is_active)
       VALUES ($1, $2, $3, $4, 'Habilidad creada por el e2e; la limpieza la borra.', 'technical', true)`,
      [E2E_DEMO.skill.id, DEMO_TENANT, E2E_DEMO.skill.code, E2E_DEMO.skill.name],
    );
    const demo = { jobChangeEmployeeId: E2E_DEMO.jobChangeEmployeeId, reason: E2E_DEMO.reason, skillName: E2E_DEMO.skill.name };
    const file = path.join(dir, ACCOUNTS_FILE);
    writeFileSync(file, JSON.stringify({ password, accounts, demo }), { mode: 0o600 });
    writeFileSync(path.join(dir, RUNTIME_SECRETS_FILE), "", { mode: 0o600 });
  } finally {
    await db.end();
  }
}

/** Every secret of this run: the password, the TOTP secrets and whatever the tests registered. */
export function runSecrets(dir) {
  const file = path.join(dir, ACCOUNTS_FILE);
  if (!existsSync(file)) throw new Error("no e2e accounts in E2E_PRIVATE_DIR: the scan needs the secrets of this run");
  const { password, accounts } = JSON.parse(readFileSync(file, "utf-8"));
  const secrets = [password, ...Object.values(accounts).flatMap((a) => (a.totp ? [a.totp.secret] : []))];
  const runtime = path.join(dir, RUNTIME_SECRETS_FILE);
  if (existsSync(runtime)) secrets.push(...readFileSync(runtime, "utf-8").split("\n").map((s) => s.trim()).filter(Boolean));
  if (secrets.some((s) => typeof s !== "string" || s.length < 16)) throw new Error("an e2e secret is missing or too short to scan for");
  return [...new Set(secrets)];
}

/** Entries of a zip (stored or deflated, no zip64): what Playwright embeds in its HTML report. */
export function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf-8", p + 46, p + 46 + nameLength);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`zip method ${method} is not supported`);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const EMBEDDED_ZIP = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/g;

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

/**
 * Looks for each secret, as is and URL-encoded, in every file under
 * artifactsDir and in the zips embedded in its HTML files, which it extracts
 * to extractDir so gitleaks can read them too. Returns the files with a hit.
 */
export function scanArtifacts(artifactsDir, extractDir, secrets) {
  const needles = [...new Set(secrets.flatMap((s) => [s, encodeURIComponent(s)]))].map((s) => Buffer.from(s));
  const hits = [];
  let files = 0;
  const check = (label, data) => {
    files++;
    if (needles.some((needle) => data.includes(needle))) hits.push(label);
  };
  walk(artifactsDir, (file) => {
    const data = readFileSync(file);
    const label = path.relative(artifactsDir, file);
    check(label, data);
    if (!file.endsWith(".html")) return;
    let z = 0;
    for (const match of data.toString("latin1").matchAll(EMBEDDED_ZIP)) {
      const out = path.join(extractDir, `${label}.zip-${z++}`);
      for (const entry of unzipEntries(Buffer.from(match[1], "base64"))) {
        const target = path.join(out, entry.name);
        if (path.relative(out, target).startsWith("..")) throw new Error("zip entry outside its folder");
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, entry.data);
        check(`${label} (embedded) ${entry.name}`, entry.data);
      }
    }
  });
  return { files, hits };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "setup") return setup(args);
  if (command === "cleanup") {
    if (!args[0]) throw new Error("usage: e2e-accounts.mjs cleanup <db-url>");
    const db = new pg.Client({ connectionString: assertLocalDbUrl(args[0]) });
    await db.connect();
    try {
      const done = await cleanup(db);
      console.log(
        `e2e cleanup: deleted ${done.accounts} accounts and ${done.factors} MFA factors; undid ${done.jobChanges} job changes and ${done.assessments} assessments on demo data`,
      );
    } finally {
      await db.end();
    }
    return;
  }
  if (command === "scan") {
    const [artifactsDir, extractDir] = args;
    if (!extractDir) throw new Error("usage: e2e-accounts.mjs scan <artifacts-dir> <extract-dir>");
    const secrets = runSecrets(privateDir());
    if (!existsSync(artifactsDir) || !statSync(artifactsDir).isDirectory()) {
      console.log("e2e scan: no artifacts");
      return;
    }
    mkdirSync(extractDir, { recursive: true });
    const { files, hits } = scanArtifacts(artifactsDir, extractDir, secrets);
    for (const hit of hits) console.error(`::error::an e2e secret appears in the artifacts: ${hit}`);
    if (hits.length > 0) process.exit(1);
    console.log(`e2e scan: ${secrets.length} secrets, ${files} files (embedded report files included), no match`);
    return;
  }
  throw new Error("usage: e2e-accounts.mjs setup|scan|cleanup …");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
