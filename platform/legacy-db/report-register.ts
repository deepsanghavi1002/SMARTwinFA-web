import { legacyPool } from "./pool.ts";
import { legacyCompanySchema } from "./company-schema.ts";

const COMPANY_SCHEMA = legacyCompanySchema();

export type LegacyReportKind = "daybook" | "ledger" | "outstanding" | "trial-balance" | "closing-stock" | "top-sales" | "cash-bank-voucher" | "journal-voucher" | "discount-voucher" | "lock-status" | "stock-movement" | "partywise-stock" | "daily-transaction" | "target-register" | "book-series" | "opening-balance" | "tax-setup" | "document-register" | "e-invoice-register" | "e-way-bill-register" | "configuration" | "sales-distribution";

export type LegacyReportPayload = Readonly<{
  source: "legacy-postgresql";
  readOnly: true;
  report: Readonly<{ kind: LegacyReportKind; title: string; note: string }>;
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<Readonly<Record<string, string | number | null>>>;
  total: number;
}>;

export type LegacyReportFilter = Readonly<{ from?: string; upto?: string; query?: string; variant?: string }>;

const queryByKind: Record<LegacyReportKind, { title: string; note: string; query: string }> = {
  daybook: {
    title: "DAY BOOK",
    note: "Posted ledger lines from the restored database. Debit/credit use the desktop AC_DBCODE convention (1 = debit, 2 = credit).",
    query: `
      SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date", COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text) AS "Document No.",
             COALESCE(b.book_desc, l.book::text) AS "Book", COALESCE(a.name, '—') AS "Account", l.narration AS "Narration",
             CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
             CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit",
             l.doc_posting AS "Posting"
      FROM ${COMPANY_SCHEMA}.ledger l
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = l.book
      WHERE COALESCE(l.doc_pos, '') <> 'D'
      ORDER BY l.doc_date DESC NULLS LAST, l.led_key DESC
      LIMIT 500
    `,
  },
  ledger: {
    title: "LEDGER REPORT",
    note: "Posted ledger lines from the restored database, latest first. Select an account in the desktop source for account-specific drill-down parity.",
    query: `
      SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date", COALESCE(a.name, '—') AS "Account",
             COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text) AS "Document No.",
             COALESCE(b.book_desc, l.book::text) AS "Book", l.narration AS "Narration",
             CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
             CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit"
      FROM ${COMPANY_SCHEMA}.ledger l
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = l.book
      WHERE COALESCE(l.doc_pos, '') <> 'D'
      ORDER BY l.doc_date DESC NULLS LAST, l.led_key DESC
      LIMIT 500
    `,
  },
  outstanding: {
    title: "OUTSTANDING REPORT",
    note: "Open outstanding rows use the desktop pending formula: entry amount minus current-year and prior-year setoff.",
    query: `
      SELECT o.out_key::text AS "Key", l.doc_date::date::text AS "Document Date", o.out_date::date::text AS "Outstanding Date",
             COALESCE(a.name, '—') AS "Account", COALESCE(o.out_fulldocno, l.full_docno, o.out_key::text) AS "Document No.",
             o.out_entryamt::numeric::text AS "Entry Amount", o.out_setoff::numeric::text AS "Setoff",
             o.out_ly_setoff::numeric::text AS "Prior Setoff",
             (o.out_entryamt::numeric - o.out_setoff::numeric - o.out_ly_setoff::numeric)::text AS "Pending"
      FROM ${COMPANY_SCHEMA}.outclear o
      LEFT JOIN ${COMPANY_SCHEMA}.ledger l ON l.led_key = o.out_ledid
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = o.code
      WHERE COALESCE(l.doc_pos, '') <> 'D'
        AND o.out_ag_outid IS NULL
        AND (o.out_entryamt::numeric - o.out_setoff::numeric - o.out_ly_setoff::numeric) <> 0
      ORDER BY l.doc_date DESC NULLS LAST, o.out_key DESC
      LIMIT 500
    `,
  },
  "trial-balance": {
    title: "TRIAL BALANCE",
    note: "Balance rows from AC_BALANCE. The current display is a source register; final grouping/rounding parity remains subject to the desktop final-report contract.",
    query: `
      SELECT a.code::text AS "Code", a.name AS "Account", COALESCE(b.book_desc, a.book::text) AS "Book",
             ab.year_id AS "Year", ab.opening::numeric::text AS "Opening", ab.debit::numeric::text AS "Debit",
             ab.credit::numeric::text AS "Credit", ab.closing::numeric::text AS "Closing"
      FROM ${COMPANY_SCHEMA}.ac_balance ab
      JOIN ${COMPANY_SCHEMA}.account a ON a.code = ab.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = a.book
      WHERE COALESCE(a.a_pos, '') <> 'D'
      ORDER BY a.name NULLS LAST, a.code
      LIMIT 1000
    `,
  },
  "closing-stock": {
    title: "MONTHLY CLOSING STOCK",
    note: "Current product balance rows use the desktop RP balance flag. Closing value is the source closing pieces multiplied by its stored reporting rate.",
    query: `
      SELECT pb.prod_id::text AS "Product Key", COALESCE(pm.prod_short, pm.prod_desc, pb.p_short, '—') AS "Product",
             pb.year_id AS "Year", pb.clsg_pcs::text AS "Closing Pieces", pb.clsg_pack::text AS "Closing Packs",
             pb.clsg_weight::text AS "Closing Weight", pb.rep_rate::text AS "Reporting Rate",
             (COALESCE(pb.clsg_pcs, 0) * COALESCE(pb.rep_rate, 0))::text AS "Closing Value"
      FROM ${COMPANY_SCHEMA}.prod_balance pb
      LEFT JOIN ${COMPANY_SCHEMA}.product_master pm ON pm.prod_key = pb.prod_id
      WHERE pb.prec_flag = 'RP' AND COALESCE(pm.prod_pos, '') <> 'D'
      ORDER BY COALESCE(pm.prod_short, pm.prod_desc, pb.p_short), pb.prod_id
      LIMIT 1000
    `,
  },
  "top-sales": {
    title: "TOP SALES PARTIES",
    note: "Sales-party ranking is calculated from active SALE process headers (book 8, entry category P) in the restored database.",
    query: `
      SELECT COALESCE(a.name, '—') AS "Party", p.code::text AS "Party Code", COUNT(*)::text AS "Invoices",
             COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Invoice Amount",
             MIN(p.p_date)::date::text AS "First Invoice", MAX(p.p_date)::date::text AS "Last Invoice"
      FROM ${COMPANY_SCHEMA}.process p
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE p.book = 8 AND p.entry_for = 'P' AND COALESCE(p.il_pos, '') <> 'D'
      GROUP BY a.name, p.code
      ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST, a.name
      LIMIT 500
    `,
  },
  "cash-bank-voucher": {
    title: "CASH / BANK VOUCHER REGISTER",
    note: "Posted ledger lines for the desktop Cash (4), Bank (6), and Petty Cash (7) books. New posting, allocation, cancellation, and reversal remain contract-gated.",
    query: `
      SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date", COALESCE(b.book_desc, l.book::text) AS "Book",
             COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text) AS "Voucher No.", COALESCE(a.name, '—') AS "Account",
             l.narration AS "Narration", CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
             CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit", l.doc_posting AS "Posting"
      FROM ${COMPANY_SCHEMA}.ledger l
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = l.book
      WHERE l.book IN (4, 6, 7) AND COALESCE(l.doc_pos, '') <> 'D'
      ORDER BY l.doc_date DESC NULLS LAST, l.led_key DESC LIMIT 500
    `,
  },
  "journal-voucher": {
    title: "JOURNAL VOUCHER REGISTER",
    note: "Posted ledger lines for the desktop Journal Book (19). The prototype supports balanced entry posting, cancellation/reversal and print-count recording against the restored PostgreSQL clone.",
    query: `
      SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date", COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text) AS "Voucher No.",
             COALESCE(a.name, '—') AS "Account", l.narration AS "Narration", CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
             CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit", l.doc_posting AS "Posting"
      FROM ${COMPANY_SCHEMA}.ledger l LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code
      WHERE l.book = 19 AND COALESCE(l.doc_pos, '') <> 'D'
      ORDER BY l.doc_date DESC NULLS LAST, l.led_key DESC LIMIT 500
    `,
  },
  "discount-voucher": {
    title: "DISCOUNT VOUCHER REGISTER",
    note: "Posted ledger lines for the desktop Discount Book (5). The prototype supports balanced entry posting, cancellation/reversal and print-count recording; advanced outstanding allocation rules remain a prototype assumption.",
    query: `
      SELECT l.led_key::text AS "Key", l.doc_date::date::text AS "Date", COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text) AS "Voucher No.",
             COALESCE(a.name, '—') AS "Account", l.narration AS "Narration", CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric::text ELSE '0' END AS "Debit",
             CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric::text ELSE '0' END AS "Credit", l.doc_posting AS "Posting"
      FROM ${COMPANY_SCHEMA}.ledger l LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code
      WHERE l.book = 5 AND COALESCE(l.doc_pos, '') <> 'D'
      ORDER BY l.doc_date DESC NULLS LAST, l.led_key DESC LIMIT 500
    `,
  },
  "lock-status": {
    title: "LOCK / UNLOCK DATA",
    note: "Live desktop book setup state. A lock blocks entry dates inside the displayed Lock From / Lock Upto range. The test deployment can update lock/unlock ranges in PostgreSQL; authorization and audit treatment remain prototype assumptions.",
    query: `
      SELECT bs.bs_rec::text AS "Setup Key", COALESCE(b.book_desc, bs.book::text) AS "Book",
             bs.book_code::text AS "Book Code", CASE WHEN bs.lock_from IS NULL OR bs.lock_upto IS NULL THEN 'Open' ELSE 'Locked' END AS "Period State",
             bs.lock_from::date::text AS "Lock From", bs.lock_upto::date::text AS "Lock Upto",
             bs.open_from::date::text AS "Open From", bs.open_upto::date::text AS "Open Upto",
             COALESCE(bs.open_user::text, '—') AS "Open User"
      FROM ${COMPANY_SCHEMA}.book_setup bs
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = bs.book
      ORDER BY b.book_desc NULLS LAST, bs.bs_rec
      LIMIT 500
    `,
  },
  "stock-movement": {
    title: "STOCK MOVEMENT REGISTER",
    note: "Live product-ledger movement rows. Quantity, value, party, product, source book, and document come directly from the restored legacy tables.",
    query: `
      SELECT pl.il_key::text AS "Line Key", pl.il_date::date::text AS "Date", COALESCE(b.book_desc, pl.book::text) AS "Book",
             COALESCE(NULLIF(BTRIM(pl.full_docno), ''), pl.doc_no1, pl.il_key::text) AS "Document No.",
             COALESCE(a.name, '—') AS "Party", COALESCE(pm.prod_short, pm.prod_desc, pl.il_billdesc, '—') AS "Product",
             COALESCE(pl.trn_pcs, pl.quantity, 0)::text AS "Quantity", COALESCE(pl.rate, 0)::text AS "Rate",
             COALESCE(pl.il_value::numeric, 0)::text AS "Value", COALESCE(pl.stock_nat, '—') AS "Stock Nature"
      FROM ${COMPANY_SCHEMA}.prod_ledger pl
      LEFT JOIN ${COMPANY_SCHEMA}.product_master pm ON pm.prod_key = pl.prod_id
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = pl.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = pl.book
      WHERE COALESCE(pl.il_pos, '') <> 'D'
      ORDER BY pl.il_date DESC NULLS LAST, pl.il_key DESC
      LIMIT 1000
    `,
  },
  "partywise-stock": {
    title: "PARTYWISE STOCK",
    note: "Live party/product movement aggregate from product-ledger rows. This is a source register; the desktop's exact period and UOM presentation options are still being reconciled.",
    query: `
      SELECT COALESCE(a.name, '—') AS "Party", COALESCE(pm.prod_short, pm.prod_desc, pl.il_billdesc, '—') AS "Product",
             COUNT(*)::text AS "Lines", COALESCE(SUM(pl.trn_pcs), SUM(pl.quantity), 0)::text AS "Quantity",
             COALESCE(SUM(pl.il_value::numeric), 0)::text AS "Value", MIN(pl.il_date)::date::text AS "First Movement",
             MAX(pl.il_date)::date::text AS "Last Movement"
      FROM ${COMPANY_SCHEMA}.prod_ledger pl
      LEFT JOIN ${COMPANY_SCHEMA}.product_master pm ON pm.prod_key = pl.prod_id
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = pl.code
      WHERE COALESCE(pl.il_pos, '') <> 'D'
      GROUP BY a.name, pm.prod_short, pm.prod_desc, pl.il_billdesc
      ORDER BY SUM(pl.il_value::numeric) DESC NULLS LAST, a.name, pm.prod_short
      LIMIT 1000
    `,
  },
  "daily-transaction": {
    title: "DAILY TRANSACTION SUMMARY",
    note: "Live daily debit/credit and document counts calculated from posted ledger rows using the desktop AC_DBCODE convention.",
    query: `
      SELECT l.doc_date::date::text AS "Date", COALESCE(b.book_desc, l.book::text) AS "Book", COUNT(*)::text AS "Lines",
             COUNT(DISTINCT COALESCE(NULLIF(BTRIM(l.full_docno), ''), l.doc_no, l.led_key::text))::text AS "Documents",
             COALESCE(SUM(CASE WHEN l.ac_dbcode = 1 THEN l.amount::numeric ELSE 0 END), 0)::text AS "Debit",
             COALESCE(SUM(CASE WHEN l.ac_dbcode = 2 THEN l.amount::numeric ELSE 0 END), 0)::text AS "Credit"
      FROM ${COMPANY_SCHEMA}.ledger l
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = l.book
      WHERE COALESCE(l.doc_pos, '') <> 'D'
      GROUP BY l.doc_date::date, b.book_desc, l.book
      ORDER BY l.doc_date::date DESC NULLS LAST, b.book_desc
      LIMIT 1000
    `,
  },
  "target-register": {
    title: "TARGET REGISTER",
    note: "Live target setup rows. Target edits remain disabled pending the desktop target validation, authorization, and audit contract.",
    query: `
      SELECT t.trg_key::text AS "Target Key", COALESCE(a.name, '—') AS "Account", COALESCE(pm.prod_short, pm.prod_desc, '—') AS "Product",
             t.trg_from::date::text AS "From", t.trg_upto::date::text AS "Upto", COALESCE(t.trg_qty, 0)::text AS "Target Quantity",
             COALESCE(t.trg_value::numeric, 0)::text AS "Target Value", COALESCE(t.trg_perc, 0)::text AS "Target %", t.year_id AS "Year"
      FROM ${COMPANY_SCHEMA}.target t
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = t.trg_accode
      LEFT JOIN ${COMPANY_SCHEMA}.product_master pm ON pm.prod_key = t.trg_pcode
      ORDER BY t.trg_from DESC NULLS LAST, t.trg_key DESC
      LIMIT 500
    `,
  },
  "book-series": {
    title: "BOOK / SERIES SETUP",
    note: "Live book setup and document series state. Changes are disabled until the setup-write and document-number concurrency contract is complete.",
    query: `
      SELECT bs.bs_rec::text AS "Setup Key", COALESCE(b.book_desc, bs.book::text) AS "Book", bs.book_code::text AS "Book Code",
             COALESCE(bn.bn_series, '—') AS "Series", COALESCE(bn.bn_dbcode::text, '—') AS "Side", COALESCE(bn.bn_from::date::text, '—') AS "From",
             COALESCE(bn.bn_upto::date::text, '—') AS "Upto", COALESCE(bn.bn_docno::text, '—') AS "Last Document No.",
             COALESCE(bn.bn_lastdate::date::text, '—') AS "Last Date"
      FROM ${COMPANY_SCHEMA}.book_setup bs
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = bs.book
      LEFT JOIN ${COMPANY_SCHEMA}.book_number bn ON bn.bn_id = bs.bs_rec AND COALESCE(bn.bn_pos, '') <> 'D'
      ORDER BY b.book_desc NULLS LAST, bn.bn_series NULLS LAST, bs.bs_rec
      LIMIT 1000
    `,
  },
  "opening-balance": {
    title: "OPENING BALANCE REGISTER",
    note: "Live account balance rows. This register shows source opening, debit, credit, and closing values; write and carry-forward functions remain contract-gated.",
    query: `
      SELECT a.code::text AS "Code", a.name AS "Account", COALESCE(b.book_desc, a.book::text) AS "Book", ab.year_id AS "Year",
             COALESCE(ab.opening::numeric, 0)::text AS "Opening", COALESCE(ab.debit::numeric, 0)::text AS "Debit",
             COALESCE(ab.credit::numeric, 0)::text AS "Credit", COALESCE(ab.closing::numeric, 0)::text AS "Closing"
      FROM ${COMPANY_SCHEMA}.ac_balance ab
      JOIN ${COMPANY_SCHEMA}.account a ON a.code = ab.code
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = a.book
      WHERE COALESCE(a.a_pos, '') <> 'D'
      ORDER BY ab.year_id DESC, a.name, a.code
      LIMIT 1000
    `,
  },
  "tax-setup": {
    title: "GST / TAX SETUP REGISTER",
    note: "Live tax master definitions. Return generation, submission, and changes remain disabled until statutory workflow and authority integrations are converted.",
    query: `
      SELECT tm.tax_rec::text AS "Tax Key", tm.tax_short AS "Short Name", tm.tax_desc AS "Tax Description", COALESCE(tm.tax_perc, 0)::text AS "Rate %",
             COALESCE(b.book_desc, tm.tax_book::text, '—') AS "Book", COALESCE(a.name, '—') AS "Posting Account",
             COALESCE(tm.tax_fromdt::date::text, '—') AS "From", COALESCE(tm.tax_uptodt::date::text, '—') AS "Upto", COALESCE(tm.tax_type, '—') AS "Type"
      FROM ${COMPANY_SCHEMA}.tax_master tm
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = tm.tax_book
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = tm.tax_accode
      WHERE COALESCE(tm.tax_pos, '') <> 'D'
      ORDER BY tm.tax_desc, tm.tax_rec
      LIMIT 500
    `,
  },
  "document-register": {
    title: "DOCUMENT REGISTER",
    note: "Live transaction header register from PROCESS. Document creation, editing, cancellation, and printing retain their own desktop side-effect contracts.",
    query: `
      SELECT p.process_key::text AS "Document Key", p.p_date::date::text AS "Date", COALESCE(b.book_desc, p.book::text) AS "Book",
             COALESCE(NULLIF(BTRIM(p.full_docno), ''), p.doc_no2, p.process_key::text) AS "Document No.", COALESCE(a.name, '—') AS "Party",
             COALESCE(p.p_amount::numeric, 0)::text AS "Amount", COALESCE(p.entry_for, '—') AS "Entry Type", COALESCE(p.ent_approve, '—') AS "Approved"
      FROM ${COMPANY_SCHEMA}.process p
      LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = p.book
      LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE COALESCE(p.il_pos, '') <> 'D'
      ORDER BY p.p_date DESC NULLS LAST, p.process_key DESC
      LIMIT 1000
    `,
  },
  "e-invoice-register": {
    title: "E-INVOICE REGISTER",
    note: "Live PROCESS rows carrying an e-invoice acknowledgement or IRN. Transmission, cancellation, and government integration are not yet enabled.",
    query: `
      SELECT p.process_key::text AS "Document Key", p.p_date::date::text AS "Date", COALESCE(NULLIF(BTRIM(p.full_docno), ''), p.doc_no2, p.process_key::text) AS "Document No.",
             COALESCE(a.name, '—') AS "Party", COALESCE(p.p_amount::numeric, 0)::text AS "Amount", COALESCE(p.einv_ackno, '—') AS "Acknowledgement",
             COALESCE(p.einv_ackdate, '—') AS "Acknowledgement Date", COALESCE(p.einv_irnno, '—') AS "IRN"
      FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE COALESCE(p.il_pos, '') <> 'D' AND (NULLIF(BTRIM(p.einv_ackno), '') IS NOT NULL OR NULLIF(BTRIM(p.einv_irnno), '') IS NOT NULL)
      ORDER BY p.p_date DESC NULLS LAST, p.process_key DESC LIMIT 500
    `,
  },
  "e-way-bill-register": {
    title: "E-WAY BILL REGISTER",
    note: "Live PROCESS rows carrying an e-way bill number. Generation, cancellation, and statutory validation are not yet enabled.",
    query: `
      SELECT p.process_key::text AS "Document Key", p.p_date::date::text AS "Date", COALESCE(NULLIF(BTRIM(p.full_docno), ''), p.doc_no2, p.process_key::text) AS "Document No.",
             COALESCE(a.name, '—') AS "Party", COALESCE(p.p_amount::numeric, 0)::text AS "Amount", p.eway_billno AS "E-Way Bill No.",
             COALESCE(p.eway_billdate::date::text, '—') AS "E-Way Bill Date", COALESCE(p.eway_valid, '—') AS "Valid Upto"
      FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE COALESCE(p.il_pos, '') <> 'D' AND NULLIF(BTRIM(p.eway_billno), '') IS NOT NULL
      ORDER BY p.p_date DESC NULLS LAST, p.process_key DESC LIMIT 500
    `,
  },
  configuration: {
    title: "APPLICATION CONFIGURATION",
    note: "Live setup parameter register. Configuration writes are disabled pending an explicit settings contract, authorization, audit, and recovery procedure.",
    query: `
      SELECT setup_key::text AS "Setup Key", COALESCE(winfa_version::text, '—') AS "WINFA Version", COALESCE(inventory, '—') AS "Inventory Enabled",
             COALESCE(i_posting, '—') AS "Inventory Posting", COALESCE(s_posting, '—') AS "Sales Posting", COALESCE(doc_upload, '—') AS "Document Upload",
             COALESCE(einvoice_req, '—') AS "E-Invoice", COALESCE(einvoice_json_req, '—') AS "E-Invoice JSON", COALESCE(image_req, '—') AS "Product Image"
      FROM ${COMPANY_SCHEMA}.setup ORDER BY setup_key LIMIT 100
    `,
  },
  "sales-distribution": {
    title: "SALES DISTRIBUTION",
    note: "Live Sale Invoice amount distribution by party. The web display is tabular until the dashboard layout and chart settings contract is converted from the desktop source.",
    query: `
      SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Invoices", COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Invoice Amount",
             ROUND(100 * SUM(p.p_amount::numeric) / NULLIF(SUM(SUM(p.p_amount::numeric)) OVER (), 0), 2)::text AS "Share %"
      FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
      WHERE p.book = 8 AND p.entry_for = 'P' AND COALESCE(p.il_pos, '') <> 'D'
      GROUP BY a.name ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST, a.name LIMIT 500
    `,
  },
};

