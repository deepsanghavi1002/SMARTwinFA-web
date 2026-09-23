# SMARTwinFA Modern Reporting Specification

Status: implementation baseline on `feature/modern-reporting`  
Evidence source: report demonstrations in `SmartWinFa Software Demo Video`  
Runtime decision: browser UI + PostgreSQL queries + native PDF/XLSX generation; no Crystal Reports runtime

## Purpose

Reproduce the useful behaviour of the desktop reports without copying their visual limitations. The web version must preserve accounting meaning, filters, drill-down, subtotals, final totals and printable output. It should improve discoverability, export quality, accessibility and maintainability.

This document is the handoff contract for agents implementing individual reports. Video observations are evidence of intended behaviour, not proof of calculation rules. Every financial calculation must be reconciled against the restored database and an accepted legacy output before release.

## Behaviour observed in the videos

The legacy reports follow one repeated workflow:

1. Open a report from the Reports menu.
2. Choose a date range and report-specific selectors.
3. Choose filters, grouping and sort order.
4. Press OK/Show.
5. Review a dense tabular result with group subtotals and a final total.
6. On supported reports, open the selected row to its voucher/document detail.
7. Print or export the selected report.

The following recordings were reviewed:

| Recording | Required web behaviour |
| --- | --- |
| Day Book | Book selector (bank/cash/discount/all), date range, detailed/summary views, debit and credit totals, voucher zoom. |
| Ledger Zoom | Account/book selection, chronological ledger, opening/running/closing balances where supported, row-to-voucher drill-down. |
| Outstanding | Sale/purchase/expense scope, ageing views, setoff/prior-setoff/pending amounts, party grouping and totals, document zoom. |
| Trial Balance | Account/schedule/area grouping, summary/detailed/opening modes, hierarchical totals, debit/credit balance checks. |
| Top Report | Customer/supplier/item dimension, value/quantity/invoice ranking, area/group context and final totals. |
| Drop Analysis | Party/item analysis, value/quantity/detail modes, comparison of movement and invoice counts. |
| Multiple Invoice PDF | Select a party/account and a set of invoices, then produce one ordered multi-invoice PDF. |
| Pie Chart | Date range and metric selection for sales, purchases, expenses, receipts and payments; legend and exact values remain available as a table. |
| Monthly Closing Stock | Product rows, month-end quantity/value columns, group/filter/sort and final totals. |

## Shared report contract

Every report implementation must provide:

- A stable report identifier and human-readable title.
- Explicit `from` and `upto` dates when the underlying query is period-based.
- Search, report-specific selectors and deterministic sorting.
- A visible summary containing row count and the most useful additive totals.
- A table that keeps numeric values typed as numbers, aligns them right, and formats with Indian grouping.
- A final totals row for additive numeric columns. Rates, percentages and shares must not be summed.
- Row selection and drill-down when a stable document key exists.
- Print, PDF, XLSX and CSV output of the currently displayed rows, filters and order.
- Loading, empty and database-error states that do not pretend zero data is a valid result.
- Source and applied-filter metadata in exported output.

The existing `LegacyReportWorkflow` is now the reference shell. `lib/reporting/report-table.ts` converts query results to the shared typed export model. `lib/export/pdf.ts` and `lib/export/xlsx.ts` generate portable files without server-side Crystal dependencies.

## Calculation and reconciliation rules

- SQL is the source of truth for filtering and accounting calculations; client code may only present, sort or group rows already returned by the report API.
- Monetary totals use unrounded source values and are rounded only for display.
- Debit/credit signs and opening/closing rules must come from the ledger conventions in the restored database, not assumptions from screen colour.
- A grouped report must reconcile: child rows equal group subtotal, group subtotals equal final total, and final total equals the equivalent ungrouped query.
- Trial Balance must expose an imbalance explicitly. It must never hide or auto-adjust a difference.
- Outstanding ageing boundaries must be documented beside the query (for example, whether 30 days is inclusive).
- Closing stock must define valuation method and effective cutoff time. Month-end columns must remain reproducible for a closed period.
- Cancelled, deleted, draft and locked documents must have an explicit inclusion rule per report.
- Time zone and financial-year boundaries must be handled on the server.

## Drill-down contract

Ledger, Day Book, Outstanding and similar reports should return stable document keys. A row drill-down opens a read-only detail view containing header fields, line items, debit/credit or quantity/value totals, narration and status. The browser Back action must restore report filters and scroll position. Missing source documents should display a traceable error containing the key, not a blank panel.

## Export and print contract

PDF output uses landscape orientation for wide reports, repeats company/report/column headings on every page, displays the applied period and view, prints page numbers, and closes with totals. XLSX output freezes headings, enables filters, retains number/date types and includes totals. CSV is a simple interoperability fallback. Export file names must be Windows-safe.

Multiple-invoice PDF is a separate batch workflow: selected invoices are ordered deterministically, each starts on a new page, page numbering covers the complete file, and one invoice failure identifies the failed document without silently omitting it.

## Chart contract

Charts are alternate views of a report, never the only representation. The distribution chart must have a legend, keyboard-readable labels, exact values, percentages and a table fallback. “Other” grouping must state its threshold. Negative values need a defined visual treatment; they must not be silently excluded.

## Security and operations

- Report endpoints are read-only and parameterized; never interpolate filter text into SQL.
- Company, financial-year and user authorization are enforced server-side.
- Sensitive exports are generated on demand and should not be retained by the server by default.
- Each export should carry generation time and, when authentication is available, the requesting user.
- Query duration and row count should be logged without storing confidential row data.
- Large reports need server-side paging for the interactive grid and a bounded streaming/background export path.

## Definition of done for each report

1. Query/filter behaviour is covered by tests.
2. Numeric/date typing and totals are covered by tests.
3. Results reconcile to an approved legacy sample for at least two date ranges, including an empty range.
4. Drill-down keys resolve to the expected source voucher where applicable.
5. PDF and XLSX open successfully and show the active filters and final totals.
6. Keyboard operation, accessible names, loading, empty and error states have been checked.
7. A reviewer records any known difference from the Crystal output in this document or a linked report note.

## Implementation sequence

1. Finish Day Book and Ledger as the reference patterns, including voucher drill-down.
2. Add Outstanding and Trial Balance with formal reconciliation fixtures.
3. Add Top, Drop Analysis and distribution chart views.
4. Implement monthly closing-stock pivot output.
5. Implement the multi-invoice PDF batch workflow.
6. Add saved report presets and scheduled/background exports only after authorization and audit requirements are defined.

## Known gaps in the current baseline

The branch provides the reusable report shell, live-row summaries, additive totals, print styling, and real PDF/XLSX/CSV exports. It does not yet reproduce every report's hierarchical subtotal rules, running balances, stock pivot, batch invoice selection, server-side pagination or durable saved presets. Those require report-specific SQL validation against the supplied sample database.
