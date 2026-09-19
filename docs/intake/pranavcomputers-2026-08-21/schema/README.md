# Schema Intake

## Present

- `e:\SMARTwinFA\SMARTwinFA\Optimize_Dashboard_Indexes.sql` is the only
  standalone schema/index SQL artifact found. It defines SQL Server index
  recommendations for `SMART_SYSTEM.USER_DASHBOARD` and
  `SMART_SYSTEM.DASHBOARD_DETAIL`, with commented recommendations for company
  `PROD_LEDGER` and `PROCESS`.
- Application SQL and object references are catalogued in `../routines/` and
  `../source-engine-and-database-map.md`.

## Not present

No SQL Server backup, schema dump, table dictionary, object definitions,
constraints, triggers, views, routine bodies, PostgreSQL DDL, or data export was
found in the scoped workspace. The migration team must obtain these from an
authorized database owner. Do not infer a schema from query strings alone.

## Required schema package

For each of `smart_setup`, `smart_system`, and every company/year database,
collect engine/version, schemas, tables, columns and types, nullability,
defaults, primary/foreign/unique keys, indexes, constraints, triggers, views,
functions, procedures, permissions, collations, identity behavior, and object
dependencies. Include row counts and sanitized samples separately.

## PostgreSQL work

No PostgreSQL conversion has been performed. The destination DDL must be
reviewed against the authorized source export and must document identifier,
numeric, date/time, boolean, identity, collation, routine, transaction, and
cross-database routing decisions.
