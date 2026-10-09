/**
 * SP_FRT_RPT_CHECKLIST_DAYBOOK's SQL, apart from the database (so it can be tested on its own): the
 * select list for the books chosen, the addon columns, the joins and the filter. PostgreSQL;
 * the procedure's SQL Server original is quoted where it differs.
 */
export type AddonField = { save: string; type: string };

/** CHARINDEX(' <book>,', FIEL_INBOOK): the desktop searches " " + "<book>" + ","; all books searches "  4, 5, 6,". */
export const inBookNeedle = (book: number): string => ` ${book < 0 ? " 4, 5, 6" : String(book)},`;

/** The MASTER addon fields are the ones kept for accounts of books 1, 2 and 3. */
export const MASTER_NEEDLE = " 1, 2, 3,";

const identifier = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "");

/** AENT.txt_X AS "X" for a memo (M) field, AENT.input_X AS "X" for the others. */
export const entryAddonColumn = (field: AddonField): string => `aent.${field.type === "M" ? "txt_" : "input_"}${identifier(field.save)} AS "${identifier(field.save)}"`;

/** COALESCE(adata.txt_X,'') AS "X"; a number column is coalesced to 0 as SQL Server's '' becomes. */
export const masterAddonColumn = (field: AddonField, numeric: boolean): string => {
  const name = identifier(field.save);
  if (field.type === "M") return `COALESCE(adata.txt_${name}::text,'') AS "${name}"`;
  return numeric ? `COALESCE(adata.input_${name},0) AS "${name}"` : `COALESCE(adata.input_${name}::text,'') AS "${name}"`;
};

const dayText = (column: string, alias: string) => `to_char(${column}, 'DD-Mon-YY') AS "${alias}"`;

/**
 * The select list: all books (book < 0) show the cheque columns and BOOK_NAME; the bank book (6) the
 * cheque columns; the cash and discount books only date, voucher, account, schedule and amounts.
 */
export function checklistSelect(book: number, entryAddons: readonly string[], masterAddons: readonly string[]): string {
  const cheque = book < 0 || book === 6;
  const parts = [
    dayText("led.doc_date", "DATE"), "led.full_docno", `ltrim(led.doc_no::text) AS "DOC_NO"`,
    ...(cheque ? [`ltrim(led.doc_no1::text) AS "CHQ_NO"`, dayText("led.chln_date", "CHQ_DATE"), dayText("led.reco_date", "RECO_DATE")] : []),
    "ac.name",
    ...(book < 0 ? [`ac1.name AS "BOOK_NAME"`] : []),
    `bsheet.bs_desc AS "Schedule"`,
    `(case when led.ac_dbcode=2 then led.amount::numeric else 0 end) AS "RECEIPT"`,
    `(case when led.ac_dbcode=1 then led.amount::numeric else 0 end) AS "PAYMENT"`,
    ...entryAddons, ...masterAddons,
    `led.narration AS "NARRATION"`,
  ];
  return parts.join(",");
}

/** FROM ... WHERE ... ORDER BY of the procedure; `from` and `upto` are SQL date literals. */
export function checklistFrom(db: string, book: number, bookCode: number, hasEntryAddon: boolean, from: string, upto: string): string {
  const parts = [`from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDON_DATA adata on adata.code=led.code left join ${db}BALSHEET bsheet on bsheet.bs_key=ac.bs_id`];
  if (book < 0) parts.push(`left join ${db}ACCOUNT ac1 on ac1.code=led.book_code`);
  if (hasEntryAddon) parts.push(`left join ${db}ADDON_AENTRY aent on aent.aona_ledid=led.led_key`);
  // (doc_posting<>'L' or (doc_posting<>'L' or reco_date is not null)) is doc_posting<>'L'.
  parts.push(`where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos<>'D' and led.doc_posting<>'L'`);
  parts.push(book < 0 ? `and COALESCE(led.doc_no,'') not like '%999999%' and led.book in (4,5,6)` : `and led.book_code=${Math.trunc(bookCode)}`);
  // The procedure's final select: by date, then the voucher number right-aligned to 10.
  parts.push(`order by led.doc_date::date, right('          ' || ltrim(led.doc_no::text), 10) nulls first, led.ac_dbcode, led.doc_no`);
  return parts.join(" ");
}
