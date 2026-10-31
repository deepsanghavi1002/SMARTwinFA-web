import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { keepToken, planToken, requestToken } from "@/lib/einvoice-token";
import { logError } from "@/lib/log";

/**
 * Utility > Get E Invoice Token: asks the gateway for a new e-invoice token when the stored one has run out. The login, token and keys stay
 * on the server; only the message to show comes back.
 */

type Body = Readonly<{ session: SessionKey; menuShortName?: string }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "EINVOICE_TOKEN";

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
    const { session, plan } = await transaction(async (client) => {
      const opened = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(opened.companyGroup), PROGRAM, String(body.menuShortName ?? ""), PROGRAM)) throw new Error("Get E Invoice Token is not in this company's visible menu");
      return { session: opened, plan: await planToken(client, opened) };
    }, { readOnlyWork: true, timeoutMs: 30000 });
    if (plan.kind === "fresh") return Response.json({ kind: "fresh", message: `EINVOICE Token Already Generated....  Expiry Time : ${plan.expiry}` }, { headers });
    const got = await requestToken(plan);
    if ("failure" in got) return Response.json({ kind: "failed", message: `EINVOICE GST Token : ${got.failure}` }, { headers });
    const expiry = await transaction(async (client) => await keepToken(client, session, plan, got.token), { timeoutMs: 30000 });
    return Response.json({ kind: "created", message: `EINVOICE GST Token generated. Expiry Time : ${expiry}` }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/einvoice-token", action: "E-invoice token", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
