# Ledger Or Trial Balance Report

- Fields/order: report metadata and dynamic query construction determine output;
  exact columns are data-driven and require setup export.
- Validations/permissions: report controls, selected groups/slabs, date range,
  user/company/year context, and rights are source-evidenced; exact rule matrix
  is unresolved.
- Sources: `Report_Combine.cs`, `Dll_ReportOutput.cs`, `Cls_Report_Output.cs`,
  smart_setup report metadata, company ledger/account tables.
- Writes/effects: report logging and temporary cleanup are evidenced; exact
  side effects require routine bodies.
- Edit/delete/cancel/lock: not applicable to read output; report date/period
  locking behavior is unresolved.
- Outputs: DataTable/grid, Crystal templates where mapped, Excel/PDF export.
- Required parity evidence: opening/closing balances, monthly columns, debit/
  credit totals, filters, grouping, union and multi-year cases.
