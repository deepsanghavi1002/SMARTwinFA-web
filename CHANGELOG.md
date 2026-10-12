# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

## 2026-10-12 (ANALYSIS REP. > Party All Transaction: report 30)
- New: **Party All Transaction** (REPORT_PARTY_SUMMARY, report key 30, SP_REPORT_STANDARD branch 30): one line per ticked party with the opening (the year's, plus what posted before From), SALE and SALE_QTY, DEBIT_NOTE / DNOTE_QTY and PURCHASE / PURCH_QTY (when the sale book also takes creditors, BS_ACHELP " 2, 3,"), SALE_RETURN / SALE_RET_QTY, RECEIPT / PAYMENT (book 4), DEPOSIT / WITHDRAWAL (book 6), GIVEN / RECEIVED (book 5), DEBIT / CREDIT (book 19) and the CLOSING_AMT worked out from them. PURCHASE gives the creditor's side (PURCHASE, PURCH_RETURN; the closing shown negative). `partySummary` in `lib/report/reportStandard.ts`, reached through `formattedReport` (format "None") and `standardReport`; added to `PORTED_REPORTS`.
- The ticked party addon groups (the first four of the order) come first and set the sort; a party with an opening and every amount 0 is left out. Licences 19 / 29 / 68 / 73 without a "CA_ENT" account read only live books' vouchers with no opening or quantities; licence 2 counts FACTOR; as the procedure.
- The procedure's correlated sub-queries (one per party and column) are one grouped pass over LEDGER and one over LEDGER + PROD_LEDGER here (0.25 s for 30 parties).
- Checked on the Rishabh data: A.A.Enterprises closes at 17,78,251, its pending in Outstanding Agewise; Cash Sales At Factory Gate 36,140.43 + 56,425 − 78,025 = 14,540.43, and from 15/Apr the opening moves (−3,409.57) while the closing stays the same; a creditor (Ambika Moulding) 62,144 + 15,576 − 10,000 = −67,720.

## 2026-10-12 (ANALYSIS REP. > Sales Analysis: report 143)
- New: **Sales Analysis** (REPORT_SALES_ANALYSIS, report key 143), SP_FRT_RPT_SALES_ANALYSIS: one line per inventory product with its sale quantity month by month (SALE_Apr ... from the From month to Upto), the period's SALE and the closing stock (Clsg_Stk), plus the ticked product addon groups. `salesAnalysis` in `lib/report/reportStandard.ts`; reached through `formattedReport` (its only format is "None", as on the desktop) and `standardReport`; added to `PORTED_REPORTS`.
- Options: Purchase Required (PURCH_<Mon> before each month and a PURCHASE total), Daily Sale Require (a column per day and month: Apr_1, May_1 ... in the desktop's order), Previous Sale Column Require (PSALE: the sale of the company's earlier years, read from each year's database), Zero Closing Stock Required (keeps the products with nothing).
- Licence branches as the procedure: 2 (TRN_QTY3), 7 / 22 (brand, design, finish, status; challan modules, MOON / JAIN / SUN laminates by book), 19, 25, 51, 61, 68, 74 (min / max quantity and order suggestions, STK_FOR_DAY) and the product child / parent setup. Licence 28 (PRITHVI) says "not available in the web version yet".
- Kept from the desktop on purpose: the month columns count party sale lines (code > 0) while SALE counts lines with no process (process_id null), so a product sold through a process shows its month figure but SALE 0; a month after the first counts from the From date's day of that month; with Daily nothing is left out (the desktop's delete never matches). Numeric(18,0) columns are totalled, PSALE (int) is not, as the desktop grid does.
- Checked on the Rishabh data (licence 21), 40 products: April sale and closing stock match the ledger by hand (Cool Nexora Big Bopp 15,695 / 2,449); PSALE filled from `rishabh_plastic26` for 32 of 34 products (the other two are new); every option runs (0.15–0.7 s).

## 2026-10-12 (Register: Include Form / Exclude Form)
- REPORT > Register > Register, Filter **Include Form / Exclude Form**: the Forms list now shows beside the filter, as on the desktop: the tax masters (TAX_MASTER: NONEC, CGST 9%, UTGST 9%, IGST 18% ...), `formFilterItems` (`lib/report/setup.ts`, API action `forms`). `planReport` reads the ticked taxes (`lib/report/generate.ts`).
- They run with the **Master Detail** format (any other format says "Include Form Only Possible For Master Details In Format Box", as the desktop): Include Form keeps the vouchers that carry one of the ticked taxes, with only those taxes' NET_ / tax columns; Exclude Form keeps the vouchers that carry none of them, with the other taxes' columns (`registerMasters`, `lib/report/reportFormating.ts`). Checked on the Rishabh SALE register: IGST 18% included 690 vouchers, excluded 137 (827 in all).
- Switching the filter between a slab and a form clears the ticks (their keys are different numbers).

## 2026-10-12 (Subtotals on the left; Register slab filter list; Outstanding Agewise licence 21 columns)
- Every report: a subtotal's caption ("* Subtotal For : ...") is left-aligned in its cell (it was right-aligned); the Final Total stays on the right. `features/grid/levelStyle.ts`.
- REPORT > Register > Register, Filter **Include Slab / Exclude Slab**: the slab list (lbchk_Slabs) now shows beside the filter, ticked as on the desktop: the slabs of the chosen register's book for the year (a return's: the book it is against), e.g. GROSS_TOT, DISCOUNT, SPOT_DISCOUNT ... The setup has no such control (the desktop builds it in its program), so the web builds it: `slabFilterItems` (`lib/report/setup.ts`, API action `slabs`), the list in `ReportCombine.tsx`, and `planReport` reads the ticked slabs (`lib/report/generate.ts`); nothing ticked says "No selection done for : Include Slab". Checked on the Rishabh SALE register: Include DISCOUNT + SPOT_DISCOUNT gives 620 vouchers with those two columns; Exclude DISCOUNT 207 vouchers with the other slabs' columns. `registerSlabBook` moved to `registerBooks.ts`.
- REPORT > Outstanding Agewise, licence 21: Filter **Detail** has a NET_AMOUNT column (each bill's master slab total S_LASTOT less its SLAB_AMT, found by the bill number, as SP_STD_RPT_OUTSTAND); Filter **Summary** has TOTAL_ABOVE_90 after PENDING (the party's pending on bills over 90 days). Bills carried from last year have no slab rows in this year's data, so their NET_AMOUNT is blank (as on the desktop). `lib/report/reportStandard.ts` (`ageing`).

## 2026-10-12 (Register without groups: column filters with the month totals)
- REPORT > Register > Register with no group ticked has the ▾ filter on every column, as the Day Book, and keeps its month subtotals ("Subtotal For : April", from the setup's `subtotal_monthly_col`). With a filter or the search in use each month total, the final total and "Total Entries" are worked out again from the rows shown, and a month with no row left is not drawn.
- `features/report/OutputGrid.tsx`: the filters are offered on any report with no group heading rows (before: only with no groups and no subtotals); a report with headings (Account, Book, addon groups ...) is unchanged and still uses Remove Group to filter.

## 2026-10-12 (Register and Stock report back in the web program: no stored procedure)
- REPORT > Register > Register (key 3, every format) and Inventory > Stock Reports (key 17, Ledger and Summary, every valuation) run from the web program again, like the Ledger and Day Book: `register`, `registerSlabs`, `registerSlabBook` (`lib/report/reportStandard.ts`), `registerFormats` and its periods / monthly / item / master formats (`lib/report/reportFormating.ts`), `stockReport` and `stockValuation` (`reportStandard.ts`), restored from the last commit. `runReport` (`lib/report/reportCombine.ts`) no longer calls the database.
- Removed: `smart_setup.sp_report_combine` and its files (`db/procedures/`, `lib/report/reportProcedure.ts`, `scripts/apply-report-procedures.mjs`, `tests/report-procedure.test.mts`). The procedure itself is still in PC1's `smart_setup` schema (nothing calls it); drop it there when convenient.
- Kept from the procedure's version of the Stock report: amounts rounded in exact decimal (`decimalRound`, `lib/report/run.ts`: 132.825 is 132.83, not 132.82), lines of the same date and nature ordered by entry number (`IL_KEY`), and a From date inside the year works (the opening's earlier movement read `pl.type`; now `pl."TYPE"`).

