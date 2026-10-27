import { transaction } from "@/lib/db";
import { clearedSessionCookie, requestIsHttps } from "@/lib/auth/cookies";
import { authReady, sessionTokenOf } from "@/lib/auth/request";
import { revokeSession } from "@/lib/auth/store";
import { tokenHash } from "@/lib/auth/tokens";
import { logError } from "@/lib/log";

/** Ends the session on the server as well as in the browser. Always answers OK, signed in or not. */
export async function POST(request: Request) {
  const token = sessionTokenOf(request);
  if (token) {
    try {
      await authReady();
      const hash = await tokenHash(token);
      await transaction((client) => revokeSession(client, hash), { timeoutMs: 5000 });
    } catch (error) {
      logError({ request, route: "/api/auth/logout", action: "Sign-out", error });
    }
  }
  return Response.json({ ok: true }, {
    headers: { "cache-control": "no-store", "set-cookie": clearedSessionCookie(requestIsHttps(request)) },
  });
}
