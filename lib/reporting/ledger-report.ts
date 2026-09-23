import { readOnly } from "../db";
import { readSession } from "../master-program/session";

export async function readScopedLedgerReport(kind: string, params: URLSearchParams) {
  return readOnly(async (client) => {
    const session = await readSession(client, { companyId: Number(params.get("companyId")), yearKey: Number(params.get("yearKey")), loginName: params.get("loginName") ?? "" });
    const values: unknown[] = [session.yearId];
    const clauses = ["l.year_id = $1", "COALESCE(l.doc_pos, '') <> 'D'"];
    const from = params.get("from"), upto = params.get("upto");
    for (const [date, operator] of [[from, ">="], [upto, "<="]]) {
      if (!date) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("Invalid report date");
      values.push(date);
      clauses.push(`l.doc_date ${operator} $${values.length}::date`);
    }
    if (from && upto && from > upto) throw new Error("From date must be before upto date");
    if (kind === "journal-voucher") clauses.push("l.book = 19");
    const search = params.get("q")?.trim();
    if (search) {
      values.push(`%${search.slice(0, 120)}%`);
      clauses.push(`concat_ws(' ', a.name, l.full_docno, l.narration, b.book_desc) ILIKE $${values.length}`);
    }
    const schema = session.companySchema;
    const result = await client.query(`SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date",
      COALESCE(a.name, '') AS "Account", COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, '') AS "Document No.",
      COALESCE(b.book_desc, l.book::text) AS "Book", l.narration AS "Narration",
      CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
      CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit"
      FROM ${schema}.ledger l LEFT JOIN ${schema}.account a ON a.code=l.code
      LEFT JOIN ${schema}.book b ON b.book_key=l.book
      WHERE ${clauses.join(" AND ")} ORDER BY l.doc_date, l.led_key LIMIT 50001`, values);
    if (result.rows.length > 50000) throw new Error("Report exceeds 50,000 rows. Narrow the date range or search before exporting.");
    return { source: "legacy-postgresql", readOnly: true,
      report: { kind, title: kind === "daybook" ? "DAY BOOK" : kind === "ledger" ? "LEDGER TRANSACTIONS" : "JOURNAL REGISTER",
        note: "All matching transactions for the selected company and year. Totals cover displayed rows. Opening/running balances and voucher drill-down are not yet available." },
      columns: result.fields.map((field) => field.name), rows: result.rows, total: result.rows.length };
  });
}