## 2026-10-12 (REPORT > Extra > Party Wise Bill PDF: report key 255 faster)
- `lib/report/reportStandard.ts` (`partyBillQuery`): Note_Nature (the voucher has inventory lines) comes from one grouped read of PROD_LEDGER joined on LED_ID instead of a count subquery a bill; with no index on PROD_LEDGER.LED_ID the subquery read the whole product ledger once a bill. SALE, whole year, every account ticked (829 bills): 14.3 s, now 1.8 s, the same rows and Note_Nature; Debit Note 7 bills and Credit Note 15 bills under a second.

## 2026-10-12 (ANALYSIS REP. > Marketing: report key 25, No Formating; subtotals in Month / Summary)
- `lib/report/reportStandard.ts`: new `marketingAnalysis` (SP_STD_RPT_MKTANALYS), no temp table. The book's product lines of the period with the setup's columns; Free Include, Return Include (by licence), the stock adjustment lines left out and licence 19 / 29 / 73's book filter as the procedure. Slab Add-Less with the book's product slabs: each slab's % and amount as columns (one grouped LEDGER_EXT join, not a subquery a slab a line) and VALUE with every slab, discounts less and GST added, as the procedure's UPDATE. Licence 1: AMOUNT, batch no., expiry date. Groups As Heading: the lines sorted as the procedure's SORTING_COL and a heading row where each group starts (addons outermost first, then the party, or the product with Product Code; the lines then show the product). Changes from the desktop: without headings the lines run by party / product then date (the procedure ran them by date first, so a party's subtotal broke at each date); a heading addon the setup already selects as SELECTED_<addon>(S) is not added twice; with only an addon group each party's lines follow its heading; a product heading carries its first line's party (no "Subtotal For :" of nothing).
- `lib/report/output.ts`: Marketing's Month and Summary subtotal only the groups outside the last one: one group shows the final total only, Area + Account a subtotal per area.
- `lib/report/run.ts`: `runReportSqlHashed`, a statement with nested loops off, used by both Marketing queries: with the ticked keys' long IN lists the planner expected one line and scanned LEDGER_EXT (no index on IL_ID) once per line (Area + Account Summary 30 s, now under 1 s).
- Checked on rishabh_plastic27 (SALE, 01/04/2026 to 12/10/2026): Account with headings 120 parties, 2,897 lines, quantity 5,48,949, value with the slabs 11,96,74,832.78, equal to a direct query; Area + Account 92 areas, 119 parties; Product 533 products; Month Area + Account 92 area subtotals and the final total; Summary Account only the final total.

## 2026-10-12 (ANALYSIS REP. > Marketing: report key 25, formats Month and Summary)
- `lib/report/reportFormating.ts`: new `marketingFormats` (SP_REPORT_FORMATING branch 25), no temp table. The book's product lines of the period by the ticked groups. Month: a QTY column per month of the period (FACT / VAL with Factor / Value Column), then TOT_QTY / TOT_FACT / TOT_VAL, whole quantities as the procedure's convert(int); with Slab Add-Less and the book's product slabs the value takes each non-tax slab (added or less). Summary: QUANTITY, FACTOR (less what was set against), VALUE, a column per non-tax slab taken into the value, Avg_Rate with Value Column, groups with no quantity left out. Free Include, Return Include (books 16 / 11 negative), licence 7's ORD-IN rule and licence 1 / 14's product description as the procedure. Where a column in front is not grouped (the party with an addon group) the party is added to the groups (SQL Server refuses that query). "No Formating" (SP_STD_RPT_MKTANALYS) ported in the entry above. 25 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (SALE, 01/04/2026 to 12/10/2026, Account group): Month 136 parties, total value with the slabs 11,28,32,981.36 = Summary's value after the slabs; Month's quantity 8,84,937 against Summary's 8,84,986 (whole numbers per line); e.g. A V S Sales Agency 1,919.99 less the slabs 480.99 = 1,439.00. With Return Include the totals fall to 8,59,819 (Summary).

## 2026-10-12 (INVENTORY > Addon Stock Summary 297, Addon Sale Summary 298)
- `lib/report/reportFormating.ts`: new `addonStockSummary` (SP_FRT_RPT_ADDON_STOCK_SUMMARY, format None), one read-only query each, no temp / global temp tables. By the product master addon in the first combo, a line per addon value (SMART_LED_KEY, Particular). 297: the year's opening (PROD_BALANCE in the product's first report unit; the year's row only, the procedure joins every year's), what came in and went out from the year's start to Upto (in that unit, less what was set against, job work receipts / issues in full), closing; only products whose addon value is a live addon sub; empty values left out. 298: the period's sale (sale lines with a voucher, less what was set against; licence 51: challans out in full), each product rounded to a whole number as the procedure's DECIMAL(20,0); values with no sale left out. 297 and 298 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 by Prod Group: 297 120 values, opening 2,60,48,318.86 + in 1,02,17,890.48 - out 1,15,10,433.42 = closing 2,47,55,775.92; 298 (01/04/2026 to 12/10/2026) 39 values, sale 5,48,949 (a direct count: 5,48,949).

## 2026-10-12 (INVENTORY > Stock Clearance: report key 124)
- `lib/report/reportFormating.ts`: new `stockClearance` (SP_FRT_RPT_STOCK_CLEARANCE, format None), its three temp tables and four cursors done in memory from three read-only queries. For each ticked product: its open purchases (stock in, not yet set against) up to Upto and its opening stock (with a previous year's company, last year's purchases latest first as far as the opening reaches; the rest one OPENING row at the year's start, a year earlier when last year had purchases), cleared first in first out by its open sales: the purchase row shows its first sale, a further sale against it a row of its own; CLSG_QTY what is left, PDays the age at Upto, SDays the wait for the sale. Quantities are rounded to whole numbers (factors to 2 decimals) as the procedure's cursor variables do. Only Pending Purchase Bills, Print Ageing Column, Factor Column Require, addon groups as the procedure. 124 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (all products, Upto 12/10/2026): 33,938 rows in 2.6 s; purchased 4,49,98,464.49 less cleared 1,08,36,903 = 3,41,61,561.49 left (the same with Only Pending, 11,452 rows); e.g. 0.5 Sqm 4 Core Copper Flexible Cable: opening 32 cleared by sales 12 + 16 + 4, the 1 bought on 14/05 by the 1 sold on 30/05. The factor columns follow the procedure's arithmetic, which lets the sale factor go below zero where the factor is used up before the quantity.

## 2026-10-12 (INVENTORY > Checklist Inventory: report key 121)
- `lib/report/reportFormating.ts`: new `checklistInventory` (SP_FRT_RPT_CHECKLIST_INVENTORY, format None), no temp table. The product lines of the period of the book account in the first combo (its lines, or its book's lines with no book account), or of all books (ALL, with a BOOK column): product code, description, HSN, date, voucher no., challan no., party, quantities by licence (21: packing, box, loose, MRP), unit, rate, amount; for one book its product slabs of the year (each slab's amount, the tax slabs' tax), the book's item entry addons, and the product master addons (a field with no column is left out). The procedure's per-line, per-slab subqueries (45 s for the year's SALE) are one grouped join of the period's LEDGER_EXT rows: 1.2 s, the same values. Not ported: licence 71's store / mill layouts (refused). 121 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026) against direct counts: SALE 2,895 lines (amount 11,84,75,438.88, GST 1,36,53,355.43), PURCHASE 1,067, ALL 29,261 (2.4 s).