const salesDistributionVariants: Record<string, { title: string; note: string; query: string }> = {
  "Sale amount": { title: "SALE AMOUNT DISTRIBUTION", note: "Live sale invoice amount distribution by party from PROCESS (book 8).", query: `
    SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Invoices", COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Amount",
           ROUND(100 * SUM(p.p_amount::numeric) / NULLIF(SUM(SUM(p.p_amount::numeric)) OVER (), 0), 2)::text AS "Share %"
    FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code
    WHERE p.book = 8 AND p.entry_for = 'P' AND COALESCE(p.il_pos, '') <> 'D'
    GROUP BY a.name ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST, a.name LIMIT 500
  ` },
  "Sale quantity": { title: "SALE QUANTITY DISTRIBUTION", note: "Live sale quantity distribution by party from PROD_LEDGER (book 8).", query: `
    SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Lines", COALESCE(SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)), 0)::text AS "Quantity",
           ROUND(100 * SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)) / NULLIF(SUM(SUM(COALESCE(pl.trn_pcs, pl.quantity, 0))) OVER (), 0), 2)::text AS "Share %"
    FROM ${COMPANY_SCHEMA}.prod_ledger pl LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = pl.code
    WHERE pl.book = 8 AND COALESCE(pl.il_pos, '') <> 'D'
    GROUP BY a.name ORDER BY SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)) DESC NULLS LAST, a.name LIMIT 500
  ` },
  "Purchase amount": { title: "PURCHASE AMOUNT DISTRIBUTION", note: "Live purchase amount distribution by party from PROCESS and restored purchase books.", query: `
    SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Documents", COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Amount",
           ROUND(100 * SUM(p.p_amount::numeric) / NULLIF(SUM(SUM(p.p_amount::numeric)) OVER (), 0), 2)::text AS "Share %"
    FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = p.code LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = p.book
    WHERE COALESCE(p.il_pos, '') <> 'D' AND COALESCE(b.book_desc, '') ILIKE '%purchase%'
    GROUP BY a.name ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST, a.name LIMIT 500
  ` },
  "Purchase quantity": { title: "PURCHASE QUANTITY DISTRIBUTION", note: "Live purchase quantity distribution by party from PROD_LEDGER and restored purchase books.", query: `
    SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Lines", COALESCE(SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)), 0)::text AS "Quantity",
           ROUND(100 * SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)) / NULLIF(SUM(SUM(COALESCE(pl.trn_pcs, pl.quantity, 0))) OVER (), 0), 2)::text AS "Share %"
    FROM ${COMPANY_SCHEMA}.prod_ledger pl LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = pl.code LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = pl.book
    WHERE COALESCE(pl.il_pos, '') <> 'D' AND COALESCE(b.book_desc, '') ILIKE '%purchase%'
    GROUP BY a.name ORDER BY SUM(COALESCE(pl.trn_pcs, pl.quantity, 0)) DESC NULLS LAST, a.name LIMIT 500
  ` },
};

