# Real-data workflow migration status

Updated: 2026-08-24

## Runtime rule

Every enabled workflow must be backed by the restored PostgreSQL source and a
reviewed desktop contract. Synthetic business rows, in-memory CRUD, and fake
success messages are not allowed in the application runtime. A workflow whose
query, permissions, validation, side effects, or reversal behavior is not yet
verified remains visibly unavailable rather than simulating completion.

For the prototype-completion pass authorized on 2026-08-24, every restored menu
leaf receives a working real-data workflow. Verified program mappings take
precedence. Unconverted programs are assigned to the closest real register,
master, stock, tax, analysis, or configuration workflow using their desktop
action family, root module, program name, and label. The shell marks these as
`Prototype assumption`; this is functional coverage, not a parity claim.

Current prototype navigation coverage: **529 of 529 actionable leaves mapped;
38 verified/specific mappings and 491 assumed family mappings; zero pending
navigation leaves.** Assumed mappings remain correction candidates during the
later parity review, but they are not dead screens and do not use mock business
records.

## Recorded-video verification — completed 2026-08-24

Pi release `20260824-functional-core-12` returned HTTP 200 for all 16 recorded
workflow boundaries: Addon, Account, Product, Sale Invoice, Voucher, Product
Import, Day Book, Ledger, Outstanding, Trial Balance, Top Report, Drop
Analysis, Multiple Invoice PDF, Pie Chart, Lock/Unlock and Monthly Closing
Stock. The three Top Report variants and all seven Pie Chart variants were
queried independently and returned live restored PostgreSQL rows.

## Exposed workflow inventory

