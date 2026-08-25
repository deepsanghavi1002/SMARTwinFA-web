# SMARTwinFA migration roadmap

## Program objective

Deliver a scalable, multi-tenant web replacement with behavior and financial
parity across menus, buttons, entries, masters, reports, dashboards, printing,
utilities, client overrides, database rules, connections, and security. Cutover
occurs tenant/company/year by tenant/company/year with measurable evidence and
a rollback path.

The work is organized around vertical business flows, not copied forms. Stable
IDs live in [backlog.csv](backlog.csv), while GitHub issues mirror those IDs.

## Recorded-workflow prototype milestone — completed 2026-08-24

The 16 local SMARTwinFA demo recordings are now implemented as connected web
workflows against the writable PostgreSQL Rishabh clone and deployed to the Pi
test environment. This includes add-on, account and product masters; sale and
voucher posting/reversal; Excel product import; the recorded financial and
stock reports; customer/supplier/item top reports; all seven pie measures;
multiple-invoice browser PDF output; and lock/unlock updates. The live endpoint
smoke suite passed all 16 flows on release `20260824-functional-core-12`.

This milestone completes the authorized prototype scope. It is deliberately
not the production-cutover definition below: unrecorded desktop programs,
authoritative identity/rights, report/template variants, external statutory
integrations, reconciliation, and operational readiness remain in their
respective workstreams.

## Verified PostgreSQL intake update — 2026-08-21

The supplied PostgreSQL archives are now restored in an isolated local intake
database. This changes the next work from "obtain a representative database"
to "extract and review safe contracts from it"; it does not establish source
authority or parity. The verified facts are recorded in
[the restore report](../intake/postgres-local-restore-2026-08-21.md) and the
[sanitized metadata catalogue](../intake/postgres-metadata-catalog-2026-08-21.md).

| Evidence | Verified fact | Migration consequence |
|---|---|---|
| Company-year schema | 75 tables, 705,743 rows, no PK/FK/view/trigger | Profile keys, duplicates, and logical relationships before target constraints. |
| `smart_setup` | 37 tables, 146,964 rows, 49 program definitions, 1,308 field definitions | Metadata discovery and a controlled first view contract can start. |
| Account Master | `program_top:14`, 87 fields, 27 compulsory, 12 lookups, 2 duplicate checks | It is the first concrete view-contract candidate; its SQL/write semantics remain unapproved. |
| Procedures | 283 signatures across 282 names; 263 need repair | Keep procedure execution quarantined; start only dependency/contract review. |
| Control-plane intake | `smart_system`: 24 tables, 448 rows, but no security/login records | Structural discovery can proceed; authentication, effective rights, routing, dashboard, and print behavior still require semantic/parity evidence. |
| Control-plane structural contract | Routing candidates are internally unique; all 19 dashboards contain raw-query slots; shared print staging has no PK/FK; all 4 user rows contain credential material | Keep raw queries and credentials quarantined; use server-owned routing, typed dashboards, and job-scoped print snapshots. Authentication and effective-rights parity remain blocked. |
| Source dialect | Legacy application is SQL Server/T-SQL; PostgreSQL dumps are converted artifacts | Track dialect per object; do not assume MySQL is the authoritative source. |

### Reprioritized execution path

1. **Metadata evidence (now):** export sanitized menu/program/field/key/query
   dependency facts; attach each result to a backlog and traceability ID.
2. **Schema semantics:** profile candidate keys, duplicate/orphan risk, money,
   dates, flags, and add-on projections for the Account Master data boundary.
3. **Safe target contracts:** turn reviewed metadata into typed, versioned,
   parameter-bound definitions and approved override precedence; raw source SQL
   never becomes web runtime configuration.
4. **First vertical slice:** implement Account Master read, then write only
   after `smart_system` permissions, save behavior, and financial side effects
   have passing contract/parity evidence.
5. **Scale-out:** repeat the same discovery → contract → migration → parity
   sequence for Addons, entries, reports, and printing. Do not measure overall
   completion by screen count: the gates are rules, permissions, data effects,
   client variants, and reconciliation.

## Continuous execution model

Migration is one continuous task organized into five workstreams. A workstream
is not a stopping point. Work proceeds to the next safe, unblocked item without
waiting for stage approval. New templates, screenshots, client rules, and other
evidence are incorporated when supplied; missing non-critical evidence is
tracked and does not stop unrelated implementation.

Progress is measured by source-backed flows that are implemented, tested, and
deployed—not by the number of small code changes. Read-only discovery, contract
extraction, implementation, automated verification, Pi deployment, and smoke
testing repeat continuously within each workstream.

## Workstream 1 — Source parity and menu navigation

Status: **in progress**.

Outcome: every legacy menu, shortcut, action, program, and client variant opens
the correct web workflow using authoritative `smart_setup` metadata.

Scope:

- Reconcile the 592 restored menu records, action codes, program names,
  shortcuts, visibility rules, and parent/child hierarchy with desktop source.
- Route known program/action combinations to migrated web workflows; show a
  precise migration status only for genuinely unimplemented leaves.
