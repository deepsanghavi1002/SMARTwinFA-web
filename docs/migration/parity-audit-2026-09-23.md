# Legacy-to-web parity audit and coding backlog

## Verdict and scope

The web application is a partial migration, not a verified replacement for the desktop application. The current menu opens generic MASTER screens only. Report, entry and utility prototypes remain in the repository but are not connected to the current application shell. PostgreSQL contains restored data; successful restore and HTTP 200 responses do not establish calculation or workflow parity.

Audited web: `feature/modern-reporting`, commit `1d06893`; legacy: `main`, commit `113345ef77e2db201569552f6e30fbdfc5aaf24c`. Inspection date: 2026-09-23. Evidence: source comparison, local Docker read-only HTTP checks and aggregate PostgreSQL catalog/data queries. No posting, cancellation, imports, procedure execution or database modifications were performed. This is a prioritized source audit, not exhaustive certification of every master program, report or client customization. The desktop executable was not run for golden-output comparison.

Paths below are relative to the web repository unless prefixed `legacy:`, which means the sibling `../SMARTwinFA-legacy-reference` checkout.

## Classification

- **Bug:** present behavior contradicts its controls, another implemented contract, or safe record identity.
- **Missing/partial:** a desktop capability lacks a complete reachable web equivalent.
- **Modification:** deliberate architecture or presentation change, not automatically a parity defect.
- **Needs reconciliation:** source discrepancy requiring accepted legacy output or database contract evidence.

P0 means block production use/activation of affected writes; P1 is core functional work; P2 is later completeness. Proposed order is a coding recommendation, not authorization to change accounting policy.

## Verified runtime evidence

| Read-only check | Result |
| --- | --- |
| `daybook`, `ledger`, `outstanding` without dates | Each returns 1,000 rows |
| Same three reports with 2099-01-01 through 2099-01-02 | Each returns zero rows |
| `trial-balance`, `closing-stock` with the same future dates | Each still returns 1,000 rows identical to unfiltered output |
| `top-sales`, `sales-distribution` with the same future dates | Each still returns 179 rows identical to unfiltered output |
| Active source ledger rows (`doc_pos <> D`, including null/empty) | 15,219; the report endpoint exposes only its capped result count |
| Restored tables | smart_system 24; smart_setup 37; rishabh_plastic27 75 |
| smart_setup routines | 283; 156 bodies match `sp_executesql`, `isnull(`, `nvarchar` or `[dbo]` |

The routine scan is a heuristic: matches can be comments, unreachable text or wrappers. It is not evidence that all 156 execute incorrectly. A per-object dependency and conversion registry is required.

## Prioritized coding backlog

