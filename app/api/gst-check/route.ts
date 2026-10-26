import { transaction } from "@/lib/db";
import { allowedMasterMenu } from "@/lib/master-program/access";
import { requireOperator } from "@/lib/auth/request";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { lookupGst, reserveLookup } from "@/lib/gst-check";

/**
 * Utility > Check Gst No Online: one look-up at the e-invoice gateway. The company's e-invoice login never leaves the server, and only a
 * company whose menu has the Check Gst No row can use it.
 */

type Body = Readonly<{ session: SessionKey; menuShortName?: string; gstNo?: string }>;

const headers = { "cache-control": "no-store" };
const PROGRAM = "UTILITY_CHECK_GSTNO";

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
  const gstNo = String(body.gstNo ?? "").trim().toUpperCase();
  if (gstNo === "") return Response.json({ error: "Please Input GST NO For Get Detail...." }, { status: 400, headers });
  if (!/^[0-9A-Z]{15}$/.test(gstNo)) return Response.json({ error: "A GST number is 15 letters and digits." }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  try {
    const login = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), PROGRAM, String(body.menuShortName ?? ""), PROGRAM)) throw new Error("Check Gst No is not in this company's visible menu");
      return await reserveLookup(client, session);
    }, { timeoutMs: 30000 });
    return Response.json({ detail: await lookupGst(login, gstNo) }, { headers });
  } catch (error) {
    console.error("Check Gst No error:", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "The request failed" }, { status: 500, headers });
  }
}
