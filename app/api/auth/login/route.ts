import { transaction } from "@/lib/db";
import { requestIsHttps, sessionCookie } from "@/lib/auth/cookies";
import { hashPassword, PASSWORD_MAX, verifyPassword } from "@/lib/auth/password";
import { publicUser } from "@/lib/auth/public-user";
import { authReady } from "@/lib/auth/request";
import { audit, createSession, findUserForLogin, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/store";
import { randomToken } from "@/lib/auth/tokens";
import { logError } from "@/lib/log";

/**
 * Sign-in with user name (or email) and password. Every refusal gives the same answer, so the
 * screen does not tell which user names exist; five wrong passwords lock the user for a while.
 */

const headers = { "cache-control": "no-store" };
const REFUSED = "Invalid user name or password";

// A hash to check against when the user does not exist, so that answer takes as long as a wrong password.
let decoy: string | null = null;

export async function POST(request: Request) {
  let body: { login?: unknown; password?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  const login = typeof body?.login === "string" ? body.login.trim().slice(0, 200) : "";
  const password = typeof body?.password === "string" ? body.password.slice(0, PASSWORD_MAX + 1) : "";
  if (!login || !password) return Response.json({ error: REFUSED }, { status: 401, headers });

  try {
    await authReady();
    decoy ??= await hashPassword(randomToken());
    const signedIn = await transaction(async (client) => {
      const found = await findUserForLogin(client, login);
      const matches = await verifyPassword(password, found?.passwordHash ?? decoy);
      if (!found || !matches || found.locked || found.user.status !== "active") {
        if (found && !matches && !found.locked && found.user.status === "active") await recordLoginFailure(client, found.user.id);
        await audit(client, null, "login.refused", found?.user.id ?? null, {
          login: login.slice(0, 100),
          reason: !found ? "unknown" : found.locked ? "locked" : found.user.status !== "active" ? found.user.status : "password",
        });
        return null;
      }
      await recordLoginSuccess(client, found.user.id);
      const token = await createSession(client, found.user.id, null, request.headers.get("user-agent"));
      await audit(client, found.user.id, "login", found.user.id);
      return { token, user: found.user };
    }, { timeoutMs: 10000 });

    if (!signedIn) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return Response.json({ error: REFUSED }, { status: 401, headers });
    }
    return Response.json({ user: publicUser(signedIn.user) }, {
      headers: { ...headers, "set-cookie": sessionCookie(signedIn.token, requestIsHttps(request)) },
    });
  } catch (error) {
    const requestId = logError({ request, route: "/api/auth/login", action: "Sign-in", error });
    return Response.json({ error: "Sign-in is not available right now", requestId }, { status: 503, headers });
  }
}