const topReportVariants: Record<string, { title: string; note: string; query: string }> = {
  Customer: { title: "TOP CUSTOMERS", note: "Live customer ranking by sale invoice value from active SALE PROCESS headers.", query: `
    SELECT COALESCE(a.name, '—') AS "Party", p.code::text AS "Party Code", COUNT(*)::text AS "Invoices", COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Amount",
           MIN(p.p_date)::date::text AS "First Invoice", MAX(p.p_date)::date::text AS "Last Invoice"
    FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code=p.code
    WHERE p.book=8 AND p.entry_for='P' AND COALESCE(p.il_pos,'')<>'D'
    GROUP BY a.name,p.code ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST,a.name LIMIT 500
  ` },
  Supplier: { title: "TOP SUPPLIERS", note: "Live supplier ranking by purchase value from PROCESS and restored purchase books.", query: `
    SELECT COALESCE(a.name, '—') AS "Party", p.code::text AS "Party Code", COUNT(*)::text AS "Invoices", COALESCE(SUM(p.p_amount::numeric), 0)::text AS "Amount",
           MIN(p.p_date)::date::text AS "First Invoice", MAX(p.p_date)::date::text AS "Last Invoice"
    FROM ${COMPANY_SCHEMA}.process p LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code=p.code LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key=p.book
    WHERE COALESCE(p.il_pos,'')<>'D' AND COALESCE(b.book_desc,'') ILIKE '%purchase%'
    GROUP BY a.name,p.code ORDER BY SUM(p.p_amount::numeric) DESC NULLS LAST,a.name LIMIT 500
  ` },
  Item: { title: "TOP SALE ITEMS", note: "Live item ranking by sale value and quantity from PROD_LEDGER (book 8).", query: `
    SELECT COALESCE(pm.prod_short,pm.prod_desc,pl.il_billdesc,'—') AS "Product", COUNT(*)::text AS "Lines", COALESCE(SUM(COALESCE(pl.trn_pcs,pl.quantity,0)),0)::text AS "Quantity",
           COALESCE(SUM(pl.il_value::numeric),0)::text AS "Amount", MIN(pl.il_date)::date::text AS "First Movement", MAX(pl.il_date)::date::text AS "Last Movement"
    FROM ${COMPANY_SCHEMA}.prod_ledger pl LEFT JOIN ${COMPANY_SCHEMA}.product_master pm ON pm.prod_key=pl.prod_id
    WHERE pl.book=8 AND COALESCE(pl.il_pos,'')<>'D'
    GROUP BY pm.prod_short,pm.prod_desc,pl.il_billdesc ORDER BY SUM(pl.il_value::numeric) DESC NULLS LAST,pm.prod_short LIMIT 500
  ` },
};