- Inventory source code, metadata, procedures, license/company branches,
  Crystal reports, templates, and database side effects in one traceability
  registry.
- Preserve legacy and modern presentation modes while sharing the same real
  workflow and data contracts.

Completion evidence: 100% of actionable leaves resolve deterministically;
navigation, keyboard, visibility, direct-route, and negative-rights tests pass;
no label collision or mock route remains.

## Workstream 2 — Masters, setup, security, and opening data

Status: **in progress**.

Outcome: all master and setup workflows reproduce desktop read/write behavior
against real data with validation, rights, audit, and concurrency protection.

Scope:

- Complete Account, Product, Addon, address, balance, group, unit, tax, price,
  formula, discount, scheme, target, commission, company, year, book/series,
  parameter, GST, email, and document setup workflows.
- Recreate metadata-driven field order, compulsory fields, lookups, duplicate
  checks, add-on projections, client overrides, and legacy keyboard flow.
- Replace quarantined dynamic-SQL saves with typed, parameter-bound commands;
  preserve legacy soft-delete and financial side effects where verified.
- Implement user/session lifecycle, roles, menu/book/company/year rights,
  company/year context, opening balances, audit, import/export, and history.

Completion evidence: every master/setup control has source traceability and
real-data CRUD parity; uniqueness, validation, concurrency, authorization,
audit, import/export, and client-variant tests pass.

## Workstream 3 — Transactions, inventory, and financial posting

Status: **pending after the current navigation/master slice, with reusable
reporting and database foundations already present**.

Outcome: every operational entry produces the same accounting, stock, tax,
lock, document, and audit effects as the desktop application.

Scope:

- Invoice, receipt/payment, cash/bank, journal, discount/allocation, interest,
  transfers, orders, challans, stock entries, transport, production,
  manufacturing, approvals, and uploads.
- E-invoice/e-way bill creation, cancellation, edit/delete/repost, duplicate
  prevention, period locks, book numbering, and year behavior.
- Ledger, product ledger, balances, stock, tax, addon, and downstream document
  effects with atomic transactions, idempotency, and rollback.

Completion evidence: every state/action has balanced accounting and inventory
proof, differential old/new results, failure rollback, concurrency,
authorization, edit/delete/repost, and representative company/year tests.

## Workstream 4 — Reports, dashboards, documents, and integrations

Status: **in progress**; the first real-data register/report family is live.

Outcome: all legacy outputs use typed server-owned contracts and reconcile to
desktop totals, ordering, filters, formatting, and client templates.

Scope:

- Financial, stock, GST, outstanding, analysis, multi-company/year, dashboard,
  drilldown, and reconciliation reports.
- PDF, Excel, JSON, XML, print, email, invoice/document templates, product
  images, and job-scoped rendering/delivery.
- Excel/Tally and other file/external integrations, e-invoice/e-way bill
  exchange, retries, logs, tokens, and retention.
- Convert active report/query/template/license branches into reviewed,
  versioned overrides; never execute stored raw SQL in the web runtime.

Completion evidence: filters, types, totals, rounding, ordering, permissions,
client variants, exports, golden artifacts, concurrency, isolation, and
peak-period performance tests pass.

## Workstream 5 — Validation, operations, deployment, and cutover

Status: **continuous validation and Pi deployment active; final cutover
pending functional parity**.

Outcome: the migrated system is secure, recoverable, supportable, reconciled,
and progressively replaces the desktop application without data loss.

Scope:

- Repeatable schema/data migration, checkpointing, quarantine/repair,
  reconciliation, backup/restore, PITR, year open/close, repost, renumber, and
  lock/unlock operations.
- CI, type checks, unit/contract/differential/end-to-end tests, accessibility,
  browser/keyboard qualification, load, isolation, security, failure recovery,
  observability, and support runbooks.
- Continuously deploy substantial verified increments to the Raspberry Pi test
  environment and smoke-test real routes and data.
- Rehearse and execute company/year cutovers with freeze, final sync,
  reconciliation, explicit go/no-go, canary monitoring, rollback, acceptance,
  read-only legacy retention, and auditable retirement.

Completion evidence: all definition-of-done gates pass; every supported
company/year and role is reconciled and accepted; the legacy system is retired
only after the approved retention period.

## Definition of 100% migration

The migration is complete only when:

- 100% of current actionable menu leaves, controls, shortcuts, database
  objects, routines, client variants, reports, and templates are resolved.
- Every supported role and company/year combination has positive and negative
  authorization evidence.
- Every financial flow has matching data, calculation, posting, report, print,
  integration, and side-effect evidence.
- No runtime path uses mock business data, browser-selected schema names,
  process-global tenant state, raw SQL interpolation, plaintext secrets, or
  shared-session scratch data.
- Performance, backup/restore, recovery, security, accessibility, UAT, canary,
  reconciliation, and rollback gates pass.

## Progress reporting

Report these five workstreams only. Each update summarizes completed flows,
current continuous work, verified deployment/test results, remaining flow
counts, and true external blockers. Small implementation steps remain internal
and do not become approval checkpoints.
