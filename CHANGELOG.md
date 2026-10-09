# SMARTwinFA-web – Change Log

Date-wise remarks of every change made by Claude. Newest entries first.
Format: `## YYYY-MM-DD` → bullet list of what changed and which files.

## 2026-10-09 (Fund Flow report)
- Ported `SP_FRT_RPT_FUND_FLOW` (REPORT > Bank/Cash > Fund Flow) from the source supplied from pc-2.
  New: `lib/report/fundFlow.ts` (read-only queries: receipts and payments by schedule per cash/bank book,
  "  Opening" rows, TOTAL, PERC) and `lib/report/fundFlowPivot.ts` (the pivot and percentage arithmetic).
  Test: `tests/fund-flow-pivot.test.mts` (passes; typecheck and lint clean).
- Wired as report_key 109: added to `PORTED_REPORTS` (`lib/report/setup.ts`) and to the key switch of both
  `standardReport` and `formattedReport`, so it runs with or without a format chosen.
- Deliberate differences from the desktop SQL: opening balances read for the report's year only; duplicate
  book names make one column; a side that nets to zero gets no PERC (the desktop divides by zero).

## 2026-10-09
- Project imported/set up in this repository (existing code and history kept as-is).
- Added this CHANGELOG.md to record all future changes date-wise.
