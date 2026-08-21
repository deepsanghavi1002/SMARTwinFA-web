# Database migration plan

## Baseline decision gate: identify the real source dialect

Current evidence conflicts:

| Evidence | Dialect/state |
|---|---|
| Inspected C# legacy branch | SQL Server/T-SQL (`SqlClient`, `.dbo`, `TOP`, `ISNULL`, `CONVERT`, SMO, MDF/LDF) |
| User migration description | MySQL to PostgreSQL |
| Two supplied “.sql” files | PostgreSQL custom-format archives, already containing converted objects/data |
| Procedures inside `smart_setup` archive | PostgreSQL wrappers with substantial T-SQL still embedded in dynamic text |

The program must maintain an object registry with `source_engine`,
`source_version`, `source_object`, `target_object`, `conversion_status`, and
`evidence`. No blanket MySQL conversion or acceptance of dumped PostgreSQL
routines is allowed until this registry resolves the dialect per object.

## Verified intake progress — 2026-08-21

The two supplied PostgreSQL archives have been restored only into the local,
isolated `smartwin_data_intake` database. The restore is physically healthy;
the evidence and archive hashes are in
[the restore report](../intake/postgres-local-restore-2026-08-21.md).

A repeatable, aggregate-only extractor now produces the committed
[sanitized metadata catalogue](../intake/postgres-metadata-catalog-2026-08-21.json):

