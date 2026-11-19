import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { Loader } from "@/lib/master-program/load";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { masterDetails, masterDetailsByName } from "@/lib/entry/details";
import type { MasterHint } from "@/lib/entry/details";
import { logError } from "@/lib/log";

/**
 * F1 on an account or an item: its whole master record, one field to a row. One server for the entry screens (they send the key of the
 * highlighted help row) and the reports (they send the name a cell shows). Read-only.
 */

type Body = Readonly<{ session: SessionKey; kind?: string; key?: unknown; name?: unknown; hint?: unknown }>;
const headers = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body?.session) return Response.json({ error: "session is required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  try {
    const found = await transaction(async (client) => {
      const loader = new Loader(client, await readSession(client, key));
      if (typeof body.name === "string") {
        const hint: MasterHint = body.hint === "account" || body.hint === "product" ? body.hint : "any";
        return { result: await masterDetailsByName(loader, body.name.slice(0, 200), hint), warnings: loader.warnings };
      }
      const code = Number(body.key);
      if (!Number.isInteger(code) || code <= 0 || (body.kind !== "account" && body.kind !== "product")) throw new Error("Choose an account or a product row");
      return { result: { kind: body.kind, details: await masterDetails(loader, body.kind, code) }, warnings: loader.warnings };
    });
    return Response.json({ kind: found.result?.kind ?? null, details: found.result?.details ?? null, warnings: found.warnings }, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/master-details", action: "Master details", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The master details request failed", requestId }, { status: 500, headers });
  }
}
