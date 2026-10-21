import { readOnly } from "@/lib/db";
import { trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { readPw, toText } from "@/lib/master-program/legacy";
import { SYSTEM_SCHEMA } from "@/lib/master-program/session";

/**
 * The screen saver's password: the operator's own USER_SCREEN_PW in smart_system.user_master (Read_pw, compared trimmed and without case,
 * as Z_Frm_Password does). "status" says whether one is set (the lock needs it, as Main_Menu_New's SCREEN_SAVER does); otherwise the typed
 * password is checked. Only yes or no goes back; the stored password never leaves the server.
 */

const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Unlock is disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 403, headers });
  }
  let body: { loginName?: unknown; password?: unknown; action?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  const loginName = toText(body?.loginName);
  const typed = typeof body?.password === "string" ? body.password : "";
  if (loginName === "") return Response.json({ error: "loginName is required" }, { status: 400, headers });
  try {
    const stored = await readOnly(async (client) => (await client.query(
      `SELECT user_screen_pw FROM ${SYSTEM_SCHEMA}.user_master WHERE UPPER(BTRIM(login_name)) = UPPER($1) AND COALESCE(BTRIM(user_pos), 'A') <> 'D' LIMIT 1`,
      [loginName],
    )).rows[0]);
    const real = stored ? readPw(toText(stored.user_screen_pw)).trim() : "";
    if (body?.action === "status") return Response.json({ set: real !== "" }, { headers });
    if (real === "") return Response.json({ ok: false, set: false }, { headers });
    const ok = real.toUpperCase() === typed.trim().toUpperCase();
    // A wrong guess waits a moment, so a password cannot be tried quickly.
    if (!ok) await new Promise((resolve) => setTimeout(resolve, 800));
    return Response.json({ ok }, { headers });
  } catch (error) {
    console.error("Unlock error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The password could not be checked" }, { status: 500, headers });
  }
}
