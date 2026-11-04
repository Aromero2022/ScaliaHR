/**
 * Links in an email may only point at the app: its own origin or one of its
 * tenant subdomains (<tenant>.<host>). A job that tries to send anywhere else
 * is rejected, so a compromised producer cannot turn the templates into a
 * phishing relay.
 */
export function assertAppUrl(raw: string, appBaseUrl: string): string {
  const base = new URL(appBaseUrl);
  const url = new URL(raw);
  const sameProtocol = url.protocol === base.protocol;
  const samePort = url.port === base.port;
  const sameHost = url.hostname === base.hostname || url.hostname.endsWith(`.${base.hostname}`);
  if (!sameProtocol || !samePort || !sameHost || url.username || url.password) {
    throw new Error(`link outside the app origin is not allowed: ${url.origin}`);
  }
  return url.toString();
}
