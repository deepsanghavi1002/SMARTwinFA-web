# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

## 2026-10-16 (Outstanding Age Wise: Date Wise Detail, no subtotals, running balance)
- Change: `lib/report/reportStandard.ts`, `lib/report/output.ts`. With Date Wise sorting and the Detail filter the list has no party subtotals (and no final total) and a RUNNING BAL column before NET AMOUNT: the pending added up down the list in the order shown. Tested: 234 rows, running balance 1,88,980.00 then 3,65,972.00 then 5,58,950.00.

## 2026-10-16 (Form Summary: Debit Note / Credit Note gave No Records)
- Fix: `lib/report/reportStandard.ts`, `lib/report/reportFormating.ts`. With Debit Note or Credit Note as the register (against Sale or Purchase) every format said 'No Records Found'. The procedure reads the notes by AG_BOOK only when the typed account codes contain 11 or 16 (the book numbers in its own database; here the accounts are 19 and 24), so the filter asked for notes that are books 8 / 13 and found none. A debit / credit note register now always reads them by the book they are against. Tested on RISHABH PLASTIC 2025-26: Debit Note against Purchase 426 rows (Details), 325 (Summarized), 12 (Summary); Credit Note against Sale 1,124 / 933 / 11.

## 2026-10-16 (Fund Flow: Opening first)
- Change: `lib/report/reportStandard.ts` `fundFlow`. The Opening row is the first row of its side (it sorted in among the particulars by name).

## 2026-10-16 (Form Summary: Format opens the Account help)
- Change: `features/report/ReportCombine.tsx`. On a report whose selection has Report Options and a single help (Form Summary: Account), choosing a Format shows that help (the Account grid) at once, as the desktop does; it used to stay on Report Options.

## 2026-10-16 (Journal: Numbers sort with Between numbers failed)
- Fix: `lib/report/sqlText.ts` `pgFragment`. The Numbers sort's boxes (led.doc_no >= 1 and led.doc_no <= 4) gave 'operator does not exist: character varying >= integer' because the voucher number is text here. A number compared with a document number is now read as a number, as SQL Server does (a voucher number that is not all digits does not match). It covers every report that uses this sort. Tested on the Journal: vouchers 1 to 4 in Detail and Month.

## 2026-10-16 (Journal, report 2: the formats)
- New: `lib/report/reportFormating.ts` `journalFormats`. Journal (REPORT > Journal) with a format no longer says Not ported: Daily, Weekly, 15 Days, Quater Year and Half Year give a row per period (and per account with a group ticked) with DEBIT and CREDIT; Summary For Period Selected a row per account; Month a row per account with a DEBIT and CREDIT column for each month and the final totals. Month and Summary with a group ticked give the procedure's 'NOT ALLOWED PLEASE SELECT DETAIL OPTION'. The Detail format was already there (16,665 vouchers, 0.6 s). Tested on RISHABH PLASTIC 2025-26: every format 0.1 to 0.2 s, and debit equals credit in every period.

