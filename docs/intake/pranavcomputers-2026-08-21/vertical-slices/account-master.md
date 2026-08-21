# Account Master

## Contract

- Fields/order: verified `smart_setup.program_top:14` has 87 ordered field
  definitions across `ACCOUNT` (37), `ADDRESS` (33), `AC_BALANCE` (4),
  `ADDON_DATA` (4), `INT_MASTER` (4), `BALSHEET` (2), `IDOPT_MASTER` (2), and
  `BOOK_PROPERTIES` (1). The non-executable structural export is documented in
  `docs/intake/account-master-field-contract-2026-08-21.md`; target type
  semantics and labels still require review.
- Validations/permissions: form validation and user/company rights are in
  `SMARTwinFA/Prj_Forms/Master_Design.cs` and security/setup flows; exact rules
  require execution evidence.
- Sources: company account-related tables; setup metadata; master grid classes;
  dynamic SQL in forms. One source field mapping is an expression and remains
  explicitly quarantined rather than treated as an identifier.
- Writes/effects: unknown until save routine and triggers are obtained. Do not
  assume posting or stock effects for master changes.
- Edit/delete/cancel/lock: unknown; obtain UI tests and database constraints.
- Outputs: account lookup, ledger/report selection, and report columns.
- Unknowns/parity evidence: schema, save routines, permissions, before/after
  database snapshots, and representative account reports.
