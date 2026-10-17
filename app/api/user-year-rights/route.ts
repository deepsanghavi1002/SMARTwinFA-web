import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { loadYearRights, saveYearRights, yearUsers } from "@/lib/user-year-rights";

/**
 * Setup > Security > User Year Rights: the users, one user's companies, and the save. The session is rebuilt on every call, and only a
 * company whose menu has the User Year Rights row can use it.
 */

type Body = Readonly<{ action: string; session: SessionKey; menuShortName?: string; userNo?: number; years?: string[] }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "User_Year_Rights";
const ACTION = "USER_YEAR_RIGHTS";

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "User year rights are disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 403, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session) return Response.json({ error: "action and session are required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), PROGRAM, String(body.menuShortName ?? ""), ACTION)) throw new Error("User Year Rights is not in this company's visible menu");
      switch (body.action) {
        case "users": return { users: await yearUsers(client) };
        case "load": return await loadYearRights(client, Number(body.userNo));
        case "save": await saveYearRights(client, Number(body.userNo), Array.isArray(body.years) ? body.years.map(String) : []); return { ok: true };
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: body.action !== "save", timeoutMs: 30000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("User year rights error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The request failed" }, { status: 500, headers });
  }
}
