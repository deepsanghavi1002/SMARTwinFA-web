# SMARTwinFA migration roadmap

## Program objective

Deliver a scalable, multi-tenant web replacement with behavior and financial
parity across menus, buttons, entries, masters, reports, dashboards, printing,
utilities, client overrides, database rules, connections, and security. Cutover
occurs tenant/company/year by tenant/company/year with measurable evidence and
a rollback path.

The work is organized around vertical business flows, not copied forms. Stable
IDs live in [backlog.csv](backlog.csv), while GitHub issues mirror those IDs.

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
| Missing control data | `smart_system` is absent | Authentication, rights, company/year routing, dashboards, and print staging remain blocked. |
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

## Program gates

The release cannot be called complete until:

- 100% of current menu leaves, dynamic action codes, keyboard shortcuts, and
  interactive controls are in the traceability registry.
- 100% of required database objects, metadata definitions, routines, client
  variants, and document/report templates are classified and resolved.
- Every supported role and tenant/company/year combination has positive and
  negative authorization evidence.
- Every financial flow has data, calculation, report, print, and side-effect
  parity evidence.
- No runtime path depends on process-global tenant state, browser-provided
  schema names, raw SQL interpolation, plaintext secrets, or pooled-session
  scratch tables.
- Performance, backup/restore, recovery, isolation, security, UAT, and canary
  gates pass.

## Phase 0 — Repository and evidence safety

Status: in progress; the new repository, latest UI baseline, initial security
rules, and planning system are present.

Deliverables:

- Preserve latest web source and prototype history.
- Remove incompatible D1/SQLite starter database artifacts.
- Establish clean install/lint/type-check/build/test CI.
- Protect dumps, secrets, `connection.ini`, and private fixtures.
- Register source artifacts by hash and confidentiality.
- Establish issue/PR templates, IDs, statuses, owners, and definition of done.

Exit gate: clean repository and CI; confidential inputs absent; all known
evidence registered; project owner approves private repository access.

## Phase 1 — Authoritative discovery freeze

Deliverables:

- Confirm whether the source is SQL Server, MySQL, both by client/version, or a
  staged PostgreSQL conversion; record exact versions and dialect per object.
- Obtain/restorably verify `smart_setup`, `smart_system`, representative
  company-year data, the PostgreSQL branch, and all procedures.
- Export current menu, rights, books, masters, entries, reports, dashboards,
  help, documents, custom fields, key metadata, and update/version rules.
- Inventory 322 Crystal reports/templates and canonical outputs.
- Convert 1,977 license checks, 91 license IDs, company/database branches, and
  custom report folders into a client-override registry.
- Capture a running legacy environment, supported versions, roles, keyboard
  paths, screenshots, input/output examples, and golden tenant datasets.
- Map every menu/button/action to code, metadata, SQL, procedure, table, output,
  permission, client override, and side effect.

Exit gate: authoritative feature/object/override registries reconcile to source
counts; every gap has an owner/dependency; no “unknown SQL” remains on the
critical vertical-slice path. The restored PostgreSQL input enables the
`smart_setup` and company-schema portions of this gate, but does not close the
`smart_system`, source-dialect, routine, or effective-client-override portions.

## Phase 2 — Architecture and domain decisions

Deliverables:

- Approve tenancy/cell isolation ADR and company/year target model.
- Approve identity/session/RBAC model and migration/reset approach for legacy
  passwords.
- Define modular domain boundaries and financial posting invariants.
- Approve PostgreSQL connection roles, pooling, RLS, secrets, and audit model.
- Define metadata/query compiler, custom fields, override precedence, and
  version rollout/rollback.
- Define reporting, dashboard, print job, template, object storage, and
  retention architecture.
- Select migration runner, schema migration convention, API contracts, queue,
  observability, and deployment cell patterns.
- Define currency/precision/rounding, dates/time zones, collation, IDs,
  fiscal-year lifecycle, and data retention.

Exit gate: reviewed ADRs, target context/domain model, threat model, initial ERD,
API conventions, error model, SLO/RPO/RTO targets, and cost/capacity assumptions.

