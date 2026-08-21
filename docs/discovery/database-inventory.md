# Database inventory and risk baseline

This is a non-sensitive structural inventory derived without restoring or
executing the supplied archives. Counts should be verified after an isolated
`pg_restore --list` and catalog-only restore using matching PostgreSQL tooling.

## Supplied archives

| Area | Client-year archive | `smart_setup` archive |
|---|---:|---:|
| Tables | 75 | 37 |
| Columns | 1,864 | 940 |
| Table-data streams | 75 | 37 |
| Primary keys | 0 | 36 single-column keys |
| Foreign keys | 0 | 0 |
| Check constraints | 0 | 0 |
| Secondary indexes | 0 | 0 |
| Views | 0 | 0 |
| Procedure signatures | 0 | 283 across 282 names |

Together the samples expose 112 tables and 2,804 columns. Only 191 columns are
`NOT NULL` (about 6.8%). The client schema contains 83 PostgreSQL `money`
columns and 88 `timestamp without time zone` columns.

The archives identify database `smartwin_data` and an
`English_India.1252` locale. That locale may not exist on Linux/cloud hosts and
must be mapped deliberately with collation parity tests.

The client archive contains accounting transactions and fields capable of
holding names, addresses, phone/mobile numbers, emails, PAN, GST, Aadhaar, and
banking data. `smart_setup` data includes user/security password fields and
mobile/query metadata. Neither archive belongs in Git.

## Integrity model

The samples enforce very little relational integrity in PostgreSQL.
`database_keys` stores relationship names as application metadata rather than
database foreign keys. Relationships such as `program_body.program_top_id`,
security/user IDs, and entry control ownership are not protected by foreign
keys. Legacy success therefore depends on application order, procedures,
metadata conventions, and client-specific SQL.

Constraints must not simply be added based on names. First measure duplicates,
orphans, invalid flags, missing required values, and cross-tenant collisions;
then quarantine/repair and enforce a reviewed target invariant.

## Runtime “view” model

Neither archive contains PostgreSQL `VIEW` objects. A legacy “view” is a
runtime-composed screen/grid result:

```text
screen/button
  → program_top
  → ordered program_body controls
  → query_table + query_condition
  → company/year addon_fld definitions
  → base tables or procedure
  → ordered result-column contract
```

### Account Master example

The supplied recipe says to:

1. Read `smart_setup.program_top` key `14` for `update_query`,
   `update_where`, and `update_orderby`.
2. Append 87 fixed fields from `program_body` ordered by
   `field_add_order`.
3. Append 33 client/year fields from `addon_fld.fiel_save`.
4. Apply company/year joins and filters to form the final SELECT.

The stated 87/33 row counts have not been independently verified. The recipe
also contains a hard-coded year alongside `|sys.yearid|`, unqualified `book`
and `name` references, and a likely `fiel_pos-'A'` typo. The first migrated
Account Master contract must prove field order, labels, types, joins, year
filtering, role visibility, tenant additions, and result parity.

## Procedure risk

The `smart_setup` archive includes 283 signatures:

- 202 `sp_frt_rpt_*` report procedures.
- 10 `sp_std_rpt_*` procedures.
- 11 `sp_mobile_*` procedures.
- 45 other `sp_*` procedures.
- 15 other routines.

Static evidence indicates:

| Pattern | Approximate count |
|---|---:|
| Dynamic `EXECUTE` | 254 procedures |
| `EXCEPTION WHEN OTHERS` | 234 |
| `SELECT *` | 212 |
| Table-drop behavior | 47 |
| Temporary-table creation | 27 |
| Fixed `zz_resultset_*` tables | 25 |
| `EXECUTE ... USING` | 1 occurrence despite extensive dynamic SQL |

The routine bodies retain T-SQL constructs such as `TOP`, `CONVERT`,
`CHARINDEX`, `OUTER APPLY`, and `SELECT variable = expression`. Some hard-code
client schemas, use undefined variables, reference mismatched table names, or
depend on unqualified objects while the archive clears `search_path`. Dynamic
SELECTs without `INTO` may discard results. Fixed result tables require a
follow-up query on the same session and are unsafe with web pooling/concurrency.

Every routine is therefore an unverified migration candidate. It must be
classified, rewritten or retired, and contract-tested; successful archive
restore is not evidence of business correctness.

## Initial high-risk tables and capabilities

- Account/address/balance/master tables and their dynamic add-on projections.
- Ledger, posting, product-ledger, stock, tax/slab, and year-close data.
- Entry/report metadata that controls financial side effects.
- User/security/company/year routing in missing `smart_system`.
- `document_top`, `document_body`, and `document_bottom` shared print staging.
- Mobile login/query paths that appear to handle plaintext-style passwords.
- Client-specific scratch/result tables and hard-coded schemas.

See [database migration](../migration/database-migration.md) for conversion and
reconciliation gates.
