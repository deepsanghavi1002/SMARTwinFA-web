import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { cleanTemplate } from "@/lib/print/template";
import { logError } from "@/lib/log";

/**
 * A company's own print format (the Print Format Designer's template), one row for a company and format in smart_system.print_template, shared by
 * all its operators and machines. The only writing this route does, and only to that table. "get" gives { template } (null: the format's default).
 */

type Body = Readonly<{ action: string; session: SessionKey; format?: string; template?: unknown }>;

const FORMAT = /^[A-Za-z0-9_]{1,40}$/;
const headers = { "cache-control": "no-store" };
const MAX_TEMPLATE = 1_500_000;

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || typeof body.action !== "string" || !body.session || (body.action !== "list" && !FORMAT.test(String(body.format ?? "")))) {
    return Response.json({ error: "action, session and format are required" }, { status: 400, headers });
  }
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  const format = String(body.format ?? "");

  try {
    // The table is made on first use.
    await transaction(async (client) => {
      await client.query("CREATE TABLE IF NOT EXISTS smart_system.print_template (co_key integer NOT NULL, format_name varchar(40) NOT NULL, template jsonb NOT NULL, saved_by varchar(60), saved_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY (co_key, format_name))");
    }, { timeoutMs: 15000 }).catch(() => undefined);
    const result = await transaction(async (client) => {
      const session = await readSession(client, key);
      switch (body.action) {
        case "get": {
          const row = (await client.query("SELECT template FROM smart_system.print_template WHERE co_key = $1 AND format_name = $2", [session.companyKey, format])).rows[0];
          if (!row) return { template: null };
          try { return { template: cleanTemplate(row.template) }; } catch { return { template: null }; }
        }
        case "save": {
          const template = cleanTemplate(body.template);
          if (format.startsWith("c_") && !template.meta) throw new Error("A format of your own needs its name");
          const text = JSON.stringify(template);
          if (text.length > MAX_TEMPLATE) throw new Error("The template is too large to save");
          await client.query(
            "INSERT INTO smart_system.print_template (co_key, format_name, template, saved_by) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (co_key, format_name) DO UPDATE SET template = EXCLUDED.template, saved_by = EXCLUDED.saved_by, saved_at = now()",
            [session.companyKey, format, text, operator],
          );
          return { template };
        }
        case "list": {
          // The formats this company made itself (format names that start with c_), for the designer and the Print dialog.
          const found = (await client.query("SELECT format_name, template->'meta'->>'name' AS name, template->'meta'->>'base' AS base FROM smart_system.print_template WHERE co_key = $1 AND format_name LIKE 'c\\_%' ORDER BY saved_at", [session.companyKey])).rows;
          return { formats: found.filter((row) => row.name && row.base).map((row) => ({ id: String(row.format_name), name: String(row.name), base: String(row.base) })) };
        }
        case "reset": {
          await client.query("DELETE FROM smart_system.print_template WHERE co_key = $1 AND format_name = $2", [session.companyKey, format]);
          return { template: null };
        }
        default: throw new Error(`Unknown action ${body.action}`);
      }
    }, { timeoutMs: 15000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/print/template", action: "Print template", error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
