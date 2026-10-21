# Pending work: master, small entry, report

One file for everything left over, to finish at the end. Add an item the moment it is left out;
tick it (`[x]`) and add the date when it is done. Do not delete finished items: strike them by
ticking, so the history stays.

Format of an item: `- [ ] what is left — why / where (date noted)`

Last updated: 2026-10-14

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
- [x] Include Slab / Exclude Slab: the slab list is built by the web (`slabFilterItems`), as the desktop builds it. (2026-10-12)
- [x] Include Form / Exclude Form: the form list is the tax masters (`formFilterItems`); with Master Detail only, as the desktop. (2026-10-12)
- [ ] Slab / Form filters combined with the formats (Month, Daily, Item Detail …). (2026-10-07)
- [ ] Item Detail with an addon group ticked (heading addon columns). (2026-10-07)
- [ ] Item Detail variants for licences 2, 14, 25 and 44. (2026-10-07)
- [ ] Item Detail "with narration" (`bit_comb_cols`) rows. (2026-10-07)
- [ ] Desktop-quirk decisions to confirm: Daily with Quantity keeps AMOUNT (the desktop dropped it);
  Month steps whole calendar months; Show Default Slabs with 2+ groups uses the pivoted rows. (2026-10-07)

### Outstanding Ageing (5)
- [x] Ported from Outstanding.txt (2026-10-17): With FIFO, With PDC, Outstanding With All Entries, Only On Account Detail, Days from system date, Ageing Column Selection (DAYS_GAP, up to 7 columns), and Multi Company Report for the Detail. Written from the procedure text, NOT yet compared with a desktop run or live data.
- [x] 2026-10-17, from Outstanding.txt: Lock Date monthly (sale), Multi Company for Summary and Monthly, On Account To Settle as the procedure reads it (set against the bills when ticked, listed below zero when not), Print Advance (CHK_AD2PRN: without it parties in credit and rows below zero are dropped; the credit test is on the sale book only), Interest sorting (Int_Amount), Month Total, licence 21 Group Summary days and Hold status. NOT compared with a desktop run.
- [x] 2026-10-17: Cash Only / Cheque Only (series filters and the address local-code opening; expense treated like purchase), typed-series opening, party heading with short name, credit days, limit, e-mail and the contact line, Overdue Only with All Entries (party chosen by an overdue bill, all bills listed). Not compared with a desktop run.
- [ ] Not ported (they write to the master tables): Collection Plan, Update OS Message, Transfer Outstanding Data; also licence 14 Reference checks and addon groups in the Lock Date report.
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
- [x] The setup's own query for the "Col_Select" list fails on PostgreSQL (`column_caption`): the list is empty
  on the selection screen. (2026-10-08) Fixed 2026-10-12: `setupSelect` quotes a WITH query's column names after it.
- [ ] Addon Master (8) is a separate menu item: not ported. (2026-10-08) Product Master (10), Price List (13), Party Wise Rate (9) ported 2026-10-12.

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

## Entry (Comman_Entry: Transaction > Invoice)

