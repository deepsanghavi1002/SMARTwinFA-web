import type { Loader } from "../master-program/load";
import { toDecimal, toText } from "../master-program/legacy";

/**
 * The Multi Year > Chart Report data (the desktop's Report_MultyYearChart.Btn_Ok_Click): for every year of the company that meets From .. Upto,
 * the Sale and Purchase (net of the master tax slabs when the books have them) or the Receipt and Payment of the cash / bank books.
 * One row a year, the oldest first; Receipt is the sale side (or the bank receipts) and Payment the purchase side (or the bank payments).
 */

export type YearBooks = "SalePurchase" | "BankCash";
export type YearRow = Readonly<{ year: string; receipt: number; payment: number }>;
export const YEAR_BOOKS: readonly YearBooks[] = ["SalePurchase", "BankCash"];

function systemSchema() {
  const candidate = process.env.DB_SCHEMA_SYSTEM?.trim() || "smart_system";
  if (!/^[a-z_][a-z0-9_]*$/i.test(candidate)) throw new Error("DB_SCHEMA_SYSTEM must be a PostgreSQL identifier.");
  return candidate;
}

export type CompanyYear = Readonly<{ y1: Date; y2: Date; schema: string }>;

/**
 * The company's years that meet From .. Upto, oldest first: the CNAME rows of the companies with the same bill name (else name) and group.
 * Licences 7 and 8 never go by bill name (the dashboard reads only the name for them).
 */
export async function companyYears(loader: Loader, from: string, upto: string, billNameAllowed = true): Promise<CompanyYear[]> {
  const system = systemSchema();
  const { client, session } = loader;
  const own = (await client.query(`SELECT btrim(coalesce(bill_name,'')) AS bill_name, btrim(name) AS name, btrim(coalesce(co_group,'')) AS co_group FROM ${system}.company WHERE co_key = $1`, [session.companyKey])).rows[0];
  if (!own) throw new Error("The company was not found");
  const byBill = billNameAllowed && own.bill_name !== "";
  const rows = (await client.query(
    `SELECT n.c_tarikh1::date AS y1, n.c_tarikh2::date AS y2, lower(btrim(c.co_dataname)) AS schema_name FROM ${system}.cname n LEFT JOIN ${system}.company c ON c.co_key = n.c_id`
    + ` WHERE n.c_tarikh2::date >= $1::date AND n.c_tarikh1::date <= $2::date AND ${byBill ? "btrim(c.bill_name)" : "btrim(c.name)"} = $3 AND btrim(coalesce(c.co_group,'')) = $4 ORDER BY n.c_tarikh1`,
    [from, upto, byBill ? own.bill_name : own.name, own.co_group])).rows;
  const result: CompanyYear[] = [];
  for (const row of rows) {
    const schema = toText(row.schema_name);
    if (!/^[a-z0-9_]+$/.test(schema)) continue;
    const exists = (await client.query("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ledger'", [schema])).rowCount;
    if (exists) result.push({ y1: row.y1, y2: row.y2, schema });
  }
  return result;
}

export async function yearChart(loader: Loader, books: YearBooks, from: string, upto: string): Promise<YearRow[]> {
  const { client } = loader;
  const years = await companyYears(loader, from, upto);

  // The master tax slabs of the sale and purchase books (this year's setup, used for every year).
  let slabs = "";
  if (books === "SalePurchase") {
    const rows = await loader.readTable("SELECT slab_key FROM |sys.db|slab_master WHERE book IN (8,13) AND slab_master='Y' AND slab_active='Y' AND slab_link=0");
    slabs = (rows ?? []).map((row) => Math.trunc(Number(row.slab_key))).filter((key) => Number.isInteger(key)).join(",");
  }

  const result: YearRow[] = [];
  for (const year of years) {
    const schema = year.schema;
    let sql: string;
    if (books === "BankCash") {
      sql = `SELECT coalesce(sum(CASE WHEN ac_dbcode=1 THEN amount::numeric ELSE 0 END),0) AS payment, coalesce(sum(CASE WHEN ac_dbcode=2 THEN amount::numeric ELSE 0 END),0) AS receipt`
        + ` FROM ${schema}.ledger WHERE book IN (4,6) AND doc_pos='A' AND doc_posting='P'`;
    } else {
      const net = slabs === "" ? "amount::numeric" : "(ledext.s_lastot::numeric - ledext.slab_amt::numeric)";
      const join = slabs === "" ? "" : ` LEFT JOIN ${schema}.ledger_ext ledext ON ledext.led_id=led.led_key`;
      const slabWhere = slabs === "" ? "" : ` AND ledext.il_id IS NULL AND ledext.slab_id IN (${slabs})`;
      sql = `SELECT coalesce(sum(CASE WHEN led.book=13 OR (led.book=16 AND led.ag_book=13) THEN ${net} WHEN led.book=11 AND led.ag_book=13 THEN ${net} * -1 ELSE 0 END),0) AS payment,`
        + ` coalesce(sum(CASE WHEN led.book=8 OR (led.book=11 AND led.ag_book=8) THEN ${net} WHEN led.book=16 AND led.ag_book=8 THEN ${net} * -1 ELSE 0 END),0) AS receipt`
        + ` FROM ${schema}.ledger led${join} WHERE led.book IN (8,11,13,16) AND led.doc_pos='A' AND led.doc_posting='P'${slabWhere}`;
    }
    const row = (await client.query(sql)).rows[0];
    const label = `${new Date(year.y1).getFullYear()}_${new Date(year.y2).getFullYear()}`;
    result.push({ year: label, receipt: toDecimal(row?.receipt), payment: toDecimal(row?.payment) });
  }
  return result;
}
