# Local PostgreSQL restore evidence

The two supplied PostgreSQL custom archives were restored on 2026-08-21 into
the isolated, local-only database `smartwin_data_intake` on PostgreSQL 18.6.
No archive, client row, credential, password value, server address, or routine
body was copied into Git.

## Provenance and restore treatment

| Archive | SHA-256 | Source | Treatment |
|---|---|---|---|
| `rishabh_plastic27_backup.sql` | `ed0124bb02497f397b874370fdbdac9d27febf90f6b677b63585a717398d8d6f` | PostgreSQL 18.4, dumped by 18.3 | Restored without source ownership or ACLs |
| `smart_setup_postgres_pc.sql` | `e3cb5c1dea3f264f8152c734889c1b26319ef8c57e43eea34e8db3d74ca5768b` | PostgreSQL 18.4, dumped by 18.3 | Restored without source ownership or ACLs |

The source used the Windows `English_India.1252` monetary locale, which is not
available on this Mac. During the data stream only, fields matching the exact
tab-delimited Windows money forms `? 1,234.56` or `?- 1,234.56` were converted
to locale-neutral numeric text before PostgreSQL parsed the existing `money`
columns. The archives were not modified. The company archive required 786,311
field conversions and `smart_setup` required 2,630. Financial parity still
requires independent totals and row-level reconciliation.

## Verified catalog

| Measure | `rishabh_plastic27` | `smart_setup` |
|---|---:|---:|
| Tables | 75 | 37 |
| Columns | 1,864 | 940 |
| Exact rows | 705,743 | 146,964 |
| Empty tables | 22 | 2 |
| `money` columns | 83 | 8 |
| Views | 0 | 0 |
| Sequences | 0 | 36 |
| Primary keys/indexes | 0 | 36 |
| Foreign keys | 0 | 0 |
| Triggers | 0 | 0 |
| Procedure signatures | 0 | 283 across 282 names |

The procedure-name set exactly matches the received PostgreSQL conversion
file. `sp_frt_rpt_document_upload` is the single overloaded name and accounts
for the additional live signature. Of the 283 stored definitions, 148 contain
TODO markers and 127 contain the currently detected residual T-SQL patterns.
Loading a PL/pgSQL definition with `check_function_bodies` disabled does not
prove dependency resolution or behavior parity.

PostgreSQL `ANALYZE` completed, all restored indexes are valid and ready, all
constraints are validated, and a temporary `amcheck` installation completed
without reporting heap or B-tree corruption. The extension was removed after
the check. The restored database is approximately 161 MB.

## Migration consequences

1. The 19 static procedure candidates can now advance to dependency and
   rollback-only contract tests against the restored schemas.
2. Company-table keys and relationships must be inferred from metadata and
   behavior, profiled for duplicates/orphans, and reviewed before adding target
   constraints; the archive supplies no company primary or foreign keys.
3. `smart_setup` metadata can now be inventoried and linked to screens, fields,
   actions, queries, and procedures without committing its rows.
4. `smart_system` is absent from both archives. Users, permissions, companies,
   accounting years, routing, dashboards, and shared print staging remain
   blocked until its archive or schema/configuration export is supplied.
5. No procedure may run outside a rollback-only test harness until its dynamic
   SQL, tenant scope, transaction behavior, and write set are reviewed.