## 2026-10-16 (Bank Slip, report 51)
- New: `lib/report/bankSlip.ts` (wired in `reportStandard.ts`, `reportFormating.ts`, `setup.ts` PORTED_REPORTS). REPORT > Bank / Cash > Bank Slip: a row for each cheque voucher of the period (date, voucher no, party, amount, cheque no and date, bank and branch from the entry addon, and the book's account code) in the order of the voucher date and number, as the procedure's Bank Slip branch. Licence 14 reads the bank from the bank-name master and takes the ticked banks (or every bank but BANK OF BARODA). Tested on RISHABH PLASTIC 2025-26: 5,289 rows for Kotak Cash Credit in 0.2 s.

## 2026-10-17 (Stock Report: Factor Value, With Expense, FG Additional Value, the procedure's own options)
- Change: `lib/report/reportStandard.ts` `stockReport`, `stockValuation`, from Stock.txt. Summary with Factor columns (CHK_FACTOR): OPEN_FACT, ADD_FACT, LESS_FACT, BAL_FACT and UOM_1 (the second report unit). With Factor Value (CHK_FACTVAL) the valuations use the factor balance (the purchases in the second unit, Actual rate to 3 places). Actual with Expense (CHK_EXP): each purchase line carries its share of the linked expense entries (book 15 add, 11 less) as the procedure's cursor works it out; stock add / transfer lines keep their value. Closing Stock FG With Additional Value (CHK_FG_VALADD, Summary): FG costing rate added to the rate and the value re-worked. The options the procedure switches on by itself are now switched on here too: Stock Add Entry (licences 8, 5, 18, 30 with Actual), With Slab (licence 8 with Actual), Opening Value (licences 8, 5, 18, 19, 29, 30, 73 with Actual or Report Rate).
- Not done, with the reason: Update Master / Update Rate / Update Before GST write to the account and product masters (the web reports are read-only); With Slab and Without Tax (the slab keys they use are not defined in the file supplied); Average Value (its running count is not reproducible); Godown and Batch / Expiry; the licence 1 / 8 / 62 Actual code (it rewrites rates in PROD_LEDGER); Factor Value in the Ledger.

## 2026-10-17 (Stock Report Summary: Challan date, Sale / Purchase Value, Opening Value)
- Change: `lib/report/reportStandard.ts` `stockReport` (report 17), from Stock.txt (the procedure supplied 2026-10-17). Challan Date Wise (CHK_CHLNCOL) no longer says Not ported: the period test is the challan date for sale / purchase entries, the voucher date for the others, and the process date for process lines. Summary with Sale / Purchase Value (CHK_SALEPURCHVAL): PURCH_AMOUNT, SALE_AMOUNT (taxable value of the period from the tax master, product-wise when the slabs are) with PURCH_RATE and SALE_RATE; with Opening Value (CHK_OPEN_VALUE) and a valuation: OPEN_RATE and OPEN_VALUE (the opening valued as the closing of the day before From, or the opening rate times the opening when From is the year start). The SQL of the taxable values was run against RISHABH PLASTIC; the report itself was not compared with a desktop run.

## 2026-10-16 (Stock Report Ledger: addon groups as headings)
- Fix: `lib/report/reportStandard.ts` `stockReport`. Ledger with an addon group ticked (e.g. Prod Group, then Product Code): the products are in order of the group values and a heading row (the group's value) starts each group, as the procedure's ADDON_1 .. ADDON_4 rows; every row of a product carries its groups so the group subtotals come under the right group. Before, the products stayed in code order and the group subtotals fell under the wrong products.

## 2026-10-16 (Stock Report Summary: addon groups)
- Fix: `lib/report/reportStandard.ts` `stockReport`. Summary with an addon group ticked (e.g. Prod Group, then Product Code) showed one blank 'Subtotal For :' line because the product rows had no addon value. The rows now carry each ticked group's value and heading column, are sorted by the groups then the product, and the subtotals show the group names (125 lines for Prod Group on RISHABH PLASTIC, 1.5 s).

## 2026-10-16 (Stock Report: From date after the year's start, speed and timeout)
- Fix: `lib/report/reportStandard.ts` `stockReport`. With From later than the year's start (e.g. 01/May) the opening of every product was worked out by a subquery for each product, which was very slow and ended with 'canceling statement due to statement timeout'. It is one grouped query now. Summary of all 17,839 products from 01/May/2025: 1.6 s.

## 2026-10-16 (Stock Report Ledger: Closing row)
- Change: `lib/report/reportStandard.ts`. Each product in the Ledger ends with a Closing row (the closing balance in CLSG QTY, and with a valuation its rate and value), like the Opening row, before the product's subtotal.

## 2026-10-16 (Stock Report Ledger: checked against the procedure's Ledger part)
- Change: `lib/report/reportStandard.ts` `stockReport`. Line and opening filters as the procedure: licence 22 leaves out stock vouchers and stock JV; licences 19, 29, 68, 73 without a cash book entry account count only the active accounts' books (the opening strictly, the lines also with no book); licence 17 takes lines with no module; licences 5, 7, 16, 22 leave the process lines out and the folder products (group 27); the Folder option takes only the process lines of group 27. Above Days / Below Days sorting now works (additions with days at or under / over the typed number are taken out, issues get Days 0, balances still run over every line). Licence 21 JOB CARD now joins the entry addon by process as the procedure does.

## 2026-10-16 (Stock Report Ledger, licence 21: Job Card, Colour, heading colour)
- Change: `lib/report/reportStandard.ts`, `lib/report/output.ts`. Licence 21 Ledger adds JOB CARD (the entry addon's job card, else the line's) and COLOUR, as the procedure's licence 21 select. The product heading row takes the subtotal colour (pink) as on the desktop.

## 2026-10-16 (Stock Report Summary: speed)
- Change: `lib/report/reportStandard.ts` `stockReport`. The Summary no longer reads every ledger line (460,000 for the whole year) into the program: the server adds up each product's ADD and LESS (a row for each product) and the tax lookup is skipped. All 17,839 products: 6 s to 1.7 s, and with Actual and Age columns 16 s to 3.4 s. The rows are the same (9,423). The Ledger is unchanged.

## 2026-10-16 (Stock Report Summary: age Opening and Open Pcs Amt)
- Change: `lib/report/stockAgeing.ts`, `lib/report/reportStandard.ts`, `lib/report/output.ts`. With the Age columns option, after VALUE come OPENING (what is left of the closing after the year's additions, or the whole closing when it is below nil, as the procedure's Opening) and, with a Filter other than None, OPEN PCS AMT (rate to 2 decimals times that Opening), then the age columns. What is left no longer goes into the last age column.

## 2026-10-16 (Stock Report Summary: age value columns)
- Change: `lib/report/reportStandard.ts`. Summary with the Age columns option and a Filter other than None (Actual, Average ...) now also gives a value for each age column (Amt_0_To_30_Day ... Amt_181_And_Above): the rate to 2 decimals times the quantity of the column. Not done: the procedure's Open_Pcs_Amt (it needs its Opening lot quantity, which the web does not work out).

## 2026-10-16 (Stock Report Summary: wide Particulars)
- Change: `lib/report/output.ts`. The Particulars column of the Stock report Summary is 380 wide so product descriptions are not cut.

## 2026-10-16 (Stock Report Ledger: blank row between subtotal and next product)
- Change: `lib/report/output.ts`. The Ledger puts a blank row between a product's subtotal and the next product's heading, as the addon blocks do.

## 2026-10-16 (Stock Report Ledger: Tax column, heading colour, Balance Factor)
- Change: `lib/report/reportStandard.ts`, `lib/report/output.ts`. Ledger TAX column is filled as the procedure does (the entry's tax report heading, not SGST, from LEDGER_EXT / TAX_MASTER). The product heading row takes the account heading colour. With Factor ticked, BAL FACT runs down the product's lines (ADD FACT less LESS FACT). Without Factor the factor columns stay hidden, as on the desktop.

## 2026-10-16 (Stock Report Ledger: as the procedure's screen)
- Change: `lib/report/output.ts`, `lib/report/reportStandard.ts`. Ledger without Factor ticked no longer shows the factor columns (FACT., BAL FACT., second UOM). The Opening row puts the opening in ADD (or LESS when negative) so the product's subtotal includes it, and the heading and Opening rows have no UOM, as on the desktop.

## 2026-10-16 (Stock Report: rules of the current SP_STD_RPT_STOCK)
- Change: `lib/report/reportStandard.ts` `stockReport` (report 17), checked against the procedure supplied today (8,304 lines). Summary: rows with nothing at all are dropped, rows closing at nil are dropped unless Print Zero Stock, rows closing below nil are dropped unless Print Negative Stock (before, negatives always showed). Ledger: no Opening row when the opening is nil, and a product with no opening and no lines has no rows (Print Zero Stock does not apply to the Ledger). Ledger with Min-Max Qty, Update Rate In Master, FG With Additional Value, Update Rate Trf. or Update Before GST now gives the procedure's own message (Summary only). Similar Products (CHK_PRODSIMILIAR): the ticked products' parents and every product under them. Tested on RISHABH PLASTIC 2025-26: Summary 7,126 to 9,423 rows by option in about 6 s, Ledger 485,891 rows in 15 s.

## 2026-10-16 (Partywise Stock: Summary For Period Selected)
- Change: `lib/report/reportStandard.ts` `partyStockSummary` (report 16, SP_FRT_RPT_PWISESTOCK). The Summary format no longer says Not ported: one row per party and product with ADD_QTY, LESS_QTY, BOX_QTY (licence 21), the product-wise slab columns (DISCOUNT ... UTGST, NET_AMOUNT), PURCH_VALUE, SALE_VALUE and MRP_VALUE. With slabs it is a row per entry line, as the procedure groups on IL_KEY. Slab amounts are read in one query (a subquery per line took minutes). Tested on RISHABH PLASTIC 2025-26 with 40 parties: 734 rows in 5.7 s. Licence 37 and 51 still refused.

## 2026-10-16 (Stock Summary: Only Within Date Transaction Require)
- Change: `lib/report/reportStandard.ts` `stockSummary`. The option (CHK_WITHDATE) now works instead of the Not ported message: only products with a transaction between From and Upto, with OPEN_QTY (opening plus movement before From), ADD_QTY, LESS_QTY, CLSG_QTY, and for licence 21 STD_PACK, CARTONS, LOOSE_QTY. Tested on RISHABH PLASTIC 2025-26 (7927 rows, 0.9 s).

## 2026-10-16 (Stock Summary, all books: as the procedure's new version)
- Change: `lib/report/reportStandard.ts` `stockSummary` (report 29, SP_FRT_RPT_STOCK_SUMMARY_ALLBOOK). The Rate Difference book (type NR) and Damage book (ND) keys are read from BOOK_PROPERTIES (44 and 45 here) in place of the fixed 25 and 0 (the fixed damage key 0 left every ordinary credit and debit note out of CR_QTY / DR_QTY and put them in the damage columns' lines wrongly, and type 25 lines were dropped). The two passes now pick their lines as the procedure's SUMMARY1 (the period) and SUMMARY2 (before From) do: the opening before From counts purchases with the other units' share of the set-off quantity and the job work in as challan out; the period's else branches (a unit that is none of the six) differ from it as in the procedure. New: the Barcode option (BAR_CODE before OPEN_QTY), the ticked addon groups (SMART_SELECTED_ADDONn and their heading columns, sorted by them then by product).

## 2026-10-16 (Stock Report: Min / Max columns with units and colours)
- Change: `lib/report/reportStandard.ts`, `lib/report/output.ts`. With "Print Min - Max Qty. Column" the Stock report shows MIN_QTY, NUOM (the minimum's unit), MAX_QTY and XUOM (the maximum's unit), blank where the product has none; the Min Qty cell is red when the closing is under the minimum and the Max Qty cell green when the closing is over the maximum (the grid's `cellColours`). For licence 21 the Stock report's quantity columns (opening, add, less, closing, factor, Min Qty, Max Qty) show 4 decimals.

## 2026-10-16 (Stock Report: Opening column after Particulars)
- Change: `lib/report/output.ts`. The Summary's OPENING column (not in the setup's output columns, so it came last) is moved right after the PARTICULARS column.

## 2026-10-16 (Stock Report: option columns, and 6x faster with many products)
- Fix: `lib/report/reportStandard.ts` `stockReport`. The options HSN Code Col., Barcode Col., Product Warn Message Col. and Print Min - Max Qty. Column (SYS.COL) now add their column (HSN_CODE, BARCODE, WARNING_MESSAGE, MIN_QTY / MAX_QTY from the product master) to the Summary and to each product's heading line in the Ledger; the Min / Max option no longer says "not available".
- Fix: the stock lines of each product were gathered by copying the product's whole list for every line (a quadratic copy: 17,839 products and 460,658 lines took 38 s, 32 s of it in that copy); they are appended now: 6.5 s.

## 2026-10-16 (Report options: SYS.ENABLE with the Filter, as the desktop's C1_CHECKBOX_AfterEdit)
- Change: `features/report/ReportCombine.tsx` `setCheck`. A report option whose CHK_SYSVALUE is sys.enable and CHK_HIDE_AGAINST_CONTOL is lbox_Filter (the Stock Report's Update Value In Master, Valuation With All Slab / Expense / Tax / Adjustment Entry, Valuation On Factor Column, Between Date Opening Stock Value, Update Rate ..., Closing Stock FG With Additional Value ...) can be ticked only when the Filter is not the one it is hidden for (CHK_HIDE_FOR, "None"): with Filter None the tick is refused (the status line says to choose a Filter); with another Filter it stays ticked and ticks the option that names it in TICKED_FOR_ID (Valuation On Factor Column ticks Print Factor Column).

## 2026-10-16 (Bank Reconciliation: no Particulars column, coloured total lines)
- Change: `lib/report/output.ts` (report 15). The system's PARTICULARS column is not drawn (the desktop has none: Date, Vou No., Vou Series, Cheque No, Name, the two Amount columns and ##). The report's heading and total lines (H0 .. H2, T0 .. T2: Balance as per Bank Book, Add: Cheque Issued ..., * Total Add, Less: Cheque Deposited ..., ** Total Less, *** Balance as per Pass Book) are drawn as bold coloured level lines (bank book / pass book, cheques issued, cheques deposited) with a zero left blank, as the desktop's grid shows them.

## 2026-10-16 (Pie Chart and Multi Year Chart: modern look)
- Change: `features/piechart/ChartView.tsx`, `features/piechart/PieChart.tsx`, the `.pc-` block of `app/globals.css` (the Multi Year Chart screen shares its cards, fields and buttons). A fixed modern colour palette, bars and columns with rounded ends and a gradient, a dashed quiet grid, thicker white gaps between pie slices and the total in the middle of a doughnut; soft rounded cards on a light gradient background, pill selects with an arrow, the total as a gradient pill, pill buttons; a legend whose rows show the value, the share % and a thin share bar in the slice's colour. Same selections, chart types, click and Save as Jpeg.

## 2026-10-16 (Dashboard drill-down: the list adds up to the bar)
- Fix: `lib/dashboard/query.ts` `monthVouchers`. The list behind a bar showed each voucher's gross amount (taxes included, credit notes as plus) and ignored the dashboard's dates, so its total differed from the bar. It now reads the very rows the bar adds up (the same source, filters, amount, month and period: `chartSource`): for Sale and Purchase one line a voucher with the sale / purchase accounts' postings (a credit note or return as a minus, no taxes), for Expense a line for each posting, for Receipt and Payment the voucher amount, all cut by the period the figures were read for (`app/api/dashboard/route.ts`, `features/dashboard/Dashboard.tsx`). Checked on Sales May 2025-26: 1144 vouchers, 7,00,59,053.90, as the bar.

## 2026-10-16 (Dashboard drill-down: filter menu)
- New: `features/dashboard/DrillTable.tsx`, `app/globals.css`. A funnel button beside the search box opens the desktop modern grid's menu: Search in Columns (a tick for each column the search box looks in), Filter by <column> for each text column with few values (a book, a type ...; one value at a time, the same value again removes it) and Clear All Filters (filters, searched columns and the search text). The chosen filters show as chips under the title (a click removes one), and the record count, totals and pages follow them. Esc closes the menu first.

## 2026-10-16 (Dashboard drill-down: Enter / double-click opens the detail)
- New: the list behind a bar or a balance has a row cursor (Up / Down, PageUp / PageDown, a click) and Enter or a double click opens the row (`features/dashboard/DrillTable.tsx`, `onOpen`). A voucher row (the server now sends its ledger key and book, `lib/dashboard/query.ts`) opens in its entry program (VOUCHER for the books 4, 5, 6, 19, else INVOICE) as the report zoom does; an account row of a balance tile opens that account's Ledger. The list stays open behind the new window; when an entry saved in a window opened from the dashboard changes data, the dashboard reads its figures again the next time it is in front (its list closes). `features/dashboard/Dashboard.tsx`.

## 2026-10-16 (Dashboard drill-down list: card rows, badges, page numbers)
- Change: `features/dashboard/DrillTable.tsx` (and the accent passed by `Dashboard.tsx`), `.dash-drill` block of `app/globals.css`. The list behind a bar or a balance in the colour of its chart: a coloured strip and icon badge, rows as soft rounded cards with a hover tint and accent edge, party names with a coloured initial badge, document numbers as code chips, book / type / group columns as coloured tags, dates muted, amounts with a rupee sign (red when negative), the total as a pill, rows-per-page (15 / 25 / 50 / 100) and numbered page buttons with the current page highlighted. Same search, sort, Excel and PDF.

## 2026-10-16 (Dashboard: modern drill-down list)
- Change: `features/dashboard/DrillTable.tsx` and the `.dash-modal` / `.dash-drill` block of `app/globals.css`. The list behind a bar or a balance: a blurred backdrop, a rounder window that rises in, the title with its record count (and "found of" while searching), a pill search box with an icon, Excel / PDF / Close pill buttons with icons, a clean sticky heading with sort arrows, rows with a hover tint and right-aligned amounts (red when negative), the totals as pills and Prev / Next pills. Same search, sort, paging, Excel and PDF.

## 2026-10-16 (Dashboard: modern look)
- Change: `features/dashboard/Dashboard.tsx` and the dashboard block of `app/globals.css`. The five balances come first as KPI tiles (icon chip, large figure, red when negative, "Position as on today"); each chart card has one accent colour (gradient bars with rounded tops, the peak month at full strength, a negative month in red, dashed grid), its totals as soft pills, and a legend of month, amount and a green / red change chip with an arrow. Rounder cards with soft shadows on a light gradient background. Same data, same clicks (a bar opens its month's vouchers, a tile its accounts), same Ok / Reset / Quit.

## 2026-10-16 (Zoom: reports refresh after the entry they zoomed into changes)
- New: a zoom window knows the window it was opened from (`zoomParent` in `app/page.tsx`). When an entry saved or deleted a voucher (`features/entry/Entry.tsx` calls `useWindowLink().changed()`), every window up the chain (Trial Balance > Ledger > Entry) is marked stale (`features/ui/windowLink.tsx`), and each report (`features/report/ReportCombine.tsx`) runs again with its own selection when it is next in front. The desktop refreshes only the report the entry was opened from; here the whole chain is brought up to date. Reports not in the chain are left alone.

## 2026-10-16 (Reports: Enter zooms into the Ledger from Trial Balance, Profit and Loss, Sales with Expense)
- New: Report_Combine C1_OUTPUT_KeyUp for reports 6, 22 and 280, and Report_Combine_Activated's Zoom_Accode. Trial Balance (an account above the schedule codes 27) and Sales with Expense rows carry their account (`OutputRow.acCode` from SMART_AC_CODE, `lib/report/output.ts`, packed by `lib/report/wire.ts`); on Profit and Loss the clicked cell's text names the account (a name of an account that is not a party; a number column says "Please Click On Alphabet Column......", an unknown name "No Record Found......"). The report route's `zoom` action (`lib/report/zoom.ts`) answers REPORT_LEDGER and the account; `app/page.tsx` opens the Ledger in a window of its own, and `features/report/ReportCombine.tsx` (`zoomAccount`) ticks the account in the Account help and the Account group and runs the report.

## 2026-10-16 (Reports: Enter on a voucher row opens the entry, as the desktop's zoom)
- New: Report_Combine C1_OUTPUT_KeyUp (Enter, ZOOM ENTRY). `features/report/OutputGrid.tsx`: Enter on a data row with a voucher (SMART_LED_KEY) asks the report route's new `zoom` action (`lib/report/zoom.ts`: the cash, bank, card and journal books 4, 5, 6, 19 open the VOUCHER entry, every other book the INVOICE entry), and `app/page.tsx` (`openZoom`, `features/report/zoom.ts`) opens that program from the menu in a window of its own. `features/entry/Entry.tsx` gets a `zoom` prop: the entry route's new `zoom` action (`zoomRegister` in `lib/entry/products.ts`) names the voucher's register (its BOOK_CODE, the account it was entered under) and its unique key, the register is chosen and the voucher opens as from Find / Edit. Not done: rows with only a process key (stock vouchers, challans, orders), the Trial Balance / Profit and Loss / Sales with Expense zoom into the Ledger report, and the Account Master zoom of rows without a voucher.

## 2026-10-16 (Output grid: closing Growth restores the report)
- Fix: `features/report/OutputGrid.tsx`: a party picked in the Growth panel filters the grid; closing the panel now clears that filter (as the Chart panel already did), so the full report is back. Other column filters stay.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Transport Register: report 299)
- New: `lib/report/trpRegister.ts` (SP_FRT_RPT_RPI_TRP_REGISTER), wired in both dispatchers and `PORTED_REPORTS`. Transport Paid ticked: the transport expense vouchers of the period with the entries (ledger vouchers, and job work / challan vouchers) that name them (TRP_EXP_LED_ID): party, book, document, invoice, LR no, date, amount, transport, transport amount and the expense entry's no and date; each part only where the database has the column on its table. Otherwise the transport details of the sale / purchase / debit note and job work / challan vouchers of the period with no transport amount charged yet. By party.

## 2026-10-16 (Job Out Index: selection screen speed)
- Change: `lib/report/helpSql.ts` `fastHelpSql` groups a `LEFT JOIN LATERAL (select col from t where key = outer.col limit 1)` lookup once and joins it (the Jobout No help's job card of report 254 read ADDON_IENTRY for every voucher).

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Job Out Index: report 254)
- New: `lib/report/jobOutIndex.ts` (SP_FRT_RPT_RPI_JOBOUT_INDEX), wired in both dispatchers and `PORTED_REPORTS`. JOB OUT INDEX: the approved job work out vouchers (the ticked ones) with the party's address, product, quantity, transport and vehicle. Otherwise the check of the vouchers not yet approved: quantity, stock, what the pending plans need through the BOMs (Pend_Plan), what the job worker holds, Required, As_Per_BOM and Difference. The procedure's cursors are in memory; the BOMs, plans and job work lines are one grouped read each.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Distributors Wise Dispatch Check: report 248)
- New: `lib/report/distributorsDispatch.ts` (SP_FRT_RPT_RPI_DISTRIBUTORS_DISPATCH_CHECK), wired in both dispatchers and `PORTED_REPORTS`. The boxes sold (book 8, From..Upto) to each distributor of the ticked products (up to 10), a column for each product by its short name and TOTAL, then the customers of the ticked account addons with no such sale; by grade then distributor. As the procedure's PIVOT does, a column holds the sale lines whose description equals the product's short name. One grouped read.

## 2026-10-16 (Stock Status: coloured standard pack)
- Change: `lib/report/output.ts`, `lib/report/types.ts` (`OutputRow.cellColours`), `features/report/OutputGrid.tsx`: report 244's STD_PACK cell is coloured by its status as the desktop does (Available green, Low Stock red, Under Process blue, Not Available none). Grid only; print / export keep the plain cells. `lib/report/wire.ts` now carries `cellColours` (the packed rows dropped it, so no colour came), and STD_PACK reads right-justified.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Stock Status: report 244)
- New: `lib/report/stockStatus.ts` (SP_FRT_RPT_RPI_STOCK_STATUS), wired in both dispatchers and `PORTED_REPORTS`. The Finish Goods products (of the ticked addon) with a status from the cartons in stock and the cartons still to be made (Available upto 20 / more than 20 / 30 / 50 / 100 CTN, Low Stock, Under Process, Not Available), the standard pack and the latest MRP; by product group then description. The plans, production and MRP are one grouped read each.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Order Clearance: report 231)
- New: `lib/report/orderClearance.ts` (SP_FRT_RPT_RPI_ORDER_CLEARANCE), wired in both dispatchers and `PORTED_REPORTS`. The ORD-IN lines of the period (the picked accounts) with the bills made against each line (PROD_LINK), a line for each order line and bill: order date / no, party, description, group, specification, job card, order quantity (first row of the line), rate, value, short close, original / revised delivery date and the days between, the bill's entry, date, no, quantity, rate, value, the balance (ordered less short closed and billed) with its value, and the delay. Pending Order keeps lines with a balance. By party, then order date. The bills of all order lines are one read.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Steel Plant Stock: report 230)
- New: `lib/report/steelPlantStock.ts` (SP_FRT_RPT_RPI_STEEL_PLANT_STOCK), wired in both dispatchers and `PORTED_REPORTS`. The stock the Steel Plant (Meher) holds, from the challans (CHLN-OUT / CHLN-IN lines with Lot No Yes) and the products' Re-order stock as the opening. Summary: Meher opening, to / from the plant in the period, Meher closing, total closing stock, stock in Rishabh and at the plant, cartons at Meher, by the addon groups then product code. Ledger: the challan lines of each product with its opening and running balance. The Stock Transfer option (it writes the next company's Re-order) is refused: a report never writes.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Steel Plant Challan: sorting box heading)
- Change: `features/report/ReportCombine.tsx`: the box that Sorting > Challan No / Vehicle No shows for report 228 has no heading (it read "OTHPERC" / "EXPPERC", the control's name).

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Steel Plant Challan: report 228)
- New: `lib/report/steelPlantChallan.ts` (SP_FRT_RPT_RPI_STEEL_PLANT_CHALLAN), wired in both dispatchers and `PORTED_REPORTS`. A line for each product added on the production vouchers ticked in the Description help: serial no, job card, voucher no and date, description, added quantity (2 decimals), process name; by the voucher's document number. `jobCardHelpSql` became `spaceConcatSql` and is applied to every help (`right(space(n)+COLUMN,n)` orders, as in the Steel Plant help, which came back empty).

## 2026-10-16 (SPECIAL > Extra Report (RP1) > MFG Formula Search: report 227)
- New: `lib/report/mfgFormulaSearch.ts` (SP_FRT_RPT_RPI_MFG_FORMULA_SEARCH), wired in both dispatchers and `PORTED_REPORTS`. The first combo picks the type (1 Finish Goods, 2 Semi Finished Material, else Raw Material). With Formula: the BOMs of products of that type, a line for the product made and a line for each component (voucher no, BOM document, finish goods, component, quantity, unit, group / type / category); without it: the products of that type that have no BOM.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Stock Balance: Job Card help)
- Fix: `lib/report/helpSql.ts` `jobCardHelpSql`, used by `lib/report/setup.ts` for HELP_JOBCARD. The help's order, `right(space(10)+JOB_CARD_NO,10)`, adds texts with `+`, which PostgreSQL refuses, so the Product Group help of reports 221 / 222 came back empty ("No records found"). It reads `right(repeat(' ',10) || JOB_CARD_NO,10)` now.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Stock Balance: reports 221, 222)
- New: `lib/report/stockBalance.ts` (SP_FRT_RPT_RPI_STOCK_BALANCE), wired in both dispatchers and `PORTED_REPORTS`. For the job cards of the PP plans (all, or the picked plan keys) and the components of the latest BOM of each plan's product: 221 first combo 1 shows planned / made / bought / consumed quantity with the balance, standard rejection and balance after it (with %); 221 first combo 2 shows planned, produced, revised planning, stock, pending plan (through the BOMs), pending purchase orders, balance stock and MSL; 222 is the requirement sheet (entry date, job card, FG product, component, planned and required quantity; issue / return columns blank). The procedure's cursors are a few grouped reads; by job card (last 10 characters).

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Stock Flow: report 212)
- New: `lib/report/stockFlow.ts` (SP_FRT_RPT_RPI_STOCK_FLOW), wired in both dispatchers and `PORTED_REPORTS`. The inventory products of the selection other than Finish Goods: opening, the year's additions (production, credit notes, purchases, stock and stock journal additions, job work in) and reductions (debit notes, sales, stock and stock journal less, job work out, consumption) in the product's report unit, closing with its value at the master rate, what the pending plans need of it through the BOMs (Pend_Prod_Plan), the pending purchase orders, and the balance with its value; products with nothing in them are left out. The procedure's work tables are in memory; the movements, plans, BOMs and orders are one read each.

