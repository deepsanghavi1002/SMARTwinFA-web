# Demo video evidence register

This register catalogues local recordings in
`/Users/rinkalshah/Downloads/SmartWinFa Software Demo Video/`. The videos are
restricted visual evidence: they are not copied into Git, are not a source of
client data, and do not authorize a database or business-rule migration.

The recordings establish navigation patterns, screen families, visible controls,
and user-facing flow shape. Narration, screen text, and any implied rules are
evidence to validate against the controlled backlog and future source-query,
routine, and client-variant intake; they are not implementation instructions.

| Demo | Recording | Approx. duration | Observed screen family | Prototype representation |
|---|---|---:|---|---|
| 1 | Addon Master Creation | 2:00 | Configurable master form and grid | Existing Addon Master prototype |
| 2 | Account Creation | 5:56 | Account master form, list, add/update/delete | Account Master |
| 3 | New Product Item Creation | 4:22 | Product master form and list | Product Master |
| 7 | Sale Invoice Entry | 5:16 | Invoice header, item grid, totals, print | Sale Invoice |
| 12 | Cash, Bank, Journal and Discount Voucher Entry | 1:42 | Voucher header, debit/credit allocation, totals | Cash / Bank, Journal, Discount |
| 16 | Product List Import from Excel | 6:20 | Import selection, field mapping, preview | Import from Excel |
| 17 | Day Book - Bank, Cash and Discount | 3:30 | Filtered tabular accounting report | Bank / Cash day book |
| 20 | Ledgers with Zooming | 1:09 | Ledger grid with drill-in / zoom | Ledger Report |
| 21 | Outstanding Report | 4:10 | Outstanding balance report | Outstanding Report |
| 24 | Trial Balance View | 1:12 | Grouped debit/credit report | Final Report / Trial Balance |
| 27 | Top Report Customer, Supplier, Item with Value | 2:21 | Ranked analytical report | Top Reports |
| 28 | Drop Analysis | 2:00 | Detail analysis report | Drop Analysis |
| 29 | Multiple Invoice in Single PDF | 1:22 | Multi-selection and print job setup | Multiple Invoice PDF |
| 30 | Pie Chart of Sale, Purchase, Expense, Receipt and Payment | 2:13 | Summary chart and legend | Pie Chart |
| 31 | Utility Lock Unlock Data | 0:45 | Accounting-period lock control | Lock / Unlock Data |
| 34 | Monthly Closing Stock Report | 0:50 | Monthly stock/value report | Monthly Closing Stock |

## Scope interpretation

The demo-derived prototype covers all 16 recorded subjects at the screen and
interaction level. This is not a claim that 50% of the migration is complete.
Production completion remains blocked on authoritative engine/schema evidence,
`smart_system`, stored procedures, tenant/client query variants, actual
authentication and permissions, PostgreSQL rules, data reconciliation, print
templates, and parity testing.

## Prototype safeguards

- All shown values are synthetic in-memory fixtures.
- Save, delete, lock, import, export, and print actions state their mock
  behavior and do not write a database or create a file.
- The repository safety gate continues to prohibit dumps, `connection.ini`,
  secrets, and private client fixtures.
