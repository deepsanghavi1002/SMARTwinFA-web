# SMARTwinFA Migration Intake

## Purpose

This package is the provenance-preserving intake for migrating the legacy
SMARTwinFA WinForms application to a web application backed by PostgreSQL. It
was prepared from the current workspace `e:\SMARTwinFA` only. Existing source
files remain in their original locations; this package indexes them rather than
duplicating or rewriting them.

## Repository and history

- Observed source repository remote: `https://github.com/pranavcomputers/SMARTwinFA.git`
- Requested target repository: `deepsanghavi1002/SMARTwinFA-web`
- Observed local branch: `main`
- Observed local HEAD: `ad09f99042400896a8fc620a88fcd56bd9ab6693`
- Observed local migration branches: none
- Target remote verification and push: blocked because the configured remote is not the requested target and GitHub authentication was not available in the workspace session.

## Engine conclusion

The legacy application is SQL Server-specific, not MySQL or PostgreSQL. It uses
`System.Data.SqlClient`, `SqlConnection`, `SqlCommand`, SQL Server database and
schema notation, T-SQL functions, SQL Server data types, stored procedures,
table-valued parameters, and Crystal Reports SQL Server logon. PostgreSQL is
the requested destination. No MySQL implementation was found. PostgreSQL DDL
and conversion scripts are not present in this workspace.

## Included evidence

- Complete legacy source map and project boundaries: `source-engine-and-database-map.md`
- Database and schema evidence, plus missing authorized exports: `schema/`
- Stored-procedure callers, dynamic SQL, and routine inventory: `routines/`
- Metadata sources and required sanitized exports: `metadata/`
- Hard-coded/license/client-variant registry: `client-overrides/`
- Five migration contract slices: `vertical-slices/`
- Crystal Reports and document/template inventory: `reports-and-printing/`
- PostgreSQL migration status and dialect gap list: `postgres-migration/`
- Confirmed and unresolved business rules: `business-rules.md`
- Restricted-artifact transfer register: `secure-transfer-manifest.md`
- Final scope, blockers, and handoff status: `handoff-summary.md`

## Confirmed, inferred, missing, blocked

Confirmed facts are marked from executable source, project files, configuration,
and present binary assets. Inferences are labeled and must be validated by the
migration team. Missing items include SQL Server schema/object definitions,
stored-procedure bodies, setup metadata exports, company/year databases,
protected report samples, and any PostgreSQL migration history. Push and commit
are blocked until the remote is corrected to the private target and GitHub
authentication is available.

## Security

`e:\SMARTwinFA\Connection.INI` contains a database host and password and is
excluded. No credentials, tokens, backups, raw production data, or protected
client rows are included in this package.