The desktop's `Entry.cs` (42,000 lines) on the web: `lib/entry/` (`invoice.ts`, `values.ts`,
`types.ts`), `app/api/entry/route.ts`, `features/entry/Entry.tsx`. Setup: entry_properties 1
(INVOICE), entry_control, control_event, entry_grid_body, query_condition.
Done 2026-10-12 (screen set-up, read-only): the form laid out at the desktop's coordinates;
Register list; choosing it sets the screen for the book (header boxes per field_enable_book,
series, default date and number from book_number + query_condition, product grid columns with
item-wise slab and product addon columns and InputCol_Property_Change's hiding, slab grid with
tax lists and the CGST/IGST/VAT renaming, book rights "Book-<book>"); party help (HELP_ENT_ACCOUNT),
the party's address lines, addon fields and pending bills (Outstanding tab); Find / Edit list
(INVOICE_PREVIEW); E-Way Bill tab boxes. Not changed in the database: the PostgreSQL dialect gaps
are rewritten in code (`entryDialect`: GetNumbers, tax_type, TO_CHAR of money; pgFragment's money casts).

- [x] Product rows: product help (HELP_PRODUCT), Product_Selection, UOM / rate / factor / value
  arithmetic, item-wise slab cells, totals line under the grid. (2026-10-12; done 2026-10-13: lib/entry/calc.ts, lib/entry/products.ts, features/entry/lines.ts + ProductGrid.tsx)
- [x] Product selection refusals (2026-10-14, Entry.tsx productRefused, BookScreen.productRules): Product Last Date before the entry date, PROD_LOCK (stops) / PROD_WARN (asks Yes/No) with the product's master message for sale bills and CHLN-OUT, I_DUPLICHK "already in used at Serial N". Both company switches are off in rishabh_plastic27 (item_para has neither, I_DUPLICHK N), so only the last-date check shows there; not clicked through.
- [ ] Product rows still open: stock checks (negative stock: desktop makes them in Save, lines ~30940 / 34521, so they go with Save), the party-rate events that need the addon names (input_rate 2-7, 9: |sys.prate_addon_nm|), slab % defaults from party_rate / pricelist (pr_slabperc, PL_SLABPERC), MRP-inclusive rate (RATE_WITH_TAX), the licence-specific product helps (46, 59, 51, 28, 68, 75, 45, 9, 89), stock_3 (bundle copy), the +/- column of stock-both books, product image, product message. (2026-10-13)
- [x] Slab arithmetic: Slab_RunTotal, percent / amount editing, round off, TCS, final amount. (2026-10-12; done 2026-10-13, checked against DSAL/26-27/827 = 1,918.00)
- [x] Slab (2026-10-14): item-wise tax chosen against the product master's tax asks "Selected Entry Tax And Product Master Tax Not Match Are You Continued Entry..." (half the product tax for CGST / SGST, Yes / No, default No; Entry.tsx editCell); in the slab grid the SGST / UTGST tax must equal the CGST row's ("CGST And SGST Tax Percentage Different not allowed...", chooseSlabTax). Not clicked through.
- [ ] Slab still open: rate-inclusive tax (RATE_WITH_TAX, off here: entry_para has "RATE_WITH_TAX1,"). Dropped as dead desktop code: TCS_COMPULSORY (its only use is commented out in Entry.cs) and bl_stop_SlabAuto (set but never read; the round-off row recalculates unless that row itself is being edited). (2026-10-14)
- [ ] Slab % defaults from party_rate pr_slabperc / pricelist PL_SLABPERC into the item-wise discount columns (int_col_Item_LessSlab1-4): licence-specific (12, 22, 21, 92, 96) and tied to which setup column is LessSlab n; not ported. (2026-10-14)
- [x] Save of a NEW account-book invoice, dry run (2026-10-14): lib/entry/save.ts reads smart_setup.entry_save_properties (add rules) and builds the statements — LEDGER, LOG_LEDGER, LEDGER_EXT (slab rows and per-product item-wise rows), PROD_LEDGER, LOG_REGTRN, ADDON_AENTRY, OUTCLEAR, LEDGER_POST + AC_BALANCE (party, control account, book, slab accounts such as TCS), PROD_BALANCE, unique_key, BOOK_NUMBER — and app/api/entry action "save" runs them in a transaction that is ROLLED BACK unless the request says commit AND the server has SMARTWINFA_ENTRY_SAVE_COMMIT=true (not set; nothing has ever been committed). The dry run numbers rows from MAX(key)+1 with OVERRIDING SYSTEM VALUE so live sequences do not move (checked). Proof: .scratch/save-dry.ts restores DSAL/26-27/827, regenerates it as number 88888 and diffs: ledger header, 10 slab rows + 6 item-wise rows, ledger_post (TCS 11151 2.00 Cr, party 1,918.00 Dr, book 1,916.00 Cr), outclear, ac_balance deltas all equal the saved bill. The Save button (features/entry/Entry.tsx saveEntry) sends the screen, the server recomputes every row and the final amount and refuses a mismatch.
- [x] Save committed on 2026-10-14 (first real save worked; the log_regtrn / expense_link identity sequences were behind their tables, runPlan now moves a sequence up to MAX(key) first and takes an advisory lock). Edit and Delete of an opened account-book invoice (2026-10-14): Edit = the update rules (entry_save_properties update_save / update_fixvalue): the old ledger_post rows come off the balances and are deleted, the old slab rows go, LEDGER is updated in place, product rows that kept their il_key are updated, new rows inserted, removed rows marked il_pos D, then the postings are made again; refused below the amount already set off or when doc_lock is Y. Delete = soft delete as the desktop: postings reversed, slab / addon / outstanding rows deleted, ledger doc_pos D and prod_ledger il_pos D, LOG rows mode D; refused when receipts are set off against the bill. Both checked as dry runs on DSAL/26-27/827 (edit: balances net zero, counts equal, narration changed; delete: every balance falls by what the bill posted). Restore now reads the typed (input_) entry addon fields too.
- [x] Special log, setup.logfile = S (2026-10-14): every Save, Edit and Delete also writes one row to <company>_biglog.log_entry (this company: rishabh_plastic27_biglog) — the entry in captions as JSON text (top / bottom, items, slab, addon, e-invoice boxes, key list), as the desktop does (specialLogStatement in lib/entry/save.ts; Delete writes a shorter copy from the saved rows). Differences: the desktop builds the text by hand without escaping, this is valid JSON; outstanding set-offs (LENTRY_OUTSTAND) are blank because set-off rows are not saved yet. log_ledger / log_regtrn are still written (only logfile N skips them). Bills saved before this change (e.g. DSAL/26-27/8888) have no log_entry row.
- [x] Log button (Btn_Log_Click, logfile S only; 2026-10-14): features/entry/EntryLog.tsx + lib/entry/log.ts + route action "log" — the opened entry's special-log rows side by side (Add, Edit 1, Edit 2 ...) by section (TOP, ITEM, SLAB, OUTSTANDING, ADDON), cells that differ from the one before coloured yellow / green / red as the desktop, Export (CSV, the desktop's Excel keeps colours; a CSV cannot). Checked in a rolled-back add + edit (Narration FIRST -> SECOND). Entries saved before the special log was switched on have no log rows (the button says so). Not done: the voucher layout (VOUCHER DETAILS), stock-register entries (process_id).
- [x] Pranav 2026-10-14 list (invoice entry, 12 points): (1) the whole form shows when the screen opens, closed (inert) until a register is chosen — the first register's layout is read once (Entry.tsx ghost); (2) register chosen -> keyboard on Series; (3) party chosen -> keyboard on the next free row's Product (its help opens); (4) every help marks the cursor column (the one typing searches): header underline, column tint, the cursor cell on the current row (features/grid/HelpList.tsx, shared with the master); (5) a figure takes one decimal point and no more decimal figures than the setup allows; (6) leaving or Enter rounds it to the setup's decimal places and shows them (EntryCell round); (7) a discount % left blank keeps the amount typed in its amount cell (desktop AfterEdit works an amount out only from a % that is there; lib/entry/calc.ts itemSlabAmounts typed, lines.ts recalcLine); (8) the focused box or cell is scrolled fully into view (scrollIntoView nearest, scroll-padding under the sticky heading); (9) end of a product row -> next row's Product, end of a slab row -> next slab cell (as before); (10) an addon field flagged fiel_mbal D uses the date control and takes a date only (not compulsory -> may stay empty); (11) Enter in the narration leaves it for the next box (Shift+Enter is a new line); (12) Enter in Credit Days (the last box) goes to Save. Not clicked through in a browser by Claude (login). Point 10: no entry addon field of rishabh_plastic27 has fiel_mbal D yet; LRDATE, ORDDATE, STARTDATE, ENDDATE look like dates — flag them in addon_fld to get the date control.
- [ ] Edit / Delete still open: stock registers; link entries; the log row for a product row removed in an edit (the desktop writes a D log row); the set-off children reset when a bill with receipts is deleted (refused instead); e-invoice generated lock; Delete of a cancelled invoice number; unique_key / doc_pos checks the desktop makes through EntryValidating.
- [x] Outstanding tab set-off (2026-10-17): typed set-offs are saved for debit note / credit note / debit note against expense (the setup names books 11, 16, 10 for c1dg_OutClear): Save writes this entry's set-off row per bill and adds to the bill's out_setoff; Edit takes the old ones back and writes the new; Delete takes them back. Dry-run proof .scratch/dr3.ts (edit / delete). Not yet run on a real save. Other books show the set-off column read-only.
- [x] Indexes for plastic26 + plastic27 applied 2026-10-17 (idx-all-schemas.mjs --apply, 10 indexes, none invalid). They did not change All fields (3.9 s): that time is the wide result, not lookups.
- [ ] Save still open: switching on real commits (decide with Pranav after testing on a copy DB); Edit (update rules, ledger_post delete / re-post, log mode E) and Delete / cancel-invoice-number; stock registers (PROCESS / process_id, stkm modules); product account posting (s_code, setup i_posting Y); entry-addon input_* fields on restore (RESTINV_04 gives no values for the I-type addon fields, so a re-save would blank them); bundle / pack / loose columns (COL_BUNDLE8 etc. are per-book flags the web grid does not show, so bundle, loose_qty and trn_pack are not saved; 827 has bundle 15, loose 1); il_div (product filter PGFILT not ported: 827 has 527); order_no / link entries; outstanding set-off rows (c1dg_Outclear 8.x, books 11, 16, 10); party_rate auto update and pricelist auto update; credit-note sign flip tested only by reading; TCS limit warnings; print after save; Save's own validations (EntryValidating, stock negative checks, rights password dialogs). (2026-10-14)
- [x] Restore_Entry: opening an account-book entry from Find / Edit (RESTINV_01 ledger, 02 product rows, 03 slab with item-wise amounts, 04 addons; tax group from the party state). (2026-10-12; done 2026-10-13)
- [ ] Restore still open: stock registers (RESTINV_01_PROCESS: orders, challans), cancelled invoice numbers, F4 copy entry, link entries, outstanding set-offs (RESTINV_05), expense grid (RESTINV_06), Zoom from reports. (2026-10-13)
- [x] Header validation on leaving each box (lib/entry/checks.ts, route action "check", Entry.tsx leaveBox / checkHeader): Dtp_Date_Leave (series period bn_from / bn_upto, book lock / open dates by user, GST start date on an opened entry), Number / Challan No / Entry No (start number, duplicate by bn_docdup / bn_doc1dup / bn_postdup incl. "O" ask-Yes/No, daily / monthly series, own key left out on edit, CHK_BETWEEN_NO), party (INV_LOCK / INV_WARN message, account start / last date, AMTLIMIT / WAMTLIMIT, account book 1-3). Server side tested read-only on DSAL/26-27; not yet clicked through in the browser. (2026-10-14)
- [ ] Header validation still open: party-number series (bn_period P, "bn_start1" duplicate), licence-specific party checks (7 overdue / series map_code, 24 GST no, 45, 51 unreceived bills, TDS nature account), multi-day / date-lock "bl_EntryDatelock" for Voucher, order-compulsory blocks (bl_Order8_Compulsory), job-in blocks (licence 21). (2026-10-14)
- [ ] Debit / credit note against a book (Returns panel, cmb_Ag_Book) and link registers
  (c1dg_LinkEntry: orders, challans, job work): the screen warns and stops short. (2026-10-12)