## 2026-10-12 (INVENTORY > Order > Job Setoff: report key 159)
- `lib/report/reportFormating.ts`: new `jobSetoff` (SP_FRT_RPT_RPI_JOB_SETOFF, format None): one read-only query per mode (the procedure's two CTEs) and its temp table, balance cursor and updates in memory. ANNEXTURE: job work issued (JOB-OUT, stock out) with the receipts against it (JOB-IN of the year, by order no. and product): issued (running), rate, unit, receipt date / no. / challan, received, balance, set-off, remark. JOB WORK ORDER: the job orders (stock in) with their receipts (entry date / no., bill date / no.). EXPENSE BILL: the expense bills (IB) with the job receipts their order no. names, one row per bill and receipt. As the procedure: rows numbered per issue, the balance on each issue and product's last row, the issue's quantity / unit / remark (ANNEXTURE also set-off) on its first row only, no balance where all was received or set off. Left out: the procedure's last ANNEXTURE update, which compares a dd-Mon-yy text with a dd/MMM/yyyy text and so never changes a row. 159 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026): ANNEXTURE 508 rows, JOB WORK ORDER 329, EXPENSE BILL 26 (expense 10,04,299.00); JOut/26-27/1 Plastic Grinding: 4,000 issued, 2,719 + 1,165 received, 116 set off, balance 0.

## 2026-10-12 (INVENTORY > Order > Order Setoff: report key 76)
- `lib/report/reportFormating.ts`: new `orderSetoff` (SP_REPORT_FORMATING branch 76, format Detail), one read-only query (the procedure's two CTEs) and the rest in memory instead of the temp table and its updates. Each order line of the period with the invoice lines billed against it (PROD_LINK iled_rec1 / iled_rec2): order date, delivery date, order no., party order no. (licence 21 SALE), party, product, product group, packing, rate, the running order quantity and value, bill date / no. / party / quantity / rate / value, delay days (delivery or order date to the bill date, or to Upto while not billed), closed quantity and value, remark, balance quantity and value (order quantity less all billed against the order and product and the closed). An order and product's second and later rows show no order quantity, value or balance (licence 21 also packing). LINK_PARTY_CHG, as the procedure. 76 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026): SALE 3,078 rows, order quantity 5,28,012 and value 12,06,55,878.60 (as the Order Register); PURCHASE 1,105 rows, 38,60,182.42 and 4,40,72,912.13. The closed quantity repeats on an order's later rows, as the procedure (its total counts it per row).

## 2026-10-12 (INVENTORY > Order > Register: report key 12, Detail and Summary)
- `lib/report/reportStandard.ts`: new `orderRegister` (Detail, SP_STD_RPT_ORDER_REG); `lib/report/reportFormating.ts`: `orderRegisterSummary` (SP_FRT_RPT_ORDER_REG). Every order line of the period, billed or not, as the Order Pending, with this report's first combo the other way (SALE 1, PURCHASE 2): licence 21 SALE has the remark, box, packing, loose, ENTRY_FROM and for Rishabh Plastic the sale product slabs as columns; licence 21 PURCHASE the job card, delivery date, specification. Licence 14's addresses, Despatch Required (the production plan's despatches) and ALCON's factor columns as the procedure. Summary by the groups (Account, Product, both, none), with closed quantity (licence 2 bundles). Not ported: licence 14's summary layout (refused).
- Shared with Order Pending: the slab columns are now one helper, `withProductSlabs` (the procedures' PIVOT, the column list passed in), and `orderPendingWhere` takes the pending filter and the date column as options.
- `setup.ts`: 12 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026) against direct counts: SALE Detail 3,016 lines (quantity 5,28,012, value 12,06,55,878.60, slab columns), Summary 730 orders; PURCHASE 1,032 lines (38,60,182.42; 4,40,72,912.13), 283 orders; Summary by Account, Product, both: the same totals. Order Pending unchanged after the refactor (570 / 196 / 502).

## 2026-10-12 (INVENTORY > Order > Pending: report key 20, Detail and Summary)
- `lib/report/reportStandard.ts`: new `orderPending` (Detail, SP_STD_RPT_PEND_ORDER_REG) with `orderPendingWhere` / `orderPendingFrom`; `lib/report/reportFormating.ts`: `orderPendingSummary` (Summary For Period Selected, SP_FRT_RPT_PEND_ORDER_REG). The order lines of the period (order module, STKM_ID 'OR'; JO / JI for job orders) with quantity still to bill or close. Detail fills the setup's SYS.COL / SYS.BOXCOL1 / SYS.SLAB_COL as the procedure by licence and side (licence 21 SALE: remark, box, packing, loose, pending boxes, no billed column; licence 21 PURCHASE: job card, delivery date, specification), the entry addon joins at sys.aent.bend, the stock spread over each product's pending lines (the procedure's cursor), and for Rishabh Plastic's SALE (Kanpur / Kaithal's PURCHASE) the book's product slabs as columns (the procedure's PIVOT: each slab's amount and percentage, NET_AMOUNT, the tax descriptions, its column list). No temp tables: the slabs are read with one grouped query; the stock is spread once per line (the procedure ran it over a row per slab, taking a line's quantity once per slab). The year's PROD_BALANCE row only (the setup joins every year's). Summary by the groups: Account (per order), Product, both, none (per order with date); licence 21 PURCHASE with boxes. Not ported: licence 71's SALE layout (refused).
- `setup.ts`: 20 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026) against direct counts: SALE Detail 570 lines (with 7 slab columns; net amount = value less the discounts), Summary 196 orders; PURCHASE 502 lines, 145 orders; Summary by Account, Product, both: the same totals (quantity 75,185, value 1,71,79,974.20).

## 2026-10-12 (INVENTORY > Challan > Setoff: report key 49)
- `lib/report/reportFormating.ts`: new `challanSetoff` (SP_REPORT_FORMATING branch 49, format Detail), in TypeScript, no temp tables or cursors. A line per challan and product of the period (Sr_No by challan) with the invoice it was billed in: the procedure's challan table and invoice table (the book's lines with no challan) are read once, and its PROD_LINK cursors are done in memory (each linked invoice line of the same product writes its date, number and party and adds its quantity, as a whole number like the procedure's INT, to BILL_QTY). With LINK_PARTY_CHG, in entry_para the invoices and links are not narrowed to the ticked accounts. The links are read as two joins put together (the procedure's OR join took 12 s; now 1.2 s for the whole report, the same set). Licence 21 keeps the challans with no party (the procedure's inner join to ACCOUNT would leave this company's report empty). 49 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026): SALE 395 challan lines (quantity 1,87,460, as the register), PURCHASE 235; no PROD_LINK row points at a challan in this data, so no line shows an invoice (the Pending report also has every line pending). The invoice filling could not be checked against data.

## 2026-10-12 (INVENTORY > Challan > Pending: report key 19, Detail and Summary)
- `lib/report/reportStandard.ts`: new `challanPending` (Detail, SP_STD_RPT_CHLN_PEND_REG) and `pendingChallanFrom`; `lib/report/reportFormating.ts`: `challanPendingSummary` (Summary For Period Selected, SP_FRT_RPT_CHALLAN_PENDING_REG). As the Challan Register (TEMP_TABLE_CHLN_PEND_REG1 / REG2 as subqueries, nothing written), keeping only the lines still pending: quantity less what was set against it and the closed quantity above zero. Detail: the setup's columns per line, with or without a party (as the procedure); Summary: a line per challan with its pending lines added up, only challans with a party and products with an addon row (as the procedure), except licence 21 (as in the register). Series, addon group, Account group, Date Wise Sorting; the challan number (DOC_NO2) hidden, keys as text.
- `setup.ts`: 19 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026) against direct counts: SALE Detail 396 lines, Summary 43 challans; PURCHASE 235 lines, 69 challans (all of the year's challan lines are still pending, so the figures equal the register's); Prod Group addon 5 lines, 2 subtotals in both formats.

## 2026-10-12 (INVENTORY > Challan > Register: report key 11, Detail and Summary)
- `lib/report/reportStandard.ts`: new `challanRegister` (Detail, SP_STD_RPT_CHLN_REG) and `challanFrom`; `lib/report/reportFormating.ts`: `challanSummary` (Summary For Period Selected, SP_FRT_RPT_CHALLAN_REG). The procedures copy the period's challans of the book (PROCESS of the book's challan module, BOOK_PROPERTIES STKM_ID 'CH') into TEMP_TABLE_CHLN_REG1 (TCR1) and their product lines (PROD_LEDGER) into TEMP_TABLE_CHLN_REG2 (TCR2); the web puts the same two queries as subqueries in the setup's FROM, so nothing is written. Detail: the setup's columns per product line (date, challan no., party, product, quantity, factor, rate, amount, balance, closed, remark); Summary: a line per challan with its lines added up (bundles when entry_para has COL_BUNDLE,). Series, addon group (its column, ordered and subtotalled by it), Account group, Date Wise Sorting. The challan number (DOC_NO2), the sort key, is hidden (the setup hides it under a field name no column has); the hidden keys are text so no empty PARTICULARS column. Licence 2's delivery charge column is read from the party addon DELIVERY; others have none.
- Licence 21 keeps challans with no party in both formats: the Detail procedure does, the Summary procedure does not, which left the Summary empty where the Detail lists them (on rishabh_plastic27 every challan of the year has no party code).
- `setup.ts`: 11 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (01/04/2026 to 12/10/2026): SALE Detail 396 lines, Summary 43 challans (a direct count: 43), the same totals (quantity 1,87,460, amount 5,07,56,234); PURCHASE Detail 235; series STI/26-27 396; Prod Group addon with 3 groups 5 lines, 2 subtotals in both formats.

