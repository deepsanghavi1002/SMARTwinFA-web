# Sale Invoice Or Representative Accounting Voucher

- Fields/order: entry UI and `Cls_Entry` define the application payload; exact
  persisted columns and line ordering require schema and `SP_ENTRY_SAVE`.
- Validations/permissions: entry style, license, user rights, book/series,
  dates, and form controls are evidenced; exact required-field rules remain
  unresolved.
- Sources: `SMARTwinFA/Prj_Forms/Entry*.cs`, `@Classes/Cls_Entry.cs`,
  `Data Logic Layer/Dll_Entry.cs`, setup metadata, company entry tables.
- Writes/effects: accounting, stock, tax, numbering, logs, and possible addon
  writes are database-routine dependent and must not be guessed.
- Edit/delete/cancel/lock: unknown; obtain routine bodies and UI/database
  transaction traces.
- Outputs: Crystal invoice/challan templates, PDF/export, email/WhatsApp, and
  ledger/dashboard effects.
- Required parity evidence: create/edit/delete/cancel/lock cases, debit-credit
  totals, taxes, numbering, rollback, and report/PDF golden samples.
