# Demo video evidence register

This register catalogues local recordings in
`/Users/rinkalshah/Downloads/SmartWinFa Software Demo Video/`. The videos are
restricted visual evidence: they are not copied into Git, are not a source of
client data, and do not authorize a database or business-rule migration.

The recordings establish navigation patterns, screen families, visible controls,
and user-facing flow shape. Narration, screen text, and any implied rules are
evidence to validate against the controlled backlog and future source-query,
routine, and client-variant intake; they are not implementation instructions.

| Demo | Recording | Approx. duration | Observed screen family | Web screen-flow status |
|---|---|---:|---|---|
| 1 | Addon Master Creation | 2:00 | Configurable master form and grid | Complete prototype: real field-definition and lookup-value create/update/soft-delete, bound to restored `addon_data` storage columns |
| 2 | Account Creation | 5:56 | Account master form, list, add/update/delete | Complete: real master grid/form and core identity CRUD |
| 3 | New Product Item Creation | 4:22 | Product master form and list | Complete: real master grid/form and core identity CRUD |
| 7 | Sale Invoice Entry | 5:16 | Invoice header, item grid, totals, print | Complete prototype: live entry/register, atomic PostgreSQL posting/reversal and recorded print count |
| 12 | Cash, Bank, Journal and Discount Voucher Entry | 1:42 | Voucher header, debit/credit allocation, totals | Complete prototype: live balanced-entry/register, atomic supported posting/reversal and recorded print count |
| 16 | Product List Import from Excel | 6:20 | Import selection, field mapping, preview | Complete prototype: local XLSX/CSV mapping and atomic product/UOM/rate/opening-stock import |
| 17 | Day Book - Bank, Cash and Discount | 3:30 | Filtered tabular accounting report | Complete: real report with date/filter/clear/print and zoom |
| 20 | Ledgers with Zooming | 1:09 | Ledger grid with drill-in / zoom | Complete: real ledger, account/date controls and row zoom |
| 21 | Outstanding Report | 4:10 | Outstanding balance report | Complete: real outstanding grid, ageing controls and row zoom |
| 24 | Trial Balance View | 1:12 | Grouped debit/credit report | Complete: real trial-balance grid, grouping controls and row zoom |
| 27 | Top Report Customer, Supplier, Item with Value | 2:21 | Ranked analytical report | Complete: real ranking grid, selector/order controls and row zoom |
| 28 | Drop Analysis | 2:00 | Detail analysis report | Complete: real analysis grid, analysis-mode controls and row zoom |
| 29 | Multiple Invoice in Single PDF | 1:22 | Multi-selection and print job setup | Complete prototype: real document selection, recorded print count and browser PDF flow |
| 30 | Pie Chart of Sale, Purchase, Expense, Receipt and Payment | 2:13 | Summary chart and legend | Complete: real-data pie chart, selector, legend/table and row zoom |
| 31 | Utility Lock Unlock Data | 0:45 | Accounting-period lock control | Complete prototype: real lock register, selected-range inspection and PostgreSQL lock/unlock action |
| 34 | Monthly Closing Stock Report | 0:50 | Monthly stock/value report | Complete: real closing-stock grid, stock/period controls and row zoom |

## Scope interpretation

All **16 of 16** recordings are now represented by a distinct web screen flow.
This is a screen-flow completion count, not a claim that 100% of the legacy
business engine has been migrated.
Production completion remains blocked on authoritative engine/schema evidence,
`smart_system`, stored procedures, tenant/client query variants, actual
authentication and permissions, PostgreSQL rules, data reconciliation, print
templates, and parity testing.

## Prototype safeguards

- Database-backed masters, registers, reports, lock state, and invoice selection
  use restored PostgreSQL data. The import preview uses the actual user-selected
  XLSX/CSV file; it does not invent source rows.
- Any action whose desktop side-effect contract is not yet ported is visibly
  guarded instead of reporting a false save, import, lock change, or PDF job.
- The repository safety gate continues to prohibit dumps, `connection.ini`,
  secrets, and private client fixtures.
