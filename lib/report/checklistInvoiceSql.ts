/**
 * SP_FRT_RPT_CHECKLIST_INVOICE's SQL, apart from the database (so it can be tested on its own): the
 * slab columns and their joins, the select list for the licence, the joins and the filter.
 * PostgreSQL; the procedure's SQL Server original is quoted where it differs.
 */
export type Slab = { key: number; short: string; master: boolean };

/** @varBook: a credit note (16) is looked up as the sale (8), a debit note (11) as the purchase (13). */
export const slabBook = (book: number): number => (book === 16 ? 8 : book === 11 ? 13 : book);

/** CHARINDEX('<book>,', FIEL_INBOOK) for the entry addon fields (no leading space, as the desktop has it). */
export const entryNeedle = (book: number): string => `${slabBook(book)},`;

/** The account master's addon fields: sale books look for " 2,", the others " 3,". */
export const masterNeedle = (book: number): string => (slabBook(book) === 8 ? " 2," : " 3,");

const identifier = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "");

/**
 * What each slab adds: a master slab (CGST ...) the net amount before it and the tax description, a
 * slab the amount itself. SGST and UTGST are the second half of a split tax and use NET_AMT1 and
 * TAX_DESC1, with the net taken off twice. The desktop would stop on a second master slab that
 * names NET_AMT again (the same alias twice); here it is added once.
 */
export function slabParts(slabs: readonly Slab[]): { columns: string[]; joins: string[] } {
  const columns: string[] = [];
  const joins: string[] = [];
  const used = new Set<string>();
  const join = (alias: string, column: string, select: string, from: string) => {
    if (used.has(alias)) return false;
    used.add(alias);
    columns.push(column);
    joins.push(`left join (${select} from ${from}) "${alias}" on "${alias}".led_id=led.led_key`);
    return true;
  };
  for (const slab of slabs) {
    const short = identifier(slab.short);
    const key = Math.trunc(slab.key);
    const ext = (extra = "") => `LEDGER_EXT where SLAB_ID = ${key} and il_id is null${extra}`;
    if (slab.master) {
      const split = short.toUpperCase() === "SGST" || short.toUpperCase() === "UTGST";
      const n = split ? "1" : "";
      join(`NET_AMT${n}`, `COALESCE("NET_AMT${n}".net,0.00) AS "NET_AMT${n}"`, `select led_id, s_lastot::numeric-${split ? "(slab_amt::numeric+slab_amt::numeric)" : "slab_amt::numeric"} as net`, ext());
      join(`TAX_DESC${n}`, `COALESCE("TAX_DESC${n}".tax_desc,'') AS "TAX_DESC${n}"`, `select ledext.led_id, taxmst.tax_desc as tax_desc`, `LEDGER_EXT ledext left join TAX_MASTER taxmst on taxmst.tax_rec=ledext.tax_id where ledext.il_id is null and ledext.slab_id = ${key}`);
    }
    join(short, `COALESCE("${short}"."${short}",0.00) AS "${short}"`, `select led_id, slab_amt::numeric as "${short}"`, ext());
  }
  return { columns, joins };
}

const dayText = (column: string, alias: string) => `to_char(${column}, 'DD-Mon-YY') AS "${alias}"`;

/** The select list: licence 2 shows bundle, quantity and kgs; the others the quantity. */
export function invoiceSelect(db: string, license: number, slabColumns: readonly string[], entryAddons: readonly string[], masterAddons: readonly string[]): string {
  const sum = (column: string) => `coalesce((select SUM(${column}::numeric) from ${db}PROD_LEDGER where il_pos='A' and led_id=led.led_key),0)`;
  return [
    dayText("led.doc_date", "DATE"), "led.full_docno", `ltrim(led.doc_no::text) AS "DOC_NO"`, `led.doc_no1 AS "CHALLAN_NO"`, dayText("led.chln_date", "CHLN_DATE"), "ac.name",
    ...(license === 2 ? [`coalesce("BUNDLE".bundle,0) AS "BUNDLE"`, `${sum("quantity")} AS "QTY"`, `${sum("trn_qty1")} AS "KGS"`] : [`coalesce("QTY".qty,0) AS "QTY"`]),
    ...slabColumns, `led.amount::numeric AS "AMOUNT"`, ...entryAddons, ...masterAddons, `led.narration AS "NARRATION"`,
  ].join(",");
}

/** FROM ... WHERE ... ORDER BY; `from` and `upto` are SQL date literals. */
export function invoiceFrom(db: string, license: number, bookCode: number, hasEntryAddon: boolean, slabJoins: readonly string[], from: string, upto: string): string {
  const parts = [`from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=led.code`];
  parts.push(license === 2
    ? `left join (Select led_id, sum(bundle::numeric) as bundle from ${db}PROD_LEDGER where il_pos='A' group by led_id) "BUNDLE" on "BUNDLE".led_id=led.led_key`
    : `left join (Select led_id, sum(quantity::numeric) as qty from ${db}PROD_LEDGER where il_pos='A' group by led_id) "QTY" on "QTY".led_id=led.led_key`);
  if (hasEntryAddon) parts.push(`left join ${db}ADDON_AENTRY aent on aent.aona_ledid=led.led_key`);
  parts.push(...slabJoins.map((join) => join.split("LEDGER_EXT").join(`${db}LEDGER_EXT`).split("TAX_MASTER").join(`${db}TAX_MASTER`)));
  parts.push(`where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos<>'D' and led.book_code=${Math.trunc(bookCode)}`);
  // The procedure's final select: by date, then the voucher number right-aligned to 10.
  parts.push(`order by led.doc_date::date, right('          ' || ltrim(led.doc_no::text), 10) nulls first, led.doc_no`);
  return parts.join(" ");
}
