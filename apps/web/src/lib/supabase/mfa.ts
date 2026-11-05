import { createClient } from "./server";
import { safeError } from "@/lib/errors/safe-error";

export async function enrollTotp() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator App",
  });

  if (error) return { error: await safeError("mfa.enrollTotp", error) };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

export async function verifyTotp(factorId: string, code: string) {
  const supabase = await createClient();
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId });

  if (challengeError) return { error: await safeError("mfa.verifyTotp", challengeError) };

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) return { error: await safeError("mfa.verifyTotp", verifyError) };
  return { success: true };
}

export async function getAal() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  return data;
}

export async function listFactors() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return [];
  return data.totp ?? [];
}
