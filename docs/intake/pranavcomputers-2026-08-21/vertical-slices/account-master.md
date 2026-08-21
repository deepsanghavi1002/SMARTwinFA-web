# Account Master

## Contract

- Fields/order: source references account fields such as code, name, book,
  balances, and addon keys; authoritative order/types require company schema
  and master metadata.
- Validations/permissions: form validation and user/company rights are in
  `SMARTwinFA/Prj_Forms/Master_Design.cs` and security/setup flows; exact rules
  require execution evidence.
- Sources: company `account` and related addon tables; setup metadata; master
  grid classes; dynamic SQL in forms.
- Writes/effects: unknown until save routine and triggers are obtained. Do not
  assume posting or stock effects for master changes.
- Edit/delete/cancel/lock: unknown; obtain UI tests and database constraints.
- Outputs: account lookup, ledger/report selection, and report columns.
- Unknowns/parity evidence: schema, save routines, permissions, before/after
  database snapshots, and representative account reports.
