import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { invoiceExists, loadBills, loadTransportOptions, saveTransportEntry, tdsFor } from "@/lib/transport-entry";
import type { TransportSave } from "@/lib/transport-entry";
import { logError } from "@/lib/log";

/**
 * Transaction > Transport Entry: the lists, a transport's open bills, the TDS of an amount, the duplicate invoice check and the save.
 * The session is rebuilt on every call, and only a company whose menu has the Transport Entry row can use it.
 */

type Body = Readonly<{ action: string; session: SessionKey; menuShortName?: string; transportKey?: number; from?: string; to?: string; amount?: number; invoiceNo?: string; entry?: TransportSave }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "TRANSPORT_ENTRY";
const ACTION = "TRANSPORT_ENTRY";

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
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), PROGRAM, String(body.menuShortName ?? ""), ACTION)) throw new Error("Transport Entry is not in this company's visible menu");
      switch (body.action) {
        case "options": return await loadTransportOptions(client, session);
        case "bills": return { bills: await loadBills(client, session, Number(body.transportKey), String(body.from ?? ""), String(body.to ?? "")) };
        case "tds": return await tdsFor(client, session, Number(body.transportKey), Number(body.amount) || 0);
        case "duplicate": return { duplicate: await invoiceExists(client, session, Number(body.transportKey), String(body.invoiceNo ?? "")) };
        case "save": {
          if (!body.entry) throw new Error("entry is required");
          return await saveTransportEntry(client, session, body.entry);
        }
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { readOnlyWork: body.action !== "save", timeoutMs: body.action === "save" ? 60000 : 30000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/transport-entry", action: "Transport entry", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
