# Feature and flow inventory

This is a migration baseline, not a final product catalog. The historical menu
snapshot contains about 400 items/350 leaves, while the current web shell shows
49 labels. Exporting current `MenuMaster` and metadata is required before
coverage can be declared complete.

## Cross-cutting traceability

| Stable ID | Flow | Legacy behavior to capture | Production completion evidence |
|---|---|---|---|
| AUTH-001 | Login/session | Connection selection, login, exit, password validation, machine/default behavior | Modern password verification/reset, invalid-login and lockout behavior, secure session lifecycle, audit, negative tests |
| CTX-001 | Company/year context | Choose year/company, prior year, switch company, resolve data name, load setup | Authorized routing, immutable request context, forbidden selections, idempotent open, cross-tenant tests |
| NAV-001 | Dynamic menu | Hierarchy, shortcuts, license/rights/hidden-book rules, module passwords | Snapshot parity per role/tenant, keyboard/mobile behavior, direct route/API denial |
| MST-001 | Generic masters | Add/update/cancel/delete/print/export/refresh/log and grid actions | Typed metadata rendering, validation, transactional CRUD, concurrency, permissions, audit, parity |
| ENT-001 | Full accounting entry | Save/cancel/delete/print/refresh/range/upload/e-invoice/log | Posting invariants, balances, tax/slabs/add-ons, rollback, idempotency, duplicate-submit tests |
| SENT-001 | Special entries | Stock journal, transfers, transport, RG, formulas/manufacturing | Explicit states, accounting/inventory effects, permissions, recovery, parity |
| RPT-001 | Reports | Generate/drill/group/tree/export/PDF/preview/print/refresh/GST/JSON/XML/email | Typed inputs/outputs, totals/order/filter/date/rounding parity, authorization, cost limits, golden exports |
| DASH-001 | Dashboard | Cards/grids/charts/date filters/refresh/drilldown/user layout | Definition parity, tenant-safe cache, permission filtering, accessibility, performance |
| PRN-001 | Document printing | Template mapping, preview/direct/copies/PDF/email/WhatsApp, shared staging | Job isolation/idempotency, template/version mapping, concurrent runs, golden artifacts, retention/audit |
| SEC-001 | Rights | User/menu/book/company/year/dashboard rights and action passwords | Normalized scoped grants and server/DB enforcement for every operation |
| UTIL-001 | Utilities | Backup/restore/repost/year open/balance transfer/import/export/Tally/GST checks/images | Durable job model, approvals, audit, retry/idempotency, destructive controls, restore tests |
| CUST-001 | Client overrides | License/company/database branches, query variants, report folders/templates | Versioned provenance/effective dates, deterministic precedence, validation, rollback, tenant regression pack |
| DB-001 | Database migration | Schemas/data/queries/procedures/metadata/constraints | Object registry, dialect classification, contracts, row/hash/total parity, integrity and performance evidence |

## Functional taxonomy

### Startup, setup, and security

- Server/environment connection (retire `connection.ini`).
- User lifecycle, password/reset/lockout/session/revocation.
- Company, accounting year, prior-year access, and safe switching.
- User, menu, book, company, year, dashboard, and action permissions.
- Application, tax, book/series, email, GST, and document configuration.
- Dynamic menu, shortcuts, hidden modules, entitlements, and support/help.

### Masters

- Account, address, balance, contacts, and custom/add-on fields.
- Product, tax/slab, units, groups, price lists, costing/formulas.
- Book/series, balance-sheet layouts, opening balances.
- Discounts, schemes, targets, commission, transport, bank, and other
  metadata-driven master families.

### Transactions and entries

- Invoice/voucher entry and approval.
- Cash/bank, receipt/payment, journal, discount, allocation, interest JV.
- Challan, order, stock voucher/journal, book/bank transfer.
- Production planning/formula/manufacturing and transport workflows.
- Document upload, e-invoice/e-way bill, cancellation/edit/delete/repost.

### Reports and analysis

- Cash/bank/reconciliation, journal/register, ledger/outstanding.
- Trial balance, profit/loss, balance sheet, annexures, interest/reminders.
- Inventory stock/rate/valuation/ageing/movement/physical stock.
- Sales/product/party/commission/budget/tax/gross-profit matrices.
- Multi-company/multi-year, dashboard, chart, drilldown, exports, and delivery.

### Utilities and integrations

- Backup/restore and recovery validation.
- Year opening, balance transfer, reposting, renumbering, lock/unlock.
- Excel import/export, Tally integration, GST validation/submission paths.
- Multiple invoice PDF, email/message delivery, product images, logs/tokens.

## Metadata families to inventory

| Family | Required source and mapping |
|---|---|
| Menus | `MenuMaster`, hierarchy, action code, shortcut, license/rights predicates, route/permission |
| Masters | `program_top`, `program_body`, query/table/key/combo/help metadata, add-on fields, CRUD commands |
| Entries | entry properties, controls, events, grids, save mappings, help/setup/book/add-on dependencies |
| Reports | report properties/controls/values/checkboxes/output/fixed/runtime fields, query/routine/template |
| Dashboards | component type/layout/query/chart/drilldown and user visibility/order/color |
| Printing | document mapping, procedure/query, template, copies/delivery, sample artifact, retention |
| Client overrides | license/company/database condition, source location, replacement manifest, effective dates |

## Initial vertical slices

1. Addon Master: converts the existing mock to authenticated, tenant-scoped,
   persistent CRUD and establishes the master metadata pattern.
2. Account Master: proves standard/client fields, dynamic view compilation,
   validation, balances/addresses, and the supplied query recipe.
3. One representative financial entry: proves posting, transactionality,
   idempotency, edit/delete, and balance parity.
4. One representative report: proves parameter/result contracts, totals,
   ordering, export, performance, and client overrides.
5. One invoice print: proves asynchronous job isolation, template mapping,
   golden output, delivery, and retention.

Only after these patterns pass parity and tenant isolation should the team scale
out across the remaining menu.
