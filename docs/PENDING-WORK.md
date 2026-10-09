# Pending work: master, small entry, report

One file for everything left over, to finish at the end. Add an item the moment it is left out;
tick it (`[x]`) and add the date when it is done. Do not delete finished items: strike them by
ticking, so the history stays.

Format of an item: `- [ ] what is left — why / where (date noted)`

Last updated: 2026-10-08

---

## Report (Report_Combine)

Ported so far: 1 Day Book, 2 Journal, 3 Register, 4 Ledger, 5 Outstanding Ageing, 6 Trial Balance,
21 Outstanding Clearance, 42 Budget.
Everything is in `lib/report/` (one program: `reportCombine.ts` → `reportStandard.ts` /
`reportFormating.ts` → `output.ts`, shared code in `library.ts`) and `features/report/`.

### Reports not started
- [ ] About 290 more report keys. Order proposed: core standard reports, then production reports by
  use (17 Stock, 150 Patiya, 175, 231, 78, 284, 212, 159, 147 …), then action screens (78 Auto
  Billing, 147 E-Way Bill, 284 Upload Doc, 255 Bill PDF, 65 Year Ending, 285, 50 Logfile are write
  actions, a separate track), other clients' reports only on demand. (2026-10-06)

### Ledger (4) and Day Book (1)
- [ ] Ledger: Account Confirmation / T-Format (CHK_ACC_CNFRM / TFPRINT), JV details
  (bit_Jv_Dtls_Required), report log (log_report), print password (u_pass_4), zoom / drill from a
  row into its entry. (2026-10-05)
- [ ] Ledger eMail: needs Ledger_Confirmation.rpt and SMTP; the button says "not ported". (2026-10-05)
- [ ] Day Book: Show Narration with a filter and no group (the desktop's INTO fails; the web returns
  the rows the procedure meant); check on more data. (2026-10-06)

### Journal (2)
- [ ] Group headings (Area / Account) are web-only: the desktop builds none. Confirm with Pranav
  that this is what he wants. (2026-10-07)
- [ ] Journal with Show Narration in rows, and with a format, not tested. (2026-10-07)

### Register (3)
- [ ] Include Slab / Exclude Slab: code is written, but this setup has no `lbchk_Slabs` control, so
  the desktop also stops ("Control Missing To Process"). Needs the control added to
  `smart_setup.report_control` first. (2026-10-07)
- [ ] Include Form / Exclude Form: refused as on the desktop (control missing). (2026-10-07)
- [ ] Slab / Form filters combined with the formats (Month, Daily, Item Detail …). (2026-10-07)
- [ ] Item Detail with an addon group ticked (heading addon columns). (2026-10-07)
- [ ] Item Detail variants for licences 2, 14, 25 and 44. (2026-10-07)
- [ ] Item Detail "with narration" (`bit_comb_cols`) rows. (2026-10-07)
- [ ] Desktop-quirk decisions to confirm: Daily with Quantity keeps AMOUNT (the desktop dropped it);
  Month steps whole calendar months; Show Default Slabs with 2+ groups uses the pivoted rows. (2026-10-07)

### Outstanding Ageing (5)
- [ ] Multi Company Report (CHK_MULTICO), With FIFO, With PDC, Outstanding With All Entries,
  Only On Account Detail: refused. (2026-10-07)
- [ ] Ageing Column Selection (columns from `DAYS_GAP`). (2026-10-07)
- [ ] Interest Perc sorting: the desktop does nothing with it for this report; confirm it should stay so. (2026-10-07)
- [ ] Grace Days sorting: the desktop compares "Geace Days" (typo) so the typed days never applied;
  the web applies them. Confirm. (2026-10-07)
- [ ] With an addon group (no party ticked) the parties are those that have bills, so a party with
  only a credit balance is missed. (2026-10-07)
