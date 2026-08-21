# Test and parity strategy

## Quality rule

Every interactive control, keyboard shortcut, API action, job, report, database
rule, and client override receives a stable ID and automated evidence. A test
that only checks a screen renders does not validate its flow.

Next.js distinguishes unit, component, integration, end-to-end, and snapshot
tests and recommends browser end-to-end coverage for complete user flows; see
the official [testing guide](https://nextjs.org/docs/app/guides/testing). The
SMARTwinFA suite uses all relevant layers plus legacy differential testing.

## Traceability chain

```text
requirement/flow
  → menu/screen/control ID
  → role and tenant/company/year scope
  → API/domain command or query
  → database tables/routines/rules and audit event
  → client override/template
  → unit/component/integration/E2E/parity/performance/security evidence
  → UAT and release
```

No tracker item closes with a broken link in this chain.

## Test layers

### 1. Static and repository gates

- Clean dependency install and lockfile consistency.
- Lint, TypeScript, production build, package/container configuration.
- Secret/credential/client-data and dependency/code scanning.
- Migration checksum and generated-artifact drift checks.
- Metadata/query manifest schema, identifier, parameter, permission, and output
  contract validation.

### 2. Domain unit tests

Table-driven tests for:

- debit/credit/posting, balance and stock invariants;
- tax/GST/slab, discounts, interest, costing, valuation, allocations;
- currency precision and rounding at each documented boundary;
- fiscal periods, year transitions, dates/time zones, locks;
- permissions and entitlement policy decisions;
- custom-field validation and override precedence;
- migration transformations and reconciliation classification;
- idempotency and state machines for entries/jobs/documents.

Use synthetic cases, including zero, negative, maximum precision, duplicate,
null/empty, boundary dates, stale version, and invalid state transitions.

### 3. Component tests

For each form/control:

- labels, instructions, defaults, masks, required/optional fields;
- keyboard/touch/mouse paths, focus order, help/autocomplete;
- validation, disabled/forbidden/loading/empty/error/conflict/success states;
- add/update/delete/cancel/reset/search/filter/sort/page/select actions;
- responsive legacy/modern presentation without changing business semantics;
- accessible name, role, state, alerts, and error associations.

### 4. PostgreSQL integration tests

Run migrations from empty state in a disposable PostgreSQL database, then test:

- primary/unique/foreign/check constraints and typed values;
- transactions, rollback, locking, optimistic concurrency, idempotency;
- RLS default-deny, forced policy behavior, background-worker context, and
  cross-tenant references;
- repository queries, metadata compiler output, routines, read models;
- timeout/error handling and pool context cleanup;
- audit/outbox atomicity;
- migration rerun, checkpoint resume, quarantine, and rollback/repair.

Tests use runtime roles, not database owner/superuser shortcuts.

### 5. API and contract tests

- Request/response, error, pagination, version, and idempotency contracts.
- Direct action attempts when UI hides a control.
- Role/company/year permission matrices.
- Metadata query parameters and ordered typed output columns.
- Backward compatibility during expand/migrate/contract releases.
- External integrations with deterministic fakes and provider sandbox tests.

### 6. Browser end-to-end tests

Use Playwright or the team-approved equivalent against a production build and
disposable PostgreSQL. Generate/scaffold cases from the control registry.

For every control:

- authorized happy path;
- invalid/empty/boundary input;
- forbidden role/direct URL or action;
- persistence/refresh/relogin verification;
- cancellation/back/navigation and unsaved-change behavior;
- duplicate submission/concurrent/stale edit where applicable;
- audit/report/print/downstream side effect;
- desktop and mobile; keyboard for all critical flows.

Current seed coverage is in [control-coverage.csv](control-coverage.csv).

### 7. Legacy differential tests

For each supported tenant/company/year and flow, run identical inputs against a
version-pinned legacy environment and the new system. Compare:

- ordered fields/rows, labels/types/null/empty semantics;
- insert/update/delete and all related postings/balances/stock/tax;
- validation and error/empty behavior;
- totals, ordering, grouping, drilldowns, exports;
- PDF/printed content using canonical normalized text plus approved visual
  snapshots;
- client-specific queries/templates/rights and effective dates.

Differences require classification and accounting/product approval; snapshots
are never updated only to make CI green.

### 8. Migration and reconciliation tests

- Restore/intake safety and source hash verification.
- Schema/object and routine registry reconciliation.
- Repeatable bulk migration, failure resume, delta/final sync.
- Row/key/null/date/flag distributions, relationships, stable hashes.
- Debit/credit, opening/closing, tax, stock, outstanding, report totals.
- Duplicate/orphan quarantine and repair audit.
- Write-freeze, go/no-go, rollback, and re-run rehearsal.

### 9. Security tests

- Cross-tenant/company/year read/write/export/report/print/job/cache/object denial.
- Horizontal/vertical privilege escalation and direct API access.
- SQL injection in values, filters, sorts, identifiers, metadata, file imports.
- Session fixation/revocation/timeout/lockout/reset and CSRF where applicable.
- Secret/PII redaction in errors/logs/traces/audit and generated outputs.
- RLS/search-path/security-definer and database role review.
- Malicious files, formula injection in spreadsheets, export/download access.

### 10. Performance, resilience, and operations

- Interactive latency and throughput by operation class.
- Concurrent tenants and noisy-neighbor fairness.
- Peak invoice entry, period close, large ledgers/reports, imports, print jobs.
- Pool saturation, locks/deadlocks, queue backlog, worker crash/retry.
- Database/network/object-store/integration degradation and recovery.
- Backup/PITR/restore/failover duration against RPO/RTO.
- Migration and canary monitoring/data-quality thresholds.

## Test data and environments

| Environment | Data | Purpose |
|---|---|---|
| Unit/component | Generated only | Fast deterministic rule/UI checks |
| CI integration | Synthetic disposable PostgreSQL | Migrations, RLS, repositories, API, E2E |
| Parity | Access-controlled restored/sanitized copies | Differential and reconciliation evidence |
| Performance | Generated volume shaped from production statistics | Capacity/load without exposing client rows |
| Pilot | Approved tenant copy/live canary | Final UAT/cutover evidence |

Fixtures encode their tenant/company/year and must contain at least two tenants
to make isolation failures observable. Production rows never enter Git,
screenshots, test reports, or general logs.

## Current prototype gate

Today the repository verifies lint, TypeScript, production build, and
server-rendered SMARTwinFA shell/application wiring. It does not yet claim
interaction, persistence, database, permission, or parity coverage. The first
test-platform work adds browser tests for:

1. legacy/modern toggle;
2. invalid and valid login;
3. company/year selection and exit/back;
4. all menu controls on desktop/mobile and home reset;
5. every Addon Master field/action/validation/lookup branch;
6. decorative/no-op window controls are removed, disabled with explanation, or
   intentionally implemented.

## Release evidence and defect policy

- CI artifacts include test versions, definition/migration hashes, seed ID, and
  failure diagnostics without secrets/data.
- Flaky tests are release failures; quarantine requires an owner, reason,
  expiry, and replacement coverage.
- A production defect adds a minimal regression fixture/test before closure.
- Financial, tenant-isolation, authorization, migration corruption, or
  unrecoverable print/export disclosure defects block release.
- Coverage is reported as traced controls/objects/variants at each gate, not a
  single code-coverage percentage.
