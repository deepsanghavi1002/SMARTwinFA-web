import { transaction } from "@/lib/db";
import { requestIsHttps, sessionCookie } from "@/lib/auth/cookies";
import { authReady } from "@/lib/auth/request";
import { activeOperatorLogin, createSession, createUser } from "@/lib/auth/store";

/**
 * TEMPORARY, LOCAL ONLY - never commit or deploy this file (the web sign-in work removed the old bypass on purpose).
 * With SMARTWINFA_SKIP_LOGIN in .env.local, a request from this PC (localhost) gets a session of a platform admin
 * user "devlocal" that opens the books as ADMIN (or as the operator the variable names), so the login form is skipped.
 */
const headers = { "cache-control": "no-store" };

export function devLoginEnabled(request: Request): boolean {
  const skip = (process.env.SMARTWINFA_SKIP_LOGIN ?? "").trim().toLowerCase();
  if (skip === "" || skip === "false" || process.env.NODE_ENV === "production") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}

export async function POST(request: Request) {
  if (!devLoginEnabled(request)) return Response.json({ error: "Not found" }, { status: 404, headers });
  const skip = (process.env.SMARTWINFA_SKIP_LOGIN ?? "").trim();
  const wanted = skip.toLowerCase() === "true" ? "ADMIN" : skip.slice(0, 60);
  try {
    await authReady();
    const token = await transaction(async (client) => {
      const operator = await activeOperatorLogin(client, wanted);
      let id = (await client.query<{ id: number }>(`SELECT id FROM web_auth.app_user WHERE lower(login) = 'devlocal'`)).rows[0]?.id;
      if (!id) id = (await createUser(client, { login: "devlocal", email: null, displayName: "Local test", role: "platform_admin", operatorLogin: null }, null)).id;
      await client.query(`UPDATE web_auth.app_user SET status = 'active', role = 'platform_admin' WHERE id = $1`, [id]);
      return createSession(client, id, operator, request.headers.get("user-agent"));
    }, { timeoutMs: 10000 });
    return Response.json({ ok: true }, { headers: { ...headers, "set-cookie": sessionCookie(token, requestIsHttps(request)) } });
  } catch (error) {
    console.error("dev-login error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "dev-login failed" }, { status: 503, headers });
  }
}
