// D27: Supabase Auth errors are never shown as they come; the user gets one of
// these messages. Status 429 is the only case worth telling apart.

type AuthLikeError = { status?: number } | null | undefined;

export function signInErrorMessage(error: AuthLikeError): string {
  if (error?.status === 429) return "Demasiados intentos. Espera un momento y vuelve a intentarlo.";
  if (error?.status === 400) return "Correo o contraseña incorrectos.";
  return "No se pudo iniciar sesión. Intenta de nuevo.";
}

export function mfaErrorMessage(error: AuthLikeError): string {
  if (error?.status === 429) return "Demasiados intentos. Espera un momento y vuelve a intentarlo.";
  if (error?.status === 400 || error?.status === 422) return "El código no es válido o ya venció.";
  return "No se pudo completar la verificación. Intenta de nuevo.";
}
