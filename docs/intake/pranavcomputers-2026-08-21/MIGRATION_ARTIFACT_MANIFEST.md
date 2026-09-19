# SMARTwinFA Migration Artifact Manifest

This manifest inventories migration-relevant artifacts in the legacy workspace
`e:\SMARTwinFA` only. It is a provenance index, not a reconstructed schema or a
claim that undocumented database behavior is known.

## Scope and provenance

- Source root: `e:\SMARTwinFA`
- Solution: `SMARTwinFA.sln`
- Target runtime: .NET Framework 4.8 WinForms application
- Database engine evidenced by source: Microsoft SQL Server via `System.Data.SqlClient`
- Logical database roles evidenced by source: `smart_setup`, `smart_system`, and a selected company/year database
- Do not treat `bin`, `obj`, `.vs`, NuGet `packages`, or other generated binaries as authoritative source.
- `Connection.INI` is explicitly ignored by Git and may contain local credentials or host data. Preserve it only as a secured deployment reference; do not publish its secrets.

## Source artifacts

The complete source is already present in the legacy workspace. Preserve the
following project boundaries and relative paths when importing it into the
migration workspace:

- `SMARTwinFA/SMARTwinFA.csproj` and `SMARTwinFA/Program.cs`
- `SMARTwinFA/Prj_Forms/` - login, security, company/year selection, entry, masters, utilities, dashboards, charts, report viewer, import/export, e-invoice, and messaging workflows; include `.cs`, `.Designer.cs`, and `.resx` files.
- `SMARTwinFA/Prj_Reports/` - report composition and report-generation orchestration; include `.cs`, `.designer.cs`, and `.resx` files.
- `SMARTwinFA/Prj_Menu/` - menu/navigation source and resources.
- `SMARTwinFA/Prj_Resources/`, `SMARTwinFA/Prj_Images/`, and `SMARTwinFA/Properties/` - UI assets and embedded resources.
- `@Classes/` - DTO/request models passed between forms, logic, and data access, including entry, security, company selection, report output, users, and utility models.
- `Data Logic Layer/` - business-facing orchestration and stored-procedure contracts (`Dll_*.cs`).
- `Data Access Layer/` - SQL Server execution helpers and stored-procedure wrapper (`SQL.cs`, `SqlManager.cs`, `clsSql.cs`, `DBTask.cs`, `Cls_Connection.cs`).
- `@Library/` - global state, connection management, SQL/data helpers, Hindi/Kruti Dev conversion, and shared utility behavior.
- `@Class_Log/` - application logging implementation.
- `SMARTwinFA.sln`, every `*.csproj`, every `packages.config`, and project `app.config` files - build/reference provenance and dependency versions.

## Database-definition and SQL artifacts

### Present as files

- `SMARTwinFA/Optimize_Dashboard_Indexes.sql` - SQL Server index recommendations for `SMART_SYSTEM.USER_DASHBOARD`, `SMART_SYSTEM.DASHBOARD_DETAIL`, and commented company-database recommendations for `PROD_LEDGER` and `PROCESS`. It is not a complete schema or migration script.
- `Connection.INI` - local server/password/data-path input. Treat as restricted configuration, not as a portable migration artifact.
- `SMARTwinFA/app.config` and the other project `app.config` files - connection names, SQL Server provider, application settings, user settings, and report-related configuration.

### Contract embedded in source

- `@Library/DbConnectionManager.cs` - parses `Connection.INI`, builds SQL Server connections, selects the company database, and defines query/non-query behavior.
- `Data Access Layer/SQL.cs`, `Data Access Layer/SqlManager.cs`, and `Data Access Layer/clsSql.cs` - command types, parameter mapping, timeouts, DataSet/DataTable behavior, and stored-procedure execution conventions.
- `Data Logic Layer/Dll_*.cs` - stored-procedure names and parameter contracts. Names evidenced in active code include `SP_ENTRY_READ_FIRSTCOMBO`, `SP_ENTRY_SAVE`, `SP_GETUSER`, `SP_IMPORT_DATA`, `SP_REPOST_DATA`, `SP_REPORT_FORMATING`, `SP_REPORT_FORMATING_NEW`, `SP_STD_REPORT`, `SP_DROP_TABLES`, `SP_FILL_CONTROL`, `SP_GET_HELP`, `SP_TRANSFER_DATA`, `SP_VERSION_CHANGES`, and `SP_YEAR_OPEN`. Some names are data-driven through model properties or setup tables.
- `SMARTwinFA/Prj_Forms/` and `SMARTwinFA/Prj_Reports/Report_Combine.cs` - inline SQL, dynamic table/database names, report selection logic, dashboard queries, ledger/entry behavior, and audit logging.
- `@Library/Lib_GlobalVariables.cs` - shared runtime state, license gates, company/year/user context, tax/e-invoice flags, printing, and integration state.

### Required database-side artifacts not present in this workspace

Obtain these from the authorized SQL Server/source database owner. Do not infer
or regenerate them from application calls:

- Full schema and data dictionary for `smart_setup`, `smart_system`, and every company/year database.
- Tables, columns, SQL types, nullability, defaults, keys, indexes, constraints, triggers, sequences/identity behavior, and collation/date settings.
- Definitions and permissions for every stored procedure, function, view, synonym, and table-valued parameter referenced by source or setup data.
- Database-held report metadata and dynamic SQL, especially setup tables referenced by `Report_Combine.cs` (report properties, controls, output columns, formatting/help data, and dashboard definitions).
- Representative sanitized data plus row counts and reconciliation totals for migration validation.
- SQL Server backup/export and an authorized record of database/server versions, logins/roles, and external dependencies.

