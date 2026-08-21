# Reports And Printing

## Template inventory

Nine Crystal Reports are present under `SMARTwinFA/REPORT/`: invoice purchase,
invoice print variants, invoice plain variants, challan, CGST plain, all
debtors outstanding, and all debtors ledger. Their exact database bindings and
parameters must be extracted with Crystal tooling or protected sample data.

## Runtime mapping

`SMARTwinFA/Prj_Forms/Crystal_ReportViewer.cs` loads the selected report path,
sets formula fields such as company/user/entry context, logs into
`SMART_SYSTEM`, refreshes, prints, exports PDF, and may e-mail or WhatsApp the
result. `Report_Combine.cs` and `Dll_ReportOutput.cs` build report query
contracts from setup metadata. Menu-to-report mappings are data-driven and
require sanitized metadata export.

## Required inventory fields

For every report/template, capture template path/hash, menu/form, query/routine,
parameters and formula fields, copies and page settings, output formats,
delivery behavior, retention path, client variants, and sanitized canonical
sample reference. No protected client sample is included.
