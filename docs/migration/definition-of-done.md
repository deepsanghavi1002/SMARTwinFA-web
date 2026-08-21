# Definition of done

A feature is complete only when every applicable item below has linked
evidence. “Screen exists” and “procedure restored” are not completion criteria.

## Discovery and contract

- Stable backlog/flow/control IDs assigned.
- Legacy menu/form/control, metadata IDs, SQL/routines, tables, reports,
  templates, client branches, and side effects linked.
- Source dialect/version and tenant/company/year variants recorded.
- Inputs, outputs, validations, calculations, rounding, ordering, empty/error
  behavior, and concurrency expectations specified.
- Product owner/accounting expert approves the contract.

## Architecture and security

- Tenant/company/year context is server-derived and immutable.
- Permission is named and enforced in UI, API/domain, and database where
  appropriate; direct URL/API and cross-tenant negative tests pass.
- No raw request identifier/value interpolation, plaintext secret, client data,
  or unscoped cache/job/object key.
- Transaction boundary, idempotency, optimistic locking, audit event, and
  failure/rollback behavior are defined.
- Data classification, retention, and export/delete restrictions are applied.

## Database and migration

- Reviewed schema migration and rollback/repair path exist.
- Primary/unique/foreign/check invariants are validated against legacy data
  before enforcement.
- Indexes are based on query/workload evidence.
- Legacy and target IDs, null/date/money/collation mappings are explicit.
- Repeatable migration is resumable and records checksums/counts/state.
- Reconciliation passes for rows, keys, nulls, dates, monetary totals,
  relationships, and feature-specific hashes.

## Implementation and experience

- UI, API/domain, repository, and worker/report/print behavior are implemented.
- Loading, empty, success, validation, conflict, forbidden, timeout, retry, and
  unexpected-error states are accessible and understandable.
- Keyboard, mobile, responsive, and supported-browser behavior passes.
- Client overrides are versioned, deterministic, tested, and reversible.
- Logs/metrics/traces/audit are useful and redact sensitive data.

## Tests and evidence

- Unit and component tests cover rules and validation branches.
- PostgreSQL integration tests cover constraints, transactions, RLS, routines,
  repositories, and failure rollback.
- Contract tests cover API and metadata/query output shapes.
- End-to-end tests cover every control/action and important state transition.
- Legacy differential tests pass for standard and representative client/year
  fixtures, including reports/print artifacts where applicable.
- Concurrency, duplicate-submit/idempotency, permission, cross-tenant, and SQL
  injection tests pass.
- Performance/error budgets pass at expected and peak workloads.
- CI is green from a clean dependency install and disposable database.

## Release

- Documentation, runbook, monitoring, alerts, migration, backup/restore, and
  rollback are updated.
- Tenant UAT and accounting reconciliation are signed.
- Canary criteria, ownership, support, and stabilization window are defined.
- Tracker links immutable evidence and status is advanced only by an authorized
  reviewer.
