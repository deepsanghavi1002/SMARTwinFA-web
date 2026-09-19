# Invoice Print And PDF Flow

- Fields/order: Crystal `.rpt` files and formula fields control rendered order;
  data binding requires report metadata and company data.
- Validations/permissions: license, entry style, print book, document flags,
  WhatsApp/email flags, and recipient availability affect delivery.
- Sources: `SMARTwinFA/REPORT/*.rpt`, `Crystal_ReportViewer.cs`, report forms,
  company `ADDRESS`/`COMPANY`, printer templates, export directories.
- Writes/effects: PDF export, print jobs, email/WhatsApp delivery, and report
  logs may occur; credentials and delivery configuration are restricted.
- Edit/delete/cancel/lock: print flow is read/delivery oriented; invoice
  cancellation and reprint policy are unresolved.
- Outputs: printer output, PDF, email, WhatsApp, and invoice/challan variants.
- Required parity evidence: sanitized canonical reports, printer/page settings,
  formula values, copies, delivery behavior, retention, and failure/rollback
  cases.
