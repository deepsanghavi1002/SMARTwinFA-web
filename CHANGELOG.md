# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

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
