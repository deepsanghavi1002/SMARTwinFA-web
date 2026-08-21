# Procedure review priorities

1. `sp_entry_save` is missing as a usable target declaration. The target file
   contains a commented SQL Server body near another procedure, not a converted
   posting contract. This blocks invoice/voucher persistence and posting parity.
2. `sp_transfer_data`, `sp_report_formating`, and several standard/GST report
   routines are missing, blocking year transfer and representative report parity.
3. Schema, table types, triggers, constraints, and metadata exports are still
   absent, so none of the 282 declarations can be compiled or dependency-tested.
4. Dynamic identifier and SQL construction must be replaced with catalog-owned
   identifiers, safe quoting, bound values, tenant/company/year scope, timeouts,
   and audit controls. A direct port is not acceptable for the web runtime.
5. The file-level `SET search_path TO smart_setup` conflicts with the target
   isolation model. Routines must use trusted schema qualification and
   transaction-scoped context.
6. Explicit `COMMIT`/`ROLLBACK`, broad exception swallowing, temporary shared
   tables, SQL Server compatibility fragments, and password-update routines
   require individual transaction and security decisions.

The first conversion wave should be limited to the five migration slices:
Account Master, Product Master, one balanced entry/posting flow, Trial Balance
or Ledger, and one invoice print job. All other procedures remain catalogued
until these patterns pass PostgreSQL integration and parity gates.