```text
node scripts/export-postgres-intake-catalog.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

It records table/column/constraint counts plus safe metadata totals and the
Account Master structural contract. It does not export client rows, raw SQL,
routine bodies, password values, or connection configuration. The command is
local discovery tooling, not an app runtime dependency and not a CI database
test.

This evidence makes the following work executable now:

1. extract the complete sanitized program/menu/key dependency graph;
2. profile Account Master candidate keys, duplicates, orphans, money, dates,
   flags, and add-on participation;
3. convert reviewed metadata into typed target definitions and contract tests.

It does **not** authorize any production migration, procedure execution, raw
query reuse, or Account Master write path. `smart_system`, source-dialect
authority, routine behavior, and effective client override evidence are still
required for those steps.

## Target data boundaries

- Control plane: tenants, deployment cells, companies, accounting years,
  identities/memberships/permissions, entitlements, definition versions,
  routing, migration state, and document/report template catalog.
- Canonical data plane: tenant/company/year-scoped accounting, inventory,
  tax, transaction, document, and audit records.
- Metadata definitions: versioned screen, field, query, action, entry, report,
  dashboard, help, and override manifests.
- Compatibility catalog: temporary mapping from stable IDs to legacy
  database/schema/table/routine names.

The target does not create a new schema/database for every accounting year.
Large tables may be partitioned only after workload measurement. PostgreSQL's
[row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
and [declarative partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
are design tools, not substitutes for application authorization or evidence-
based physical design.

## Phase 1: secure intake and reproducible inspection

1. Quarantine every source dump/query/procedure outside Git.
2. Record SHA-256, size, owner, tenant/company/year, capture time, engine,
   version, encoding/collation/SQL mode, and retention.
3. Install matching PostgreSQL client tools in a disposable environment.
4. Use `pg_restore --list` first. Do not use create/clean/drop behavior against
   a shared or production database. PostgreSQL documents selective archive
   restore in [`pg_restore`](https://www.postgresql.org/docs/current/app-pgrestore.html).
5. Restore catalog/schema and data only to explicitly named disposable targets
   with no network path to production.
6. Extract sanitized object manifests and column/routine contracts.
7. Rotate any credential represented in an intake artifact.

Exit gate: all inputs are registered, reproducible, isolated, and absent from
Git/logs; the source dialect/version is known or explicitly blocked per object.

## Phase 2: complete discovery and lineage

Obtain and catalog:

- `smart_setup`, `smart_system`, and representative company-year stores;
- current menu, entry, master, report, dashboard, help, book, security, document,
  custom-field, and key metadata;
- the PostgreSQL migration branch and all stored procedures/functions;
- authoritative MySQL DDL/data dictionary if a MySQL system exists;
- C#/XML/runtime query builders and `|sys.*|` replacement behavior;
- license/company/database-to-feature and report/template mappings;
- representative golden data and reports for each major flow.

For every UI action, build lineage:

```text
flow/control ID → legacy form/menu/metadata ID → query/routine/template
→ read/write tables and fields → target command/query → permission
→ tests and reconciliation evidence
```

Exit gate: 100% of current menu/actions and known database objects have an
owner, classification, dependency graph, source dialect, target decision, and
status.

## Phase 3: schema conversion and integrity recovery

Create an explicit mapping for each column and behavior.

### MySQL concerns, if confirmed

- unsigned ranges and identity allocation;
- `AUTO_INCREMENT`, `tinyint(1)`, enum/set, zero dates, implicit casts;
- charset/collation and case sensitivity;
- `ON DUPLICATE KEY`, date/string functions, delimiters, and result sets;
- SQL mode-dependent grouping/null/truncation behavior.

### SQL Server concerns already evidenced

- three-part/cross-database names and `.dbo` qualification;
- `TOP`, `ISNULL`, `CONVERT`, `CHARINDEX`, `OUTER APPLY` and assignment SELECT;
- temp/global/fixed result tables and multiple result sets;
- SMO, `sa`, attach/detach, MDF/LDF, catalog/system procedures;
- implicit conversions, identity behavior, bit/money/datetime/collation;
- dynamic SQL, XML batch writes, and client schema/database interpolation.

### PostgreSQL dump concerns

- Convert `money` to reviewed `numeric(precision, scale)` plus currency where
  multiple currencies are possible.
- Classify each timestamp as a business-local wall time/date or a UTC instant;
  do not mechanically change every `timestamp without time zone`.
- Map `English_India.1252` to an available deterministic encoding/collation and
  test ordering/equality on real edge cases.
- Add identities/defaults only after verifying legacy key allocation/imports.
- Add composite tenant-aware keys and FKs after duplicate/orphan analysis.
- Convert coded flags to constraints/reference values deliberately.
- Design indexes from captured query/workload evidence.

Use expand/migrate/contract changes. Record any invalid legacy row in a
quarantine table with source ID, rule, decision, approval, and final mapping.

Exit gate: schema diff and data-profile checks are clean; every proposed
constraint is proven; unresolved data is quarantined with owners.

## Phase 4: metadata query/view compiler

Implement [ADR-002](../architecture/adr-002-query-customization.md). Each view
has a typed manifest, deterministic override precedence, bound parameters,
explicit output contract, permission, owner, and golden results.

Account Master is the first proof:

- verify `program_top` key and all ordered `program_body` rows;
- verify every tenant `addon_fld` projection and field type;
- remove hard-coded year/schema values and qualify columns;
- bind tenant/company/accounting-year values;
- compare ordered columns, rows, nulls, duplicates, sort, and performance;
- test field add/change/disable and standard/client precedence.

Exit gate: every migrated view has an active compiled definition, contract
hash, tenant isolation test, golden result, and rollback version. Program-level
exit requires 100% view registry coverage.

## Phase 5: routines and business rules

Follow [procedure intake](procedure-intake.md). Classify each signature as
domain command, query, report, maintenance job, compatibility adapter, or
retired. Replace broad dynamic report procedures with reviewed read contracts
where possible. Replace fixed scratch/result tables with scoped rows or returned
sets suitable for pooled connections.

Exit gate: every known signature is rewritten and tested, deliberately retired
with call-graph evidence, or blocked on a named missing input. No unreviewed
routine has runtime permission.

## Phase 6: repeatable data movement

Build a resumable migration runner with:

- immutable migration/version/checksum ledger;
- cell/tenant/company/year and source snapshot IDs;
- checkpoints, retries, idempotent transforms, and bounded batches;
- preserved legacy IDs or explicit collision mapping;
- validation/quarantine counts at every stage;
- optional change capture only after source semantics are understood;
- final write freeze and deterministic delta reconciliation.

Avoid two writable systems. Dual-read comparisons are useful; dual-write for
accounting data risks split-brain and is not the default strategy.

## Reconciliation matrix

Every tenant/company/year migration checks:

- table rows and key ranges;
- duplicate natural keys and orphan relationships;
- null/empty/zero distributions and coded flag domains;
- date/time ranges, fiscal boundaries, and ordering/collation samples;
- debit/credit, opening/closing, tax, stock quantity/value, outstanding, and
  report-specific totals using explicit rounding rules;
- per-table or stable ordered chunk hashes where semantics permit;
- custom fields and client overrides;
- routine/query result contracts;
- representative reports, exports, and printed documents;
- unauthorized/cross-tenant visibility.

Differences are classified as expected transformation, legacy defect repaired,
target defect, source drift, or unresolved. A human accounting owner signs
financial reconciliation.

## Performance, recovery, and cutover

- Capture representative interactive, reporting, period-close, import, and
  printing workloads before index/partition decisions.
- Test pool saturation, concurrent tenants, expensive reports, locks/deadlocks,
  vacuum/analyze, backup, PITR, and isolated restore.
- Canary one tenant/company/year at a time through catalog routing.
- Final sync uses a short write freeze, reconciliation, explicit go/no-go, and
  rollback criteria.
- Stabilize and sign off before routing the next tenant.

See [cutover runbook](../operations/cutover-runbook.md).

## Immediate blockers

- Missing `smart_system` archive.
- Missing authoritative MySQL artifacts or confirmation that SQL Server is the
  actual source.
- Missing promised PostgreSQL branch and future stored procedures.
- Missing current menu and effective client query/report/template sets.
- Missing a running legacy environment and representative golden fixtures.
