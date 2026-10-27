import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { formatDesktopDate, parseDesktopDate } from "@/lib/master-program/legacy";
import { DASH_BALANCES, DASH_KINDS, balanceAccounts, dashboardData, monthVouchers } from "@/lib/dashboard/query";
import { logError } from "@/lib/log";

/**
 * The Dashboard's server (the desktop's Dashboard form): Report > Dashboard (REP_DASHBOARD) and Analysis > Multi Year > Yearly Dashboard
 * (YEAR_DASHBOARD). Read-only. Only the menu's own rows can open it.
 */

type Body = Readonly<{ action: string; session: SessionKey; entryName: string; menuShortName?: string; from?: string; upto?: string; kind?: string; month?: number; balance?: string }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

function isoDate(value: Date | string | undefined, label: string): string {
  const date = value instanceof Date ? value : parseDesktopDate(value);
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
  const yearly = body.entryName === "YEAR_DASHBOARD";
  if (body.entryName !== "YEAR_DASHBOARD" && body.entryName !== "REP_DASHBOARD") {
    return Response.json({ error: "Unknown dashboard" }, { status: 400, headers });
  }

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, body.entryName)) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      const now = new Date();
      switch (body.action) {
        case "setup": {
          // From the year's start to today, or to the year's end when that is already past.
          const upto = session.tarikh2 < now ? session.tarikh2 : now;
          return { yearly, from: formatDesktopDate(session.tarikh1), upto: formatDesktopDate(upto), yearStart: formatDesktopDate(session.tarikh1) };
        }
        case "data":
          return { data: await dashboardData(loader, yearly, isoDate(body.from, "From date"), isoDate(body.upto, "Upto date"), isoDate(now, "Today")) };
        case "month": {
          const kind = DASH_KINDS.find((candidate) => candidate === body.kind);
          if (!kind) throw new Error("Choose a chart");
          return { table: await monthVouchers(loader, kind, Number(body.month), isoDate(body.from, "From date"), isoDate(body.upto, "Upto date")) };
        }
        case "balance": {
          const balance = DASH_BALANCES.find((candidate) => candidate === body.balance);
          if (!balance) throw new Error("Choose a balance");
          return await balanceAccounts(loader, balance);
        }
        default:
          throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 120000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/dashboard", action: "Dashboard", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The dashboard request failed", requestId }, { status: 500, headers });
  }
}
