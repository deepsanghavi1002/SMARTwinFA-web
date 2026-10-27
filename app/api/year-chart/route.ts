import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { formatDesktopDate, parseDesktopDate } from "@/lib/master-program/legacy";
import { YEAR_BOOKS, yearChart } from "@/lib/yearchart/query";

/**
 * The Multi Year Chart Report's server (the desktop's Report_MultyYearChart): the year at set-up, then each year's two totals
 * for the chosen books. Read-only. Only the menu's own Chart Report row can open it.
 */

type Body = Readonly<{ action: string; session: SessionKey; entryName: string; menuShortName?: string; books?: string; from?: string; upto?: string }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

function isoDate(value: string | undefined, label: string): string {
  const date = parseDesktopDate(value);
  if (!date) throw new Error(`${label} is not a date`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.entryName ?? ""))) {
    return Response.json({ error: "action, session and entryName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  const moduleName = String(body.menuShortName ?? "");

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "PIE_YEAR_CHART")) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      switch (body.action) {
        case "setup":
          return { yearStart: formatDesktopDate(session.tarikh1), yearEnd: formatDesktopDate(session.tarikh2) };
        case "chart": {
          const books = YEAR_BOOKS.find((candidate) => candidate === body.books);
          if (!books) throw new Error("Choose SalePurchase or BankCash");
          return { years: await yearChart(loader, books, isoDate(body.from, "From date"), isoDate(body.upto, "Upto date")) };
        }
        default:
          throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 120000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Year chart error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The chart request failed" }, { status: 500, headers });
  }
}
