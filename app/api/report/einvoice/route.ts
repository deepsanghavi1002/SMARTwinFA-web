import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { einvoiceLogin, keepAcknowledgement, pendingVouchers, prepareInvoices, sendInvoices } from "@/lib/einvoice-generate";
import { logError } from "@/lib/log";

/**
 * Eway Bill Generate (report 147), Ctrl+I on the output: the e-invoice of each voucher of the grid is posted to the gateway and its acknowledgement kept.
 * The login and token stay on the server; only the message to show comes back.
 */

type Body = Readonly<{ session: SessionKey; reportName?: string; menuShortName?: string; vouchers?: { ledKey?: unknown; code?: unknown; distanceKm?: unknown }[] }>;

const headers = { "cache-control": "no-store" };
const NAME = /^[A-Z0-9_]{1,60}$/;
const MAX_VOUCHERS = 500;

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || !body.session || !NAME.test(String(body.reportName ?? "")) || !Array.isArray(body.vouchers)) return Response.json({ error: "session, reportName and vouchers are required" }, { status: 400, headers });
  const vouchers = body.vouchers.slice(0, MAX_VOUCHERS).map((voucher) => ({ ledKey: Math.trunc(Number(voucher.ledKey) || 0), code: Math.trunc(Number(voucher.code) || 0), distanceKm: String(voucher.distanceKm ?? "").replace(/[^0-9.]/g, "") }))
    .filter((voucher) => voucher.ledKey > 0 && voucher.code > 0);
  if (vouchers.length === 0) return Response.json({ message: "No voucher to generate", ok: false, done: 0 }, { headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  try {
    const prepared = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), String(body.reportName), String(body.menuShortName ?? ""), "REPORT")) throw new Error("The requested report and module are not in this company's visible menu");
      const login = await einvoiceLogin(client, session);
      const loader = new Loader(client, session);
      // Only a sale voucher that has no acknowledgement yet may go (a second send would be refused by the gateway, or double count).
      const open = await pendingVouchers(loader, vouchers.map((voucher) => voucher.ledKey));
      const toSend = vouchers.filter((voucher) => open.has(voucher.ledKey));
      if (toSend.length === 0) return { session, login, invoices: [] };
      const invoices = await prepareInvoices(loader, toSend);
      if (typeof invoices === "string") throw new Error(invoices);
      return { session, login, invoices };
    }, { readOnlyWork: true, timeoutMs: 60000 });
    if (prepared.invoices.length === 0) return Response.json({ ok: false, done: 0, message: "These vouchers already have an e-invoice (or are not sale vouchers)" }, { headers });
    const reply = await sendInvoices(prepared.login, prepared.invoices, async (ledKey, ack) => { await transaction(async (client) => { await keepAcknowledgement(client, prepared.session, ledKey, ack); }, { timeoutMs: 30000 }); });
    return Response.json(reply, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/report/einvoice", action: "E-invoice generate", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
