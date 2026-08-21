# Synthetic implementation tranche

This is a 60-item implementation target using deterministic synthetic data.
It is deliberately separate from the top-level migration backlog: a synthetic
contract may be complete while source parity, production deployment, external
integration, cutover, and business signoff remain pending.

| ID | Mock-safe deliverable | Backlog link | State |
|---|---|---|---|
| SYN-01 | Deterministic isolated tenant fixtures | PLAT-FIXTURE-001 | complete |
| SYN-02 | Fixture identity and scope separation | PLAT-FIXTURE-001 | complete |
| SYN-03 | Immutable server-owned session issue contract | PLAT-AUTH-001 | complete |
| SYN-04 | Session expiry and terminal revocation rules | PLAT-AUTH-001 | complete |
| SYN-05 | Deny-by-default permission decision | PLAT-RBAC-001 | complete |
| SYN-06 | Company/year-scoped permission decision | PLAT-RBAC-001 | complete |
| SYN-07 | Synthetic control catalog adapter | PLAT-CTX-001 | complete |
| SYN-08 | Context transaction-scope lifecycle | PLAT-DB-001 | complete |
| SYN-09 | Context isolation negative contract | PLAT-RLS-001 | complete |
| SYN-10 | Typed archive registry | DB-INTAKE-001 | complete |
| SYN-11 | Archive checksum validation | DB-INTAKE-001 | complete |
| SYN-12 | Restore-plan allowlist | DB-INTAKE-001 | complete |
| SYN-13 | Target type mapping contract | DB-MAP-001 | planned |
| SYN-14 | Money and rounding contract | ARCH-007 | planned |
| SYN-15 | Date/time and identifier contract | ARCH-007 | planned |
| SYN-16 | Control-plane schema model | DB-CONTROL-001 | planned |
| SYN-17 | Tenant-aware composite-key contract | DB-CONTROL-001 | planned |
| SYN-18 | Canonical journal-line balance rule | DB-CANON-001 | planned |
| SYN-19 | Canonical stock movement rule | DB-CANON-001 | planned |
| SYN-20 | Transaction idempotency ledger | DB-MOVER-001 | planned |
| SYN-21 | Migration checkpoint state | DB-MOVER-001 | planned |
| SYN-22 | Migration quarantine record | DB-MOVER-001 | planned |
| SYN-23 | Reconciliation result contract | DB-PARITY-001 | planned |
| SYN-24 | Reconciliation tolerance rule | DB-PARITY-001 | planned |
| SYN-25 | Metadata compilation boundary | DB-META-001 | planned |
| SYN-26 | Metadata rollback selection | DB-META-001 | planned |
| SYN-27 | Typed custom-value validation | DB-CUSTOM-001 | planned |
| SYN-28 | Custom-field projection isolation | DB-CUSTOM-001 | planned |
| SYN-29 | Account master read model | MST-ACCOUNT-001 | planned |
| SYN-30 | Account master validation model | MST-ACCOUNT-001 | planned |
| SYN-31 | Addon master definition model | MST-ADDON-001 | planned |
| SYN-32 | Addon master lifecycle model | MST-ADDON-001 | planned |
| SYN-33 | Balanced journal posting | ENT-REP-001 | planned |
| SYN-34 | Posting rollback rule | ENT-REP-001 | planned |
| SYN-35 | Invoice lifecycle state machine | ENT-INVOICE-001 | planned |
| SYN-36 | Receipt/payment allocation rule | ENT-ACCOUNTING-001 | planned |
| SYN-37 | Stock voucher movement state | ENT-STOCK-001 | planned |
| SYN-38 | Production formula/costing contract | ENT-PROD-001 | planned |
| SYN-39 | Tax submission retry contract | ENT-TAX-001 | planned |
| SYN-40 | Typed report filter contract | RPT-REP-001 | planned |
| SYN-41 | Report totals and export contract | RPT-REP-001 | planned |
| SYN-42 | Accounting report projection | RPT-ACCOUNTING-001 | planned |
| SYN-43 | Inventory report projection | RPT-INVENTORY-001 | planned |
| SYN-44 | Dashboard layout resolver | DASH-001 | planned |
| SYN-45 | Dashboard drill-down permission guard | DASH-001 | planned |
| SYN-46 | Print job request contract | PRN-REP-001 | planned |
| SYN-47 | Print output retention lifecycle | PRN-REP-001 | planned |
| SYN-48 | Year open/lock state machine | UTIL-YEAR-001 | planned |
| SYN-49 | Destructive-operation approval rule | UTIL-BACKUP-001 | planned |
| SYN-50 | Import row validation contract | INT-EXCEL-001 | planned |
| SYN-51 | Import duplicate/quarantine contract | INT-EXCEL-001 | planned |
| SYN-52 | Delivery authorization/retry contract | INT-DELIVERY-001 | planned |
| SYN-53 | Override registry closure check | CUST-CLOSE-001 | planned |
| SYN-54 | Client-branch static rule | CUST-REMOVE-001 | planned |
| SYN-55 | Unit-test evidence registry | QA-UNIT-001 | planned |
| SYN-56 | Database-contract test harness | QA-DB-001 | planned |
| SYN-57 | Accessible control manifest | QA-A11Y-001 | planned |
| SYN-58 | Tenant-safe observability event | PLAT-OBS-001 | planned |
| SYN-59 | Data classification and lineage contract | AI-DATA-001 | planned |
| SYN-60 | Synthetic operational-readiness checklist | OPS-OBS-001 | planned |
