import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { transferData, transferInfo } from "@/lib/utility/transfer";
import type { TransferOptions } from "@/lib/utility/transfer";
import { logError } from "@/lib/log";

/**
 * Utility > Transfer Balance: SP_TRANSFER_DATA for the open company and year. It writes this year's balances, bills and stock from last year's company, so it
 * runs only for a company whose menu has the Transfer Balance row, in one transaction (a failed statement takes it all back). `info: true` only reads the
 * previous year the screen shows (the dates, and whether a password is asked).
 */

type Body = Readonly<{ session: SessionKey; menuShortName?: string; info?: boolean; password?: string } & Partial<Record<keyof TransferOptions, boolean>>>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "TRANSFER_DATA";

type MenuRow = Readonly<{ actionCode: string | null; menuShortName: string | null; children: readonly MenuRow[] }>;
/** The Transfer Balance row is found by its action code and short name (the row has no program name of its own). */
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
  const flag = (name: keyof TransferOptions) => body[name] === true;
  const options: TransferOptions = {
    account: flag("account"), product: flag("product"), addonOpening: flag("addonOpening"), outclear: flag("outclear"), lyAddon: flag("lyAddon"), lyAccount: flag("lyAccount"), lyProduct: flag("lyProduct"),
    pendReco: flag("pendReco"), pendOrder: flag("pendOrder"), osOnAccountClear: flag("osOnAccountClear"), ignoreAccountManual: flag("ignoreAccountManual"), ignoreProductManual: flag("ignoreProductManual"),
  };
  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!inMenu(await readMenuCatalog(session.companyGroup), String(body.menuShortName ?? ""))) throw new Error("Transfer Balance is not in this company's visible menu");
      if (body.info === true) {
        // The schema of last year stays on the server.
        return { ...(await transferInfo(client, session)), prevSchema: undefined };
      }
      return await transferData(client, session, options, String(body.password ?? ""));
    }, { timeoutMs: 3_600_000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/utility/transfer", action: "Transfer Balance", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