| Web workflow | Desktop evidence and primary data boundary | Runtime status |
|---|---|---|
| Account Master | `MASTER_ACCOUNT`, `program_top` 14; `program_body`; `account`, `address`, `ac_balance`, books, tax/lookups, `addon_fld`, `addon_sub`, `addon_data` | Real PostgreSQL read plus typed create/update/soft-delete enabled on the Pi test gate. The supported contract updates account identity, address, accounting-year balance, credit/budget/tax fields in a transaction; add-on and unsupported lookup fields remain read-only. |
| Product Master | `MASTER_PRODUCT`, `program_top` 8; desktop `update_query`; `product_master`, current `prod_balance`, latest `pricelist`, UOM/tax/group/account/product lookups, product add-ons | Real PostgreSQL read/search/paging plus typed create/update/soft-delete enabled on the Pi test gate. The supported contract updates product identity, inventory/base fields, current balance/opening stock and active price-list fields in a transaction; add-ons and unsupported lookup fields remain read-only. |
| Addon Master | `Addon_Field`, `Master_ProgramGrid`, `addon_fld`, `addon_sub`, polymorphic `addon_data`; `SP_Master_Insert` | Real field definitions and active lookup values enabled. Field-definition and lookup create/update plus legacy soft-delete are enabled on the Pi migration-test write gate with duplicate checks, locked key allocation, and optimistic concurrency. New definitions must select an existing restored `addon_data` column, preserving the physical clone instead of inventing mock storage. |
| Sale Invoice | `Entry.cs`, `SP_ENTRY_SAVE`, invoice SQL evidence; book `8` (`SALE`), `process`, `ledger`, `ledger_ext`, `prod_ledger`, tax/add-ons; demo video 7 | Desktop-style entry and register use real account/address, product, UOM, sale-rate and stock facts. The prototype posts header, ledger, posting, product and stock movements atomically; cancellation reverses its supported stock/document movements; print count is recorded. |
| Cash / Bank Voucher | desktop Cash 4, Bank 6, Petty Cash 7 books; `ledger`, `account`; demo video 12 | Desktop-style balanced voucher entry/register uses real books/accounts and atomically posts supported header/ledger/posting rows; cancellation and print count are available. |
| Journal Voucher | desktop Journal Book 19; `JOURNALVOUCHERINSERT.txt`, `SP_ENTRY_SAVE`, `ledger`; demo video 12 | Desktop-style balanced journal entry/register uses real books/accounts and atomically posts supported header/ledger/posting rows; cancellation and print count are available. |
| Discount Voucher | desktop Discount Book 5; `ledger`, `outclear` allocation; demo video 12 | Desktop-style balanced discount entry/register uses real books/accounts and atomically posts supported header/ledger/posting rows; cancellation and print count are available. |
| Transaction Register | `process` transaction headers | Real PostgreSQL document register enabled; entry-specific edit/delete/print behavior pending |
| Stock Voucher / Stock Movement | `prod_ledger`, `product_master`, `account`, `book` | Real PostgreSQL movement register enabled; stock posting, transfer, reversal, and valuation actions pending |
| Product Import from Excel | `Utility_ImportExcel.cs`; product, balance, UOM, add-on validation and inserts; demo video 16 | Desktop-style file selection, XLSX/CSV read, field mapping and source preview enabled. Product code/name/description/HSN/UOM/rate/opening-stock import creates `product_master`, balance and active price-list rows in one all-or-nothing PostgreSQL transaction. Tax/add-on mapping and update/idempotency rules remain prototype assumptions. |
| Day Book | `ledger`, `account`, `book`; desktop `ac_dbcode` debit/credit convention; demo video 17 | Real PostgreSQL read enabled with desktop-style date/filter/clear/print controls; final-total and book-option parity remain pending. |
| Ledger Report | `ledger`, `account`, `book`; account and document drill-down evidence; demo video 20 | Real PostgreSQL grid enabled with account/date view controls and selected-row zoom. Account-specific opening/closing calculation parity remains pending. |
| Outstanding Report | `outclear`, `ledger`, `account`; desktop pending formula; demo video 21 | Real PostgreSQL grid enabled using `entryamt - setoff - prior setoff`, with ageing controls and selected-row zoom. Allocation reconciliation remains pending. |
| Trial Balance | `ac_balance`, `account`, `book`; demo video 24 | Real PostgreSQL grid enabled with group/format controls and selected-row zoom. Desktop grouping, rounding, and final-total parity remain pending. |
| Top Report | active Sale Invoice `process` headers, purchase books, `account`, `prod_ledger`; demo video 27 | Real PostgreSQL Customer, Supplier and Item ranking grids enabled with selector/order controls and selected-row zoom. |
| Drop Analysis | `prod_ledger`, `account`, `product_master`; demo video 28 | Real party/product movement grid enabled with analysis/view controls and selected-row zoom. Exact comparison parameters remain pending. |
| Daily Transaction | `ledger`, `book`; desktop debit/credit convention | Real PostgreSQL daily debit/credit summary enabled; parameter and export parity pending |
| Pie Chart | `Report_PieChart.cs`; `process`, `ledger`, `prod_ledger`, `account`; demo video 30 | Real Sale/Purchase amount and quantity plus Expense/Receipt/Payment distribution pie, legend/table, selectors, and selected-row zoom enabled. |
| Monthly Closing Stock | `prod_balance` RP rows and `product_master`; desktop stock-balance evidence; demo video 34 | Real current balance grid enabled with stock/period controls and selected-row zoom. Period movement/UOM/valuation reconciliation remains pending. |
| Partywise Stock | `prod_ledger`, `account`, `product_master` | Real party/product movement aggregate enabled; period/UOM presentation parity pending |
| Target | `target`, `account`, `product_master` | Real PostgreSQL target register enabled; target write, authorization, and audit contract pending |
| Book / Series | `book_setup`, `book_number`, `book` | Real PostgreSQL book/series register enabled; setup write and document-number concurrency contract pending |
| Opening Balance / Last Year Detail | `ac_balance`, `account`, `book` | Real PostgreSQL balance register enabled; carry-forward/opening write contract pending |
| GST Reports | `tax_master`, books, accounts | Real PostgreSQL tax setup register enabled; statutory return calculation/submission contract pending |
| E-Invoice | `process` e-invoice acknowledgement/IRN fields | Real PostgreSQL register enabled; transmission, cancellation, and government integration pending |
| E-Way Bill | `process` e-way bill fields | Real PostgreSQL register enabled; generation, cancellation, and statutory validation pending |
| Configuration | `setup` | Real PostgreSQL setup register enabled; configuration write/audit/recovery contract pending |
| Multiple Invoice PDF | `SP_BILL_PRINT`, document/print staging tables and template evidence; demo video 29 | Real document selection, format selection, recorded print-count update and browser-print/PDF flow enabled. Job-scoped template rendering remains a prototype browser layout. |
| Lock / Unlock Data | `SETUP_BOOK_LOCK_UNLOCK`, desktop entry-date validation; `book_setup.lock_from`, `lock_upto`, `open_from`, `open_upto`; demo video 31 | Real PostgreSQL lock grid, selected-period inspection and lock/unlock updates are enabled. Authorization/audit/recovery remain prototype assumptions. |
| Login / company / year | `Dll_Users`, `Dll_Company_Select`; company schema and accounting balances; control-plane database required for identity | Restored company and year are read from PostgreSQL; test access remains isolated because the intake has no authoritative `smart_system` user records |

