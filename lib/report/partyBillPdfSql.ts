/**
 * SP_FRT_RPT_PARTY_BILL_PDF's SQL, apart from the database (so it can be tested on its own). PostgreSQL; the SQL Server original is quoted where
 * it differs. `from` and `upto` are SQL date literals; `codes` the selected accounts (none: every account).
 */
export type PartyBillInput = {
  db: string;
  book: number;
  codes: readonly number[];
  from: string;
  upto: string;
  /** Licences 19, 29, 68 and 73 keep out the entries booked in a CA_ENT cash account, unless no account is short-named CA_ENT. */
  hideCaEnt: boolean;
};

/** The selected account codes out of the "(1,2,3)" list the Account tab gives. */
export const codesOf = (list: string): number[] => [...list.matchAll(/-?\d+/g)].map((match) => Number(match[0])).filter((code) => Number.isInteger(code) && code > 0);

/** CONVERT(varchar(11),DOC_DATE,103) is the SELECTED_DATE text; Note_Nature is 1 when the voucher has inventory lines. */
export function partyBillQuery(input: PartyBillInput): string {
  const { db, book, codes, from, upto, hideCaEnt } = input;
  return `select led.LED_KEY::text AS "SMART_LED_KEY",ac.Name AS "name",to_char(led.DOC_DATE,'DD/MM/YYYY') as "SELECTED_DATE",led.FULL_DOCNO as "FULL_DOCNO",led.AMOUNT::numeric AS "AMOUNT",`
    + `coalesce((select case when count(*) > 0 then 1 else 0 end from ${db}prod_ledger where il_pos='A' and led_id=led.led_key),0) as "Note_Nature"`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code where led.DOC_POS='A'${codes.length > 0 ? ` and led.code in (${codes.join(",")})` : ""}`
    + ` and led.book=${Math.trunc(book)} and led.DOC_DATE BETWEEN ${from} AND ${upto}`
    + `${hideCaEnt ? ` AND LED.BOOK_CODE in (select code from ${db}ACCOUNT where A_SHORT<>'CA_ENT')` : ""}`;
}
