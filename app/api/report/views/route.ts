import { transaction } from "@/lib/db";
import { allowedMasterMenu, trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { readMenuCatalog } from "@/lib/menu-catalog";

/**
 * Saved views of a report (web only): a name for a selection (and the Group By on its output),
 * kept per operator, company and report in smart_system.report_saved_view. The only writing the
 * report screen does, and only to that table.
 */

type Body = Readonly<{ action: string; session: SessionKey; reportName: string; menuShortName?: string; name?: string; payload?: unknown }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };
const MAX_PAYLOAD = 200000;
const MAX_VIEWS = 50;

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Reports are disabled until authenticated sessions are implemented." }, { status: 503, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || !NAME.test(String(body.reportName ?? ""))) {
    return Response.json({ error: "action, session and reportName are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  const name = String(body.name ?? "").trim().slice(0, 60);

  try {
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (!allowedMasterMenu(await readMenuCatalog(session.companyGroup), body.reportName, String(body.menuShortName ?? ""), "REPORT")) {
        throw new Error("The requested report and module are not in this company's visible menu");
      }
      const who = [session.companyKey, session.userNo, body.reportName];
      switch (body.action) {
        case "list": {
          const rows = (await client.query("SELECT view_name, payload FROM smart_system.report_saved_view WHERE co_key = $1 AND user_no = $2 AND report_name = $3 ORDER BY view_name", who)).rows;
          return { views: rows.map((row) => ({ name: String(row.view_name), payload: row.payload })) };
        }
        case "save": {
          if (name === "") throw new Error("Give the view a name");
          const text = JSON.stringify(body.payload ?? null);
          if (text === "null" || text.length > MAX_PAYLOAD) throw new Error("The view is empty or too large to save");
          const count = Number((await client.query("SELECT count(*) AS n FROM smart_system.report_saved_view WHERE co_key = $1 AND user_no = $2 AND report_name = $3 AND view_name <> $4", [...who, name])).rows[0].n);
          if (count >= MAX_VIEWS) throw new Error(`At most ${MAX_VIEWS} views can be kept for a report; delete one first`);
          await client.query(
            "INSERT INTO smart_system.report_saved_view (co_key, user_no, report_name, view_name, payload) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (co_key, user_no, report_name, view_name) DO UPDATE SET payload = EXCLUDED.payload, saved_at = now()",
            [...who, name, text],
          );
          return { saved: name };
        }
        case "delete": {
          await client.query("DELETE FROM smart_system.report_saved_view WHERE co_key = $1 AND user_no = $2 AND report_name = $3 AND view_name = $4", [...who, name]);
          return { deleted: name };
        }
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { timeoutMs: 15000 });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Report views error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "The request failed" }, { status: 500, headers });
  }
}
