# Legacy SMARTwinFA Source Reference

The original Windows application is cloned separately at:

`../SMARTwinFA-legacy-reference`

Repository: `https://github.com/pranavcomputers/SMARTwinFA.git`  
Reference branch: `main`  
Reference commit at clone time: `113345ef77e2db201569552f6e30fbdfc5aaf24c`

This is a reference checkout, not a dependency, submodule or source folder of the web application. Do not copy compiled binaries, credentials, connection strings, client backups, vendor DLLs or Crystal runtime files into this repository.

## Initial source map

| Legacy area | Primary reference | Web destination |
| --- | --- | --- |
| Menu and feature routing | `SMARTwinFA/Prj_Menu1/Main_Menu.cs` | `platform/legacy-db/menu.ts`, application navigation |
| Master behaviour | `@Classes/Cls_Master_ProgramGrid.cs`, `Data Logic Layer/Dll_MasterProgramGrid.cs` | `features/master-program`, `/api/master-program` |
| Entry behaviour | `@Classes/Cls_Entry.cs`, `Data Logic Layer/Dll_Entry.cs`, `SMARTwinFA/Prj_Forms/Entry.cs` | transaction features and `/api/legacy/transaction/*` |
| Report orchestration | `@Classes/Cls_Report_Output.cs`, `Data Logic Layer/Dll_ReportOutput.cs` | `platform/legacy-db/report-register.ts`, `/api/legacy/report/:kind` |
| Crystal viewer | `SMARTwinFA/Prj_Forms/Crystal_ReportViewer.cs` | browser report workspace and `lib/export/pdf.ts` |
| Combined reports/invoices | `SMARTwinFA/Prj_Reports/Report_Combine.cs` | future multi-invoice PDF workflow |
| Pie/distribution reports | `SMARTwinFA/Prj_Forms/Report_PieChart*` | sales-distribution web report |
| Stored procedure contracts | `SPTXT`, `DATASPTXT`, `DESIGN`, top-level parameter notes | parameterized PostgreSQL report/service queries |
| Security and users | `@Classes/Cls_Security.cs`, `Cls_Users.cs`, `Cls_UserMaster.cs` | server-side authorization and audit layer |

## Migration rules

1. Reproduce business behaviour, validation and accounting results; do not line-for-line port WinForms UI code.
2. Record the exact legacy class/method or stored procedure used as evidence in the implementing PR.
3. Treat stored procedures and Crystal formulas as specifications that must be reconciled against sample data.
4. Use parameterized, read-only queries for reports. Writes require explicit transaction boundaries and tests.
5. Replace Crystal output with the shared typed report table plus browser print, PDF and XLSX exporters.
6. Preserve document keys so reports can drill down to the corresponding voucher.
7. Compare totals against the legacy application for at least two periods before marking a report complete.
8. Never copy secrets or customer data from the legacy repository. The checkout contains old operational files and must remain local and access-controlled.

The detailed report behaviour and definition of done are in `docs/reports/modern-reporting-spec.md`.