- [ ] Advances dated after the Upto date are left out (the desktop did not filter): confirm. (2026-10-07)
- [ ] Print-only options not acted on: Outstanding With Letter Format, Every Party Start On New
  Page, Collection Planning, Transfer Outstanding Data, Update OS Message, cloud send. (2026-10-07)
- [ ] Other books: only the sale book (8) was checked against live data; purchase (13) and expense
  (15) run the same code, untested. (2026-10-07)

### Outstanding Clearance (21)
Ported in `reportFormating.ts` `outstandingClearance()` (SP_FRT_RPT_OUTSTANDING_CLEAR, exported to
`.scratch/mssql_SP_FRT_RPT_OUTSTANDING_CLEAR.sql`): Entrywise Detail and Summary, On Account To
Settle (the default), the Interest Perc sorting, addon groups, Ageing Column Selection, Only Pending Bills, Print Right Side Entry, Entry Level Credit Days, the Grace
Days sorting. Checked on the sale book: every sale party's pending total equals its ledger closing
except 2 whose data disagree (16260 has a duplicated receipt row in OUTCLEAR, 10221 is 95.00 off).
- [ ] Refused for now: Combine Setoff (a C# post-process of its own) and an entry-level addon group. (2026-10-07)
- [x] Addon groups (Area, Zone ...) and Ageing Column Selection (DAYS_GAP keys 1-5) ported 2026-10-07. Quirks kept: an
  addon heading below level 1 takes the last (outer, inner) pair; a heading with nothing under it is dropped (levels 1-2 only).
  Checked on Zone+Area+Account detail and Summary (totals equal the plain run); not compared with a desktop run.
- [ ] Purchase (13) and expense (15) run the same code, but their opening handling is the
  procedure's own (the credit opening goes in as a receipt), and the totals do NOT match the ledger
  for some parties (e.g. 10265 Crescent Petrochem: the 6,95,592.02 OPENING bill is never listed).
  Confirm against the desktop output before relying on them. (2026-10-07)
- [ ] The procedure swallows its own cursor errors (TRY/CATCH with PRINT); the web follows the
  intended path and cannot repeat a silent failure. (2026-10-07)
- [ ] Not checked against a desktop run (the proc needs write access to temp tables in SQL Server, so
  it was not run): only against the ledger closing. (2026-10-07)

### Trial Balance (6), REPORT > Final Report > Trial Balance
Ported 2026-10-08 (`trialBalance()` in `reportStandard.ts`, SP_REPORT_STANDARD lines 7004-8503): General
Ledger / Debtors / Creditors, Both / Opening Only / Closing Only, from a later date, groups as
headings (Book, Schedule, addon groups), Sundry Debtors / Creditors control lines, Opening Difference.
Checked on live data: debit = credit = 44,99,94,841.83 with Print Zero on, Debtors Zone totals equal the
control line, an Apr-May run closes where a Jun-Oct run opens.
- [ ] Formats other than "No Formating" (Month, Daily, Weekly, 15 Days, Quater Year, Half Year): they
  go to SP_REPORT_FORMATING branch 6, not ported. (2026-10-08)
- [ ] Licence 14 Reference trial balance (Debtors + Reference addon, Collection / Sales Man, opening
  transfer to next year): refused. (2026-10-08)
- [ ] Desktop quirks copied as they are, confirm with Pranav: (a) the Opening filter puts a credit
  opening in CREDIT as a negative number; (b) accounts with an opening and no postings get SORTING_COL
  without the group's name, so with Print Zero they sort above the first heading; (c) the accounts
  filter on that insert reads `ac.book in <accounts>`; (d) the Book group's GROUP BY would name
  `bookmst`, which the earlier-postings query does not join, so the web groups on its own columns;
  (e) with a schedule the control lines only update rows already named SUNDRY DEBTORS / CREDITORS. (2026-10-08)
- [ ] Addon group other than a master addon (entry addons through `aentry`) and Opening-between-dates
  with several addon groups: written from the procedure, tested only with one master addon (Zone). (2026-10-08)
- [ ] Not compared with a desktop run (SQL Server proc not run); compared with ledger_post totals only. (2026-10-08)

### Profit & Loss (22), REPORT > Final Report > Profit / Loss
Ported 2026-10-08 (`profitLoss()` in `reportStandard.ts`, SP_REPORT_STANDARD lines 8771-10776): the
two-sided table (debit left, credit right) with the procedure's own SR_NO / row counters, trading and
profit & loss levels, gross and net profit / loss lines, appropriation (level 3), Profit Transfer lines,
Profit Percentage. Checked on live data: trading and profit & loss each balance (10,54,84,608.47 and
6,13,26,255.21); a typed Closing Amount adds the CLOSING STOCK line and moves the gross profit by it.
- [ ] Options refused: Previous Year Balance (CHK_PREV_BAL), Cash / Cheque (CHK_CASH_CHQ), Cash Sale
  (CHK_CSPLREQ). Each has its own cursor query and extra columns. (2026-10-08)
- [ ] Closing stock from the stock report (CHK_UPD_MASTER, Report 17 engine, not ported): only a typed
  Closing / Opening Amount is used. The selection screen does not fill the Closing Amount box from
  `txt_ClosingAmt` the way the desktop does, so with "Closing Amount" chosen it must be typed. (2026-10-08)
- [ ] The procedure's writes to AC_BALANCE.OS_BILLDIFF (profit shared to the partners, closing stock)
  are not done: the web report only reads. (2026-10-08)
- [ ] Year-ending entry checks ("Opening / Closing Figure Change Not Allowed After Year Ending Entry
  Pass", END- journals) not ported. (2026-10-08)
- [ ] This company has capital heads 0902, 0903 and 0905 together, so both the 0903 and the partnership
  blocks run (NET PROFIT before and after the appropriation lines, and 0%-lines per partner for Profit
  Transfer). Probably what the desktop does here; confirm with a desktop run. (2026-10-08)
- [ ] Column captions show the raw names (CURRENT_AMOUNT, PARTICULAR_1) as the setup gives them. (2026-10-08)

### Balance Sheet (23), REPORT > Final Report > Balance Sheet
Ported 2026-10-08 (`balanceSheet()` in `reportStandard.ts`, SP_REPORT_STANDARD lines 10777-11296, the
single company branch): accounts of the level 8 / 9 heads added into the heads, Balance Sheet Reverse
(REV_BSREC) onto the other side, liabilities and assets side by side, Difference line, Percentage,
Show Previous Figures, Vertical. Checked on live data: the grid shows on screen; both sides add to the
same figure once the Difference (4,94,42,058.69) is counted.
- [ ] The Difference is the profit: the desktop's P&L run writes the profit shares into
  AC_BALANCE.OS_BILLDIFF (partner capital, 090601) and the Balance Sheet reads them back; the web
  P&L does not write, so until the profit is in OS_BILLDIFF the sheet shows it as Difference. Decide with
  Pranav whether the web should work the profit out itself. (2026-10-08)
- [ ] Multi company (136) and multi year (138) balance sheets: not ported (same procedure branch,
  other databases and a pivot). (2026-10-08)
- [ ] The procedure's join of AC_BALANCE has no year test; the web adds the year and AC record flag. (2026-10-08)
- [ ] The updates by account name (profit shares, 090601) match on the account's NAME, as the
  desktop does; two accounts of one name would both be hit. (2026-10-08)
- [ ] Annexure (24) and the cash / cheque option (CHK_CASH_CHQ) of the balance sheet: not ported. (2026-10-08)

### Annexure (24), REPORT > Final Report > Annexure
Ported 2026-10-08 (`annexure()` in `reportStandard.ts`, SP_REPORT_STANDARD lines 11297-11466): the
accounts under each ticked Schedule head with their closing, head and group headings, reversing heads,
empty heads taken out, partner-capital OS_BILLDIFF added. Checked on live data against the Balance
Sheet: Fixed Assets 77,12,788.52, Furniture & Fixtures 44,11,010.72, Plant & Machinery 11,32,55,859.27 ...
are the same figures. Run from the script only (the Schedule ticking was not clicked through on screen).
- [ ] The group line (SMART_SELECTED_ADDON1) is the desktop's UPDATE ... FROM with several matching
  balance sheet lines (same first 4 digits of the code); SQL Server takes any one of them. The web takes the
  one with the lowest code (the head). Confirm against a desktop run. (2026-10-08)
- [ ] Licence 29 / 73 (local code deducted from the opening, CA_ENT accounts left out) is written but
  untested here. (2026-10-08)

### Bank Reconciliation (15), REPORT > Bank/Cash > Bank Reco
Ported 2026-10-08 (`bankReconciliation()` in `reportStandard.ts`, from SP_STD_RPT_BANKRECO, exported to
`.scratch/mssql_SP_STD_RPT_BANKRECO.sql`): balance as per bank book, cheques issued and deposited not
cleared by Upto (RECO_DATE empty or later), totals, balance as per pass book. Checked on live data: Bank
Of Baroda 54,506.49 equals the Balance Sheet / Trial Balance bank figure; its one uncleared deposit of
5,000.00 gives 49,506.49 as per pass book. Run from the script only (not clicked through on screen).
- [ ] The procedure's UNION also removes identical rows; two identical uncleared lines would show once on
  the desktop and twice here. (2026-10-08)
- [ ] The Daybook (bank) choice list is the report's own; the web screen was not clicked through. (2026-10-08)

### Form Summary (14), REPORT > Register > Form Summary
Ported 2026-10-08 (`formSummary()` in `reportStandard.ts`, from SP_STD_RPT_FORM_SUMM and SP_FOMSUMM_COLS,
exported to `.scratch/mssql_SP_STD_RPT_FORM_SUMM.sql` / `mssql_SP_FOMSUMM_COLS.sql`): the register's
vouchers by tax slab and tax, net / tax / total, SGST and UTGST lines carrying tax only. New in the
common program: `call.firstHelpKeys` (generate.ts) carries the keys ticked in a report's own first help
grid (REP_CONTROL_ID -1), which the Form Summary needs for its book accounts. Checked on live data:
Sale (book 8), Purchase (13) and Expense (15) run; the sale net total 10,54,73,056.08 is in line with the
P&L sale figure. Run from the script only (not clicked through on screen).
- [ ] The formats "Details (Summarized Taxes)" and "Summary For Period Selected": not ported (SP_REPORT_FORMATING). (2026-10-08)
- [ ] With "Show Cash / Return combined" off the extra columns (B_NET, CN_NET, R_NET ...) come from
  SP_FOMSUMM_COLS and are written but untested on this data. (2026-10-08)
- [ ] The procedure looks for ",16" / ",11" / ",10" in the ticked keys to decide the return book; the web
  builds that text as ",<codes>,", so on this data ticking account 16 (SALE) counts as a return account.
  Confirm how the desktop builds the key text. (2026-10-08)
- [ ] TAX_MASTER.TAX_TYPE is text in the PostgreSQL schema; the join to IDOPT_MASTER casts it here (the
  other reports using TAX_TYPE may need the same). (2026-10-08)
- [ ] GST Form Summary (127) is another menu item with its own setup: not ported. (2026-10-08)

### Account Master (7), REPORT > Master > Account
Ported 2026-10-08 (`accountMaster()` in `reportStandard.ts`, from SP_STD_RPT_ACC_MASTER, exported to
`.scratch/mssql_SP_STD_RPT_ACC_MASTER.sql`): the accounts of the chosen ledger (All / General / Debtors /
Creditors) with the setup's columns and ticked addons, locked parties left out unless "With Locked". Checked
on live data: All 4,819 rows, Debtors 1,459, With Locked 4,878. Run from the script only (not clicked
through on screen).
- [ ] An account shows once for each of its ADDRESS rows (the desktop joins every address, not only
  address 1); on this data some parties have many, so they repeat. Check whether the desktop does too. (2026-10-08)
- [ ] With the Account group alone the setup builds SORTING_COL as ", || '   P'" (no group before it); the
  web puts the account's name there. (2026-10-08)
- [ ] The setup's own query for the "Col_Select" list fails on PostgreSQL (`column_caption`): the list is empty
  on the selection screen. (2026-10-08)
- [ ] Addon Master (8), Product Master (10) and Party Wise Rate (9) are separate menu items: not ported. (2026-10-08)

### Stock (17), REPORT > Inventory > Stock Reports - FIRST SLICE ONLY
Written 2026-10-08 (`stockReport()` in `reportStandard.ts`; the procedure SP_STD_RPT_STOCK, 8,439 lines, is
exported to `.scratch/mssql_SP_STD_RPT_STOCK.sql`). Pranav chose "quantity + simple rates first". Not a
line-by-line port: it takes the procedure's meaning (first combo 1 = LEDGER, 2 = SUMMARY) and its quantity
rule (first report unit, less AG_QTY, job work whole). LEDGER: product heading, opening (year opening + what
moved before From), each movement with running closing; SUMMARY: opening, added, less, closing per product.
Report Rate adds RATE and VALUE (closing x PROD_BALANCE.REP_RATE). Checked on live data: the summary's
closing quantities add up to the ledger's running closings (Final Total 1,000.00 for the 6 products
ticked). Run from the script only (not clicked through on screen).
- [ ] Refused (each is a large part of the procedure): Update Value / Rate In Master; Folder; Challan date;
  Age columns; FG value add; Min / Max columns; Valuation with expense; Above / Below Days sorting;
  Godown and Batch / Expiry selections. (2026-10-08)
- [ ] Not compared with the desktop procedure: only against the stock ledger movements. The opening for a
  From date later than the year start, the `AG_QTY` rule and the `TYPE` (rate difference notes) exclusion are
  from reading the procedure. (2026-10-08)
- [ ] Licence specific columns (BUNDLE, PACKING, JOB_CARD, COLOUR ...) are not added. (2026-10-08)
- [ ] The heading and opening rows' look (ROW_DATA_TYPE PRODUCT / OPENINGS) is the web's own; the desktop
  builds them through CTE_HEADING / its union. Compare against the desktop output. (2026-10-08)
- [ ] The other stock menu items (Stock Summary Report, Addon Stock Summary, Stock Movement, Partywise
  Stock, Monthly Closing, Dead Stock ...) are separate reports: not ported. (2026-10-08)

#### Stock valuations (Filter list), ported 2026-10-08 - `stockValuation()` in `reportStandard.ts`
Actual, Average Rate, Average C.Year, Last Purchase, Last Sale and MRP, for the Summary and the Ledger format
(Report Rate was in the first slice). Taken from SP_STD_RPT_STOCK's summary branch (lines ~5340-7200); the rate is
worked out per product from its closing quantity, as the procedure does on the heading / summary rows. In the
Ledger format the product's rate shows on its opening and movement rows, the value on each row is the running
closing x rate and the last row carries the product's own value. Run from the script only (.scratch/val-run.ts);
checked: Last Purchase / Average C.Year / Average Rate / Actual agree for a product bought at one rate (19.60);
the whole stock (17,366 products) runs in 14 s with Actual.
- [ ] Average Value is refused: in the procedure its loop compares the closing quantity with @AVGPURCH_QTY (a
  variable of the Average Rate block, empty in this run) and never resets @ROW_COUNT between products, so it takes
  only the newest purchase line and divides by a count that grows through the product list. Ask Pranav / compare the
  desktop figures before copying that.
- [ ] Not written (the desktop writes them): the closing value to AC_BALANCE.OS_BILLDIFF of the closing stock account
  (licence 21 adds CHK_UPD_MASTER itself for Actual / Report Rate - the Profit & Loss closing stock reads it), the
  rate to PROD_BALANCE.P_RATE / GST_CLOSE_RATE (CHK_UPD_RATE / CHK_GST_OPEN) and PROD_BALANCE.EXCISE_RATE (licence 21
  Actual; the Stock Summary's ACT_RATE column reads it). A report never writes in the web; decide whether a
  separate "Update" button should.
- [ ] Actual: licences 1, 8 and 62 (they write to the ledger / have their own code) and CHK_SLABVAL / CHK_EXP
  (slab and expense costing) are refused. Licence 21 is ported (first in first out, master / opening / price list
  rates, finished goods at 52.5 % of the price list sale rate, semi finished products valued from their BOM) - the
  BOM step is copied as written (the cost of every MFG-BOM entry of the product, not per unit): compare with desktop.
- [ ] MRP of licences 7 and 19 (party rate list) not ported; Last Purchase of licence 9 uses the price list (done),
  the 2017 FOOD and GST open rate special cases are not.
- [ ] RATE_UOM column (the unit of the rate) that the procedure adds for MRP / Last / Report Rate is not added.
- [ ] Ties in dates (two purchases on one day) are put in entry-key order; SQL Server's order is not defined.

### Stock Movement (93), REPORT > Inventory > Stock Movement
Ported 2026-10-08 (`stockMovement()` in `reportStandard.ts`, called from `formattedReport`; procedure
SP_FRT_RPT_STOCK_MOVEMENT, 1,324 lines, exported to `.scratch/mssql_SP_FRT_RPT_STOCK_MOVEMENT.sql`). REPORT = Sale: a
line per product with its closing stock (PROD_BALANCE.CLSG_PCS) and the quantity sold in the period (book 8 less
credit notes 16), then the products in stock that did not sell with 0; REPORT = Stock: a line per product with its
closing stock. The ticked groups are columns and the order; None Moveble sorts on quantity (low first), Moveble
(high first); Quantity Gap Column puts the quantity into 30-day (or typed) bands. Script only (.scratch/mv-run.ts):
the sale of 0.5 Sqm cable (44) equals the Stock ledger's LESS, closing stock equals PROD_BALANCE.
- [ ] Refused: Godown selections; licences 2, 7, 16, 22, 29 (other columns - BRAND / DESIGN / FINISH / THICKNESS).
- [ ] Not compared with the desktop. The gap bands copy the procedure (BETWEEN on whole numbers, so 30.5 falls in no
  band; the values are held as whole numbers). The CLOSING is the stored balance, not worked out for the period.
- [ ] The typed number of days (runtime text box) for the gap bands is read from the first text; not tried on screen.

### Monthly Closing Stock (258), REPORT > Inventory > Monthly Closing Stock
Ported 2026-10-08 (`monthlyClosingStock()` in `reportStandard.ts`, called from `formattedReport`; procedure
SP_FRT_RPT_MONTHLY_CLOSING_STOCK, 774 lines, exported to `.scratch/mssql_SP_FRT_RPT_MONTHLY_CLOSING_STOCK.sql`). A line
per product description (and ticked groups) with APRIL .. MARCH: the year's opening quantity plus the net movement
to each month's last day; products with nothing in any month are left out. Script only (.scratch/mc-run.ts): 0.5 Sqm
cable 32 in April then -11 from May, the ledger's closing.
- [ ] Pranav asked for "monthly closing stock bar": the grid is done; a bar chart of the months is NOT built (the
  Chart button gives the donut / cards; TrendChart is for the period formats). Ask what the bar should show.
- [ ] Godown selection refused; not compared with the desktop. The months run April-March of the year even past the
  Upto date (as the procedure does).

### Stock Summary, all books (29), REPORT > Inventory > Stock Summary Report
Ported 2026-10-08 (`stockSummary()` in `reportStandard.ts`, called from `formattedReport` because the report's
only format "None" goes through SP_REPORT_FORMATING; the procedure SP_FRT_RPT_STOCK_SUMMARY_ALLBOOK, 1,623 lines,
is exported to `.scratch/mssql_SP_FRT_RPT_STOCK_SUMMARY_ALLBOOK.sql`). One line per product: opening, purchase,
credit note, challan in, production (licence 21), stock voucher add, stock JV add, sale, debit note, challan
out, consumption (licence 21), stock voucher less, stock JV less, damage, closing; opening for a later From date
= year opening + what moved before. Checked on live data: for the 8 products ticked the closing equals the
opening less the sales (e.g. 0.5 Sqm cable 32 - 44 = -12) and a Jun-start run opens at that closing. Run from the
script only (not clicked through on screen). The whole stock (no ticks) gives 7,580 products.
- [ ] Not ported: With Date layout (CHK_WITHDATE), Factor columns (CHK_FACTOR), godown / entry-addon stock, and the
  column sets of licences 6, 15, 22 and 38. (2026-10-08)
- [ ] The "Stock" (key 17) report counts every book's receipts; this summary only the purchase, credit note, stock
  voucher ... kinds above, so an expense-book receipt (e.g. Exp/1) shows in the first and not the second.
  This is how the two procedures differ. (2026-10-08)
- [ ] The desktop uses TYPE <> 25 here (hard coded) while the Stock report looks the rate-difference book up (44):
  the web follows each procedure. (2026-10-08)
- [ ] Not compared with a desktop run. (2026-10-08)

### Partywise Stock (16), REPORT > Inventory > Partywise Stock - Detail format
Ported 2026-10-08 (`partyStock()` in `reportStandard.ts`, also called from `formattedReport`; procedure
SP_STD_RPT_PWISESTOCK, 746 lines, exported to `.scratch/mssql_SP_STD_RPT_PWISESTOCK.sql`). Each stock line of
the chosen book under its party (date, voucher, product, quantity, rate, purchase / sale value) with the
product-wise slab columns the procedure pivots (DISCOUNT, SPOTDIS, SCHDIS, ADDDIS, TRADEDIS with their %, then
NET_AMOUNT, TAX_DESCRIPTION, GST, TAX_DESCRIPTION1, UTGST). Checked on live data: sale line 16 x 500 = 8,000.00
with a 20% discount of 1,600.00. Run from the script only (not clicked through on screen).
- [ ] NET_AMOUNT and the tax descriptions are blank here, as the procedure does it: they are only worked out when
  the setup has exactly one master (tax) slab; this company has four (GST, UTGST for sale and purchase). Confirm
  with Pranav that the desktop shows them blank too. (2026-10-08)
- [ ] Refused: the Summary For Period Selected format; licence 37 and 51 variants. The godown / batch addons on
  the lines are not joined. (2026-10-08)
- [ ] Purchase (book 13) with a few creditors ticked found no lines; not checked with more. (2026-10-08)

### Output screen and extras
- [ ] Ledger Create Group is enabled on the web for keys the desktop skips (4/6/22/23/117/118). (2026-10-05)
- [ ] Target vs actual (target table has 5 test rows with text amounts "? 10,000.00"; ask how it is used). (2026-10-06)
- [ ] Cash forecast (needs outstanding by due date), what-if, pin to dashboard (no dashboard screen). (2026-10-06)
- [ ] Previous-year compare (the other year's data is in another schema). (2026-10-06)
- [ ] Group By / Compare / Growth only fully tested on a few reports. (2026-10-06)

### Look and library
- [ ] The 4-level heading / subtotal colours (`features/grid/levelStyle.ts`) are used by the report
  output only. Use them in master, small entry and entry grids. (2026-10-07)
- [ ] User-chosen screen colour theme: only the provision exists (`resolveLevelColours`, a level that
  matches the user's colour turns light red). No screen picks a theme yet. (2026-10-07)
- [ ] Ribbon (`features/grid/GridRibbon.tsx`) is on the report output only; master and small entry
  still use the old button bar. (2026-10-07)
- [ ] Buttons are coloured by position in the ribbon, so Excel / PDF no longer keep their own colours;
  confirm. (2026-10-07)

---

## Small entry (Small_Entry)

All 31 active small entries for licence 21 now save (see `PORTED_ENTRIES` in
`lib/small-entry/load.ts`). Code in `lib/small-entry/` and `features/small-entry/`.

- [ ] 37 of 109 SMALL_ENTRY menus load on this server; the rest are other clients' screens (missing
  columns / tables such as `master_link.ml_prod_id`, `party_product.fg_prod_id`, money-type
  errors). Decide which clients' screens matter. (2026-10-02)
- [ ] Entries whose grid query is "not ported": 19 (detail grid done), 69, 79, 107. (2026-10-02)
- [ ] Not ported generic features: Col+ / RecBlk / PARTYMulFld fill styles, header (non-multiple)
  save rules, delete rows, print / export of the entry. (2026-09-30)
- [ ] `|sys.imagedb|` entries (57 / 60 / 64): an empty `rishabh_plastic27_image.document_upload` was
  created; real image storage is not set up. (2026-10-02)
- [ ] `entry_properties.no_of_col_frozen` is PG only (not on SQL Server); values still to be set
  per entry. (2026-10-02)
- [ ] Payment entries 42 / 47 clear every listed row like the desktop; check with real use. (2026-10-05)
- [ ] The shared grid features (filters, calculator, calendar, arrange columns, export / print) are
  in `features/grid/`; check each on every small entry. (2026-10-01)
- [ ] Everything since 2026-10-02 (save audit, payments, last four entries) is uncommitted until
  Pranav tests. (2026-10-05)

---

## Master (Master_ProgramGrid)

One generic web master for all MASTER menus (`lib/master-program/`, `features/master-program/`).

- [ ] Legacy password verification: `smart_setup.user_master.user_pw` is a 12-character
  obfuscation; the desktop algorithm is not in the repo, so the app runs in `migration-test` mode
  and does not verify passwords. Needed before launch. (2026-08-27)
- [ ] Remove the temporary `SMARTWINFA_SKIP_LOGIN` bypass before launch (also `app/api/dev-login`
  and its call in `features/startup/StartupGate.tsx`). (2026-10)
- [ ] `docs/testing/control-coverage.csv`: most controls were still "discovered", not tested on
  real data (93 of 108 at 2026-08-27); re-run the coverage. (2026-08-27)
- [ ] Seed re-export: the dump's non-ASCII characters are already lost as "?" (money columns and
  text); re-export the seed from the source. (2026-09)
- [ ] Program 32 (rate master) still missing `pr_slabperc1`; the setup date-cast fix is in the live
  PG `program_top` for 8 rate masters (backup file in `.scratch`). (2026-10-01)
- [ ] Print uses the browser instead of Crystal `.rpt`; program 39 / 50 percentage boxes mark the
  rows they change as edited (the desktop does not). (2026-09-19)
- [ ] The two `Master_ProgramGrid.cs` copies (F: and D:) have identical grid logic; F: is the SQL
  Server dialect. Keep the grid column index coupling in mind (property-grid row N = update-grid
  column N). (2026-09)

---

## Across all three

- [ ] Commit and push: all report work since 2026-10-06 and the small-entry work since 2026-10-02
  are local until Pranav confirms in his browser ([see notes]: test locally before push). (2026-10-07)
- [ ] The dev server (vinext) serves a stale `globals.css` after edits; restart it
  (`npm run dev -- --port 3000`) when a CSS change does not show. (2026-10-07)
- [ ] Speed indexes were added to the live `rishabh_plastic27`; other company schemas need
  `.scratch/idx-all-schemas.mjs`. (2026-10)
- [ ] Multi-client rule: company and year lists come live from `smart_system`, never hard-coded. Check
  new code for hard-coded company names or schemas. (2026-09)
