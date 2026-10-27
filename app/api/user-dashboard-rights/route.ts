import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import type { DashboardRightRow } from "@/lib/user-dashboard-rights";
import { dashboardUsers, loadDashboardRights, saveDashboardRights } from "@/lib/user-dashboard-rights";
import { logError } from "@/lib/log";

/**
 * Setup > Security > User Dashboard Rights: the users, one user's dashboard blocks, and the save. The session is rebuilt on every call, and only a
 * company whose menu has the User Dashboard Rights row can use it.
 */

type Body = Readonly<{ action: string; session: SessionKey; menuShortName?: string; userNo?: number; rows?: DashboardRightRow[] }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "User_Dashboard_Rights";
const ACTION = "USER_DASHBOARD_RIGHTS";

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
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), PROGRAM, String(body.menuShortName ?? ""), ACTION)) throw new Error("User Dashboard Rights is not in this company's visible menu");
      switch (body.action) {
        case "users": return { users: await dashboardUsers(client) };
        case "load": return { rows: await loadDashboardRights(client, Number(body.userNo)) };
        case "save": await saveDashboardRights(client, Number(body.userNo), Array.isArray(body.rows) ? body.rows : []); return { ok: true };
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: body.action !== "save", timeoutMs: 30000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/user-dashboard-rights", action: "User dashboard rights", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
