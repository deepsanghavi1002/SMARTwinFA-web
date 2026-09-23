# Report parity bridge

Branch: feature/report-parity-bridge. Starts from modern-reporting with Pranav Shah's September 23 master improvements intact.

First slice connects verified REPORT_DAYBOOK, REPORT_LEDGER and REPORT_JOURNAL menu programs. Existing MASTER dispatch and master implementation are preserved.

These three read-only reports resolve selected company/year/operator through the existing server-side session resolver. Like the existing report endpoints, they remain development access, not production authentication. Write gates are unchanged.

Date and search filters run against selected-year ledger facts. Full matching rows are returned, with explicit rejection above 50,000 rows rather than a silent truncated export. PDF/Excel headers include company, year and applied search. Numeric identifiers remain text; quantities retain three decimal places. Request cancellation no longer lets an obsolete request replace the active result, and stale results clear during reload.

Remaining: authenticated sessions, report-specific rights, server pagination/full export jobs, account picker, opening/running balances, voucher detail, reconciliation of signed amounts, other report families and batch invoice output. Ledger is deliberately titled Ledger Transactions while balance semantics remain pending. Unsupported report modes are not exposed on the newly connected screens.

See ../migration/parity-audit-2026-09-23.md for the complete backlog. This slice partially addresses NAV-01, CTX-01, REP-02 and REP-09; it does not close the full accounting parity audit.