| ID / priority | Classification and evidence | Work required / acceptance criterion |
| --- | --- | --- |
| AUTH-01 P0 | Missing authentication: `features/startup/StartupGate.tsx`, `login()` checks an existing username and any nonempty password. Legacy `Prj_Forms/Z_LoginScreen.cs:260` reads the stored password and rejects an incorrect password. | Implement server verification and a server-owned session; incorrect passwords must fail and changing browser loginName must not impersonate another operator. `lib/master-program/legacy.ts:380` already contains readPw; the UI comment saying the algorithm is unavailable is stale. Plan secure credential migration rather than adopting reversible storage as the permanent design. |
| AUTH-02 P0 | Partial authorization: `app/api/master-program/route.ts` explicitly gates on trusted local mode and reconstructs identity from browser session fields. Legacy API handlers use environment write flags, not authenticated operator permissions. | Bind company/year/operator and rights to authenticated sessions across ALL API families. Test denied writes and cross-company/year requests. Local-mode gating is intentional; missing production identity is not fixed by turning it on. |
| CTX-01 P0 | Bug/integration gap: `platform/legacy-db/company-schema.ts` selects one environment schema, whereas generic masters resolve selected company/year through `lib/master-program/session.ts`. | Unify context before connecting prototypes; switching company/year must change report/entry scope and exports consistently. |
| POST-01 P0 | Confirmed incomplete posting: `platform/legacy-db/entry-post.ts:45` creates one party debit for an invoice. No sales/tax balancing credits, outclear creation or ac_balance update appear in this function. | Port the full posting contract, including any actual database-trigger responsibilities. Reconcile invoice, ledger_post, outstanding, tax and balances to a legacy fixture; demonstrate balanced postings and rollback on failure. Do not enable this prototype as a complete invoice engine. |
| POST-02 P0 | Bug: posting uses `line.debit - line.credit` for ledger.amount, while Day Book/ledger reports use amount directly as positive Debit/Credit based on ac_dbcode (`entry-post.ts:47`, `report-register.ts:25`). | Resolve signed-vs-magnitude conventions against source data and SP_ENTRY_SAVE. A balanced two-line voucher must display equal positive debit/credit totals and reconcile across reports. |
| POST-03 P0 | Bug: `entry-post.ts:36` chooses a lexically descending 16-digit year_id from stock balances instead of the selected accounting year. Date validation is format-only and no book date-lock check exists in this posting function. | Require validated session year, real calendar date, fiscal boundaries and lock windows. Test backdated, locked and cross-year entries. |
| CANCEL-01 P0 | Bug: `platform/legacy-db/entry-cancel.ts` selects/updates product and account ledger rows by full_docno only although posting uniqueness includes book. | Use stable header relationships plus company/book/year scope; two books with the same document number must not cancel each other. |
| CANCEL-02 P0 | Partial reversal: cancellation restores every matched product quantity as an outgoing sale, marks ledger/header rows deleted, and has no ledger_post/outclear/ac_balance reversal in this function. | Implement document-type-specific reversal and allocations; reconcile all affected tables and repeat-cancel behavior, including database-trigger effects. |
| NAV-01 P1 | Deliberate scope reduction with missing integration: `app/page.tsx:99-102,157-158` routes only MASTER to a real screen. Legacy `Prj_Menu/Main_Menu_New.cs:1970-2370` dispatches entries, reports and charts. | Build an explicit actionCode/actionMenu registry with supported parameters; connect only validated flows. Add a menu-to-screen integration check. Older claims of 529 functional leaves no longer describe this shell. |
| REP-01 P1 | Confirmed bug: Top Sales, distribution, trial balance and closing stock have no date column mapping in `report-register.ts:416-440`; runtime ignores supplied dates. | Apply date/year filters to underlying facts BEFORE aggregation; test disjoint and empty periods. For snapshot reports, implement an explicit as-of cutoff rather than pretending a transaction date filter is enough. |
| REP-02 P1 | Bug: API `LIMIT 1000` and `total=result.rowCount` conceal truncation; export summaries sum only loaded rows. | Return true counts, full-query totals and pagination metadata; exports must include all matching rows or clearly state partial scope. Test above 1,000 rows. |
| REP-03 P1 | Bug: Outstanding selector filters by Book/Type, but outstanding SQL returns neither (`LegacyReportWorkflow.tsx` presentRows; `report-register.ts:58-69`). Non-All choices therefore eliminate every row. Ageing measure is not applied. | Return stable book/type and due-date fields; implement server-side Sale/Purchase/Expense and documented ageing buckets. |
| REP-04 P1 | Missing ledger semantics: current SQL returns latest-first ledger rows, and Account-wise merely sorts. No account-specific opening/running/closing balance; zoom shows fields from the same row. | Account picker, chronological balances, opening before from-date, closing reconciliation and actual source-voucher drill-down. |
| REP-05 P1 | Partial trial balance: raw ac_balance register includes years without a selected-year predicate; Schedule/Area controls have no corresponding query columns and do not aggregate. | Fiscal/as-of calculation, opening/movement/closing, schedule hierarchy, group totals and explicit imbalance checks. |
| REP-06 P1 | Partial monthly stock: current RP balance rows and closing pieces × reporting rate are not a month-end pivot. Period choices do not calculate month-end history. | Product × month matrix from reconciled movements; define UOM, valuation, returns and cutoff semantics with accepted desktop output. |
| REP-07 P1 | Partial Top/Drop analysis: Drop uses party/product movement aggregates; no comparative period or drop calculation. Top invoice ordering searches Invoice Count/Documents but query returns Invoices. | Implement dimension/ranking contracts and actual comparison periods; distinguish invoice counts from line counts. |
| REP-08 P1 | Bug in chart prototype: first six positive rows only, then renormalized; no Other slice, and zero/negative rows disappear. Pie/Legend/Table measure does not control rendered layout. | Chart and table must reconcile to the entire filtered dataset; implement Other and explicit negative-value handling and accessible mode switching. |
| REP-09 P1 | Bug in new export helper: `lib/reporting/report-table.ts` infers all numeric-looking identifiers as numbers and sums them. Leading-zero codes lose formatting; Key/Year can enter KPI totals. Quantity gets zero decimals unless its caption matches moneyNames. | Explicit per-report column schema: identifiers text, reviewed decimal scale, explicitly additive fields, dates/time zone rules. Test all-numeric codes and fractional quantities. |
| REP-10 P1 | Bug/partial print: Print selected calls window.print while print CSS hides `.legacy-report-zoom`; export header defaults to a generic company and omits search text. | Scoped voucher print and company/year/applied filters in all outputs; PDF and on-screen totals must agree. Verify pagination and non-Latin names; current PDF font replaces unsupported characters. |
| REP-11 P1 | Missing metadata parity: legacy `Data Logic Layer/Dll_ReportOutput.cs:38-346` calls SP_MONTHS_FORMATING, SP_REPORT_FORMATING(_NEW), SP_FILL_RPT_CONTROL and SP_REPORT_STANDARD. Web uses fixed report kinds. | Inventory report keys, parameter/control definitions, groupings, formulas and client overrides; port typed definitions report-by-report. Native PDF/XLSX is an acceptable renderer replacement, not a replacement for report calculations. |
| PRINT-01 P1 | Partial batch invoices: retained utility/browser-print prototype is disconnected; Crystal template/formula parity is unverified. | Selected-invoice batch, actual detail/tax lines, layout/template choice, per-invoice page breaks, error handling and accurate print-count semantics. |
| MASTER-01 P1 | Implemented but not certified: generic metadata master screen, loader, save/events, permissions, grids and exports are substantial ports. Loader catches SQL failures as warnings and continues. | Matrix by program/group and add/edit/delete action; validate required fields, add-ons, duplicates, rights, concurrency and side effects using disposable fixtures. Screen load alone is not proof of parity. |
| DB-01 P1 | Conversion incomplete/unverified: 156 routine syntax candidates; `lib/master-program/sql.ts` replaces session tokens but is not a general T-SQL translator. | Object registry with source routine/query, target implementation, dependencies and conversion decision. Exercise only reviewed routines on disposable fixtures; surface failed metadata queries. |
| DB-02 P1 | Needs reconciliation: data exists but no current source-target financial certification was performed. Canonical schema/domain tests do not prove the legacy compatibility tables satisfy those invariants. | Compare counts, keys, duplicates, null/blank rules, collation, dates, money precision, balances, stock and allocations across a matched SQL Server snapshot and PostgreSQL. Record accepted differences. |
| DB-03 P1 | Needs integration testing: posting uses MAX+1 under one advisory lock; correctness depends on every writer sharing that lock and constraints. | Audit master/import/entry allocation together; prove concurrent uniqueness, book-series/year numbering and rollback. |
| ENTRY-01 P1 | Missing reachable/full workflows: legacy ENTRY, SMALL_ENTRY, RG_ENTRY, stock journal, transport, book transfer and manufacturing formula dispatches exceed invoice/voucher prototypes. | Complete purchase, expense, debit/credit note, orders, challans, proforma, linked-document fulfilment and stock workflows with posting/reversal fixtures. Prioritize actual Rishabh usage. |
| TAX-01 P1 | Missing statutory behavior: tax setup and acknowledgement registers are not GST return calculation, e-invoice or e-way generation/cancellation. | Port tax rules and document lifecycle, then sandbox integration, reconciliation and retry/idempotency behavior. |
| UTIL-01 P2 | Partial/missing: Excel import prototype, Tally import/export, transfer/repost, backup/restore setup and year-open exist as legacy menu families but are not active web workflows. | Separate coding tickets per utility with validation, preview, atomicity/recovery and duplicate-import tests. |
| RIGHTS-01 P1 | Missing administration UI: legacy Security_Menu and User_Company/Year/Dashboard_Rights are pending in current dispatch. | Rights management and server enforcement; verify company/year membership and audit changes. |
| DASH-01 P2 | Missing: REP_DASHBOARD, YEAR_DASHBOARD, multi-year pie and factory daily report in legacy dispatch. | Define KPI queries and drill-down; reconcile against equivalent reports before connecting screens. |
| DOC-01 P1 | Stale status: workflow-real-data-status.md claims all-leaf coverage and missing smart_system; neither matches this checkout/runtime. | Replace historical claims with current reachable-screen status and link this audit. Keep historical reports clearly dated. |

