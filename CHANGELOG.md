# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

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