## Product Master contract implemented in this release

- The first selector is the real product group, matching the desktop
  `|sys.firstcombovalue|` filter.
- The accounting year comes from real `prod_balance` rows with `prec_flag='RP'`.
- Standard fields and order come from `smart_setup.program_body` for program 8.
- Products come from active `product_master` rows.
- Current balances, latest active prices, UOM descriptions, tax, posting account,
  related products, group description, and first product add-on row follow the
  joins declared by the desktop `program_top.update_query` and `addon_from`.
- Product add-on definitions follow the desktop `addon_query`: relation `P`,
  not deleted, master-visible, excluding the `GODOWN,` special field.
- Search and paging are executed on the server so the 18,007-row master remains
  usable without truncating or fabricating data.

## Addon lookup-value write contract implemented in this release

- Lookup values are read from active `addon_sub` rows for the selected real
  `addon_fld` definition.
- Create allocates the legacy integer `sub_code` while holding a transaction
  advisory lock; update and delete require the row version originally read.
- Duplicate active names within one `para_id` are rejected case-insensitively.
- Delete preserves desktop behavior by marking `sub_pos='D'`; it does not
  physically remove historical rows or rewrite existing documents.
- The desktop `SP_Master_Insert` dynamic-SQL path remains quarantined. The web
  service accepts only the typed create/update/delete command contract.
- Writes default to disabled and are enabled explicitly for the Pi migration
  test deployment. Field-definition changes require an existing compatible
  `addon_data` column rather than creating new physical storage.

## Implementation order

1. Finish audited Addon/Account/Product CRUD contracts.
2. Convert one representative invoice entry with posting and reversal parity.
3. Reuse that transaction provider for cash/bank, journal, and discount flows.
4. Convert Ledger Report, then Outstanding and Trial Balance with reconciliation.
5. Convert stock/analysis reports, imports, print jobs, and lock utilities.
6. Enable production identity/company/year selection only from an authoritative
   restored control-plane source.

## Current shell routing rule

The web menu preserves the module identity of every selected label. This avoids
collapsing desktop labels reused in different modules: for example,
`TRANSACTION → Register` opens the live `process` document register whereas
`REPORT → Register` opens the live accounting day-book register. The existing
49-label shell is only a partial visual snapshot; the migration inventory still
requires the authoritative `MenuMaster` export to close the legacy catalog. A
live read-only catalog endpoint now returns 592 restored desktop menu records;
effective per-user visibility and rights remain blocked on the authoritative
control-plane security evidence.
