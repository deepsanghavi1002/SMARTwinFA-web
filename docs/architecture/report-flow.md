# How a report runs in SMARTwinFA-web, step by step

Every REPORT menu entry (all the reports in `lib/report`) goes through the same eight steps. Only step 5 differs from report to report.

## The flow

1. **Menu click.** The menu row names a report (`REPORT_STOCK_VOUCHER`, `REPORT_GSTR_1` ...). `app/api/report/route.ts` only opens a report that is in the company's visible menu.
2. **Selection screen** (`features/report/ReportCombine.tsx`). `loadReport` (`lib/report/setup.ts`) reads the report's setup from `smart_setup.report_properties`, `report_checkbox`, `report_control`, `report_controlval` and `report_outputcol`:
   the first combo (REGISTER, SELECT BOOK ...), the groups, formats, options (checkboxes), help tabs (Account, Addon ...), dates. The first combo's own SQL (`first_combo_query`) is run by `setupSelect` (`lib/report/sqlText.ts`, which turns SQL Server text into PostgreSQL).
3. **OK / Generate.** The screen posts the selection (combo value, dates, ticked groups, ticked helps, options) to `/api/report`, which opens one **read-only** transaction.
4. **Plan** (`planReport`, `lib/report/generate.ts`: the desktop's Report_Combine.GenerateReport). Checks the selection (dates in the year, "Minimum one account ..."), then builds the *call* the procedures take: `queryStart`, `from_`, `where`, `groupBy`, `orderBy`,
   `checkQuery` (the ticked options), `selectKey` (ticked addon / account keys), `book`, `fcValue` (first combo), `database` (the company schema), `tarikh1/2` (the year), `from/upto` (the period).
5. **The report itself** (`runReport`, `lib/report/reportCombine.ts`). Every report is picked by `reportKey`: `standardReport` (`reportStandard.ts`, the desktop's SP_REPORT_STANDARD) or `formattedReport` (`reportFormating.ts`, SP_REPORT_FORMATING, when a format is chosen).
   The branch runs its SQL with `runReportSql` (`lib/report/run.ts`: one SQL statement at a time in a savepoint, a failure becomes the desktop's error message) and shapes the rows in memory into a `ResultTable` (`lib/report/call.ts`).
6. **Output** (`buildOutput`, `lib/report/output.ts`: Update_Subtotal, OutputGridSettings). Applies the report's output-column settings (caption, width, hidden, number formats), the subtotal rows under each group, the final total, headings and colours,
   and returns the grid description (`ReportOutput`).
7. **Grid** (`features/report/OutputGrid.tsx`). Draws it: sorting, filters, Create Tree, Group By, Pivot, chart, compare, print / preview / export, row log.
8. **Nothing is written.** The desktop builds `TEMP_TABLE_*` tables; the web builds the same table in memory from read-only queries.

## The reports written for the web (by report key)

| Key | Report | Where (in `lib/report/reportStandard.ts` unless noted) |
|---|---|---|
| 1, 3, 4, 21, 42 | Day book, Register (every format), Ledger, Outstanding clearance, Budget | `reportStandard.ts` / `reportFormating.ts` |
| 17 | Stock report (Ledger and Summary, every valuation) | `stockReport`, `stockValuation` |
| 2, 5, 6, 22, 23, 24 | Journal, Ageing, Trial balance, Profit & loss, Balance sheet, Annexure | `reportStandard.ts` |
| 7, 9, 10, 11, 12, 13, 19, 20, 25, 49, 76, 121, 124, 159, 297, 298, 157, 282, 292, 14, 15, 16, 29, 93, 112, 258 | Account master, Party wise rate, Product master, Challan register, Challan pending, Order register, Order pending (Summary in `reportFormating.ts`), Marketing No Formating, Challan setoff, Order setoff, Job setoff, Checklist inventory, Stock clearance, Addon stock / sale summary, Marketing Month / Summary (`reportFormating.ts`), Price list, Party addon price list, Expense party wise rate and Party product addon price list (`reportFormating.ts`), Form summary, Bank reconciliation, Partywise stock, Stock summary, Stock movement, Physical stock, Monthly stock | `reportStandard.ts` (14's formats in `reportFormating.ts`) |
| 18, 109, 119, 120, 135, 152, 156, 162, 211, 232, 255, 284 | Tax summary, Fund flow, Checklist invoice, Checklist daybook, Bookwise, Target, Daily transaction, TDS, Top reports, Drop analysis, Party bill PDF, Document upload | `reportStandard.ts` |
| 32 | Interest calculation | `reportStandard.ts` |
| 31 | Stock voucher | `stockVoucher` |
| 126, 127, 129, 130, 131, 132 | Invalid GST No, GST form summary, GSTR 3B, GSTR 1, GSTR 2, GSTR entry tax mismatch | `invalidGst`, `gstFormSummary`, `gstr3b`, `gstr1`, `gstr2`, `gstrTaxMismatch` |

The list the screen uses is `PORTED_REPORTS` in `lib/report/setup.ts`; a report not in it says "not available in the web version yet".

## The steps inside one report (the same pattern each time)

1. Read what the selection gives: `call.fcValue` / `call.book` (first combo), `call.checkQuery` (options), `call.selectKey` / `call.firstHelpKeys` (ticked accounts / addons), `call.from` / `call.upto`, `call.tarikh1` / `call.tarikh2`.
2. Refuse what must not run (no account ticked, a layout not ported).
3. Read the year's setup the procedure reads first (slab ids, whether the book's slabs are by product, the company's state, the stock module of a voucher book).
4. Run the procedure's SELECTs, as read-only queries on `call.database` (the company schema `rishabh_plastic27.`); `pgFragment` makes the SQL Server text valid PostgreSQL (money columns as numeric, `|sys.db|`).
5. Do in memory what the procedure does with temp tables: sums across companies, "insert where not in", row numbers (SR_NO), counts rows, the total row, final sort.
6. Return the `ResultTable`; steps 6 to 8 above draw it.

## Why not PostgreSQL stored procedures?

Every report, the Register and the Stock report included, is written in the web program (TypeScript), not as a database procedure. The converted `sp_report_standard` / `sp_report_formating` cannot be used, for these reasons:
- **They write.** The converted procedures `CREATE TEMP TABLE ... AS`, `INSERT INTO TEMP_TABLE_...` and `CALL sp_drop_report_table` for every run. The web report screen opens a read-only transaction by design (one operator cannot change data by running a report).
- **They are not finished.** The conversion left `TODO[CALLPROC]` and `TODO(review)` notes, `INTO @variable` selects that PostgreSQL does not run, a few procedures are missing altogether (GSTR 3B, 1, 2 and Stock Voucher were never converted), and many errors are caught and hidden.
- **They return the wrong shape for a web grid.** A stored procedure here only fills temp tables; the grid needs rows with typed columns, numbers as numbers, and the subtotal and heading rows the desktop's C# adds afterwards (`buildOutput`).
- **Parity and tests.** The TypeScript is unit-checked against the real data and fixes the SQL where the desktop's SQL is loose (missing group-by columns, `''` read as 0, char padding); that is much harder to change inside 1.5 MB procedures.