## Intentional modifications to retain

| Change | Classification / condition |
| --- | --- |
| SQL Server databases to PostgreSQL schemas | Intended migration. Must preserve company/year scope, type semantics, keys and transaction effects. |
| WinForms/ComponentOne to React web grids | Intended UI change. Preserve useful shortcuts, validation, selection and drill-down behavior. |
| Crystal runtime to native PDF/XLSX/browser print | Intended replacement. Layout can improve; calculations, totals and document content still need acceptance. |
| Unsupported actions visibly marked not built | Intentional current shell behavior; missing capabilities still count as backlog, not completed features. |
| Typed queries/commands instead of unrestricted legacy dynamic routines | Valid design direction where implemented; requires explicit coverage of the displaced business rules. |

## Suggested delivery sequence

1. AUTH-01/02 and CTX-01: one authenticated company/year context for both API stacks.
2. DB-01/02 and MASTER-01: reconcile the master foundation and review executable metadata.
3. REP-01/02/03/04/09 and NAV-01: a complete Day Book + Ledger + Outstanding slice, including real totals, drill-down and exports.
4. POST-01/02/03 and CANCEL-01/02: balanced, scoped invoice/voucher posting and reversal on disposable fixtures, then connect entry menus.
5. Trial Balance, monthly stock, Top/Drop, chart and invoice print parity.
6. Remaining entry families, statutory integrations, utilities, dashboards and administration.

Each ticket is done only when reachable through the real menu, scoped to the selected company/year, reconciled to an accepted legacy fixture, covered for empty/error cases and reflected in the status inventory. Feature existence, HTTP 200 and unit tests alone do not demonstrate parity.