## Phase 3 — Secure platform foundation

Deliverables:

- Real identity/session lifecycle, password reset, lockout, revocation, and
  audit.
- Control-plane tenant/company/year catalog and immutable request context.
- Normalized memberships, roles, permissions, and entitlements.
- Server/API guards plus direct-route/action denial.
- PostgreSQL pool with least-privilege roles, transaction-scoped context, RLS,
  secrets, TLS, timeouts, and safe error redaction.
- Audit/outbox, background worker, job state, idempotency, correlation IDs,
  structured logs/metrics/traces.
- Synthetic fixture factory and disposable PostgreSQL CI environment.
- Company/year selection that is authorized and idempotent.

Exit gate: end-to-end authenticated shell with no mock credential/data path;
cross-tenant and privilege-escalation suites pass; context leakage/pool reuse
tests pass; backup and isolated restore of the foundation schema succeed.

## Phase 4 — Database migration and compatibility toolchain

Deliverables:

- Secure archive inspection/restoration and object registry.
- Source-to-target type/collation/date/money/key mapping.
- Canonical schema migrations with tenant-aware constraints and RLS.
- Legacy compatibility routing adapter, strictly server-catalog controlled.
- Versioned metadata/query compiler and output contract registry.
- Procedure intake/classification and static/differential harness.
- Resumable data mover, checkpoint ledger, quarantine/repair workflow, and
  reconciliation reports.
- Captured workload and explain-plan/index review tooling.

Exit gate: representative schemas/data migrate repeatedly from clean state;
schema/object diffs and reconciliation pass; failure can resume/rollback; no
unreviewed routine or SQL fragment has runtime permission.

## Phase 5 — Five pattern-setting vertical slices

Implement in order, reusing the platform rather than creating one-off paths:

1. Addon Master: persistent CRUD, lookups, validation, custom-field foundation,
   audit, concurrency, permissions, legacy/modern UI.
2. Account Master: 87 standard plus client fields, query compiler, address/
   balance joins, update behavior, field ordering, client overrides.
3. Representative financial entry: posting, balances, tax/add-ons, edit/delete,
   idempotency, rollback, print trigger.
4. Representative report: typed parameters/output, totals/order/filters,
   drilldown/export, heavy-job path, client variant.
5. Representative invoice print: job-scoped snapshot, template/version,
   renderer, golden artifact, concurrent runs, delivery/retention.

Exit gate: all five satisfy the full definition of done for at least two
representative tenants/years and roles; patterns/SDKs/templates are documented;
architecture review authorizes scaling out.

## Phase 6 — Security, setup, and master-data wave

Scope:

- User, role, menu/book/company/year/dashboard rights.
- Company, year, books/series, parameters, tax/GST/email/document setup.
- Account, product, address, balance, groups, units, tax/slab, price/cost/formula,
  discount/scheme/target/commission and remaining generic masters.
- Opening balances and year/prior-year behavior.
- Metadata help/lookups, imports/exports, logs, and client custom fields.

Exit gate: every master/setup menu and control mapped and flow-tested; CRUD,
uniqueness, history, concurrency, permission, import/export, audit, and client
variant parity signed off.

## Phase 7 — Transaction and posting wave

Scope:

- Invoice/voucher, cash/bank, receipt/payment, journal, discount/allocation,
  interest JV, bank/book transfers.
- Orders, challans, stock vouchers/journals, transport, production planning,
  formula/manufacturing, approvals, document upload.
- E-invoice/e-way bill entry-side integration, cancellation, edit/delete,
  repost, duplicate prevention, period/data locks.
- Posting, ledger/product ledger, balances, stock/tax effects, and audit.

Exit gate: every transaction state/action has invariants, balanced accounting
proof, rollback/idempotency/concurrency tests, negative permissions, old/new
differential data, and representative tenant UAT.

## Phase 8 — Reports, inventory, GST, analysis, and dashboards

Scope:

- Cash/bank/reconciliation, journal/register, ledger/outstanding.
- Trial balance, profit/loss, balance sheet, annexures, interest/reminders.
- Stock/rate/product/price/challan/order/ageing/loading/physical/movement/
  valuation reports.
