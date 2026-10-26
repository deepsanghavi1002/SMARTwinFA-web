import { transaction } from "../db.ts";
import { readCookie, SESSION_COOKIE } from "./cookies.ts";
import { ensureAuthSchema } from "./schema.ts";
import { readSessionUser, type SessionUser } from "./store.ts";
import { looksLikeToken, tokenHash } from "./tokens.ts";

/**
 * The signed-in user of a request, read from the session cookie on every call. Routes never take
 * the operator from the request body, a query parameter or a header the browser could set.
 */

// Set once the tables exist in this isolate. A flag rather than a shared promise: a promise made by
// one request must not be awaited by another on the Workers runtime (see lib/db.ts).
let schemaReady = false;

export async function authReady(): Promise<void> {
  if (schemaReady) return;
  await transaction(ensureAuthSchema, { timeoutMs: 15000 });
  schemaReady = true;
}

export function sessionTokenOf(request: Request): string | null {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  return looksLikeToken(token) ? token : null;
}

export async function currentUser(request: Request): Promise<SessionUser | null> {
  const token = sessionTokenOf(request);
  if (!token) return null;
  await authReady();
  const hash = await tokenHash(token);
  return transaction((client) => readSessionUser(client, hash), { timeoutMs: 5000 });
}

/** The operator the signed-in user opens the books as, or null when signed out or none is chosen yet. */
export async function currentOperator(request: Request): Promise<string | null> {
  return (await currentUser(request))?.operator ?? null;
}

export const SIGN_IN_REQUIRED = "Sign in to continue";

export function signInRequired(headers: HeadersInit = { "cache-control": "no-store" }): Response {
  return Response.json({ error: SIGN_IN_REQUIRED, signIn: true }, { status: 401, headers });
}

/**
 * For a route that works in the books: the session's operator, or the response to send instead
 * (401 signed out, 403 signed in without an operator).
 */
export async function requireOperator(request: Request, headers: HeadersInit = { "cache-control": "no-store" }): Promise<string | Response> {
  const user = await currentUser(request);
  if (!user) return signInRequired(headers);
  if (!user.operator) return Response.json({ error: "No operator is chosen for this session" }, { status: 403, headers });
  return user.operator;
}

/** The address users reach this installation at, for set-password links. SMARTWINFA_PUBLIC_URL wins when set. */
export function publicOrigin(request: Request): string {
  const configured = process.env.SMARTWINFA_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/** The token travels in the fragment, which browsers never send to a server, so no proxy or access log records it. */
export function setPasswordLink(origin: string, token: string): string {
  return `${origin}/set-password#token=${token}`;
}
