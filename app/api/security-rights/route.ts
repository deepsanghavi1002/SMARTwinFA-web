import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { loadSecurityRows, saveSecurityRows, securityUsers } from "@/lib/security-rights";
import type { SecuritySave } from "@/lib/security-rights";
import { logError } from "@/lib/log";

/**
 * Setup > Security > Menu Book Rights: the users, one user's rights, and the save. The session is rebuilt from smart_system on every call,
 * and only a company whose menu has the Menu Book Rights row can open it. Reads run in a read-only transaction.
 */

type Body = Readonly<{ action: string; session: SessionKey; menuShortName?: string; userNo?: number } & Partial<SecuritySave>>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "Security_Menu";
const ACTION = "SECURITY_MENU";

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session) return Response.json({ error: "action and session are required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  const writes = body.action === "save";
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      const menus = await readMenuCatalog(session.companyGroup);
      if (!allowedMasterMenu(menus, PROGRAM, String(body.menuShortName ?? ""), ACTION)) throw new Error("Menu Book Rights is not in this company's visible menu");
      switch (body.action) {
        case "users": return { users: await securityUsers(client) };
        case "rows": return { rows: await loadSecurityRows(client, session, menus, Number(body.userNo)) };
        case "save": {
          const rows = Array.isArray(body.rows) ? body.rows : [];
          return await saveSecurityRows(client, session, { userNo: Number(body.userNo), copyToNo: Number(body.copyToNo) || 0, rows });
        }
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: !writes, timeoutMs: 60000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/security-rights", action: "Security rights", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The security request failed", requestId }, { status: 500, headers });
  }
}