## 2026-10-16 (SPECIAL > Extra Report (RP1) > Planning FG Analysis: report 210)
- New: `lib/report/planningFgAnalysis.ts` (SP_FRT_RPT_RPI_PLANING_FG_ANALYSIS), wired in both dispatchers and `PORTED_REPORTS`; `phnDate` / `style6` of `productionSetoff.ts` are now exported. Summary format: a line for each PP plan with a job card (From..Upto, the picked products): planning, packing and revised packing dates, the last finished good production date of the job card ("Plan Closed" when the plan is all done), the product's PHN date and the days from each of them to the last production date while the plan is open. The last production dates of all the job cards are one read. No final total (`output.ts`).

## 2026-10-16 (SPECIAL > Extra Report (RP) > Indent Comparison: report 149)
- New: `indentCompare` in `lib/report/orderCompare.ts` (SP_FRT_RPT_RP_INDENT_COMPARE), wired in both dispatchers and `PORTED_REPORTS`. The lines linked to the indent of the first combo, one row a product with a column for each party's rate (shared pivot with report 148). With Pending Indent ticked: the indent lines (IND-PURCH) with a quantity not yet against and no link, by date.

## 2026-10-16 (SPECIAL > Extra Report (RP) > Order Comparison: report 148)
- New: `lib/report/orderCompare.ts` (SP_FRT_RPT_RP_ORDER_COMPARE), wired in both dispatchers and `PORTED_REPORTS`. For the process picked in the first combo: its lines and the lines of every order linked to the same entries (PROD_LINK), as one row a product (description, quantity, last purchase rate, unit) with a column for each party holding its rate. The procedure's cursors that built the key lists are single reads; "No Record Found" when the process has no link.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Production Planning Detail: reports 170, 207, 208, 209)
- New: `lib/report/productionPlanDetail.ts` (SP_FRT_RPT_RPI_PRODUCTION_PLANING_DETAIL), wired in both dispatchers and `PORTED_REPORTS`. The PP plans of the ticked products (entry date, or packing date with "Packing Plan Date Wise Require", From..Upto): a finished good line under each BOM of its product and a line for each BOM component (BOM quantity x planned quantity). 170 adds packing, cartons, the latest sale rate / value and the purchase order and bill against the job card; 207 / 208 / 209 (Moulding, Filling, Stamping) are the same lines of their product group (Plastic Moulded / Plated / Metalizing parts, Insulated - Filling, Stamping Foils) without the rate and purchase columns. "Only Pending Job Card Require" leaves out the produced job cards. The sale rates, BOM components and purchase orders are read once each (the procedure looked each up per line).

