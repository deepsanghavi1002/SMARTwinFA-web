# Current-state inventory

Last updated: 2026-08-24 (verified by the
[migration gap audit](migration-gap-audit-2026-08-24.md) at web commit
`000b150`).

## Web baseline

The repository carries the latest tracked web workspace from legacy branch
`web-project`, commit `b3970e94991824574fd2106764e1b3e95e377c9e`, on top of
the earlier 26-commit prototype history.

| Capability | State | Notes |
|---|---|---|
| Build/runtime | Prototype | React 19, TypeScript, Vinext, Vite, Cloudflare Worker-compatible build, Node 22.13+ |
| Legacy/modern view toggle | Prototype | Present on startup and application surfaces |
| Login | Mock | In-memory credential check; no production identity/session controls |
| Company/year selection | Mock | UI selection only; chosen context is not securely propagated |
| Navigation shell | Prototype | 9 groups, 49 visible labels, responsive desktop/mobile behavior |
| Home/splash | Prototype | Branded home navigation and contact presentation |
| Addon Master | Prototype | 8 groups, 27 fields, in-memory CRUD/lookup/validation/print/refresh |
| Other menu workflows | Placeholder | Selecting an item changes shell state but does not implement the feature |
| PostgreSQL persistence | Not started | D1/SQLite starter scaffolding was removed to avoid the wrong target |
| Authentication/RBAC | Not started | Menu rights and direct API enforcement are not implemented |
| Multi-tenancy | Not started | No tenant boundary, RLS, connection routing, or scoped cache |
| Automated checks | Baseline | Lint, type-check, production build, and rendered login/application-surface checks pass |

The current build must not be publicly exposed. Window chrome controls are
decorative, all data is ephemeral, print invokes the browser directly, and
refresh only updates a local status message.

## Legacy application size

The active legacy solution is a Windows Forms/.NET Framework 4.8 application:

| Area | Inventory |
|---|---:|
| Solution projects | 6 |
| Compiled C# | 129 files, approximately 172,473 lines |
| Active non-designer UI/controller files | 41 files, approximately 143,791 lines |
| Active designers | 43 |
| Crystal report files | 322 |
| Approximate unique report basenames | 214 |
| Active SQL literals | approximately 1,873 |
| `|sys.*|` token occurrences | 1,429 |
| SQL Server `.dbo.` references | 2,237 |
| Static menu snapshot | 400 items, approximately 350 leaves |
| Dynamic menu action codes | 45 |

The largest controllers are `Entry.cs` (about 41.6k lines),
`Report_Combine.cs` (28.3k), `Small_Entry.cs` (18.5k),
`Master_ProgramGrid.cs` (13.0k), and `Main_Menu_New.cs` (7.1k). A
form-by-form rewrite would conceal business rules and is not an acceptable
migration strategy.

## Legacy runtime model

```text
startup
  → read connection.ini and open server connection
  → load smart_setup metadata
  → authenticate user
  → select accounting year and company
  → resolve company-year database/schema from smart_system
  → load rights, books, documents, dashboard, and setup metadata
  → build the menu dynamically
  → open generic master, entry, report, dashboard, or special-purpose shell
  → compose and execute metadata/client-specific SQL
```

`smart_setup` is application-definition metadata. `smart_system` holds users,
rights, company/year routing, dashboard configuration, and shared print
staging. The company-year data store holds accounting and inventory masters,
transactions, configuration, add-on fields, and document definitions.

The legacy process stores user, company, accounting year, database name,
rights, dates, and other request context in static/global variables. That model
is unsafe in a concurrent web process and must not be carried forward.

## Metadata-driven product surface

The WinForms classes are generic shells around database metadata:

- Menus come from hierarchy and rights metadata.
- Master grids come from `program_top`, `program_body`, query/table/key
  metadata, and add-on definitions.
- Entries come from entry/control/event/grid/save/help metadata plus embedded
  special-case code.
- Reports come from report/control/output/fixed-column metadata, SQL, and
  Crystal templates.
- Dashboards come from component/layout/query/drilldown definitions and
  per-user visibility/order.
- Printing chooses a document template, builds result data, and stages it in
  shared tables.

Metadata is therefore executable application source and needs versioning,
review, testing, provenance, and deployment controls.

## Client customization footprint

The inspected C# contains approximately 1,977 comparisons against
`Smartwinfa_License`, covering 91 distinct numeric IDs, plus roughly 49
database-name conditions and 38 company-name/short-name conditions. Custom
report folders and templates add another layer. These branches must become
explicit tenant overrides with owners, versions, effective dates, tests, and a
retirement path.

## Critical facts — resolved 2026-08-24

The [migration gap audit](migration-gap-audit-2026-08-24.md) resolved the
previously blocking questions against the running legacy installation.

1. The inspected C# is SQL Server/T-SQL (`System.Data.SqlClient`, `.dbo`,
   `TOP`, `ISNULL`, `CONVERT`, SMO, `sa`, MDF/LDF operations). **Confirmed by
   the runtime:** SQL Server 2008 R2 (archive instance, 148 databases) and
   SQL Server 2022 Express (active instance, 32 databases) are both running.
2. **No MySQL exists.** No service, client, server, or data directory is
   present anywhere on the authorized workstation. "MySQL migration" is
   terminology, not a source engine.
3. Both originally supplied database files are PostgreSQL custom archives; a
   third (`smart_system`) has since been supplied and restored.
4. **`smart_system` is live**, not missing: 25 tables, 25 primary keys,
   26 procedures. Current `MenuMaster` data is live (592 rows). A PostgreSQL
   conversion covering 328 routines exists on the legacy workstation
   (`SRC-PG-001`…`SRC-PG-003`).
5. **Company-year data are separate physical databases** named
   `<CLIENT>_<YY>`, with optional `_BIGLOG` and `_IMAGE` companions — not
   schemas inside one database.
6. **The populated rights store is `smart_setup`, not `smart_system`.**
   `SMART_SETUP.SECURITY` holds 465 rows and `SMART_SETUP.USER_MASTER` holds 8,
   while `SMART_SYSTEM.SECURITY` and `SMART_SYSTEM.LOGIN` are empty. The legacy
   runtime model described above must be read with this correction, and
   `ARCH-005` and `SEC-WAVE-001` planned accordingly.
7. **The PostgreSQL archives lost every integrity object.** A representative
   company-year database carries 72 primary keys, 164 unique indexes, and 82
   identity columns in SQL Server, and none of them survive in the archive,
   which is also missing 3 tables. Foreign keys and check constraints are
   genuinely absent from both.

Remaining engine work is object-by-object dialect classification, not
source-engine discovery. Client query sets and the balance of the routines are
still outstanding.

## Unmerged platform work

Two branches carry roughly 15.7k lines that `main` does not have:
`codex/metadata-contract-foundation` and `codex/source-engine-confirmation`.
They add a `platform/` layer (context resolution, RBAC, session lifecycle,
scoped transactions, audit, jobs, metadata registry, custom fields), profiling
scripts, and `docs/intake/` evidence including an isolated PostgreSQL 18.6
restore of all three archives.

No module under `app/` or `features/` imports any of them, so under the
[definition of done](../migration/definition-of-done.md) they are
`unit-tested` — not integrated, and not production-implemented. They must be
merged or explicitly closed before further platform work begins.