function ledgerDistributionVariant(label: "Expense" | "Receipt" | "Payment") {
  const search = label.toLowerCase();
  const condition = label === "Receipt"
    ? "(COALESCE(b.book_desc, '') ILIKE '%cash%' OR COALESCE(b.book_desc, '') ILIKE '%bank%') AND l.ac_dbcode = 1"
    : label === "Payment"
      ? "(COALESCE(b.book_desc, '') ILIKE '%cash%' OR COALESCE(b.book_desc, '') ILIKE '%bank%') AND l.ac_dbcode = 2"
      : "COALESCE(b.book_desc, '') ILIKE '%expense%'";
  const source = label === "Receipt" || label === "Payment" ? "cash/bank ledger movements using the desktop debit/credit convention" : "restored expense books";
  return { title: `${label.toUpperCase()} DISTRIBUTION`, note: `Live ${search} distribution by account from ${source}.`, query: `
    SELECT COALESCE(a.name, '—') AS "Party", COUNT(*)::text AS "Lines", COALESCE(SUM(l.amount::numeric), 0)::text AS "Amount",
           ROUND(100 * SUM(l.amount::numeric) / NULLIF(SUM(SUM(l.amount::numeric)) OVER (), 0), 2)::text AS "Share %"
    FROM ${COMPANY_SCHEMA}.ledger l LEFT JOIN ${COMPANY_SCHEMA}.account a ON a.code = l.code LEFT JOIN ${COMPANY_SCHEMA}.book b ON b.book_key = l.book
    WHERE COALESCE(l.doc_pos, '') <> 'D' AND ${condition}
    GROUP BY a.name ORDER BY SUM(l.amount::numeric) DESC NULLS LAST, a.name LIMIT 500
  ` };
}

