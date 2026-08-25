import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const COMPANY_SCHEMA = legacyCompanySchema();
const SALE_BOOK = 8;

export type LegacyInvoiceRegisterPayload = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  screen: Readonly<{ bookKey: 8; bookLabel: "SALE" }>;
  rows: ReadonlyArray<Readonly<{
    id: string;
    invoiceNumber: string;
    date: string;
    party: string | null;
    partyCode: number | null;
    amount: string;
    documentStatus: string | null;
    productLines: number;
    quantity: string;
    productValue: string;
    approved: boolean;
    printCount: number;
  }>>;
  pagination: Readonly<{ page: number; pageSize: number; total: number; totalPages: number; query: string }>;
}>;

type InvoiceRow = {
  process_key: number;
  invoice_number: string | null;
  p_date: string;
  party: string | null;
  code: number | null;
  p_amount: string | null;
  il_pos: string | null;
  product_lines: string;
  quantity: string | null;
  product_value: string | null;
  ent_approve: string | null;
  print_count: number | null;
};

export async function readLegacyInvoiceRegister(input: { query: string; page: number; pageSize: number }): Promise<LegacyInvoiceRegisterPayload> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20000ms'");
    const query = input.query.trim();
    const count = await client.query<{ total: string }>(`
      SELECT COUNT(*)::text AS total
      FROM ${COMPANY_SCHEMA}.process p
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE p.book = ${SALE_BOOK} AND p.entry_for = 'P' AND COALESCE(p.il_pos, '') <> 'D'
        AND ($1 = '' OR p.full_docno ILIKE '%' || $1 || '%' OR p.doc_no2 ILIKE '%' || $1 || '%'
          OR COALESCE(a.name, '') ILIKE '%' || $1 || '%')
    `, [query]);
    const total = Number(count.rows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
    const page = Math.min(Math.max(1, input.page), totalPages);
    const offset = (page - 1) * input.pageSize;
    const records = await client.query<InvoiceRow>(`
      WITH page_rows AS (
        SELECT p.*
        FROM ${COMPANY_SCHEMA}.process p
        LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
        WHERE p.book = ${SALE_BOOK} AND p.entry_for = 'P' AND COALESCE(p.il_pos, '') <> 'D'
          AND ($1 = '' OR p.full_docno ILIKE '%' || $1 || '%' OR p.doc_no2 ILIKE '%' || $1 || '%'
            OR COALESCE(a.name, '') ILIKE '%' || $1 || '%')
        ORDER BY p.p_date DESC, p.process_key DESC
        LIMIT $2 OFFSET $3
      )
      SELECT p.process_key,
             COALESCE(NULLIF(BTRIM(p.full_docno), ''), NULLIF(BTRIM(p.doc_no2), ''), p.process_key::text) AS invoice_number,
             p.p_date::text,
             NULLIF(BTRIM(a.name), '') AS party,
             p.code,
             p.p_amount::numeric::text,
             p.il_pos,
             COALESCE(lines.product_lines, '0') AS product_lines,
             lines.quantity::text AS quantity,
             lines.product_value::numeric::text AS product_value,
             p.ent_approve,
             p.print_count
      FROM page_rows p
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::text AS product_lines,
               COALESCE(SUM(pl.quantity), 0) AS quantity,
               COALESCE(SUM(pl.il_value), 0::money) AS product_value
        FROM ${COMPANY_SCHEMA}.prod_ledger pl
        WHERE pl.full_docno = p.full_docno AND pl.book = ${SALE_BOOK} AND COALESCE(pl.il_pos, '') <> 'D'
      ) lines ON true
      ORDER BY p.p_date DESC, p.process_key DESC
    `, [query, input.pageSize, offset]);
    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      screen: { bookKey: SALE_BOOK, bookLabel: "SALE" },
      rows: records.rows.map((row) => ({
        id: String(row.process_key),
        invoiceNumber: row.invoice_number ?? String(row.process_key),
        date: row.p_date.slice(0, 10),
        party: row.party,
        partyCode: row.code,
        amount: row.p_amount ?? "0",
        documentStatus: row.il_pos,
        productLines: Number(row.product_lines),
        quantity: row.quantity ?? "0",
        productValue: row.product_value ?? "0",
        approved: row.ent_approve?.trim().toUpperCase() === "Y",
        printCount: row.print_count ?? 0,
      })),
      pagination: { page, pageSize: input.pageSize, total, totalPages, query },
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