- GST reports/utilities, e-invoice/e-way bill reporting and exports.
- Multi-company/year, budget, tax, gross-profit, sales/product/party/commission
  analysis.
- Dashboard cards/grids/charts/filter/drilldown/user customization.
- PDF/Excel/JSON/XML/print/email and other supported delivery.

Exit gate: every report contract has filters/types/order/totals/rounding,
permission and client override tests; golden results/artifacts pass; report
cost, concurrency, cache isolation, and peak-period SLOs pass.

## Phase 9 — Utilities, documents, integrations, and operations

Scope:

- All invoice/document templates and print/delivery channels.
- Backup/restore, repost, year open, balance transfer, renumber, lock/unlock.
- Excel/Tally and other file/external integrations.
- Multiple invoice PDF, product images, logs/reminders/tokens.
- Destructive-operation approvals, maintenance windows, retries, and recovery.

Exit gate: job/audit/idempotency and permission controls pass; golden documents
and integration contract tests pass; backup/PITR/restore, year-close/open, and
operational runbooks are proven in rehearsal.

## Phase 10 — Client override closure

Deliverables:

- Migrate every active license/company/database/query/report/template branch to
  a versioned override or intentionally retire it with approval.
- Define effective dates, precedence, owner, fallback, validation, and rollback.
- Run each supported client/year regression pack and UAT.
- Remove hard-coded client/schema/year conditions from common runtime code.

Exit gate: override registry reconciles with all discovered branches and
artifacts; zero unexplained client differences; each active override has passing
tests and a named owner.

## Phase 11 — Non-functional hardening and release qualification

Deliverables:

- Accessibility, keyboard, responsive, supported browser/device qualification.
- Peak-period, concurrent-tenant, report, import, print, and pool load tests.
- Threat model, dependency/code/secret scanning, injection, RLS/isolation,
  privilege, session, export, and audit review.
- Failure/chaos tests for database/network/worker/object storage/integration.
- Backup/PITR/restore and disaster-recovery exercises against declared RPO/RTO.
- Observability dashboards, actionable alerts, on-call/support, data quality,
  capacity/cost and incident runbooks.

Exit gate: SLO/security/recovery/accessibility gates pass; no critical/high
release blockers; operations and support sign off.

## Phase 12 — Pilot, progressive cutover, and retirement

Steps per tenant/company/year:

1. Rehearse full migration and record duration/differences.
2. Complete UAT and accounting/report/document signoff.
3. Announce freeze/support/rollback windows.
4. Final sync under a short source write freeze.
5. Reconcile and execute explicit go/no-go.
6. Route through the control catalog; monitor canary metrics/audit/data quality.
7. Stabilize and obtain signed acceptance before the next cutover.
8. Retain legacy read-only access for the approved period.
9. Export/archive, revoke credentials, remove routes/jobs, and decommission with
   an auditable record.

Program exit gate: all supported tenants/years are live and reconciled; legacy
is read-only then retired; retention/audit obligations are met; unresolved
backlog is explicitly transferred to post-migration product ownership.

## Tracking and reporting

Weekly program reporting uses counts, not subjective percentages:

- controls/flows discovered, implemented, flow-tested, UAT, live;
- database objects classified/converted/parity-tested/live;
- 283 initial routine signatures resolved;
- client overrides discovered/active-tested/retired;
- reports/templates inventoried/golden-tested/live;
- tenants/companies/years rehearsed/reconciled/live;
- open blockers by age/owner/critical path;
- test pass rate, parity differences, escaped defects, SLO/security findings.

Status advances only when the linked evidence for that gate exists.

## Critical external dependencies

- Confirmation and artifacts for the real source database engine(s).
- `smart_system`, current menu/metadata, PostgreSQL branch, remaining routines,
  all client override/query/template sets.
- Running legacy environment and business/accounting subject-matter experts.
- Representative client/year data under an approved confidentiality process.
- Decisions on supported clients/features, hosting/residency, SLO/RPO/RTO,
  identity provider, integrations, and template/rendering technology.
