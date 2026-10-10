// Content-Security-Policy: strog za izgrađenu aplikaciju, olabavljen samo za Vite dev server.

/** Izgrađeni interfejs: bez unsafe-eval, bez inline skripti i stilova. */
export const CSP_BUILT = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Samo razvoj: React Fast Refresh ubacuje inline skriptu, Vite inline stilove i koristi WebSocket za HMR. */
export function cspDev(devUrl: string): string {
  const u = new URL(devUrl);
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ws://${u.host}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
