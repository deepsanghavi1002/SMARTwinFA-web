# Source Engine And Database Map

## Engine evidence

| Item | Finding | Provenance |
|---|---|---|
| Legacy engine | Microsoft SQL Server | `Data Access Layer/SQL.cs`, `SqlManager.cs`, `Cls_Connection.cs`, `@Library/DbConnectionManager.cs` |
| Client provider | `System.Data.SqlClient` and Enterprise Library SQL provider | project files and data-access source |
| Destination | PostgreSQL, requested by migration brief | external requirement; no local implementation found |
| MySQL | No evidence found | workspace-wide source/config inventory |
| Version | SQL Server version not recorded in source | requires authorized server/backup metadata |

## Logical databases

- `smart_setup`: setup and metadata database. Source calls include first-combo
  lookup, report formatting, report controls/help, import, repost, transfer,
  restore, and year-open procedures. Report metadata references include report
  properties, controls, control values, output columns, checkbox/help/style
  data. Exact tables, keys, and routines require a database export.
- `smart_system`: system database. Source reads company, company-year routing,
  user/security, dashboard, and company contact/configuration data. The source
  uses `dbo` schema notation and SQL Server database-qualified names.
- Company/year database: selected after company and year selection. The name is
  runtime data held in `Lib_GlobalVariables.PublicVariable.Company_Database`.
  Source uses accounting and operational tables such as `account`, `ledger`,
  `aentry`, `aientry`, `process`, `prod_ledger`, `address`, and report log/data
  tables. Exact per-client schemas and year suffix conventions require live
  database metadata.

## Resolution flow

1. `Connection.INI` supplies server name, password, and external data path;
   the file is restricted and excluded.
2. `DbConnectionManager.InitialiseFromIni` builds connections to
   `smart_setup` and `smart_system`.
3. Login and company selection resolve user, company key, company database,
   year ID, financial-year dates, and rights into global state.
4. `SetDataDatabase` builds the selected company database connection.
5. Data-access helpers route queries by connection and database-qualified SQL;
   report and dashboard code also chooses setup/system/data connections based
   on SQL text.
6. User rights, license, entry style, company key, year, and machine/user
   context affect available operations and report output.

## Dialect mismatch

The legacy SQL contains SQL Server syntax such as `[database].[dbo].table`,
`nvarchar`, `CONVERT`, `DATENAME`, `RIGHT`, `ISNULL`/`COALESCE` patterns,
identity/stored-procedure conventions, `SqlDbType`, table-valued parameters, and
`sys.indexes`. PostgreSQL migration requires explicit rewrites for identifiers,
types, date formatting, routines, dynamic SQL, transaction/error behavior,
identity generation, and report query execution. No rewrite is included because
the source database definitions and data are absent.