const dateColumnByKind: Partial<Record<LegacyReportKind, string>> = {
  daybook: "Date", ledger: "Date", outstanding: "Document Date", "cash-bank-voucher": "Date", "journal-voucher": "Date", "discount-voucher": "Date", "stock-movement": "Date", "partywise-stock": "First Movement", "daily-transaction": "Date", "target-register": "From", "book-series": "From", "document-register": "Date", "e-invoice-register": "Date", "e-way-bill-register": "Date",
};

function validDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

export async function readLegacyReport(kind: LegacyReportKind, filter: LegacyReportFilter = {}): Promise<LegacyReportPayload> {
  const selectedVariant = filter.variant ?? "";
  const definition = kind === "sales-distribution" ? (salesDistributionVariants[selectedVariant] ?? (selectedVariant === "Expense" || selectedVariant === "Receipt" || selectedVariant === "Payment" ? ledgerDistributionVariant(selectedVariant) : salesDistributionVariants["Sale amount"]))
    : kind === "top-sales" ? (topReportVariants[selectedVariant] ?? topReportVariants.Customer)
      : queryByKind[kind];
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20000ms'");
    const sourceQuery = definition.query.trim().replace(/\s+LIMIT\s+\d+\s*$/i, "");
    const dateColumn = dateColumnByKind[kind];
    const clauses: string[] = []; const params: string[] = [];
    const from = validDate(filter.from); const upto = validDate(filter.upto); const query = (filter.query ?? "").trim().slice(0, 120);
    if (dateColumn && from) { params.push(from); clauses.push(`NULLIF(NULLIF(source."${dateColumn}", '—'), '')::date >= $${params.length}::date`); }
    if (dateColumn && upto) { params.push(upto); clauses.push(`NULLIF(NULLIF(source."${dateColumn}", '—'), '')::date <= $${params.length}::date`); }
    if (query) { params.push(`%${query}%`); clauses.push(`to_jsonb(source)::text ILIKE $${params.length}`); }
    const filteredQuery = `SELECT * FROM (${sourceQuery}) source${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} LIMIT 1000`;
    const result = await client.query<Record<string, string | number | null>>(filteredQuery, params);
    await client.query("COMMIT");
    return {
      source: "legacy-postgresql",
      readOnly: true,
      report: { kind, title: definition.title, note: definition.note },
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
      total: result.rowCount ?? result.rows.length,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