## 2026-10-15 (SPECIAL > Extra Report (RP) > Moulding Production Plan: report 203)
- New: `lib/report/mouldingPlan.ts` (SP_FRT_RPT_RPI_MOULDING_PRODUCTION_PLAN), wired in both dispatchers and `PORTED_REPORTS`. The plans (PP) of the period with the components of their BOM: mould, machine, standard weight, pieces an hour, planned / produced / pending quantity, hours required (pending / (pieces an hour x 0.85)), total weight, and the machine's lines laid one after the other from its Addon start time (START / END date and time). As in the procedure, figures are whole numbers, a component with no production on the job card makes no line, and only lines with pieces an hour show. BOM, production and machine margins are read once each.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Job Work Master: report 200)
- New: `lib/report/jobWorkMaster.ts` (SP_FRT_RPT_RPI_JOB_WORK_MASTER), wired in both dispatchers and `PORTED_REPORTS`. Job out lines of the period with the job in lines made against them (ORDER_NO) and the expense bills (book 15) made against those, laid line by line exactly as the procedure's cursors did (n-th line, else a new line), sorted by the sorting text. The three sides are read once each and the temp table is done in memory.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Job Setoff Expense Bill: report 199)
- New: `lib/report/jobSetoffExpense.ts` (SP_FRT_RPT_RPI_JOB_SETOFF_EXPENSE), wired in both dispatchers and `PORTED_REPORTS`. Expense Bill: the bill lines of the period that name a job-in entry (ORDER_NO) with that entry; a bill's lines of one job-in entry and quantity are one; the bill's party / number / date on its first line. Job In: the job-in entry lines of the period with the bills linked to them (PROD_LINK): bill number and date, challan, bill quantity, and BALANCE (quantity less what the bills took); only the first line of an entry keeps its number and quantity. Each side is read once and joined in memory.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Purchase Price Analysis: report 198)
- New: `lib/report/purchasePrice.ts` (SP_FRT_RPT_RPI_PURCHASE_PRICE), wired in both dispatchers and `PORTED_REPORTS`. The purchase lines (book 13) of the period from the ticked suppliers against the lowest rate of the same item in the period from any supplier (its date, number, party, quantity, rate): Diff_Rate, Min_Val_Act_Rate, Diff_Value; by supplier, item and entry date. One read for the lines and one for the lowest rates (the procedure ran a query a product).

## 2026-10-15 (SPECIAL > Extra Report (RP) > Planning V/S Production: report 189)
- New: `lib/report/planVsProduction.ts` (SP_FRT_RPT_RPI_PRODUCTION_VS_PLANING), wired in both dispatchers and `PORTED_REPORTS`. For the one product picked and its PP plans of the Upto day: the plan's line (planned, short, FG_PRODUCTION_QTY from the product's finished good entries on the job cards, PLAN_VS_FG_PRODUCTION) and a line for each BOM component (FORMULA_QTY, REQ_QTY = planned less short x it, MOULDING_QTY the quantity of it taken on those processes, EXTRA_MOULDING_QTY, PLAN_VS_MOULDING). Several products are refused ("Multiple Product Selection Not Allowed"), as the procedure.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Total Expense: reports 188, 302)
- New: `lib/report/totalExpense.ts` (SP_FRT_RPT_RPI_TOTAL_EXPENSE), wired in both dispatchers and `PORTED_REPORTS`. The expense (15) and debit note expense (10) vouchers of the period with a column for each slab of the expense book (the taxes with NET_AMOUNT and their name), Amount (negative for a debit note; by item from 01/04/2026, the amounts on the first line), and the cash / bank payments, journals and discounts to the expense accounts as NET_AMOUNT; by book, date and document. 302 takes only the factory departments' lines (the procedure's list); it has no setup row in the database yet. The slab amounts of all the vouchers come from one read of the ledger extension.