- [ ] Multiple-addon product grid (batch / godown, c1Prod_AddonLink), product filter (PGFILT),
  last-rate help (c1help_PrdLastRate), Sq.ft rate box. (2026-10-12)
- [ ] Expense purchase grid (cmb_Ac_Exp_Name, c1dg_ExpPurchase) and reverse charge entry. (2026-10-12)
- [ ] Outstanding tab set-off editing (Fill_Display_OutstandingScreen, narration from bills). (2026-10-12)
- [ ] Print, Range print, document print setup, Upload Document, E-Invoice / E-Way Bill
  generation, Log viewer, narration macros (Shift+F1..F10), Ctrl+R repeat narration. (2026-10-12)
- [x] Voucher screen set up inside the Invoice entry program (entry 2, str_Entry_Style V; design in docs/VOUCHER-ENTRY-DESIGN.md): Daybook, Book Side (sets series), date / number defaults, account rows (Account help, Debit / Credit by side, journal both), Dr / Cr totals and difference, Voucher_Validate_Account rules (lock / warn message, same as day book, start / last date, group per day book, Contra rules). (2026-10-15)
- [ ] Voucher still open: Save / Edit / Delete (entry_save_properties entrykey_id 2 through lib/entry/save.ts), Find / Edit restore (RESTVOU_01..03), bank cheque number / date columns on a bank book (only Cash tried), outstanding clear grid (control_event 53, Setoff Amt), account addon grid per row, Contra / JV balance check on Save, day-lock (V_DAYLOCK), Voucher_Plain / Voucher_Multi print, Exp. Name box (books 10, 15), Doc. Type box, book balance label. (2026-10-15)
- [ ] Licence-specific branches (21, 14, 51, 82, 45, 6 ...) beyond the column hiding already ported. (2026-10-12)
- [x] Pranav 2026-10-13 list: register locked until Cancel; Save on series + date + number, Delete / Print / Range / Upload / E-Invoice / Log on an opened entry; header line Date / Number / Entry Date and Chln Dt / Chln No / Entry No, party and address on the right; book balance beside Series (hidden here by HIDEBAL, as the desktop); Find / Edit with column filter, type-to-search, search box, opens the entry; column resize on every entry grid; account and product help in the shared HelpList (now features/grid/HelpList.tsx); slab Particulars +30%; slab and addon grids half the width each with a two-scrollbar gap; disabled slab cells grey; product grid. (2026-10-13)
- [x] Pranav 2026-10-13 list (2): helps show on the field focus, ↓ goes into them, starts-with filter with the typed letters marked, main column frozen and in capitals (others Proper Case), help name (ACCOUNT HELP / PRODUCT HELP) in the first line; product, slab and addon cells use the master controls (calculator / calendar without the clear button, the master combo, features/entry/EntryCell.tsx); Enter moves cell to cell and row to row in the product, slab and addon grids; credit days whole positive numbers. (2026-10-13)
- [x] Pranav 2026-10-13 list (3): every help has column filters (▾) and heading-click sorting (features/grid/useHelpView.tsx, HelpList onHeadingClick / headingTools); F5 in the product help ends the products (blank qty row off, zero total warning except licences 6, 9, 19, 25, 27, 29, 68, then the slab grid); credit days 0 to 365, 366 when the year has a 29 February. (2026-10-13)
- [x] Pranav 2026-10-13 list (4): product help shows 9 rows; typing in a help or the Find / Edit list marks the letters found (FoundText, as the master); the Find / Edit column filter list floats over the page (it was cut off by the grid, so Apply could not be reached). (2026-10-13)
- [x] The whole entry screen is uncommitted until Pranav tests. (2026-10-12; committed to main 2026-10-13)

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

