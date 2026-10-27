import { transaction } from "@/lib/db";
import { requestIsHttps, sessionCookie } from "@/lib/auth/cookies";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { publicUser } from "@/lib/auth/public-user";
import { authReady } from "@/lib/auth/request";
import { audit, createSession, readPasswordToken, recordLoginSuccess, setPasswordWithToken } from "@/lib/auth/store";
import { looksLikeToken, tokenHash } from "@/lib/auth/tokens";
import { logError } from "@/lib/log";

/**
 * The set-password link (an invitation, or a reset an administrator issued). GET says whether the
 * link still works and whose it is; POST sets the password, uses the link up and signs the user in.
 * The token comes in the request body or the x-set-password-token header, never in the URL.
 */

const headers = { "cache-control": "no-store" };
const DEAD_LINK = "This link has expired or was already used. Ask your administrator for a new one.";

export async function GET(request: Request) {
  const token = request.headers.get("x-set-password-token");
  if (!looksLikeToken(token)) return Response.json({ valid: false, error: DEAD_LINK }, { headers });
  try {
    await authReady();
    const hash = await tokenHash(token);
    const link = await transaction((client) => readPasswordToken(client, hash), { readOnlyWork: true, timeoutMs: 5000 });
    if (!link) return Response.json({ valid: false, error: DEAD_LINK }, { headers });
    return Response.json({ valid: true, purpose: link.purpose, login: link.user.login, displayName: link.user.displayName }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/auth/set-password", action: "Set-password link", error });
    return Response.json({ valid: false, error: "The link could not be checked right now", requestId }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  let body: { token?: unknown; password?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  const token = body?.token;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!looksLikeToken(token)) return Response.json({ error: DEAD_LINK }, { status: 400, headers });
  try {
    await authReady();
    const hash = await tokenHash(token);
    const link = await transaction((client) => readPasswordToken(client, hash), { readOnlyWork: true, timeoutMs: 5000 });
    if (!link) return Response.json({ error: DEAD_LINK }, { status: 400, headers });
    const problem = passwordProblem(password, link.user.login);
    if (problem) return Response.json({ error: problem }, { status: 400, headers });
    const passwordHash = await hashPassword(password);
    const done = await transaction(async (client) => {
      const user = await setPasswordWithToken(client, hash, passwordHash);
      if (!user) return null;
      await recordLoginSuccess(client, user.id);
      await audit(client, user.id, link.purpose === "invite" ? "password.set" : "password.reset", user.id);
      return { user, session: await createSession(client, user.id, null, request.headers.get("user-agent")) };
    }, { timeoutMs: 10000 });
    if (!done) return Response.json({ error: DEAD_LINK }, { status: 400, headers });
    return Response.json({ user: publicUser(done.user) }, {
      headers: { ...headers, "set-cookie": sessionCookie(done.session, requestIsHttps(request)) },
    });
  } catch (error) {
    const requestId = logError({ request, route: "/api/auth/set-password", action: "Set-password", error });
    return Response.json({ error: "The password could not be set right now", requestId }, { status: 503, headers });
  }
}
