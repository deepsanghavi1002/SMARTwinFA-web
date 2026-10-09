/**
 * SP_FRT_RPT_BOOKWISE's SQL and its row clean-up, apart from the database (so they can be tested on their own).
 * PostgreSQL; the SQL Server original is quoted where it differs.
 */

/** The select of the expense book (15): its entries and the bills each was set against (EXPENSE_LINK), or of any other book: its entries and the bills cleared (OUTCLEAR). */
export function bookwiseSelect(db: string, book: number): { select: string; from: string; extraWhere: string } {
  const style6 = (column: string) => `to_char(${column}, 'DD-Mon-YY')`;
  if (book === 15) {
    return {
      select: `led.led_key AS "LED_KEY",to_char(led.doc_date,'YYYYMMDD')||led.full_docno||ac.name||led.amount::numeric::text AS "SORTING_COL",${style6("led.doc_date")} AS "selected_date",led.full_docno AS "DOC_NO",ac.name AS "PARTY_NAME",led.amount::numeric AS "AMOUNT",${style6("outclr.elink_date")} AS "Ag_Date",outclr.elink_fulldocno AS "Ag_No"`,
      from: `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}EXPENSE_LINK outclr on outclr.elink_ag_ledid=led.led_key`,
      extraWhere: ` and ac.A_POS='A' and ac.book in (1)`,
    };
  }
  return {
    select: `led.led_key AS "LED_KEY",to_char(led.doc_date,'YYYYMMDD')||led.full_docno||ac.name||outclr.out_entryamt::numeric::text AS "SORTING_COL",${style6("led.doc_date")} AS "selected_date",led.full_docno AS "DOC_NO",ac.name AS "PARTY_NAME",case when coalesce(outclr.out_entryamt::numeric,0)=0 then led.amount::numeric else coalesce(outclr.out_entryamt::numeric,0) end AS "AMOUNT",${style6("outclr1.out_date")} AS "Ag_Date",outclr1.out_fulldocno AS "Ag_No",outclr.out_setoff::numeric AS "Ag_Amt"`,
    from: `FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}OUTCLEAR outclr on outclr.out_ledid=led.led_key left join ${db}OUTCLEAR outclr1 on outclr1.out_key=outclr.out_ag_outid left join ${db}BALSHEET bs on bs.bs_key=ac.bs_id`,
    extraWhere: ` and ac.A_POS='A' and led.full_docno<>'Auto/999999' and ac.book in (1,2,3)`,
  };
}

/** The where the procedure builds: the report's own where, its extra conditions and the dates (the base may be a bare "where"). */
export function bookwiseWhere(base: string, extra: string, from: string, upto: string): string {
  const bare = base.trim().toLowerCase() === "where";
  return `${base}${bare ? extra.replace(/^ and /, " ") : extra} and led.doc_date BETWEEN ${from} AND ${upto}`;
}

type Row = Record<string, unknown>;

/**
 * SR_NO: the row's number among those of the same voucher, date, amount and ledger key; every row after the first of its voucher is
 * blanked (DOC_NO, selected_date, AMOUNT 0), so a voucher with several bills shows once. LED_KEY goes. Rows keep the query's order.
 */
export function numberAndBlank(rows: readonly Row[]): Row[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.DOC_NO, row.selected_date, row.AMOUNT, row.LED_KEY].map((value) => String(value ?? "")).join("\u0000");
    const rank = (seen.get(key) ?? 0) + 1;
    seen.set(key, rank);
    const rest: Row = { ...row };
    delete rest.LED_KEY;
    return rank === 1 ? { ...rest, SR_NO: rank } : { ...rest, DOC_NO: "", selected_date: "", AMOUNT: 0, SR_NO: rank };
  });
}
