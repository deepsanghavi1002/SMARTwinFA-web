import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { formatDesktopDate, parseDesktopDate } from "@/lib/master-program/legacy";
import { PIE_BOOKS, PIE_SIDES, pieAddons, pieSlices } from "@/lib/piechart/query";
import type { PieBook, PieSide } from "@/lib/piechart/query";

/**
 * The Pie Chart screen's server (the desktop's Report_PieChart): the addon list and the year at set-up, then the slices of
 * a chosen book and period. Read-only. Only the menu's own Pie Chart row can open it.
 */

type Body = Readonly<{ action: string; session: SessionKey; entryName: string; menuShortName?: string; book?: string; side?: string; addonKey?: number; from?: string; upto?: string }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

function isoDate(value: string | undefined, label: string): string {
  const date = parseDesktopDate(value);
  if (!date) throw new Error(`${label} is not a date`);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "The pie chart is disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 503, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.entryName ?? ""))) {
    return Response.json({ error: "action, session and entryName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  const moduleName = String(body.menuShortName ?? "");

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.entryName, moduleName, "PIE_CHART")) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const loader = new Loader(client, session);
      switch (body.action) {
        case "setup":
          return { addons: await pieAddons(loader), companyName: session.companyName, userName: session.loginName, yearStart: formatDesktopDate(session.tarikh1), yearEnd: formatDesktopDate(session.tarikh2), warnings: loader.warnings };
        case "chart": {
          const book = PIE_BOOKS.find((candidate) => candidate === body.book) as PieBook | undefined;
          const side = PIE_SIDES.find((candidate) => candidate === body.side) as PieSide | undefined;
          if (!book || !side) throw new Error("Choose a book and Quantity or Amount");
          const slices = await pieSlices(loader, { book, side, addonKey: Math.trunc(Number(body.addonKey) || 0), from: isoDate(body.from, "From date"), upto: isoDate(body.upto, "Upto date") });
          return { slices };
        }
        default:
          throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: true, timeoutMs: 120000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Pie chart error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The pie chart request failed" }, { status: 500, headers });
  }
}
