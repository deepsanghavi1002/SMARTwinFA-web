# Current-state inventory

Last updated: 2026-08-21.

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

## Critical unresolved facts

1. The inspected C# is SQL Server/T-SQL (`System.Data.SqlClient`, `.dbo`,
   `TOP`, `ISNULL`, `CONVERT`, SMO, `sa`, MDF/LDF operations).
2. The user described a MySQL-to-PostgreSQL migration, but no MySQL source was
   found in the inspected tree.
3. Both supplied database files are already PostgreSQL custom archives.
4. The `smart_system` archive, the promised PostgreSQL branch, current
   `MenuMaster` data, every client query set, and remaining procedures have not
   been supplied.

No production database conversion may begin until the authoritative source
engine and object-by-object dialect are recorded.
