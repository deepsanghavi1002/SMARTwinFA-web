/** The session cookie: HttpOnly, SameSite=Lax, Secure whenever the browser reached us over HTTPS. */

export const SESSION_COOKIE = "swfa_session";
/** A session ends this long after sign-in, whatever the activity. */
export const SESSION_MAX_HOURS = 12;
/** ...or after this long without a request. */
export const SESSION_IDLE_HOURS = 4;

/** Behind Cloudflare Tunnel the app itself is spoken to over HTTP; the forwarded protocol tells what the browser used. */
export function requestIsHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:";
}

export function sessionCookie(token: string, secure: boolean): string {
  return [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_MAX_HOURS * 3600}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

/**
 * A request that changes something must come from this site's own pages. SameSite=Lax already keeps
 * the cookie off cross-site POSTs; this refuses them outright when the browser names another origin.
 */
export function crossSiteWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return false;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