## 2026-10-12 (INVENTORY > Master > Party Product Addon Price List: report key 292)
- `lib/report/reportFormating.ts`: new `partyProductAddonPriceList` (SP_FRT_RPT_PARTY_PRODUCT_ADDON_PRICELST, format None), in TypeScript. The rates and discounts set for a party addon value (Grade, PR_AONSUB) and a product addon value (Product Group, PR_AONSUB1): Grade, Product Group, From Date, Upto Date, Rate, Discount, by grade, product group, newest date first; lines with a rate or a discount. The first combo's W.E.F. range keeps exactly that range (ALL: every line); the ticked grades (addon group) if any. 292 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 against direct counts: ALL 1,816 lines (6 grades); FROM 10/04/2026 1; two grades ticked 29.

## 2026-10-12 (INVENTORY > Master > Expense Party Wise Rate: report key 282)
- `lib/report/reportFormating.ts`: new `expensePartyRate` (SP_FRT_RPT_EXP_PARTYWISE_RATE_REP, format None), in TypeScript. The purchase side's (PR_ADDLESS 'A') product rates for parties (PARTY_RATE, PR_PARASELECT 'S', active, rate above zero): Name, Description, From Date, Upto Date, Rate, UOM, by party, product, newest date first; the ticked accounts only. 282 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27: all accounts 455 lines of 15 parties (as a direct count); one party (Aara Industries - Expense) 42.

## 2026-10-12 (INVENTORY > Master > Party Addon Price List: report key 157)
- `lib/report/reportFormating.ts`: new `partyAddonPriceList` (SP_FRT_RPT_PARTY_ADDON_PRICELST, format None), in TypeScript, no temp table. A party's rates by product addon value (PARTY_RATE lines with no product, PR_PARASELECT 'S', addon pr_aonfiel1 / pr_aonsub1): Name, Addon Name, From Date, Upto Date, Rate, by party, addon, newest date first. The first combo's W.E.F. range keeps exactly that range (ALL: every line); the ticked accounts if the Account group is ticked. 157 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27: 1,979 such lines, but only 2 have a rate above zero (the setup keeps pr_rate > 0) and one of them fails the setup's account / addon conditions: ALL and FROM 01/04/2026 give 1 line (Aarnav Interio Private Limited, Barcode Label & Ribbon, 100.00).

## 2026-10-12 (INVENTORY > Master > Party Wise Rate: report key 9)
- `lib/report/reportStandard.ts`: new `partyRate` (SP_STD_RPT_PWISERATE), in TypeScript. The special rates (PARTY_RATE) of the side in the first combo (LESS: sale, PR_ADDLESS 'L'; ADD: purchase, 'A'), for the Input Column chosen: Rate (PR_INPUTCOL 'R', with the rate's unit from PROD_UOM), or a slab (a tax slab 'T' with TAX_MASTER's tax, or a percentage 'P'). As the procedure: only lines with no Upto date or an Upto on or before the From date. Sorting Party: party, date (newest first), product; Product: date, product (the date as a date; the procedure sorted the dd/mm/yyyy text). The hidden keys (PR_AONSUB, code, PR_PRODID, PROD_KEY ...) are text, so no empty PARTICULARS column.
- Input Columns was empty: it is filled by the first combo's lost-focus query (Rate plus the side's slabs, each with HIDE_RCOLS, the columns it hides). `lostFocusItems` (`setup.ts`) now fills `|sys.where.col1|` / `|sys.where.col2|` from the chosen first combo row (LESS: BOOK <= 12 / BOOK = 8; ADD: BOOK >= 13 / BOOK = 13) and keeps HIDE_RCOLS on the item; `planReport` (`generate.ts`) passes the choice as `slabsKey` and hides its columns (Rate hides Percentage). `setupSelect` (`sqlText.ts`) also quotes a WITH's column used after the WITH's name (slabs.SLAB_KEY); test added.
- `generate.ts`: a product group whose where compares the product's code (Party Wise Rate's Product Code, the Description group of Price List, Stock and six other reports: "product.PROD_SHORT in") got the ticked products' keys (numbers), which PostgreSQL refuses; it now compares PROD_KEY, the same products.
- Screen (`features/report/ReportCombine.tsx`): Input Columns (a list box) showed blank: the first combo's refill reached only combo boxes; a list box named by the setup's lost-focus control now shows the refilled items too, and changes with the first combo; `loadReport` (`lib/report/setup.ts`) names such a list box as the `lostFocusControl` (it named combo boxes only, so the screen never asked; report 9 is the only setup with a list box there). The Account help follows the side: LESS lists the debtors (book 2), ADD the creditors (book 3) (`accountScopeOf`, `accountHelpBooks` in `lib/report/registerBooks.ts`). On rishabh_plastic27 the ADD rates (455 lines, 15 parties) are all of book 1 accounts, so ADD finds none of them from that list.
- `setup.ts`: 9 added to `PORTED_REPORTS`.
- Checked on rishabh_plastic27 (all PARTY_RATE lines are Rate lines): LESS 1,123 lines, ADD 448 (Account group, and ADD by Product Code group also 448); a slab gives "No Records"; Price List by Description 7,822.

