# PostgreSQL Migration Status

- Current migration branch: none found in the scoped workspace.
- Latest migration commit/history: none found.
- PostgreSQL scripts/converted objects: none found.
- Known source engine: SQL Server; destination requested: PostgreSQL.
- MySQL artifacts: none found.

## Unresolved dialect work

Convert SQL Server database qualification and `dbo` schemas, identifiers,
`nvarchar`/`nvarChar`, `datetime`/date formatting, `SqlDbType`, identity and
sequence behavior, table-valued parameters, stored procedures, temporary table
cleanup, `sys.indexes` checks, T-SQL functions, transaction/error semantics,
cross-database routing, and Crystal query bindings. These conversions require
the missing source definitions and parity fixtures.

## Remaining work

Extract source schema/routines/metadata; create reviewed PostgreSQL DDL and
routine replacements; map tenant/company/year context; migrate data with
reconciliation; replace dynamic report SQL and Crystal delivery; and record
failures and golden-output comparisons in a versioned migration repository.