### Stock (17), from Stock.txt (2026-10-17)
- [x] Challan Date Wise, Sale / Purchase Value and Opening Value in the Summary (not compared with a desktop run).
- [x] 2026-10-17: Factor columns and Factor Value (Summary), With Expense, FG With Additional Value, the options the procedure adds by itself. Not compared with a desktop run.
- [ ] Still not ported: With Slab / Without Tax / With CN slab value (the slab keys are not in Stock.txt), Update Master / Rate / Before GST (writes), Average Value, Godown and Batch / Expiry, licence 1 / 8 / 62 Actual, Factor Value in the Ledger, the Above / Below Days sorting in the Summary.

- [x] Stock registers (Job Stock In / Out; process rows) in the invoice screen (2026-10-19): Find/Edit lists them from STOCK_PREVIEW (lib/entry/invoice.ts entryPreview); Restore reads RESTINV_01_PROCESS and the +/- column (lib/entry/products.ts); Save (new and edit) and Delete run through lib/entry/save.ts (stock branch, rules chosen by the register own book via ruleBook; per row stock_nat from +/- and inventory Y/N as Entry.cs |sys.inventory| for JOB-OUT / JOB-IN; process_id / pkval_3). Checked only by rolled-back dry runs (.scratch/stock-dry.ts: edit, edit with a new - row, delete of Job Out 193 and Job In 204): nothing committed. NOT ported: ag_qty linking of a Job In to Job Out rows, the special log (logfile S) on delete, licence-specific Job Out rate rules, p_amount follows the screen Final Amt (0.00 for a book with no slab rows; two old Job entries had it equal to the item total).

