// D28: what a person reads when a request is refused for going too fast. No
// server imports, so a client component can show the same text from a 429's
// Retry-After (9c PR 6b: PersonSearch and ⌘K).

export function waitText(seconds: number): string {
  return seconds < 120 ? `${seconds} segundos` : `${Math.ceil(seconds / 60)} minutos`;
}

export function tooManyRequestsText(retryAfterSeconds: number): string {
  return `Demasiados intentos. Intenta de nuevo en ${waitText(retryAfterSeconds)}.`;
}
