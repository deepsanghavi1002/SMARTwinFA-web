/**
 * The API calls that work without a session. Everything else under /api needs one: a new route is
 * protected by default, and must be added here on purpose to be reachable signed out.
 */
const PUBLIC_API: Readonly<Record<string, readonly string[]>> = {
  "/api/health": ["GET", "HEAD"],
  "/api/auth/login": ["POST"],
  "/api/auth/logout": ["POST"],
  "/api/auth/set-password": ["GET", "POST"],
  // Browser error reports, also from the sign-in screen (the route caps size and rate itself).
  "/api/client-log": ["POST"],
};

export function isPublicApi(pathname: string, method: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_API[path]?.includes(method.toUpperCase()) ?? false;
}
