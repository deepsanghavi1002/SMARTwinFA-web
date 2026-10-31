import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { repostData } from "@/lib/utility/repost";
import { logError } from "@/lib/log";

/**
 * Utility > Re-Post Data: SP_REPOST_DATA for the open company and year. It rewrites balances and postings, so it runs only for a company whose
 * menu has the Re-Post Data row, in one transaction (a failed statement takes it all back).
 */

type Body = Readonly<{ session: SessionKey; menuShortName?: string; account?: boolean; outstanding?: boolean; productRecalc?: boolean; product?: boolean; verify?: boolean }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "REPOST_DATA";

type MenuRow = Readonly<{ actionCode: string | null; menuShortName: string | null; children: readonly MenuRow[] }>;
/** The Re-Post Data row is found by its action code and short name (the row has no program name of its own). */
const inMenu = (menus: readonly MenuRow[], module: string): boolean => menus.some((menu) => (menu.actionCode?.toUpperCase() === PROGRAM && (menu.menuShortName ?? "") === module) || inMenu(menu.children, module));

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || !body.session) return Response.json({ error: "session is required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!inMenu(await readMenuCatalog(session.companyGroup), String(body.menuShortName ?? ""))) throw new Error("Re-Post Data is not in this company's visible menu");
      return await repostData(client, session, { account: body.account === true, outstanding: body.outstanding === true, productRecalc: body.productRecalc === true, product: body.product === true, verify: body.verify === true });
    }, { timeoutMs: 3_600_000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/utility/repost", action: "Re-Post Data", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
