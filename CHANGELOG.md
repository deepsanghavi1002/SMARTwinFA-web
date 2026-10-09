# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

## 2026-10-09 (Interest Calculation: Account help by the account book)
- `lib/report/registerBooks.ts` `accountHelpBooks`: Interest Calculation (32)'s BOOK combo is the account book itself (1, 2, 3: `ac.BOOK = @int_book`), so its Account tab lists the accounts of
  that book (the Agewise rule, SALE -> debtors, did not fit). Test in `tests/register-books.test.mts`.
- To confirm: if the Account tab is still wrong, send the desktop and web screenshots (BOOK chosen, Account tab open).

## 2026-10-09 (Interest Calculation)
- Ported `SP_FRT_RPT_INTEREST` (REPORT > Extra > Interest Calculation, report_key 32): `lib/report/interest.ts` (queries) and `lib/report/interestSql.ts` (rate, days, percent
  expressions, the summary's roll-up). Wired as `case 32` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/interest-sql.test.mts`.
  - Rate: the runtime box's (12 when blank, applied to every account); with the box blank each account's own `INT_PERC` unless 0. 365 days a year, 366 when Tarikh2's year is a leap year.
  - Detail: a line for each account's opening (the year's opening balance; from a From after the year's start, plus the entries before it) and each interest entry
    (`int_type<>10`, book 19 or receipts) of the period: principal, days to Upto, interest received / paid, rate. TDSREQ adds TDS_RATE.
  - Summary: each party's balance (credits plus, debits minus) by period, from each date it changed to the day before the next change and to Upto, at the one rate.
  - Account help: the Account tab lists the parties of the chosen book as Agewise Outstanding (the BOOK combo's value is read as the book number when it has no book column).
- As the desktop does it: from a From after the year's start every account takes its Dr / Cr from the opening balance without its sign plus the entries before From.
- To confirm: compare Detail and Summary with the desktop for a party; if the first format of this report is a different procedure, send it.

## 2026-10-09 (Outstanding Bookwise)
- Ported `SP_FRT_RPT_BOOKWISE` (REPORT > Outstanding > Bookwise, report_key 135): `lib/report/bookwise.ts` (query) and `lib/report/bookwiseSql.ts` (select, where, the SR_NO clean-up).
  Wired as `case 135` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/bookwise-sql.test.mts`.
  - Entries of the period of the accounts of books 1, 2, 3 (the expense book 15: general accounts, bills from EXPENSE_LINK; any other book: bills from OUTCLEAR), with the
    bill's date, number and the amount set off (AG_DATE, AG_NO, AG_AMT); a voucher set against several bills shows once with the bills under it (SR_NO > 1 rows blanked).
  - The BOOK combo's value is read as the book number when the combo gives no book column.
- To confirm: compare a period with the desktop; if the report's first format is a different procedure (SP_STD_RPT_BOOKWISE) send it.

## 2026-10-09 (Against Book: two entries, SALE and PURCHASE)
- Desktop (credit / debit note): Against Book offers SALE and PURCHASE only; the web showed six (the setup's list repeats the books: SALE, PURCHASE, SALE, PURCHASE, SALE,
  SALE - Direct) in Register, and the Against Book chosen then filtered the register on `led.ag_book` even for a plain SALE register.
- `lib/report/setup.ts` `againstBookItems` / `lib/report/registerBooks.ts` `againstBooksOf`: a credit or debit note is against the SALE (book 8) or the PURCHASE (book 13), the first
  entry of each book from the first combo; any other register has none (the combo is greyed, no `ag_book` filter). `lib/report/generate.ts` and `features/report/ReportCombine.tsx`
  use this list instead of the setup's own for cmb_AgainstBook. Test in `tests/register-books.test.mts`.
- To confirm: Register, Form Summary and Yearly Tax Summary with a credit note and a debit note: two entries, SALE first.

## 2026-10-09 (Against Book filled for credit / debit note registers)
- REGISTER : CREDIT NOTE / DEBIT NOTE (Register, Form Summary, Yearly Tax Summary): the Against Book combo (cmb_AgainstBook) was empty, so no against book
  went to the report. `lib/report/setup.ts` `againstBookItems` (and `firstComboOptions`, the first combo's rows, shared with the report's load): a credit note (16) is
  against the sale registers (8, cash sale 9), a debit note (11) against the purchase (13, cash purchase 14), taken from the first combo's own entries, the
  value being the book number (`led.ag_book`, `@int_against_book`). `lib/report/generate.ts` reads the same list when the report runs; `app/api/report/route.ts`
  has an "against" action; `features/report/ReportCombine.tsx` refills the combo when the register changes (first entry chosen) and greys it when it has none.
  `lib/report/registerBooks.ts` `againstBooksOf`; test in `tests/register-books.test.mts`.
- To confirm: the entries the desktop offers for each note (only the first, SALE, is seen on the desktop screenshot); the Against Book is used only when the setup's own
  list is empty.

## 2026-10-09 (Against Book list: show why it is empty)
- Problem: REGISTER : CREDIT NOTE / DEBIT NOTE (Form Summary, Register, Yearly Tax Summary): the Against Book combo is empty on the web (the desktop
  fills it, e.g. SALE for a credit note).
- `app/api/report/route.ts`, `features/report/ReportCombine.tsx`: the first-combo refill (fc_lostfocus_qry) now returns the database's warnings and the screen
  shows the first one when the query fails, so the cause can be read from the screen.
- To confirm: send that message (or `SELECT fc_lostfocus_qry, lostfocus_qry_control, fc_lf_qry_dispmem, fc_lf_qry_key FROM smart_setup.report_properties
  WHERE report_key IN (3, 14, 18)`) and the Against Book list is fixed from it.

## 2026-10-09 (Yearly Tax Summary: Account help by the register)
- `features/report/ReportCombine.tsx`: the REGISTER combo's value is read as the book number for Form Summary and Yearly Tax Summary (14, 18)
  when the combo query gives no `book` column, so the Account tab lists the register's books (SALE: 8, 9, 11, 16) all ticked, as Form Summary's.
- To confirm: the Yearly Tax Summary's Account tab must be the first combo's own help (rep_control_id -1) like Form Summary's; send a screenshot if it still lists every account.

## 2026-10-09 (Yearly Tax Summary)
- Ported `SP_FRT_RPT_TAXSUMM` (REPORT > Register > Yearly Tax Summary, report_key 18, format SUMMARY): `lib/report/taxSummary.ts` (queries)
  and `lib/report/taxSummarySql.ts` (the net / tax column lists). Wired as `case 18` in `standardReport` and `formattedReport`, and in
  `PORTED_REPORTS` (`lib/report/setup.ts`). Test: `tests/tax-summary-sql.test.mts`.
  - A "Net Amount" and a "Tax Amount" row for each month, then the year's "Total Net" and "Total Tax"; a column for each tax, a total for each
    tax place, the tax total (`TOTAL TAX AMT`), the slabs after the taxes (TCS, rounding ...) with their total, and `TOTAL MONTHLY AMT`.
  - With the "CHK_MONTHCOL" option: a row for each tax and amount, a column for each month, and TOTAL (rows of nil total left out).
  - Column names carry the desktop's |..| heading markers; the grid shows them without the bars (`lib/report/output.ts`, all reports).
- Account tab: same logic as Form Summary (the register's books, all ticked): `lib/report/registerBooks.ts`, `features/report/ReportCombine.tsx`.
- Where the desktop SQL is loose: the slab that ends the taxes is the last linked slab (its "top 1" had no order); a tax name used twice is one
  column; the ordering columns are left out of the grid.
- To confirm: compare a month and the year's totals with the desktop; if the standard first format of this report is another procedure
  (SP_STD_RPT_TAXSUMM), send it.

## 2026-10-09 (Form Summary: subtotal the tax level only, all formats)
- `lib/report/output.ts`: Form Summary (14) subtotals the tax level only (`* Subtotal For : EXPORT / LOCAL / OUT-STATE / SLABS ...`, then the
  Final Total), as the desktop's grid, in all three formats (Details Unsummarized, Details Summarized, Summary For Period Selected); the web
  also put a `**` subtotal under each tax (`** Subtotal For : CGST 9%`). Other reports unchanged.
- To confirm: the two Details formats on the desktop (send their screenshots if their subtotals differ).

## 2026-10-09 (Outstanding Clearance: Account help by the book)
- `features/report/ReportCombine.tsx`: the Account tab of Outstanding Clearance (21) and Ageing (5, 20) reads the book from the BOOK combo's
  value when the combo query has no `book` column, so the party books rule (SALE debtors 2, PURCHASE creditors 3, EXPENSE general 1) applies
  to Clearance as it does to Agewise. Other reports still need the combo's own `book` column.
- To confirm: if Clearance's list still differs from the desktop, send both screenshots (the BOOK chosen, the Account tab).

## 2026-10-09 (Account tab by the book in every report)
- The Agewise Outstanding rule (the Account tab lists the parties of the chosen BOOK: SALE / cash sale / credit note the debtors, book 2;
  PURCHASE / cash purchase / debit note the creditors, book 3; EXPENSE the general accounts, book 1) now applies to every report with an
  Account tab (`accountHelpBooks` in `lib/report/registerBooks.ts`, `accountScopeOf` in `features/report/ReportCombine.tsx`). Form Summary
  keeps its own (the register's books, all ticked); a first-combo help of any other report, and a BOOK with no party book, list every
  account. A book none of the rows has also lists every account. Test in `tests/register-books.test.mts`.
- To confirm: any report whose Account tab should list every account even with a book chosen (send a screenshot; it is one exception).

## 2026-10-09 (Agewise Outstanding: Account help by the book)
- Desktop, REPORT > Outstanding > Agewise, BOOK : EXPENSE: the Account tab lists only the general accounts (book 1), none ticked; the web
  listed all 4,457 accounts. `lib/report/registerBooks.ts` `partyBooks` / `accountHelpBooks`: SALE (8, 9, 16) the debtors (book 2),
  PURCHASE (13, 14, 11) the creditors (book 3), EXPENSE (15, 10) the general accounts (book 1); the Form Summary rule (the register's
  own books, all ticked) stays for report 14 only.
- `features/report/ReportCombine.tsx` `accountScopeOf`: replaces `firstHelpOf`; narrows the Account help of report 5 by the chosen BOOK
  (the combo's `book`, or its value when it has none); report 14 as before; every other report unchanged. Tests in `tests/register-books.test.mts`.
- To confirm: SALE and PURCHASE on the desktop's Agewise Outstanding (debtors 2 / creditors 3 are read from the Budget and Compare code),
  and which other reports (Outstanding Clearance 21 ...) list parties by the book the same way: send a screenshot and it is one more line.

## 2026-10-09 (Form Summary Account help: books of the register, all ticked)
- Desktop for REGISTER : SALE lists 4 accounts, all ticked (SALE, SALE - Direct, DEBIT NOTE, CREDIT NOTE); the web listed 2 (book 8
  only), unticked. `lib/report/registerBooks.ts`: the books a register covers (SALE 8 + cash sale 9 + debit note 11 + credit note 16;
  PURCHASE 13 + 14 + 11 + 16; EXPENSE 15 + 10), as SP_STD_RPT_FORM_SUMM reads them. Test: `tests/register-books.test.mts`.
- `features/report/ReportCombine.tsx`: the first combo's help lists those books and has every listed account ticked until the operator
  changes a tick for that register (a saved view restores its own ticks).
- To confirm: PURCHASE and EXPENSE lists on the desktop (the books 13/14/11/16 and 15/10 are read from the procedure's own books).

## 2026-10-09 (Form Summary: Account help live, listed by register)
- Problem: REPORT > Register > Form Summary, REGISTER : SALE gave an Account tab that was greyed (nothing could be ticked) and listed
  every account (4457) instead of the sale accounts.
- `features/report/ReportCombine.tsx`: the first combo's own help (marked `first`, REP_CONTROL_ID -1) is always live (before, a help
  grid was only live when a Group ticked it, and Form Summary has no group); it lists the accounts whose book is the chosen
  register's book (`firstHelpOf`), every row when the entry has no book or no row has it; ticks of accounts the register no longer
  lists are dropped when the report runs.
- `lib/report/setup.ts`, `lib/report/types.ts`: first combo options carry their `book`; the first combo's help is marked `first`.
- To confirm on the desktop: the Account tab of Form Summary lists only the accounts of the register's book (e.g. book 8 for SALE).

## 2026-10-09 (Form Summary formats)
- Ported `SP_FRT_RPT_FORM_SUMM` (REPORT > Register > Form Summary, report_key 14, with a format): `lib/report/formSummaryFormats.ts`
  (queries) and `lib/report/formSummaryFormatsSql.ts` (summed columns, the two formats). Wired as `case 14` in `formattedReport`
  (`lib/report/reportFormating.ts`). Test: `tests/form-summary-formats-sql.test.mts`.
  - Details (Summarized Taxes) `SM_SUMMARY`: a row a voucher and tax line (SORTING_DATE, SELECTED_DATE, FULL_DOCNO, NAME, the summed
    amounts, TAX_SHORT, TAX_DESC, TAX_PLACE_DESC, TAX_PLACE, SLAB_ORDER, SLAB_KEY).
  - Summary For Period Selected `SUMMARY`: a row a tax line (TAX_PLACE, TAX_PLACE_DESC, TAX_SHORT, TAX_DESC, the summed amounts).
  - SGST / UTGST lines carry their tax only (as the standard report), sorted by TAX_PLACE_DESC.
- As the desktop reads it: return accounts are looked for as "16" or "11" anywhere in the ticked keys (no comma, no CHK_CRCASCOM
  test), unlike the standard report; check against the desktop if a book with return accounts differs.

## 2026-10-09 (Group By: Half Year)
- `lib/report/groupBy.ts`: new period "Half Year" (the financial year's halves: `Apr - Sep 2026` and `Oct 2026 - Mar 2027`, as the
  reports' own Half Year format), offered after Quarter for every date column. Test in `tests/report.test.mts`.

## 2026-10-09 (Group By: 4 Week Month)
- `lib/report/groupBy.ts`: new period "4 Week Month": 7-day blocks counted from the financial year's 1 April, so a four-week month
  is 1-7, 8-14, 15-21 and 22-28 and the next one starts on the 29th (29/04 To 05/05, then 06/05 To 12/05 ...), labelled
  `dd/mm/yyyy To dd/mm/yyyy`; offered after 15 Days for every date column. Test in `tests/report.test.mts`.
- To confirm: weeks run on across calendar months from 1 April (not restarting each calendar month), and each week is its own
  group. If a whole 28-day block (1-28, 29-26 ...) should be one group, say so.

## 2026-10-09 (Group By: date periods on every report, 15 Days)
- `lib/report/groupBy.ts`: new period "15 Days" (1st-15th and 16th-month end, labelled `dd/mm/yyyy To dd/mm/yyyy`, as the reports'
  own 15 Days format); new `dateColumns()` finds every column a period can be grouped on: columns typed as a date, plus any
  column whose name says "date" and whose rows read as dates (the checklist reports' DATE / CHQ_DATE / RECO_DATE come back as text,
  so they had no "DATE by ..." choices).
- `features/report/GroupByPanel.tsx`: the Group by / Then by lists now offer "<DATE column> by Day / Week / 15 Days / Month /
  Quarter / Year" for every report that has a date column, like the Daybook. Tests added in `tests/report.test.mts`.

## 2026-10-09 (Report output grid: row count)
- `features/report/OutputGrid.tsx` (the one grid every report uses): the entry count no longer shows in the grid's top-left
  header cell; the bottom-right info now reads `Rows : <current row>-<total rows>` (e.g. `Rows : 1-828`), and the first number
  follows the row clicked / moved to (cursor). With a filter on it reads `Rows : 3-120 of 828`; an empty grid reads `Rows : 0`.

## 2026-10-09 (Checklist Invoice report)
- Ported `SP_FRT_RPT_CHECKLIST_INVOICE` (REPORT > Register > Checklist Invoice) as report_key 119:
  `lib/report/checklistInvoice.ts` (queries) and `lib/report/checklistInvoiceSql.ts` (slab columns, select list, joins).
  Wired in `PORTED_REPORTS` and both key switches. Test: `tests/checklist-invoice-sql.test.mts`.
  Columns: DATE, full_docno, DOC_NO, CHALLAN_NO, CHLN_DATE, name, QTY (licence 2: BUNDLE, QTY, KGS), a column per tax slab
  of the book (master slabs add NET_AMT and TAX_DESC; SGST / UTGST add NET_AMT1 and TAX_DESC1), AMOUNT, entry addon
  fields, master addon fields, NARRATION.
- Deliberate difference: a second master slab that would repeat NET_AMT / TAX_DESC is added once (the desktop's SQL fails).
- To confirm: the book's slabs are those of the year's start (`SLAB_FROMDT` = Tarikh1) with a credit note read as sale and
  a debit note as purchase, as the desktop does.

## 2026-10-09 (Checklist Daybook report)
- Ported `SP_FRT_RPT_CHECKLIST_DAYBOOK` (REPORT > Bank/Cash > Checklist Daybook): `lib/report/checklistDaybook.ts`
  (queries) and `lib/report/checklistDaybookSql.ts` (select list, joins, filter). Test: `tests/checklist-daybook-sql.test.mts`.
  Columns: DATE, full_docno, DOC_NO, [CHQ_NO, CHQ_DATE, RECO_DATE for bank / all books], name, [BOOK_NAME for all books],
  Schedule, RECEIPT, PAYMENT, entry addon fields, master addon fields, NARRATION.
- Wired as report_key 120: added to `PORTED_REPORTS` (`lib/report/setup.ts`) and to the key switch of both
  `standardReport` and `formattedReport`.
- Fix: the field lookups run one after the other (overlapping queries broke the savepoints: savepoint "rp2" does not exist).
- To confirm: for "all books" the desktop looks for entry addon fields whose FIEL_INBOOK holds "  4, 5, 6," (two leading
  spaces), copied as is; if the desktop's checklist shows fewer addon columns than expected for ALL, this is the cause.

## 2026-10-09 (Fund Flow report)
- Ported `SP_FRT_RPT_FUND_FLOW` (REPORT > Bank/Cash > Fund Flow) from the source supplied from pc-2.
  New: `lib/report/fundFlow.ts` (read-only queries: receipts and payments by schedule per cash/bank book,
  "  Opening" rows, TOTAL, PERC) and `lib/report/fundFlowPivot.ts` (the pivot and percentage arithmetic).
  Test: `tests/fund-flow-pivot.test.mts` (passes; typecheck and lint clean).
- Wired as report_key 109: added to `PORTED_REPORTS` (`lib/report/setup.ts`) and to the key switch of both
  `standardReport` and `formattedReport`, so it runs with or without a format chosen.
- Deliberate differences from the desktop SQL: opening balances read for the report's year only; duplicate
  book names make one column; a side that nets to zero gets no PERC (the desktop divides by zero).

## 2026-10-09
- Project imported/set up in this repository (existing code and history kept as-is).
- Added this CHANGELOG.md to record all future changes date-wise.
