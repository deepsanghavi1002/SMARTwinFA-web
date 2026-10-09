/**
 * SP_FRT_RPT_TDS_REPORT's SQL and arithmetic, apart from the database (so they can be tested on their own): the purchase, expense and
 * expense-return vouchers with the deductee's details, the tax deducted against each, and what the rate says it should have been.
 * PostgreSQL; the SQL Server original is quoted where it differs.
 */
type Row = Record<string, unknown>;

const num = (value: unknown): number => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const round0 = (value: number): number => Math.round(value);
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The vouchers of the period (books 10 expense return, 13 purchase, 15 expense) with the party's address, PAN, deductee type and the TDS chart's
 * nature of payment, section and rates, the net amount (the voucher's amount before the first tax slab of its book) and the TDS journal set
 * against it. `setup` is the schema of the TDS chart; `from` and `upto` are SQL date literals.
 */
export function tdsQuery(db: string, setup: string, purchaseSlab: number, expenseSlab: number, from: string, upto: string): string {
  const slab = `case when led.book=13 then ${Math.trunc(purchaseSlab)} else ${Math.trunc(expenseSlab)} end`;
  const net = `(select s_lastot::numeric-slab_amt::numeric from ${db}LEDGER_EXT where led.led_key=led_id and il_id is null and slab_id=${slab} limit 1)`;
  return `select led.full_docno AS "full_docno",outclr.out_ag_outid AS "OUT_AG_OUTID",led.book AS "BOOK",led.code AS "CODE",outclr1.out_key AS "OUT_KEY",ac.name AS "name",`
    + `(addr.address_1||' '||addr.address_2||' '||addr.address_3||' '||addr.city||' '||addr.pin_code) AS "Address",addr.pan_no AS "PAN",smrtset.nature_of_payment AS "NATURE_OF_PAYMENT",idopt.opt_desc AS "Deductee_Type",smrtset.section_no AS "Section",`
    + `(case when led.book=13 then 'Purch' when position('JOB' in upper(led.doc_series)) > 0 then 'Job' when led.book=10 then 'ExpReturn' else 'Exp' end) AS "Inovice_Type",`
    + `ltrim(rtrim(led.doc_no::text)) AS "Invoice_No",to_char(led.doc_date,'DD/MM/YYYY') AS "Invoice_Date",ltrim(rtrim(led.doc_no1::text)) AS "Ref_No",to_char(led.chln_date,'DD/MM/YYYY') AS "Ref_Date",`
    + `(case when led.book=10 then ${net}*-1 else ${net} end) AS "Net_Amount",`
    + `(case when left(idopt.opt_desc,1) = 'C' then smrtset.tds_rate_company::numeric else smrtset.tds_rate_individual::numeric end) AS "TDS_Rate",`
    + `(case when led.book=10 then outclr1.out_entryamt::numeric*-1 else outclr1.out_entryamt::numeric end) AS "TDS_AMOUNT",outclr1.out_fulldocno AS "TDS_JV_No"`
    + ` FROM ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code=led.code left join ${db}ADDRESS addr on addr.code=ac.code and addr.address_id=1`
    + ` left join ${db}IDOPT_MASTER idopt on idopt.idopt_key::text=ac.type_deduct::text left join ${setup}.TDS_CHART smrtset on smrtset.tds_key::text=ac.nature_pay::text`
    + ` left join ${db}OUTCLEAR outclr on outclr.out_ledid=led.led_key left join ${db}OUTCLEAR outclr1 on outclr1.out_ag_outid=outclr.out_key and outclr1.out_entrybook=19 and outclr1.out_ledid in (select led_key from ${db}LEDGER where book = 19 and imp_ledkey>0)`
    + ` where led.doc_date BETWEEN ${from} AND ${upto} and led.doc_pos='A' and led.book in (10,13,15) order by led.doc_date,led.doc_no1`;
}

/** An expense return set against a bill takes the TDS of the other side: the first clearing of another account in the TDS journal. */
export const returnLookup = (db: string): string =>
  `select p.code, p.ag, o.amount, o.out_key from unnest($1::int[], $2::int[]) as p(code, ag) left join lateral (select out_setoff::numeric*-1 as amount, out_key from ${db}OUTCLEAR where p.code <> code and out_fulldocno in (select out_fulldocno from ${db}OUTCLEAR where out_entrybook=19 and out_ag_outid=p.ag) order by out_key limit 1) o on true`;

/** The TDS journal's number of a clearing key. */
export const journalLookup = (db: string): string =>
  `select p.k, (select out_fulldocno from ${db}OUTCLEAR where out_ag_outid=p.k order by out_key limit 1) as number from unnest($1::int[]) as p(k)`;

const COLUMNS = ["name", "Address", "PAN", "NATURE_OF_PAYMENT", "Deductee_Type", "Section", "Inovice_Type", "Invoice_No", "Invoice_Date", "Ref_No", "Ref_Date", "Net_Amount", "TDS_Rate", "TDS_AMOUNT", "TDS_JV_No", "ACT_TDS_AMT", "DIFF_TDS_AMT"];
export const TDS_COLUMNS: readonly string[] = COLUMNS;

/**
 * ACT_TDS_AMT = Net_Amount x TDS_Rate / 100 to the rupee where there is a rate and a net amount; DIFF_TDS_AMT = TDS_AMOUNT - ACT_TDS_AMT; the
 * vouchers with a rate and TDS deducted are kept, and the working columns (voucher, clearing keys, book, account) go.
 */
export function finishRows(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const rate = num(row.TDS_Rate);
    const act = rate > 0 && num(row.Net_Amount) !== 0 ? round0((num(row.Net_Amount) * rate) / 100) : 0;
    const amount = row.TDS_AMOUNT === null || row.TDS_AMOUNT === undefined ? null : num(row.TDS_AMOUNT);
    const diff = amount === null ? null : round2(amount - act);
    if (!(rate > 0 && amount !== null && amount !== 0)) continue;
    out.push(Object.fromEntries(COLUMNS.map((name) => [name, name === "ACT_TDS_AMT" ? act : name === "DIFF_TDS_AMT" ? diff : row[name] ?? null])));
  }
  return out;
}