## 2026-10-12 (INVENTORY > Master > Price List: Price List report, key 13)
- `lib/report/reportStandard.ts`: new `priceList` (SP_STD_RPT_PRICELST), in TypeScript, no temp table. The price list lines (sale / purchase / MRP rate with units, W.E.F. date, group), newest date first, lines with no date or no rate left out. The first combo's W.E.F. range keeps the lines of exactly that range (ALL: every line). The filters work on the ticked rate columns: Last Rate / First Rate (each product's latest / earliest date with that rate), Highest / Lowest Rate, Zero Rate Only; none ticked gives the desktop's "Error no : 11". An addon group adds a heading row per addon value (ROW_DATA_TYPE 'AC', from addon_sub) sorted in before its lines. The empty sorting group is the product's code (as Product Master); the hidden keys (PL_KEY, PROD_KEY, ADDON_n_CODE) are text so no empty PARTICULARS column appears; the MRP's UOM is hidden with the MRP.
- `lib/report/setup.ts` / `generate.ts`: `firstComboValues`: a first combo whose key repeats (the Price List's dates all have FAKE_KEY 1) is chosen by its caption, so each date can be picked (before, every date opened the first one). 13 added to `PORTED_REPORTS`.
- Price List speed: the Last / First / Highest / Lowest Rate filters took 6 to 12 s (the procedure's "PL_KEY IN (SELECT ... the same selection ...)" with the 18,000 ticked products' key list, checked line by line). The lines passing the filter are now found first from PRICELIST alone (each product's latest / earliest date or highest / lowest rate, grouped once) and the report keeps those PL_KEYs: about 1 to 2 s for the whole report, the same lines.
- Checked on rishabh_plastic27: ALL 7,822 lines; FROM 01/04/2026 3; Last Rate 2,731, First Rate 2,731, Highest 3,534, Lowest 3,794, Zero 21; Prod Group with 4 values: 4 heading rows, 605 lines.

## 2026-10-12 (INVENTORY > Master > Product: Product Master report, key 10)
- `lib/report/reportStandard.ts`: new `productMaster` (SP_STD_RPT_PROD_MASTER), written in TypeScript like the Day book / Ledger / Account master, not a stored procedure. The products of the year (PROD_BALANCE 'RP') with the setup's columns (code, description, HSN, opening 1 / 2 with their units, opening and report rates and values, group), then every product master addon field (ADDON_FLD relate 'P', master 'Y', entry 'N', by caption, INPUT_ or TXT_ by its type). Only Lock Products keeps the products with a start or last date; Image Required adds the image (its file name: the grid shows no pictures). Group by Product Code / Description / an addon with subtotals and the final total as usual. The setup's sorting column is left as ", || '   P'" without an addon group; it becomes the product's code (as Account master does). The procedure's GROUP BY for the Group alone is left out (it groups none of the other columns).
- `lib/report/setup.ts`: 10 added to `PORTED_REPORTS`.
- Input Columns list was empty (Product Master and Account Master): the setup queries SHOW_COLS_LIST_PRODS / SHOW_COLS_LIST are a WITH query whose columns are named in quotes (AS "COLUMN_CAPTION") and then bare (COLUMN_CAPTION), which PostgreSQL refuses. `setupSelect` (`lib/report/sqlText.ts`) now quotes those names after the WITH, outside literals (test in `tests/report.test.mts`). Product Master lists 31 columns, Opening Qty and Product Group ticked at the start; an unticked column (an addon by its caption) is hidden in the output.
- Checked on rishabh_plastic27, year 2026-27: all products 18,007 rows; HSN / Image / Lock options; Prod Group addon with 4 groups, 257 rows, 4 subtotals.

## 2026-10-10 (Ledger of every account: "Maximum call stack size exceeded", and its speed)
- Ledger with all 4,439 accounts ticked failed with "Maximum call stack size exceeded". `push(...list)` hands every value to the call as an argument and JavaScript stops at about 100,000 of them; the ledger had 207,000 lines. New `pushAll` / `maxOf` in `lib/report/library.ts` (loops, any length) replace the spreads over report rows in `reportStandard.ts` (the Ledger's journal / contra and WhatsApp ledger lines, the Target and GSTR 1 rows, the Ageing rows) and `reportFormating.ts`.
- The same selection took 106 s (the limit is 120 s); now about 9 s (210,616 rows, 53 MB): the Ledger's own step 78.7 s to 6.3 s, the output step 24 s to 2.3 s. Three causes: every journal line was compared with every contra line (16,000 x 16,000), now the contra lines are indexed by voucher number; `formatNumber` (`output.ts`) made a new locale formatter for every number cell, now one per number of decimals; `ResultTable.name` (`call.ts`) rescanned the column names on every cell read, now it remembers where each was found. The figures are the same.

## 2026-10-10 (Subtotal labels on the right; Agewise Outstanding addon group subtotals)
- `features/report/OutputGrid.tsx`: a subtotal's (and the Final Total's) label now always runs over every empty text column after it, so all of them end at the same place on the right (before, it ran only as far as its text needed, so short names stopped after the third column and long ones after the fourth).
- `lib/report/reportStandard.ts` (Agewise Outstanding, report 5): a ticked addon group (Sales Man, Area ...) was dropped from the output: the grid only had the account's subtotal. Each party's addon text now goes in the group column SMART_SELECTED_ADDON<n> on every row, a heading row per addon value is added (Party Wise), and the rows are ordered by the addon groups first, so the output gives "* Subtotal For : <Sales Man>" around the accounts' "** Subtotal For : <party>". The bill rows' sort key no longer carries the addon's text in front (the rows the report adds itself did not, which split a party's rows in two when an addon was ticked). With the account group alone nothing changes.

## 2026-10-10 (SETUP > Company > Select)
- `features/startup/StartupGate.tsx`, `app/page.tsx`: the menu row SETUP > COMPANY > SELECT (action COMPANY_SELECT) now opens the company and accounting year selection screen, as after the login, with the current year and company highlighted (it said "screen not built yet"). OK opens the chosen company (the menu is read again for its group and the home screen shows); Exit / × from here goes back to the company that was open (after the login it still goes back to the login). The gate offers `useStartupActions().changeCompany()` for this.

## 2026-10-10 (Esc asks to quit)
- `features/report/ReportCombine.tsx`, `OutputGrid.tsx`, `HelpGrid.tsx`: the Esc key now does what the Quit button does, on the Selection tab and on the output grid: it asks "Are you sure you want to quit?" (Yes closes the report from the Selection tab; from the output it returns to a cleared Selection tab). Esc still first closes whatever has something to close (a combo's list, a typed search or marked block, a side panel, the Log, a message box, Create Group); on the output grid it used to go back to the Selection tab, which the Selection side tab still does. The grid leaves a bare Esc to the screen (it first asked twice: once from the grid, once from the screen). The screen watches Esc on the window and decides a moment later, once every control has had its turn (a control that used the key marks it with preventDefault), so it asks wherever the keyboard focus is (it did not on the Selection tab after the first fix).

## 2026-10-10 (Quit asks first)
- `features/report/ReportCombine.tsx`: the Quit button of every report (Alt+Q) now asks "Are you sure you want to quit?". On the Selection tab, Yes closes the report. On the output grid, Yes goes back to the Selection tab with the selection cleared as when the report first opened (the first combo and dates, the groups, every help un-ticked, options and lists at their defaults) and the output removed; the report stays open.

## 2026-10-10 (Busy symbol on every report)
- `features/report/ReportCombine.tsx`, `app/globals.css`: while a report is generating (the OK button, the output grid's Refresh button, Create Group, Compare periods, and the first load of the screen) a spinner with "Generating report…" covers the report screen, the wait cursor shows and the buttons are blocked. Before, only a small text on the selection tab said it, so nothing showed on the output grid where Refresh is. Works for every report, as they share this screen.

## 2026-10-10 (Browser Back button)
- `app/page.tsx`: the browser's Back arrow no longer leaves the program for the previous site (Google). The program is one page, so it keeps a history entry of its own: Back closes the open program (as Home does) and, on the home screen, stays put. The address bar, a new tab or closing the tab still leave as before. Chrome skips a history entry a page adds without a click or key press, so the page keeps two entries ahead and tops them up on each click / key press (a second Back went straight to Google before).

## 2026-10-10 (Stock report from the database: sp_report_combine)
- The Stock report (REPORT 17, Inventory > Stock Report: LEDGER and SUMMARY, every selection of the first screen) now runs from `smart_setup.sp_report_combine` (`db/procedures/04_stock_valuation.sql`, `05_stock_report.sql`), like the Register. The product openings, the period's stock lines with their running closing quantity, the Summary layout and the Filter's valuations (Report Rate, Last Purchase, Last Sale, Actual with licence 21's layers and BOM costs, Average Rate, Average C.Year, MRP) are the procedure's; the web program only shapes the grid. `stockReport` and `stockValuation` (319 lines) are gone from `reportStandard.ts`; `PROCEDURE_REPORTS` now holds 3 and 17.
- Checked against the TypeScript it replaces on the Rishabh data (licence 21, and the other licences' paths by forcing the licence): the table and the finished grid for the Ledger and Summary layouts, every Filter, 4 / 120 / 300 products, product with addon groups, zero-closing off, the valuation options (CHK_WITHCN, CHK_DPRATE, CHK_STKADJCALC) and every refusal message. Identical except as below.
- Differences from the old output, on purpose:
  - Paise: the procedure rounds in exact decimal (SQL Server's way), the old code in floating point, which put a half-paisa amount (253 x 52.5 % = 132.825, 17.49 / 6 = 2.915, 1,318,942.765) one paisa low in a few cells. The old figure was the wrong one.
  - Lines with the same date and nature are ordered by entry number (they came in no fixed order, and the running closing followed it).
  - A **From date inside the year** now works: the old code failed with `column pl.type does not exist`. The opening carries what moved before From; the closings equal those of a run from the year's start.
- Not changed: Average Value, the master updates (CHK_UPD_MASTER, CHK_UPD_RATE), godown / batch, age, folder, challan-date, FG value add, min / max, valuation with expense and the Above / Below Days sorting are still refused with a message.

## 2026-10-10 (Register from the database: smart_setup.sp_report_combine)
- New PostgreSQL procedure **`smart_setup.sp_report_combine`** on PC1 (`db/procedures/*.sql`, applied with `node scripts/apply-report-procedures.mjs`; see `db/procedures/README.md`). The web program sends it the plan (`planReport`'s SQL pieces and the selection, as one JSON call) and reads the rows from a cursor. The Register (REPORT 3, every selection of the first screen: the standard list, Show Narration in rows, Print All Slabs, Include / Exclude Slab, and the Month, Daily, Weekly, 15 Days, Quarter, Half Year, Summary, Item Detail and Master Detail formats) now runs from it.
- The procedure never writes (no temp table, no ALTER), so it runs in the report screen's read-only transaction. The converted `sp_report_standard` / `sp_report_formating` were not used: they never open their result cursor, still hold SQL Server statements (`IDENTITY(INT,1,1)`, `sp_RENAME`, `SET IDENTITY_INSERT`) and create tables, which a read-only transaction refuses.
- Removed from the web program: the Register's queries and in-memory reshaping (`register`, `registerSlabs`, `registerFormats` ... in `reportStandard.ts` / `reportFormating.ts`, 513 lines). `lib/report/reportProcedure.ts` (new) makes the call and maps the procedure's errors (`RP001` a refusal, `RP002` not carried); `runReport` uses it for `PROCEDURE_REPORTS`. `ReportRefusal` moved to `lib/report/refusal.ts` (still exported from `generate.ts`).
- Checked against the TypeScript it replaces, on the Rishabh data, for the eight Register books: the columns, their kinds and every row of the table, and the finished grid (`buildOutput`) byte for byte, for the standard list, narration, Print All Slabs, Account and Area groups (and both), every format, other sorts and every column option. Print All Slabs reads the slab rows in one grouped pass (166 ms; per-voucher lookups took 2 s).
- Found, not changed: the Register's **Numbers** sort fails in the TypeScript and the procedure alike (`led.doc_no >= 5`: doc_no is text, SQL Server converts it); Include / Exclude Slab cannot be picked on the screen (the setup lacks the slab list control); the company schemas have no index on `ledger_ext.led_id` / `prod_ledger.led_id` and no statistics (`ANALYZE` never run), so formats with slabs or quantity take 8 to 35 s; PC1's network connection dropped twice in a long test session.
- Tests: `tests/report-procedure.test.mts`.


## 2026-10-10 (Stock Voucher: the book list)
- `setupSelect` (`lib/report/sqlText.ts`): a setup query's `STKM_ADDON = 'PF'`, `STKM_SHORT = '...'` or `STKM_ID = '...'` now compares without the column's trailing spaces, as SQL Server does for char columns. The Stock Voucher's book list had only 6 of
  its 12 books because `STKM_ADDON` is stored as 'PF   '. It now lists STOCK VOUCHER-ADD / LESS, STOCK JV, JOB STOCK OUT / IN, INDENT PURCHASE, MFG. FORMULA, the production slips, QUOTATION-PURCHASE and SAMPLE CHALLAN.

## 2026-10-10 (Stock Voucher)
- Ported `SP_FRT_RPT_STOCK_VOUCHER` (REPORT 31, Inventory > Stock Voucher: indent, amendment / adjustment, sample challan, quotation, production slip, job work ...) inside `lib/report/reportStandard.ts` (`stockVoucher`), wired as `case 31` in
  `standardReport` and `formattedReport` and in `PORTED_REPORTS`. Source: the SQL Server text of the procedure (it is missing from PC1's PostgreSQL). The voucher book's name picks the stock module (TRN_MODULE); a book that keeps a party shows
  party / product / quantity / unit (with Factor, Rate and Value, the entry remark of a sample challan, the job card of job work); the others show the voucher number, product and quantity (Add / Less for the production vouchers), godown
  transfers' From / To godown, and the ticked addon fields as columns.
  - Not ported (refused with a message): Dryer Entry, Transfer Data (it writes into the next year's company), and the production slip layouts of licences 7, 30, 38, 40 and 71.
  - Where the desktop SQL is loose: whole quantities are cut, not rounded (convert(int)); the addon column is named by its field; the licence 21 production slip's `numeic` typo is read as numeric.
- Checked on the Rishabh data: Indent Purchase, Quotation-Purchase, Production Slip [FG] / [SFG] / Multi and Sample Challan, with and without Factor / Rate. The Rishabh company has no "Adjustment" book of its own.

## 2026-10-10 (Partywise Stock NET_AMOUNT)
- `partyStock` (Partywise Stock, report 16): NET_AMOUNT (the line's value less the discounts, before the tax) is now filled whenever the book has a master (tax) slab. The procedure worked it out only with exactly one master slab, so a GST
  company (the CGST slab and the linked SGST / UTGST slab are both master slabs) got an empty NET_AMOUNT column.

## 2026-10-10 (Pivot in the output grid)
- New **Pivot** button (Alt+I) beside Group By on every report's output grid: an Excel-style field list (`features/report/PivotPanel.tsx`) to drag fields into Rows and Columns and numbers into Values (arrow buttons too; fields can be reordered),
  each value totalled by Sum / Count / Average / Min / Max, with a row total column and a final total row (`lib/report/pivot.ts`). A field is a text column or a period (day, week, month, quarter, year) of a date column, as in Group By.
  Worked on the rows already on screen (entries only, not headings / openings / the report's subtotals); at most 150 columns. Clear brings back the report. `lib/report/groupBy.ts` exports its label helpers for it.

## 2026-10-10 (Stock Summary with addons)
- Stock report (17) Summary format and Stock Summary (29): the product is not a subtotal group. A row a product: PROD CODE (the product), OPEN QTY, ADD, LESS, CLSG QTY, UOM (the ledger format's date / voucher / factor columns are
  hidden in the Summary: `lib/report/output.ts`, `stockReport` in `lib/report/reportStandard.ts`), with no subtotal rows but the final total. When an addon group is ticked only that addon's subtotal rows (and the final total) are shown.

## 2026-10-10 (Invalid GST No, GSTR Entry Tax Mismatch)
- Ported `SP_FRT_RPT_INVALID_GST_REP` (report 126, GST > Invalid GST No) and `SP_FRT_RPT_GSTR_TAX_MISMATCH` (report 132, GST > GSTR Entry Tax Mismatch) inside `lib/report/reportStandard.ts` (`invalidGst`, `gstrTaxMismatch`), wired as
  `case 126 / 132` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Source: the live PC1 procedures (later copy of each).
  - Invalid GST No: the sale (8) or purchase (13) entries of the period whose party has no GSTIN (DOC_NO, SELECTED_DATE, amount, name, GST_NO, STATE_NAME, STATE_CODE); with "Only Master Level Require" the debtors / creditors whose GSTIN is
    blank or does not start with their State's code. SELECTED_DATE is written DD-Mon-YY like the other reports' dates.
  - GSTR Entry Tax Mismatch: for the sale / purchase / expense / credit note / debit note book, the entries (stock lines when the book's slabs are by product) whose CGST line and SGST / UTGST line differ in rate or amount or have the same tax name.
- To confirm against the desktop for one period; the Rishabh data has no sale entries without a GSTIN, so the first report returns no rows there.

## 2026-10-10 (GSTR 3B, GSTR 1, GSTR 2)
- Ported `SP_FRT_RPT_GSTR_3B` (report 129), `SP_FRT_RPT_GSTR_1` (130) and `SP_FRT_RPT_GSTR_2` (131) inside `lib/report/reportStandard.ts` (`gstr3b`, `gstr1`, `gstr2`), wired as `case 129 / 130 / 131` in
  `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. The source is the SQL Server text of the three procedures (they are missing from PC1's PostgreSQL: the conversion never made them).
  - Company: the company's own, or with "Multi Company Require" every company of the same GSTIN for the year (CUR_YEAR), their figures added; "Multi Company GSTIN Not Set" when the company has no GSTIN.
  - GSTR 3B: the 3.1 / 4 / 5 table (NATURE_OF_SUPPLIES, PLACE_OF_SUPPLY, TOTAL_TAXABLE_VALUE, IGST, CGST, SGST, CESS): outward supplies (CGST / SGST / IGST slabs, product slab books by the stock lines), zero rated and nil / exempt, reverse
    charge, imports, ISD, other ITC (purchase and expense) and the ITC reversed. The procedure's loops for 3.2 (supplies to unregistered, composition and UIN holders) fetch from a cursor already at its end, so only their headings come out, as on the desktop.
  - GSTR 1 and GSTR 2, by their first combo: 1 B2B (with the count row first, the error rows of GSTIN / State mismatches in GSTR 1), 2 HSN (GSTR 1: within / out of State; summary), 3 B2C Large, 4 B2C Small, 5 Credit / Debit Note (registered),
    6 Credit / Debit Note (unregistered), 7 Exempted / Nil rated. Options: Document No, HSN Summary, Factor, Challan Date (GSTR 2), Multi Company.
  - Where the desktop SQL cannot run on this database the web does what it meant: a column the select needs is added to its group by, PROD_LEDGER has no DOC_NO (the voucher's own is read), a text key compared with a number is cast.
- To confirm: compare one period of each choice with the desktop. The Rishabh company has no GSTIN, so Multi Company was not run; licence 17's HSN (the `addon_ientry.txt_hsncode` column) is not on this database.

## 2026-10-10 (GST Form Summary)
- Ported `SP_FRT_RPT_GST_FORM_SUMM` (REPORT > GST > Form Summary, report_key 127) inside `lib/report/reportStandard.ts` (`gstFormSummary`), wired as `case 127` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`.
  - For the sale (8), purchase (13) or expense (15) book: the period's tax by the party's state and tax rate: PLACE_OF_SUPPLY ("<state code>-<state>"), CGST and UT_SGST (the same figure, for the company's own state),
    IGST (other states) and Taxable_Value, from LEDGER_EXT of the year's CGST slab (master slab, no link). "Combine Figure Of Credit And Cash" nets the credit / debit notes (16, 11); when the book has product
    slabs the stock lines decide the sign of a return. The company's state is smart_system.company.state_code. Rows by state then rate (the rate itself is not shown, as in the procedure).
  - The Account tab works as in Form Summary / Yearly Tax Summary: the ticked accounts are the book accounts (LED.BOOK_CODE; with the credit / cash switch also AG_BKCODE); none ticked gives "Minimum One Account Should Be Selected To Generate Report" (the procedure itself ignores the selection). The format is not read, as in the procedure. The procedure's joins to SLAB_MASTER, the tax type, ACCOUNT and the registration option (no filter, unique keys) are left out.
  - Account tab: GST Form Summary (127) is one of the Form Summary-like reports (`FORM_SUMMARY_LIKE` in `features/report/ReportCombine.tsx`): its REGISTER combo has its own Account help, all ticked until changed, listing the accounts of the
    books the combo's FILTER_ACC_BOOKS gives (`accountHelpBooks` in `lib/report/registerBooks.ts`: SALE 8, 11, 16; PURCHASE 13, 11, 16; EXPENSE 15).
- Source: the live PC1 procedure (the later of its two copies). Checked on the Rishabh data (books 8, 13, 15, with and without the credit / cash switch); not compared with the desktop yet.

## 2026-10-10 (Upload Document)
- Ported `SP_FRT_RPT_DOCUMENT_UPLOAD` (REPORT > Extra > Upload Document, report_key 284) inside `lib/report/reportStandard.ts` (`documentUpload`), wired as `case 284` in `standardReport` and in `PORTED_REPORTS`.
  - Book below 20 (first combo's book): the ledger entries of the chosen book account in the period with their documents (`<company>_image.document_upload`, ENTRY_MODE L): IMAGE_ENT_KEY, Sr, Name, Entry_Date,
    full_Docno, Doc_no1, Amount, REMARK, DOCUMENT_PATH. Book 20 and above: the PROCESS entries of the stock module (BOOK_PROPERTIES.STKM_SHORT; ENTRY_MODE P), named by product for PROD-FG / PROD-SFG / PROD-MULTI, else by party.
  - "Without Upload Document Entry Require" (CHK_WUPLOADDOC): the entries that have no document yet (IMAGE_ENT_KEY 0, no Sr / REMARK / DOCUMENT_PATH). LED_KEY and PROCESS_KEY stay hidden (report output columns).
- Source: the live PostgreSQL procedure on PC1 (3 overloads; the 12-argument one with `_var_dtupto` is the one the desktop converts). The temp table is replaced by one read-only query. Entry_Date is written DD-Mon-YYYY
  (the procedure's `REPLACE(date::text,' ','-')` is the SQL Server style-106 conversion gone wrong); orders by date then document number.
- To confirm: compare one book with uploaded documents against the desktop. `rishabh_plastic27_image.document_upload` is empty on this server, so only the "without document" lists were checked against data.

## 2026-10-10 (One program per layer, part 2)
- Bookwise (135), Checklist Daybook (120), Checklist Invoice (119), Daily Transaction (156), Fund Flow (109), Interest (32), Target (152), Tax Summary (18), TDS Report (162) and Top Reports (211) are now
  written inside `lib/report/reportStandard.ts` (each with its SQL helpers); Form Summary formats (14) inside `lib/report/reportFormating.ts`. `reportFormating.ts` imports the others from `reportStandard.ts`.
  The files `bookwise*.ts`, `checklistDaybook*.ts`, `checklistInvoice*.ts`, `dailyTransaction*.ts`, `formSummaryFormats*.ts`, `fundFlow*.ts`, `interest*.ts`, `target*.ts`, `taxSummary*.ts`,
  `tdsReport*.ts`, `topReports*.ts` and their 11 `tests/*-sql.test.mts` / `fund-flow-pivot.test.mts` are removed. Logic is unchanged; only colliding private helpers were renamed
  (`targetNum`, `targetRound2`, `targetText`, `targetFinishRows`, `tdsNum`, `tdsRound2`, `tdsFinishRows`, `interestRound2`).

## 2026-10-09 (Physical Stock)
- Ported `SP_FRT_RPT_PHYSICAL_STOCK` (REPORT > Inventory > Physical Stock, report_key 112), written inside `lib/report/reportStandard.ts` (`physicalStock`, with its SQL helpers `physical*`), wired as `case 112` in
  `standardReport` and `formattedReport`, and in `PORTED_REPORTS`.
  - The count sheet: a row per product with the book STOCK and empty PHYSICAL_STOCK / DIFF_STOCK columns. Licence 21: stock at the date (opening plus the stock ledger's additions less issues in the period,
    job work counted whole), the latest selling rate (the opening rate when it is 0), STOCK_VAL, sorted by product. Licence 22: stock up to the date by brand, finish and design. Any other licence: the closing
    pieces of each godown (balance rows flagged GW), by godown, brand, finish and design. The addon filters are the ticked keys of each addon group (the second one is the godown for the godown report).
- Where the desktop SQL is loose: it added the movements to the stock with `||` (text joining), written as `+`; licence 22 read every balance row of a product, here the product's own (RP) only.
- To confirm: compare one licence-21 company and one godown company with the desktop for the same date. The Rishabh company data has no godown (GW) balance rows, so the godown form lists nothing there.

## 2026-10-09 (One program per layer)
- Drop Analysis (232) and Party Wise Bill PDF (255) are now written inside `lib/report/reportStandard.ts` (exported `dropAnalysis`, `partyBillPdf`; `reportFormating.ts` imports them from there) instead of
  `dropAnalysis*.ts` / `partyBillPdf*.ts`; those files and their tests are removed. New reports go into `reportStandard.ts` / `reportFormating.ts` / `ReportCombine`, not into files of their own.

## 2026-10-09 (Party Wise Bill PDF - Particulars column)
- `lib/report/partyBillPdfSql.ts` / `partyBillPdf.ts`: the voucher key is returned as the hidden `SMART_LED_KEY` (text) instead of a visible number column `LED_KEY`. The grid had taken that number as the
  first calculation column and added an empty PARTICULARS column in front; the grid now shows DATE, NAME, DOC NO., AMOUNT, NOTE NATURE like the desktop.

## 2026-10-09 (Party Wise Bill PDF - Account help)
- `features/report/ReportCombine.tsx`: report 255's Account tab now lists only the parties of the chosen book (SALE: debtors, PURCHASE: creditors, EXPENSE: general accounts), like Agewise Outstanding;
  255 added to the `OUTSTANDING` set (its first combo's value is the book number).

## 2026-10-09 (Party Wise Bill PDF)
- Ported `SP_FRT_RPT_PARTY_BILL_PDF` (REPORT > Extra > Party Wise Bill PDF, report_key 255): `lib/report/partyBillPdf.ts` and `lib/report/partyBillPdfSql.ts`. Wired as `case 255` in `standardReport` and
  `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/party-bill-pdf-sql.test.mts`.
  - Lists the bills of the first combo's book in the period for the selected accounts (LED_KEY, name, date, bill no, amount, Note_Nature = has inventory lines), ordered by name, date, bill no.
  - Licences 19 / 29 / 68 / 73 leave out the CA_ENT cash books unless no account is short-named CA_ENT.

## 2026-10-09 (Drop Analysis)
- Ported `SP_FRT_RPT_DROP_ANALYSIS` (REPORT > Extra > Drop Analysis, report_key 232): `lib/report/dropAnalysis.ts` (queries + table) and `lib/report/dropAnalysisSql.ts` (the selects and the pivot). Wired as
  `case 232` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/drop-analysis-sql.test.mts`.
  - Product format: sale lines by product; other formats: sale invoices by customer. Sorting picks the figure: Drop Count, Quantity or Amount (the party's amount is the net before the book's first tax slab).
  - One column per day of the first-combo month (Jan-Mar in the year the financial year ends, Apr-Dec in the year it starts, February by leap year) plus TOTAL (sum of the cells as integers); the
    Month-wise option (CHK_MONTH) gives Apr..Mar instead. The master addon fields follow as columns. The desktop's PIVOT over a temp table is done in memory.

## 2026-10-09 (Top Reports)
- Ported `SP_FRT_RPT_TOP_REPORTS` (REPORT > Extra > Top Reports, report_key 211): `lib/report/topReports.ts` (queries) and `lib/report/topReportsSql.ts` (the five selects). Wired as `case 211` in
  `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/top-reports-sql.test.mts`.
  - The first combo names the report: Customers / Suppliers (the parties ranked by amount: the sale or purchase less its credit / debit notes, net of the book's first tax slab when it has one, with
    closing balance, number of invoices and quantity; customers also carry the account's master addon fields), Item Sold / Purchase by Value (the products by IL_VALUE, with the product's addon fields),
    Item Sold / Purchase by Quantity (the products by quantity with their closing stock, licence 2 counting TRN_QTY1).
  - Licence 51 lists those with nothing sold or bought after the ranked ones (Row_No 0).
- Where the desktop SQL is loose: the closing balance is that of the report's year (its join had no year, so a second year's row would double the amounts); the licence-51 quantity insert had a typo (`Row_Noname`)
  and is written as meant.
- To confirm: compare Customers and one item report with the desktop for the same period.

## 2026-10-09 (TDS Report)
- Ported `SP_FRT_RPT_TDS_REPORT` (REPORT > Extra > TDS Report, report_key 162): `lib/report/tdsReport.ts` (queries) and `lib/report/tdsReportSql.ts` (the voucher query, the TDS the rate gives). Wired as
  `case 162` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/tds-report-sql.test.mts`.
  - Vouchers of the period of the purchase (13), expense (15) and expense return (10) books with the party's address, PAN and deductee type, the TDS chart's nature of payment, section and rate
    (company or individual by the deductee type), the net amount (before the book's first tax slab), the TDS deducted (the TDS journal set against it; for a return the other side's clearing),
    ACT_TDS_AMT (net x rate / 100 to the rupee) and DIFF_TDS_AMT; only vouchers with a rate and TDS deducted show.
- As the desktop does it: the address is blank when any part of it (a line, city or pin) is missing; the TDS chart is the setup's `TDS_CHART`.
- To confirm: compare a period with the desktop.

## 2026-10-09 (Daily Transaction)
- Ported `SP_FRT_RPT_DAILY_TRANSACTION` (REPORT > Extra > Daily Transaction, report_key 156): `lib/report/dailyTransaction.ts` (queries) and `lib/report/dailyTransactionSql.ts` (the summary's lines, the detail's
  nine voucher kinds). Wired as `case 156` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/daily-transaction-sql.test.mts`.
  - SUMMARY: SORTING_COL / SMART_NAME / DESCRIPTION / FIGURE lines: 01 sale (with credit notes), 02 purchase (with debit notes), 03 expense, 04 deposits, 05 withdrawals (bank and cash books, by book account),
    06 inventory moved by product (sale, credit note, purchase, debit note, less, add, production FG / SFG, job in / out), 07 / 08 sale and purchase quantity by party, 09 / 10 / 11 sale, purchase and expense amount by party.
  - Any other format: the day's posted vouchers: Payment, Receipt, Journal, then sale, purchase, credit note, debit note, expense and agency by document series (Debit / Credit columns), ordered by kind, date text, voucher no.
- As the desktop does it: the journal's amount goes to the Debit column; the detail orders by the dd/mm/yyyy text of the date; credit notes are added to the sale, debit notes to the purchase.
- To confirm: compare a day with the desktop in both formats.

## 2026-10-09 (Target: Group list is Sales Man only)
- `lib/report/setup.ts`: Target (152)'s Group list shows only the Sales Man group, as the desktop does (the web listed every account addon: Bank Name, Bank Branch, Cheque Print Name ...); its procedure
  reads the sales person (`adata.KEY_SALESMAN`) only. A fixed rule for this report: the setup query that builds the list on the desktop was not available. If no group is called Sales Man
  the list is left as it was.

## 2026-10-09 (Target)
- Ported `SP_FRT_RPT_TARGET` (REPORT > Extra > Target, report_key 152): `lib/report/target.ts` (queries) and `lib/report/targetSql.ts` (months, quarter targets, shortfalls, the three summaries).
  Wired as `case 152` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. Test: `tests/target-sql.test.mts`.
  - Each ticked sales person's customers month by month (Month, Month_perc, Month_Target) against the net sale of the sale book (sale and debit / credit notes before tax, the sale book's first
    tax slab): yearly target and its four quarters, Net_Sale, Short_fall, the running shortfall (Tot_Short) and Archive (% achieved).
  - Options: Summary Require (a row a customer), Sales With Expense Required (a row a sales person and month with salary + expense and the two %), Group Wise Required (a row a customer type
    with its target, sale, shortfall and % achieved).
- Needs the Sales Man group ticked (the addon group); without it the report asks for one.
- Not done: the Group list shows every account addon on the web (Bank Name, Bank Branch, Cheque Print Name ...) but only "Sales Man" on the desktop; the setup's query for it is needed (see the
  chat: SELECT ... FROM smart_setup.report_controlval / query_table WHERE rep_properties_id = 152).

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