- [x] TDS auto journal on Expense / Agency / Purchase (account book) entries (2026-10-19): lib/entry/tds.ts (party TDS nature + % from int_master / tds_chart, the JV pair of Save_Entry: debit party with its bill set off, credit TDS nature account, ledger_post, ac_balance, outclear, log_ledger, licence 21 addon), hooked in lib/entry/save.ts (new entries only); the screen shows the foot box as "TDS Amount" with "TDS Perc", works the amount out from the tax slab on entering it, asks before saving with it empty, refuses a party whose TDS nature account is not open (API action tds). Purchase: only once the party year purchases pass 50,00,000. Checked by a rolled-back dry run (.scratch/tds-dry.ts: ExpTrp/26-27/14 with 30 gave the same JV pair as the desktop JV/183). Not ported: TDS on an edited entry, the opening of TDS for linked entries, Credit Days kept for TDS books.

- [x] Slab-only (no product rows) expense / agency entries (2026-10-19): slab rows with slab_pos P act as the entry own rows when the book has no stock entry (lib/entry/invoice.ts slabGrid), the save works without product rows (lib/entry/save.ts), Exp. Name list loads from combo_fixquery (lib/small-entry/load.ts) and its account takes the book-side posting and ledger.post_bkcode (|sys.exp_code|); a tax row posts to tax_master.tax_accode. Dry run of DnExp26-27/1 (.scratch/tds-dry.ts) gives the desktop postings: 10607 Cr 1001, 11352 Cr 120, 13178 Dr 1121; with TDS the JV pair as JV/190. TDS on an edited entry: the desktop writes the JV on Add only and never changes or removes it on Edit / Delete (Entry.cs Save_Entry EntryNat A), so the web does the same; the JV of an entry is listed in Find/Edit All fields (TDS JV column).