## Business-rule artifacts

Preserve the implementation and comments in these locations as the rule
provenance set:

- `SMARTwinFA/Prj_Forms/Entry*.cs`, `Small_Entry*.cs`, and `Entry_*.cs` - voucher/entry workflows, validation, posting, and entry-style differences.
- `SMARTwinFA/Prj_Forms/Master_*.cs` and `@Classes/Cls_Master_ProgramGrid.cs` - master-data and grid behavior.
- `SMARTwinFA/Prj_Forms/Setup_*.cs`, `Z_LoginScreen.cs`, `Z_Frm_Password.cs`, and `Utility_User_*.cs` - authentication, company/year selection, rights, and license gating.
- `SMARTwinFA/Prj_Forms/Utility_*.cs` and matching `@Classes/Cls_Utility*.cs` / `Data Logic Layer/Dll_Utility*.cs` - import, export, restore, repost, year-open, balance transfer, and maintenance behavior.
- `SMARTwinFA/Prj_Forms/Dashboard.cs`, `Report_PieChart.cs`, and `Report_MultyYearChart.cs` - dashboard date, license, aggregation, and drill-down rules.
- `SMARTwinFA/Prj_Reports/Report_Combine.cs`, `Data Logic Layer/Dll_ReportOutput.cs`, and `@Classes/Cls_Report_Output.cs` - report metadata, filters, grouping, slabs, unions, formatting, and output contracts.
- `@Library/Lib_GlobalFunctions.cs`, `@Library/Lib_GlobalVariables.cs`, `@Library/KrutiDevConverter.cs`, and `@Library/Transliterator.cs` - shared conversions, dates, formatting, Hindi text, and global state.
- `SMARTwinFA/Prj_Forms/Crystal_ReportViewer.cs` - print, PDF, e-mail, WhatsApp, paper-size, and report formula behavior.

Rules must be ported from these artifacts and verified against observed legacy
behavior. License numbers, flags, SQL expressions, and commented-out code are
evidence to investigate, not assumptions about intended product behavior.

## Report, template, and integration artifacts

- Crystal Reports: `SMARTwinFA/REPORT/*.rpt` (9 templates currently present).
- Report host/orchestration: `SMARTwinFA/Prj_Reports/`, `SMARTwinFA/Prj_Forms/Crystal_ReportViewer.*`, and the report-related resources.
- E-invoice sample/template: `SMARTwinFA/EINVOICE/EINVOICE_JSON.txt`.
- E-way invoice directory: `SMARTwinFA/EWAYJSON/`.
- Export/output directories: `SMARTwinFA/Export/` and `SMARTwinFA/JSON/`.
- Printer templates/settings: `SMARTwinFA/RAS2K8PrinterSimple1.txt` and `SMARTwinFA/RASPrinter2010Simple.txt`.
- Fonts used by the application/report output: `FONTS/` including Mangal, Kruti Dev-related, barcode, and Rupee fonts. Confirm redistribution rights before web deployment.
- Branding and UI images: `PC bill Logo.png`, `SMARTwinFA/Prj_Images/`, `SMARTwinFA/Prj_Resources/`, and project resources in `SMARTwinFA/Properties/Resources.resx`.
- Localization/conversion data: `SMARTwinFA/hindi-overrides.json`, `SMARTwinFA/krutidev-map.json`, and `@Library/` conversion code.

Binary Crystal templates, fonts, images, and resource files are source
artifacts even though they are not readable as text. Keep their original bytes
and relative paths; do not replace them with screenshots or guessed web
templates.

## Migration work products and status

No PostgreSQL schema, ETL/import script, mapping specification, web API
contract, PostgreSQL-compatible query rewrite, automated reconciliation test,
or migration runbook was found in `e:\SMARTwinFA`. No unrelated PC locations
were scanned.

The migration team should create these as new, reviewable artifacts while
linking each decision back to the paths above:

1. SQL Server extraction and PostgreSQL schema/mapping package, including explicit type, collation, identity, date, money/decimal, boolean, and identifier decisions.
2. Stored-procedure replacement design for each active procedure and each data-driven procedure discovered from `smart_setup`.
3. Report inventory keyed by report metadata and `.rpt` template, with rendered golden outputs from sanitized legacy data.
4. Business-rule decision log for every inferred, conflicting, license-gated, or database-resident rule. Unknowns remain open questions.
5. Repeatable ETL/import scripts with checkpoints, idempotency, error quarantine, and row-count/financial-total reconciliation.
6. Web replacement contracts for authentication, authorization, company/year context, entries/posting, reports, printing/export, e-invoice, and integrations.
7. A secured handling record for `Connection.INI` and any database backup or production data supplied outside this source workspace.

## Handoff acceptance checks

- Every source path above is copied or mounted with its relative path and provenance metadata.
- Every database object referenced by source is matched to an authorized SQL Server definition or recorded as missing.
- Every `.rpt`, resource, font, image, JSON/template, and printer artifact has an owner and web replacement decision.
- No password, production data, or local-only connection file is committed to a public migration repository.
- Legacy-vs-PostgreSQL reconciliation covers opening balances, transaction totals, tax totals, closing balances, and representative report outputs.