## 2026-10-15 (INVENTORY > Stock Report: Stock With Ageing Required / Print Days Column)
- `reportStandard.ts stockReport`: the Summary first combo takes the ageing option (CHK_AGECOL, both "Print Days Column" and "Stock With Ageing Required"): each product's closing set against the year's additions, newest first, into Days_0_To_30 ... Days_181_To_Above and Days (the age of the oldest lot used; 99999 for stock older than the year). `stockAgeing.ts stockLots` is shared with report 187. The Ledger first combo still refuses the option. The procedure's own text (SP_STD_RPT_STOCK) is not in the PostgreSQL copy: the columns follow SP_FRT_RPT_STOCK_AGEING's fixed form.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Stock With Ageing: report 187)
- New: `lib/report/stockAgeing.ts` (SP_FRT_RPT_STOCK_AGEING), wired in both dispatchers and `PORTED_REPORTS`. Each inventory product of the ticked products / addons with its closing stock on Upto (the year's opening in its report unit plus the year's movement, rate-difference notes left out) set against its additions, newest first, into the day-gap columns of Setup (STOCK_DAYS_GAP, e.g. 0-7 ... 91-ABOVE) with their values at the rate (the last rate of an addition, else the opening rate), Negative / Neg_Amt, Amount and Days (the age of the oldest lot used); closing of 0 left out. The additions and movement are read once for all products and the lots are set off in memory (the procedure's cursor ran a query a product). The previous year's database is not read (stock older than the year goes to the last column); licence 21 (Rishabh) is ported: rate from the price list (then the year's last purchase, the opening rate, the report rate), PROD_PACK, CLSG_BOX_QTY, CLSG_LOOSE_QTY, TOTALQTY_ABOVE_90, TOTALAMT_ABOVE_90.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Production Planning Setoff / PMP Assemble: reports 175, 177)
- New: `lib/report/productionSetoff.ts` (SP_FRT_RPT_RPI_PRODUCTION_PLANING_SETOFF), wired in both dispatchers and `PORTED_REPORTS`. 175: the PP plans with a job card against the approved FG entries (first combo FG) or the SFG entries (SFG) of the job card, with the balance of each plan on its first line (FG: with rate, value and net value; SFG: against the BOM's quantity); Summary a line for each plan with a balance. 177: the FG plans and, for each plan not fully produced, the BOM components that are moulded / plated parts (with hours at the standard pieces an hour) and chemicals, with the semi-finished components under a part. The work tables are in memory from a few reads. "Pending Plan Transfer To New Year" is not done (it writes the next year's database).

## 2026-10-15 (SPECIAL > Extra Report (RP) > Bank Payment Transfer: report 174)
- New: `lib/report/paymentTransfer.ts` (SP_FRT_RPT_RPI_PAYMENT_TRANSFER), wired in both dispatchers and `PORTED_REPORTS`. The payments of the bank account of the first combo From..Upto as the rows of the bank's upload sheet (client / product code, NEFT below 2,00,000 else RTGS, date, debit account = the bank account's long narration, amount, beneficiary name / IFSC / account no / e-mail / mobile, debit narration); punctuation in the name and narration is cleaned as the procedure does. One read.

## 2026-10-15 (SPECIAL > Extra Report (RP) > HV Purchase: report 172)
- New: `lib/report/hvPurchase.ts` (SP_FRT_RPT_RPI_HV_PURCHASE), wired in both dispatchers and `PORTED_REPORTS`. The purchase lines (book 13) of the period from the ticked suppliers with PURCH_KGS (quantity x standard weight, 3 decimals): Detail a line each (invoice and entry dates / numbers, supplier, product, STD_WEIGHT, PURCH_QTY, RATE, VALUE, PURCH_KGS) by entry date; Summary a line a supplier and product. One read.

## 2026-10-15 (SPECIAL > Extra Report (RP) > SS Circle: report 171)
- New: `lib/report/ssCircle.ts` (SP_FRT_RPT_RPI_SS_CIRCLE_PURCHASE_SALE), wired in both dispatchers and `PORTED_REPORTS`. The purchase lines (book 13) of the period of the "SS Circles" products with the sale lines (book 8) that took the purchase's number as their invoice number for the same product: supplier, dates, numbers, rates, quantities, BAL_QTY (purchase less sale). By purchase date (the procedure sorted the day-month text), then number. One read.

## 2026-10-15 (SPECIAL > Extra Report (RP) > SFG Difference: report 169)
- New: `lib/report/sfgDifference.ts` (SP_FRT_RPT_RPI_SFG_DIFFERENCE), wired in both dispatchers and `PORTED_REPORTS`. FG Difference: each PROD-FG entry of the period with the components its entry took, expected (BOM quantity x finished quantity) against taken, and DIFF_QTY. SFG Difference: each PROD-SFG / PROD-MULTI entry with the components of the same document against the BOM, by date then document. One read.
- `reportFormating.ts` / `reportStandard.ts`: only the dispatch lines. (The procedure's first combo value 1 is SFG, 2 is FG, as its combo lists.)

## 2026-10-15 (SPECIAL > Extra Report (RP) > Sales Net Rate To DP Difference: report 122)
- New: `lib/report/rateDiff.ts` (SP_FRT_RPT_SHAH_RATE_DIFF), wired in both dispatchers and `PORTED_REPORTS`. The sale lines (Sale format: no process; Challan: order-out lines with a process) of the period with the net rate (amount before the first sale slab's taxes over the quantity) against the DP in force on their date: DP_RATE, VARIANCE, VARIANCE_%, ACT_VALUE, DP_VALUE, DIFF_VALUE, by party. One read; the procedure's unused addon join (it repeated the lines of a product with two addon rows) is left out.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Collection Summary: report 161)
- New: `lib/report/collectionSummary.ts` (SP_FRT_RPT_RPI_COLLECTION_SUMMARY), wired in both dispatchers and `PORTED_REPORTS`. For the debtors / addons ticked and the month of the first combo (Upto is the end of the month before it, April is today): OS_UPTO_LAST_MONTH (the party's closing on Upto), THIS_MONTH_DUE (bills 60-90 days old), OVERDUE_90_DAYS, COLLECTION_RECEIVED (cash / bank receipts of the month number), SHORT_FALL, Against_os_%, Achieved_%. The outstanding bills are cleared as the procedure's cursors do (credit note, receipts set off, receipts on account, cut to the closing). "Summary Required" sums by the ticked addon groups. The procedure's temp tables are in memory from five reads.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Production Summary / Daily Packing: reports 160, 216)
- New: `lib/report/productionSummary.ts` (SP_FRT_RPT_RPI_PRODUCTION_SUMMARY), wired in both dispatchers and `PORTED_REPORTS`. 160 Summary: the PRODUCTION line (target of the months, gross production of the Finish Goods entries at the sale rate of their day, outsourced production at the last rate, the nets at Other Perc / Export Perc, shortfall, % achieved, worked out as the procedure does). 160 Detail: a line a Finish Goods entry and a line a bought one with gross / net production and the ticked addon groups. 216 Daily Packing: the entries of the period with job card, lot, plan balance run down entry by entry, cartons / loose, total packed, % complete, gross and net value. No lot: no percentage (the procedure divided by zero). Nothing is written.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Production Inquiry: reports 154, 168)
- New: `lib/report/productionInquiry.ts` (SP_FRT_RPT_RPI_PRODUCTION_INQUIRY, the 07-Oct-2026 form), wired in both dispatchers and `PORTED_REPORTS`. 154 Production Inquiry: the PP plans with a job card (entry date From..Upto) of the ticked products, a finished good line and the components of its latest BOM (semi-finished components with a BOM exploded to ten levels, quantities multiplied down the chain), with stock, pending orders, what all pending plans need (PLANING_PEND), the quantity short, lead days and tentative date for Finish Goods; with "Indent Entry Require" summed by product with the last purchase's party, quantity, rate and the weight short. 168 Planing Checking: the PC plans entered on Upto, a row a description with planned, stock and quantity. The work tables are in memory from five grouped reads; 168's delete of its PC plan rows is not done (reports do not write).

## 2026-10-15 (SPECIAL > Extra Report (RP) > Packing Planning: report 153)
- New: `lib/report/packingPlan.ts` (REPORT_RPI_PACKING_PLAING, SP_FRT_RPT_RPI_PACKING_PLANING), wired in both dispatchers and `PORTED_REPORTS`: the production plans (type PP, planned quantity above 0) packing From..Upto (entry date with "Entry Date Wise Require"), a line each with the sale rate in force on the entry date, Amount (rate x planned) and Net Value (75 %, 68 % for Export items); by packing date then product group. One read.

## 2026-10-15 (SPECIAL > Extra Report (RP) > Patiya: report 150)
- New: `lib/report/patiya.ts` (REPORT_PATIYA, SP_FRT_RPT_RP_PATIYA), wired in both dispatchers and `PORTED_REPORTS`: a line for each product of the sale vouchers ticked in the Invoice help (voucher, date, party / contact, city, transport, lot, description, box, loose, quantity, area, load, LOCATION, specification, mould code), by area, load, voucher no, date, mould code; "Only Pending Eway Bill Require". One read.
- `helpSql.ts invoiceHelpSql` (used by `smartHelp` for HELP_INVOICENO): the Invoice help gets the LOCATION column (the voucher's remark) the desktop's grid has, and a voucher with no transport keeps its DOC_NO.

## 2026-10-15 (ANALYSIS REP. > Income / Sales Tax: report 26)
- New: `lib/report/incomeTax.ts` (Tax Report, REPORT_TAX_REPORT; SP_STD_RPT_INCOMETAX and the report-26 branch of SP_REPORT_FORMATING), wired in `standardReport` / `formattedReport` and `PORTED_REPORTS`, from the PostgreSQL text of the procedures. Summary: a line a party (Gross, GST / VAT / CST no) with its address lines and an empty line under it (the cash book lists receipts: date, party, amount). Bill Detail: a line a bill (Net_Amt, Tax_Amt, Gross, tax numbers, transaction code, Remark with Return Include). 704 Summary: a line a party (Net_Amt, Tax_Amt, Gross, VAT / CST no, mobile, e-mail). The filter (All / Local / Out-State) narrows the taxes to the places; Return Include takes in credit / debit notes with a negative sign. One query a format (the procedure's temp tables and cursors are not needed).

## 2026-10-15 (ANALYSIS REP. > Multi Company > Profit And Loss: report 178)
- New: `multiCompanyProfitLoss` in `lib/report/multiCompanyAccountSummary.ts` (the other branch of SP_FRT_RPT_MULTI_COMPANY_ACCOUNT_SUMMARY_REP), wired in both dispatchers and `PORTED_REPORTS`. The accounts of the profit and loss heads (balance sheet codes 01 / 02) with their postings From..Upto (debit less credit) in a column a company of the group (ticked Book companies), TOTAL; a row a name inside its head (SMART_SELECTED_SCHDULE, subtotal under each), by head level then name; zero lines left out; OPENING STOCK takes the closing stock account's opening (last year's closing when From is not the year's start) and CLOSING STOCK its OS_BILLDIFF reversed, as the procedure's renames and updates. The company list is now `groupCompanies`, shared with 115.

## 2026-10-15 (ANALYSIS REP. > Multi Company > Bal Sheet: report 136)
- New: **Multi Company Balance Sheet** (report 136, the multi company branch of SP_REPORT_STANDARD's balance sheet) in `reportStandard.ts`: the companies of the group with the year (ticked Book companies), each balance sheet worked out on its own database from the year's start to Upto by `balanceHeads` (as 23); a row a head (liabilities before assets), a column a company (short name), TOTAL, a Difference row for a company that does not balance, subtotals on the side as 138. The side-by-side layout is now `balanceColumns`, shared with 138 (138's output unchanged). In `standardReport` and `PORTED_REPORTS`.

## 2026-10-15 (ANALYSIS REP. > Multi Company > Product Analysis: report 116)
- New: `lib/report/multiCompanyProduct.ts` (SP_FRT_RPT_MULTI_COMP_PROD_ANALYSIS_REP), wired in both dispatchers and `PORTED_REPORTS`. The first combo's quantity (Stock, Opening, Sale, Purchase, Credit Note, Debit Note, Stock Add, Stock Less) of each product side by side in a column a company of the group, TOTAL; zero quantities left out; licence 7's Stock with the addon attributes, licence 2's quantity from TRN_QTY3. One grouped read a company.

## 2026-10-15 (ANALYSIS REP. > Multi Company > Ledger: report 118)
- New: `lib/report/multiCompanyLedger.ts` (SP_FRT_RPT_MULTI_COMPANY_LEDGER_REP), wired in both dispatchers and `PORTED_REPORTS`. One account (single pick) by name in every company of the group with the year (ticked Book companies): heading, per company opening, postings, Closing Balance line carrying the closing balance (one closing at the end with Combine). Two grouped reads a company; the closing line is the last of its company. `output.ts`: Debit / Credit are the subtotal columns for 118 when the setup names none.

## 2026-10-15 (ANALYSIS REP. > Multi Company > Account Summary: report 115)
- New: `lib/report/multiCompanyAccountSummary.ts` (SP_FRT_RPT_MULTI_COMPANY_ACCOUNT_SUMMARY_REP, report 115), wired in `standardReport`, `formattedReport` and `PORTED_REPORTS`. A row a account (and schedule when schedules are ticked), a column a company of the group (ticked ones of the Book group) with the closing balance, TOTAL; zero closings left out; Sundry Debtors / Creditors control accounts (SD / SC) take in the party postings with the first combo "others". Two or three grouped reads a company. `output.ts`: with schedules ticked a subtotal under each schedule and a final total. Report 178 (same procedure) is not ported.
- Report 117 (Bank / Cash): Closing Bal filled (the balance runs on Receipt / Payment when the setup names no subtotal columns); the Book grid's tick key falls back to CO_KEY (`setup.ts loadHelp`) so a click ticks one company, not all.

## 2026-10-15 (ANALYSIS REP. > Multi Company > Bank / Cash: report 117)
- New: `lib/report/multiCompanyDayBook.ts` (SP_FRT_RPT_MULTI_COMPANY_DAY_BOOK_REP), wired as `case 117` in `standardReport` and `formattedReport`, and in `PORTED_REPORTS`. The cash / bank account of the first combo in every company of the group with the same year (ticked companies of the Book group only): a line a voucher with company, party, Receipt, Payment (bank adds cheque no / date / reco date), an opening and closing line per company (one closing at the end with Combine), or the schedule of the party when schedules are ticked. Four grouped reads a company instead of the cursor's statements. Put right: a company without the account no longer reuses the previous company's code; the closing line sorts after the Upto day's vouchers.

## 2026-10-14 (SPECIAL > Extra Report (RP) > Finish Product Costing (Sales Dept.): report 163)
- New: **Finish Product Costing** (REPORT_FINISH_PRODUCT_COSTING, report key 163, SP_FRT_RPT_RPI_FINISH_PROD_COSTING): the finish goods' bills of material (MFG-BOM vouchers) costed. A row for each BOM voucher of a finish good: Description, DP_RATE (the latest sale rate up to Upto), NP_RATE (68% of it), STD_PACK, QUANTITY, PRODUCTION and SALE (the year's start to Upto), COST_RATE (the voucher's whole cost), DIFF_RATE (NP less cost), PROD_VAL, DIFF_VAL, CONSUMPTION_RATIO_%, PROFIT_ON_NET_%, PROFIT_ON_COST_%; under it a row for each material (Material_Used rows: quantity, Rate, COST_RATE = quantity x rate), the rate being the voucher's, else the year's latest purchase rate, else the opening rate, else the report rate; a semi finished material is replaced by the raw materials its own latest BOM explodes to (quantities scaled, at most ten levels, leaves only, no repeats in a path). **Summary Require**: the finish goods' rows only. **Consumption Require**: SORTING_FIELD, Description, PRODUCTION, CONSUMPTION, UOM for the finish goods' PROD-FG vouchers of the period and what the same vouchers consumed. **PMP Detail Require**: the semi finished materials' BOM vouchers with the materials of each (Prodcat, Category, prod_Group, Description, Material_Used, QUANTITY, SINGLE_PC_WEIGHT). Ordered by SORTING_FIELD (the voucher, then its materials). `finishProductCosting` in `lib/report/reportFormating.ts` (`case 163`); added to `PORTED_REPORTS`.
- Speed: the procedure's temp tables, its UPDATEs and its recursive query become a few grouped reads (100-330 ms here: 2,364 finish good BOM vouchers, 52,440 BOM lines) and the same steps in memory.
- Kept from the desktop: every row's SINGLE_PC_WEIGHT is 1 before the materials are exploded, so TOTAL_WEIGHT of a material row is its quantity; the voucher's cost is added up over all its rows (including exploded ones); the semi finished rows are replaced by their leaves.
- To confirm: Summary, the full report, Consumption and PMP Detail against the desktop; the grid itself was not run.

## 2026-10-14 (SPECIAL > Extra Report (RP) > Finish Product Stock (Sales Dept.): report 151)
- New: **Finish Product Stock** (REPORT_FINISH_PRODUCT_STOCK, report key 151, SP_FRT_RPT_RPI_FINISH_STOCK): the products whose addon PRODTYPE is FINISH GOODS (of the ticked products / addon groups), a row each: ITEM, the addon columns, PROD_PACK, OPEN_QTY / OPEN_AMT (a From after the year's start carries what moved before it), PACKING (production), CR_QTY, PURCH_QTY, STOCK_ADD, DR_QTY, SALE_QTY, STOCK_LESS, CLSG_QTY (whole pieces), CLSG_BOX_QTY / CLSG_LOOSE_QTY (cartons of PROD_PACK and the rest), Rate (the latest sale rate up to Upto), Amount, Plan_Qty (job cards' planned quantity not yet made), Pend_Order, Transit (purchase orders pending), Hold_Ctn, Hold_Qty, After_Hold_Stock, Hold_Remark; rows with nothing in any quantity column left out; ordered by the first addon, ITEM, the other addons. **Only Production Require**: ITEM, addons, PROD_PACK, PRODUCTION (the approved production lines of the period), Rate, Amount. `finishProductStock` in `lib/report/reportFormating.ts` (`case 151`); added to `PORTED_REPORTS`.
- The procedure's seven temp tables joined by ITEM are one grouped read each matched by product (40-140 ms each here). The Hold columns (PRODUCT_MASTER.BUNDLE, HOLD_QTY) are read where the database has them, else 0: this server's copy has neither. The procedure's period read joins PROD_BALANCE without its RP flag, counting a product with two balance rows twice; here once.
- To confirm: against the desktop on a company that has FINISH GOODS products (the Rishabh data has none, so the grid was not run); not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Addon Detail: report 264)
- New: **Addon Details** (REPORT_ADDON_DETAILS, report key 264, SP_FRT_RPT_ADDON_DETAILS): the vouchers of the ticked accounts between From and Upto (not deleted, not Auto/999999) as lines: SEELCTED DATE, DOC NO, PARTY_NAME, DEBIT, CREDIT (the caption spelling is the desktop's). Without addon groups the PARTY_NAME column is the addon field picked in **Input Columns** (the account's, or the voucher's own) and a voucher with no text there is left out, with an account left with none; each account has a heading row, "* Subtotal For : <account>" and the final total. With addon groups ticked PARTY_NAME is the account's name and the lines go under a heading for each addon value (ADDON_1..4) and each account. **Summary**: one row an account (DEBIT, CREDIT, CLOSING = debit less credit). `addonDetails` in `lib/report/reportFormating.ts` (`case 264`), the account subtotal group in `lib/report/output.ts`; added to `PORTED_REPORTS`.
- Put right: the procedure's heading insert names SMART_SELECTED_ADDON12 with two or more addon groups (its typo; ADDON2 here), and an addon text that is null no longer makes the whole SORTING_COL null.
- Speed: one read of the vouchers, the headings, order and summary made in memory (0.14 s here); the procedure's temp table, deletes and re-reads are not needed.
- To confirm: Detail and Summary, with and without an addon group, against the desktop; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Sales V/S Expense: report 281)
- New: **Multi Year Sales V/S Expense Summary** (REPORT_MULTI_YEAR_SALES_EXPENSE, report key 281, SP_FRT_RPT_MULTI_YEAR_SALES_EXP_REP): the SALES line (book 8 sale, credit and debit note vouchers; the taxable value, S_LASTOT less the slab, when the book has a GST master slab, else the voucher amount; parties named like a system company left out) and a line for each expense account (balance sheet code 02-04, debits less credits) under its balance sheet head, for each of the company's years meeting From-Upto (as report 103, at most ten, each read whole from its own database): a column a year (`2026_2027`) with the expense's share of the year's sales (`2026_2027_PERC`), TOTAL and TOTAL_PERC; expense lines with a TOTAL of 0 or less left out. **Multi Company Require**: a pair of columns for every company of the group with a short name and the same year (`SHORT_2026_2027`), without TOTAL_PERC. Subtotals "** Subtotal For : <head>" and "* Subtotal For : SALES / EXPENSE" as the desktop (the same grouping as report 280), no final total. `multiYearSalesExpense` in `lib/report/reportFormating.ts` (`case 281`); added to `PORTED_REPORTS`.
- Speed: a year is one read for the sales and one grouped read for the expenses; the procedure's temp table, updates and pivot are done in memory.
- To confirm: two years (and Multi Company) against the desktop; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Sales V/S Receipt: report 279)
- New: **Multi Year Sales V/S Receipt Summary** (REPORT_MULTI_YEAR_SALES_RECEIPT, report key 279, SP_FRT_RPT_MULTI_YEAR_SALES_RECEIPT_REP): a row a month under SALE (the sale and credit note vouchers of books 8 / 16, debit less credit) and under RECEIPT (the cash and bank vouchers of books 4 / 6 against the debtors, credit less debit), April first; for each of the company's years meeting From-Upto (as report 103, at most ten, each read whole from its own database) a column `2026_2027` and `2026_2027_PERC` (the month's share of the side's total), and TOTAL (the years' amounts). **Multi Company Require**: a pair of columns for every company of the group (CO_GROUP_NAME) with a short name and the same year (`SHORT_2026_2027`). Subtotal rows "* Subtotal For : SALE" / "RECEIPT" (the percentages added up too: 100.00), no final total, as the desktop. `multiYearSalesReceipt` in `lib/report/reportFormating.ts` (`case 279`), the subtotal group in `lib/report/output.ts`; added to `PORTED_REPORTS`.
- Speed: a year is one grouped read for the sale and one for the receipt; the procedure's temp table, update per year and pivot are done in memory.
- To confirm: two years (and Multi Company) against the desktop; not run in the browser.

## 2026-10-14 (Multi Year Top Reports: subtotal by YEAR_NAME)
- Report 267 without Year As a Column Require ticked: each year's rows are followed by "* Subtotal For : <year>" (amount, Quantity and the other number columns added up), then the final total. `lib/report/output.ts`.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Top Report: report 267)
- New: **Multi Year Top Reports** (REPORT_MULTY_YEAR_TOP_REPORTS, report key 267, SP_FRT_RPT_MULTY_YEAR_TOP_REPORTS): the first combo's Customers / Suppliers (by amount), Item Sold / Purchase by Value, Item Sold / Purchase by Quantity for each of the company's years meeting From-Upto (as report 103, at most ten), each read from its own database between the From / Upto chosen. Without **Year As a Column Require**: a row a party / item of each year (YEAR_NAME, Row_No, name, amount, clsg_bal, No_Of_invoice, Quantity; items: name, amount, or Quantity and Clsg_Stock) ordered by year then amount (quantity) high first, with Top Record the first N of each year. With it: a row a party / item, a column a year (`2025_2026`) and TOTAL (only what was above 0 in a year), ordered by TOTAL high first, with Top Record the first N. `multiYearTopReports` in `lib/report/reportFormating.ts` (`case 267`); added to `PORTED_REPORTS`.
- The amounts are the procedure's own (the sale / purchase vouchers with their credit / debit notes taken off; the stock lines' value or quantity less the returns; licence 2 TRN_QTY1; licence 21 Finish Goods only), not those of the single year Top Reports (211).
- Speed: a year is one grouped read (0.2 s for the customers of 2025-26, 267 rows); the procedure's sub-query per customer for its quantity is one grouped join.
- To confirm: two years against the desktop for Customers and Item Sold by Quantity, with and without Year As a Column; not run in the browser.

## 2026-10-14 (Multi Year Party Product Addon Sale: subtotal by NAME)
- Report 176 subtotals on the party (NAME): each party's rows (one a combination of the product addon values) are followed by "* Subtotal For : <party>" with the year columns and TOTAL added up, then the final total. `lib/report/output.ts`.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Party Product Addon Sale: report 176)
- New: **Multi Year Party Product Addon Sale** (REPORT_MULTI_YEAR_PARTY_PRODADDON_SALE, report key 176, SP_FRT_RPT_MULTI_YEAR_PARTY_PRODADDON_SALE): the sale book's stock lines (with a voucher) of each of the company's years meeting From-Upto (as report 103, at most ten, each year's own dates), the quantity (licence 2: TRN_QTY3) added up by party and the products' master addon values (PRODGROUP, PRODTYPE ...), rows by party name; a column a year (`Sale_25_26`), or with **Month Wise Require** a column a month, April first (`Apr_25_26`), and TOTAL. `multiYearPartyProductAddonSale` in `lib/report/reportFormating.ts` (`case 176`); added to `PORTED_REPORTS`.
- Put right: the procedure reads the addon fields with FIEL_ENTRYPOS = '' (finds none) and, Month Wise, groups by the day so none of its month columns is filled; here the products' master addon fields (FIEL_ENTRYPOS = 'N', as the other reports) are the columns and a month's column holds its month's quantity.
- Speed: a year is one grouped read (0.16 s for 2025-26: 2,616 rows).
- To confirm: two years against the desktop, with and without Month Wise; not run in the browser.

## 2026-10-14 (Run-time number columns: wide enough for the subtotal)
- A number column the report makes at run time (the multi year balance sheet's year columns and TOTAL, the multi year reports ...) was a fixed 100 wide, so its subtotal ("* Subtotal For : LIABILITY") showed cut off (",00,45,21,062.38"). Its width now follows the largest figure it can hold (the sum of its figures). `lib/report/output.ts`.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Bal Sheets: report 138)
- New: **Multi Year Balance Sheet** (REPORT_MULTI_YEAR_BAL_SHEET, report key 138, the multi year branch of SP_REPORT_STANDARD's balance sheet): the company's years meeting From-Upto (SMART_SYSTEM.CNAME, same company name, oldest first), each balance sheet worked out on its own database for the year's own dates as report 23 does (closing from the opening and the postings, reversing heads (Balance Sheet Reverse), the profit transfer / closing stock in OS_BILLDIFF). A row a head: the liability heads (BAL_SIDE LIABILITY) before the asset heads (ASSET), by name; a column a year (`2025_2026`) and TOTAL; a year that does not balance adds a "Difference" row last (BAL_SIDE blank). `multiYearBalanceSheet` in `lib/report/reportStandard.ts` (`case 138`); added to `PORTED_REPORTS`.
- The heads' work of report 23 is now `balanceHeads` (one database and period), used by 23 and 138; report 23's output is unchanged.
- Put right: the procedure numbers all the years' rows together (ORDER BY co_short, bs_code) and sets a liability row against the asset row of the same number, so with two years an asset's amount can land in the other year's column, and sides of unequal length add "LIABILITY" / "ASSET" filler rows of 0.00; here each year stands on its own and no filler rows are made. A difference where the liabilities are more is the amount with its sign, as written.
- To confirm: two years (2025-26, 2026-27) against the desktop; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Party Wise Stock: report 133)
- New: **Multi Year Party Stock** (REPORT_MULTI_YEAR_PARTY_STOCK, report key 133, SP_FRT_RPT_MULTI_YEAR_PARTY_STOCK_REP): the one party picked in the Account group (several: "Multiple Account Selection Not Allowed") through the company's years meeting From-Upto (as report 103, at most ten). First combo SALE (8: a debtor; its sale, purchase and credit note lines) or PURCHASE (13: a creditor; purchase, debit note and sale lines). In each year's database the account of the same name gives its stock lines between From and Upto (not the year's dates), a row each: date, voucher, party, product, ADD_QTY / LESS_QTY, (MRP_RATE when the setup's entry_para has no X_MRP), RATE, UOM_SHORT, PURCH_VALUE / SALE_VALUE, in SORTING_COL order; identical rows dropped as the procedure's UNION does. No heading, opening or total row, as the procedure. `multiYearPartyStock` in `lib/report/reportFormating.ts` (`case 133`); added to `PORTED_REPORTS`.
- Speed: a year is one read of the party's lines (0.14 s for the busiest debtor, 1,601 lines).
- To confirm: one party over two years against the desktop; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Stock Ledger: report 125)
- New: **Multi Year Stock Ledger** (REPORT_MULTI_YEAR_STOCK_LEDGER, report key 125, SP_FRT_RPT_MULTI_YEAR_STOCK_LEDGER_REP): the one product picked in the Product group (several: "Multiple Product Selection Not Allowed") through the company's years meeting From-Upto (as report 103, at most ten). In each year's database the product of the same short code gives its stock lines between From and Upto (not the year's dates) in the product's first report unit, as the single-year stock ledger takes them (job work in / out whole, the book type of the note book left out); then the product's heading, the first year's Opening, and the lines in date order with the running CLSG_QTY. Factor Column Require adds ADD_FACT / LESS_FACT / BAL_FACT / UOM2; licence 2 the bundle columns. `multiYearStockLedger` in `lib/report/reportFormating.ts` (`case 125`); added to `PORTED_REPORTS`.
- Speed: a year is one read of the product's lines; the tax name the procedure looks up for each line (a sub-query that reads all of LEDGER_EXT, which has no index on LED_ID) is read once for the lines' vouchers.
- Kept from the desktop: the opening is the first year's (a From after the year's start leaves out what moved before it); the order of lines of one day is date, year, stock nature, entry.
- To confirm: one product over two years against the desktop; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Expense: report 106)
- New: **Multi Year Expense Summary** (REPORT_MULTI_YEAR_EXPENSE, report key 106, SP_FRT_RPT_MULTI_YEAR_EXPENSE_SUMMARY_REP): the company's years meeting From-Upto (as report 103, at most ten), the last year's live book 1 accounts with a balance sheet code starting 02 (expense), NAME and SMART_SELECTED_ADDON1 (the balance sheet head), ordered by head and name. A column a year with what was debited in From / Upto's day and month in that year (`Ex_Apr2025_Mar2026`); **Month Wise Require** a column a month, April first (`Apr_25_26`), and the year's total (`Ex_2025_2026`). Earlier years' accounts are matched by name. `multiYearExpense` in `lib/report/reportFormating.ts` (`case 106`), the rows in the new `lib/report/multiYearExpense.ts`, `tests/multi-year-expense.test.mts`; added to `PORTED_REPORTS`.
- Without Month Wise, as the procedure: each earlier year adds the expense accounts the rows lack (that year's figure only, the other years blank), and a figure of 0 is read again as what was credited to the account of that name that year. The last year gets neither. With three or more years the procedure also asks the balance sheet head to be the same in each year; here name and book are enough.
- Speed: a year is two grouped reads (accounts with heads; postings by account and month) matched in memory, instead of a sub-query for every account and column.
- To confirm: two years (2025-26, 2026-27) against the desktop, with and without Month Wise; not run in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Ledger: report 105)
- New: **Multi Year Ledger** (REPORT_MULTI_YEAR_LEDGER, report key 105, SP_FRT_RPT_MULTI_YEAR_ACCOUNT_LEDGER_REP): the one account picked in the Account group (several: "Multiple Account Selection Not Allowed") through the company's years meeting From-Upto (as report 103, at most ten). In each year's database the account of the same name and book gives its postings between From and Upto, a ledger line each (voucher date, number, the book's account, Debit / Credit, doc_no1; Show Narration adds NARRATION), then the account's heading, the first year's "Opening Balance B/d" and the "Closing Balance B/d" row; the running balance and Dr / Cr come from the common closing_bal step. `multiYearLedger` in `lib/report/reportFormating.ts` (`case 105`); added to `PORTED_REPORTS`.
- Speed: a year is one grouped read of the account's postings (the procedure joins ACCOUNT by name and AC_BALANCE again for every line and lets UNION remove the repeats); identical rows are still dropped. Licences 19 / 29 / 68 / 73 keep the CA_ENT book rule.
- Put right: the opening's Credit when the balance is negative is the whole balance (the procedure showed only abs(AC_BALANCE.opening), leaving out the postings before From).
- To confirm: one account over two years against the desktop; the run itself was not done in the browser.

## 2026-10-14 (ANALYSIS REP. > Multi Year > Inventory: report 104)
- New: **Multi Year Stock Summary** (REPORT_MULTI_YEAR_STOCK_SUMMARY, report key 104, SP_FRT_RPT_MULTI_YEAR_STOCK_SUMMARY_REP): the company's years meeting From-Upto (as report 103, at most ten, each read from its own database), a product a row (last year's products, earlier years matched by short code to the live product), a block of columns a year. First combo: **STOCK** Op_ / Add_ / Less_ / Cl_ (`25_26` style year suffix); **SALE, PURCHASE, CREDIT NOTE, DEBIT NOTE, STOCK ADD, STOCK LESS** the quantity (Licence 2: TRN_QTY3), named as the procedure names it (`Qty_Apr25_Mar26`); **Month Wise Require** a column a month, April first, then the year's total (`Qty_` / `SAdd_`). Only STOCK and Month Wise use the year's own dates; the others use From / Upto's day and month in each year. `multiYearStock` in `lib/report/reportFormating.ts` (`case 104`), the rows in the new `lib/report/multiYearStock.ts`, `tests/multi-year-stock.test.mts`; added to `PORTED_REPORTS`. The year list is now `companyYears`, shared with report 103.
- STOCK without Month Wise adds the products an earlier year had that the last year lacks (that year's figures only); with three or more years, as the procedure, the middle years are filled with 0 on those rows, the earlier years re-read for rows with no Add or Less, and their closing worked out as Op + Add - Less. The last year's columns stay blank on an added product.
- Speed: the procedure asks each product's opening and movement with a sub-query of its own per column (PROD_BALANCE and PROD_LEDGER have no PROD_ID index); here a year is three grouped reads matched in memory (0.2 s a year on the Rishabh data).
- To confirm: compare one STOCK and one SALE run of two years with the desktop on the Rishabh data (2025-26 and 2026-27); the run itself was not done in the browser.

## 2026-10-13 (Reports with a Product help: open in 1 s instead of 30 s)
- Every report with a Product help tab (INVENTORY: Stock Reports, Stock Summary, Stock Clearance, Partywise Stock, Monthly Closing Stock; MASTER: Product; ANALYSIS: Marketing, GP Report, Sales Analysis ...) took about 30 s to open. The help's query (HELP_PRODUCT and the other product helps) looks up each product's first ADDON_DATA row and its latest MRP in PRICELIST once per product; neither table has an index on PROD_ID, so for 17,839 products each lookup read the whole table (29.4 s). Those two lookups are now done once for all products and joined: 0.57 s, the same rows in the same order (checked against the original query's output). Opening each of those reports now takes about 1 s. `lib/report/helpSql.ts` (new, `fastHelpSql`), used by `smartHelp` in `lib/report/setup.ts`; `tests/help-sql.test.mts`.

## 2026-10-13 (REPORT > Register, Item Detail: "canceling statement due to statement timeout")
- Register › SALE › Item Detail for a year (2025-26: 65,701 rows) ran past the 2 minute limit. Each item line looked up its slabs one by one (two subqueries a slab and line: 14 here), each reading all of LEDGER_EXT (614,365 rows, no index on IL_ID); and the planner took the year's item lines for a few hundred, so it looped once per line. Now the period's item slab rows are grouped by line once and joined, and the item query runs with hash joins (`runReportSqlHashed`, as Marketing by Area): 4.5 s for the whole report, same values. Show Default Slabs (the bill's slabs on the voucher line: amounts, %, NET_AMOUNT, tax names) is grouped by voucher the same way. `registerItems` in `lib/report/reportFormating.ts`.

## 2026-10-13 (Large reports: "Client has encountered a connection error")
- INVENTORY > Checklist Inventory, ALL books for 2025-26 (462,253 rows) failed with "Client has encountered a connection error and is not queryable": the report itself took 13 s, but its answer was 398 MB of JSON (every row repeating its ~45 column names), built as one string on the server; the web side gave up while the rows were still arriving (PostgreSQL log: "could not send data to client ... connection to client lost"). Every report's rows now go packed: the column names once, each row a list of its values (167 MB here), written a batch at a time so no single giant string is built, and turned back into the same rows in the browser. Nothing changes on the screens. `lib/report/wire.ts` (new), `app/api/report/route.ts`, `features/report/api.ts`, `tests/report-wire.test.mts`.

## 2026-10-13 (Window tabs: minimize / restore, Ctrl+Tab, Close All Open Windows)
- As the desktop's tabs, each tab has one button before ×: on an open window ─ Minimize (the window goes out of sight, its tab greyed and marked "(minimized)" in the list; the window used before it comes back, else Home); on a minimized one □ Restore / Maximize (a click on its name does the same).
- Ctrl+Tab / Ctrl+Shift+Tab, as Ctrl+F6 / Ctrl+Shift+F6, go to the next / previous open window, minimized ones too (they come back). A browser keeps Ctrl+Tab for its own tabs in a normal tab; Ctrl+F6 always works.
- "N Open ▾" list: **Close All Open Windows** before Home. Reports close at once; with a master or entry open it asks once ("Close All N Open Windows ?") instead of each one's "Returning To Main Menu ?". `app/page.tsx`, `app/globals.css`.

## 2026-10-13 (Several program windows open at once)
- As the desktop MDI windows: a screen opened from the main menu opens in its own window and the others stay as they were (selection, grid, scroll, unsaved entry), hidden behind it. A tab strip over the work area shows the open windows: click a tab to bring it to the front, its ✕ closes it (a report closes at once; a master or entry runs its own Quit, so it asks about unsaved work first). "N Open ▾" lists them with Home. Ctrl+F6 / Ctrl+Shift+F6 go to the next / previous window. Choosing a screen that is already open brings that window to the front (no second copy). At most 10 windows. Back / Home shows the home screen and keeps the windows; changing company closes them all. Each window remembers where the keyboard was.
- Only the window in front answers keys (Esc, Alt letters, Pause, side panels' Esc) and finds its own elements (save buttons, editors, combo lists, print preview): `features/ui/activeWindow.tsx` (new), `app/page.tsx`, `app/globals.css`, `features/grid/useEscapeClose.ts`, `features/grid/GridRibbon.tsx`, `features/grid/EditorTools.tsx`, `features/grid/PrintPreview.tsx`, `features/grid/comboPlace.ts`, `features/ui/hotkeys.tsx`, `features/master-program/MasterProgram.tsx`, `features/small-entry/SmallEntry.tsx`, `features/report/ReportCombine.tsx`.

## 2026-10-13 (Main menu from the keyboard)
- Alt + a menu's letter opens it, as on the desktop: the letter MenuText marks with "&" (Alt+T TRANSACTION, Alt+R REPORT, Alt+P S&PECIAL ...), else the label's first letter; menus that share a letter open in turn. Alt alone (pressed and let go) puts the keyboard on the menu bar. In a menu: ↑ ↓ move, → opens a submenu (or the next menu), ← goes back, Enter / Space opens or runs, a row's letter runs it (several rows with one letter: moves between them), Home / End, Esc closes a level. A screen's own Alt letters (data-hotkey buttons) still come first; nothing fires while a message box is open. The letters are underlined while the menus are used from the keyboard, and the row in hand is highlighted.
- `lib/menu-catalog.ts` (MenuNode.accessKey / accessIndex from MenuText), `app/page.tsx`, `app/globals.css`.

## 2026-10-13 (Main menu: a long submenu stays inside the window)
- A submenu longer than the room below its row (REPORT › Extra Report) ran off the bottom of the window and its last rows (Upload Document ...) could not be reached. An opened submenu is now moved up until its last row shows; one taller than the window scrolls; one that would run off the right opens to the left. The modern view's sidebar (submenus open in place) is left as it was. `app/page.tsx`.

## 2026-10-13 (Help grids: numbers on the right; Pivot: a number more than once, values reordered)
- Report selection help grids (Product help and the others): a column the setup types as text (T) but whose every filled cell is a number (stock, min / max quantity, opening stock, rate, toll % ...) is right-aligned, heading too. Only the alignment: the text stays as stored, so codes such as HSN are not grouped. `features/report/HelpGrid.tsx`.
- Pivot Values: the same number can be added more than once (each added again takes the next way of totalling not yet used: Sum, then Average ...), and the values can be put in any order at any time, with ‹ › on each or by dragging one onto another. The pivot itself already worked by position (`lib/report/pivot.ts`); `features/report/PivotPanel.tsx`.
- Pivot panel on a short screen: the Fields / Numbers list was squeezed to one line (the panel's parts shrank to fit); now they keep their height and the panel scrolls as a whole. `app/globals.css`.

## 2026-10-13 (ANALYSIS REP. > Multi Year > Account Balance: report 103)
- New: **Multi Year Account Balance** (REPORT_MULTI_YEAR_ACCOUNT_SUMMARY, report key 103, SP_FRT_RPT_MULTI_YEAR_ACCOUNT_SUMMARY_REP): the company's years meeting From–Upto (SMART_SYSTEM.CNAME, same billing name or name and group; at most ten), each read from its own database, side by side: Op_ / Dr_ / Cr_ / Cl_ a year (format None), or Dr_ / Cr_ (Debit Credit Only). First combo: General ledger (not books 2, 3, 19), Debtors, Creditors. Accounts matched across years by name (any case) and book; earlier years add the accounts the last year lacks; a general account opened as Sundry Debtors / Creditors (SD / SC) shows all debtors' / creditors' postings. `multiYearAccountBalance` in `lib/report/reportFormating.ts`, the rows in the new `lib/report/multiYear.ts` (`multiYearAccounts`), tested in `tests/multi-year.test.mts`; added to `PORTED_REPORTS`.
- Kept from the desktop: the last year's closing is worked out only for the general ledger (0.00 for debtors / creditors); rows added from a later year leave the first year blank. The desktop's broken join for 6–8 years (a missing bracket) is what it meant here; a year whose database is not on this server is left out; with duplicate account names in a year the first is taken.
- Speed: each year's accounts are matched through maps by name and book (not a scan of every account for every row), and the openings are one grouped join (AC_BALANCE has no index on CODE, so a sub-query an account read the whole table each time). Two years, General ledger: 10.7 s → 0.8 s, same figures; the long run had ended in "Connection terminated unexpectedly".
- Checked on the Rishabh data (2025-26 and 2026-27; the 2023-24 company has another name, so it is not one of its years): General 2,645 rows, Debtors 1,067, Creditors 762, Debit Credit Only 1,065; A V S Sales Agency closes 2025-26 at 37,45,576.04 and opens 2026-27 at the same.

## 2026-10-13 (ANALYSIS REP. > Sales V/S Expense: report 280)
- New: **Sales V/S Expense** (REPORT_SALES_EXPENSE, report key 280, SP_FRT_RPT_SALES_EXPENSE_REP): a column a month (April first, only the months with something), Total and AVG_PER_MONTH. The SALES line is the sale book with its debit / credit notes against the sale (with a GST master slab of book 8: the taxable value, S_LASTOT less the slab; without one the voucher amount, leaving out parties named like a system company); a line an expense account (balance sheet code 02–04, posting accounts) ordered by its balance sheet head and name, those with a total of 0 or less left out; then TOTAL EXP % (expenses over sales, each month, the total and the average). **Percentage Column Require** puts each month's share of the sales beside it (<Month>_Perc) instead of the % line. `salesExpense` in `lib/report/reportFormating.ts`, the pivot in the new `lib/report/salesExpense.ts` (`salesExpenseTable`), tested in `tests/sales-expense.test.mts`; added to `PORTED_REPORTS`.
- Subtotals as the desktop's grid: "** Subtotal For" each balance sheet head (SMART_SELECTED_ADDON2) inside "* Subtotal For" each side, SALES / EXPENSE / EXP % (SMART_SELECTED_ADDON1); `lib/report/output.ts`.
- The desktop's no-slab select names ac.code without grouping on it (SQL Server refuses it); here that is the one SALES line. The % line counts every expense, as the procedure (before the lines of 0 or less are dropped).
- Checked on the Rishabh data, 01/Apr–13/Oct: April and May (the months with entries), SALES 10,54,48,646.53, 52 expense lines, TOTAL EXP % 6.42 / 7.30; with Percentage Column Require 52 rows a month's share each.

## 2026-10-13 (ANALYSIS REP. > Functional Party Product: report 35)
- New: **Functional Party Product** (REPORT_NON_FUNCTION, report key 35): first combo ACCOUNT lists the debtors (Sorting Sale, book 2) or creditors (Purchase, book 3), PRODUCT the products. Formats: **Functional** (a voucher of the year in the dates, licence 7 a process entry; a product: a stock line) with the closing (CLS_BAL: the account's closing, the product's CLSG_PCS, licence 2 CLSG_QTY3); **None Functional** (nothing in the dates and no opening; a product: no closing pieces unless With Closing Require); **Only Opening Within Period** (nothing in the dates but an opening, OPENING). A party shows MOBILE_NO (address 1); the ticked addon groups narrow the list, come as columns and set the order, then the name. CLS_BAL shows only with With Closing Require ticked (the setup's chk_tickcolvisible). `nonFunction` in `lib/report/reportStandard.ts`, reached through `formattedReport` and `standardReport`; added to `PORTED_REPORTS`.
- The desktop's TEMP_TABLE_NON_FUNCTION1 (the ones that functioned) is a sub-query here; one read-only query a run.
- Checked on the Rishabh data, Area / Prod Group ticked: debtors Functional 135, None Functional 886 (the same count as a hand query), Only Opening 43; creditors None Functional none (no creditor has an Area); products Functional 11,468, None Functional 6,539, Only Opening 2,088 (the None Functional closing total equals the Only Opening total, 99,70,859.77).

## 2026-10-13 (ANALYSIS REP. > GP Report: report 27)
- New: **GP Report** (REPORT_PROFIT_REPORT, report key 27, SP_REPORT_STANDARD branch 27): each sale line matched first in first out against the product's opening at From (PURCH_NO "OPENING") and then the period's stock-in lines, a row for each piece with the sale and stock quantities, rates and values, PROFIT_AMOUNT and PROFIT_PERC (on the cost; 0 for a loss). Sorting Detail (by product and stock date, subtotalled by product) or Summary (a line a product, sale rate and purchase rate). `gpReport` in `lib/report/reportStandard.ts`; the matching itself in the new `lib/report/gp.ts` (`matchGp`, `summariseGp`, `gpOpeningValue`), tested in `tests/gp-report.test.mts`; added to `PORTED_REPORTS`.
- Slab Add-Less Include takes the year's product-wise slabs of the sale (8) and purchase (13) books off each line's value. From after the year's start: the opening adds the movement before From and is valued at the purchases (book 13) before Upto, latest first, the rest at the year's opening rate. Licences 2 (TRN_QTY1 / OPEN_QTY1) and 5 (TXT_PRODGROUP, TOLL_PERC + 18%) as the procedure.
- Kept from the desktop on purpose: only products with a PROD_BALANCE 'RP' row for the year come in; the cursors take sales, stock lines and purchases in the order of their dd-Mon-yy text, not of the date; a product's sales stop once its stock is used up; PURCH_QTY is the stock line's whole quantity (and is subtotalled, as the setup says).
- Checked on the Rishabh data: Detail and Summary for three products from 01/Apr (70 and 11 rows), and from 15/May with Slab Add-Less (the later opening path).

## 2026-10-13 (Budget: the Account tab follows DEBTORS / CREDITORS)
- ANALYSIS REP. > Budget: the Account tab lists only the debtors (book 2) for DEBTORS and the creditors (book 3) for CREDITORS; the first combo's value is the account book itself. `ACCOUNT_BOOK_COMBO` in `features/report/ReportCombine.tsx`.

## 2026-10-12 (Register: Quantity / Factor / MRP and the formats' slabs, fast)
- REPORT > Register > Register with **Quantity Col. Required** (and Factor / MRP Value, with or without Show Default Slabs) took 14 s to 3 minutes: each voucher's product-line total was a sub-query per voucher (LEFT JOIN LATERAL), and PROD_LEDGER has no index on LED_ID, so every voucher read the whole table. The totals are now worked out once, grouped by LED_ID, and joined (`register`, `lib/report/reportStandard.ts`). Rishabh SALE register, 831 vouchers: Quantity 13.9 s → 0.26 s; Show Default Slabs + Quantity 62.5 s → 0.36 s; with Factor and MRP too 178 s → 0.37 s.
- The same for the Register's Daily / Weekly / 15 Days / Quarter / Half Year / Summary formats: the slab columns (a sub-query a voucher and slab) and Daily's Quantity are one grouped pass each (`registerPeriods`, `lib/report/reportFormating.ts`). Daily with Quantity 36.6 s → 0.23 s; Summary 19.1 s → 0.23 s.
- Same output: every case was compared with the previous code, every row and column of the finished grid (identical).

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
