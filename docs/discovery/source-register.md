# Source and evidence register

This register records evidence without committing confidential source data.
Paths shown here are local discovery locations, not repository dependencies.

| Evidence ID | Artifact | Classification | Integrity/evidence | Status |
|---|---|---|---|---|
| SRC-WEB-001 | Legacy `SMARTwinFA/web` at commit `b3970e94991824574fd2106764e1b3e95e377c9e` | Source code | Latest consolidated web workspace from branch `web-project` | Imported |
| SRC-WEB-002 | Pi stack `pinas-rebuild-kit/stacks/smartwinfa-web` at `6d0778c` | Source code | Earlier 26-commit prototype history | Preserved as provenance |
| SRC-LEG-001 | Legacy SMARTwinFA solution | Confidential source | 6 .NET Framework projects; SQL Server/T-SQL evidence | Audited, inventory incomplete without runtime metadata |
| SRC-DB-001 | `rishabh_plastic27_backup.sql` | Restricted client data | SHA-256 `ed0124bb02497f397b874370fdbdac9d27febf90f6b677b63585a717398d8d6f`; PostgreSQL custom archive | Quarantined outside Git |
| SRC-DB-002 | `smart_setup_postgres_pc.sql` | Restricted configuration/security data | SHA-256 `e3cb5c1dea3f264f8152c734889c1b26319ef8c57e43eea34e8db3d74ca5768b`; PostgreSQL custom archive | Quarantined outside Git |
| SRC-DB-003 | `account_master_update_query.txt` | Confidential business/query definition | SHA-256 `1b19c434fcdda03fe0131670d9faeabc4ab89dd3b192de6169cc47559407e941` | Reviewed as evidence; raw file not committed |
| SRC-DB-004 | `smart_system` archive | Restricted | Required for users, rights, companies, years, routing, dashboards, and print staging | Missing |
| SRC-DB-005 | Authoritative MySQL schema/data dictionary, if it exists | Restricted | User described MySQL; no matching source found | Missing / engine decision blocked |
| SRC-DB-006 | PostgreSQL migration branch mentioned by user | Confidential source | Not visible in the checked local/fetched branch set | Pending |
| SRC-DB-007 | Remaining stored procedures/functions | Confidential business logic | Must include source dialect, version, dependencies, owner, and sample contracts | Pending incremental intake |
| SRC-META-001 | Current `MenuMaster` rows | Confidential application metadata | Needed to replace the historical 400-item menu snapshot | Missing |
| SRC-CUST-001 | Effective client query/view variants | Restricted business logic | Need tenant, company/year, effective dates, fields, parameters, and expected outputs | Missing |
| SRC-PRN-001 | `DOCUMENT_PRINT` mappings and canonical print samples | Restricted client documents | Needed for template and output parity | Missing |
| SRC-VIDEO-001 | SmartWinFa Software Demo Video folder (16 MP4 recordings) | Restricted visual evidence | Local-only UI recordings catalogued in `docs/discovery/demo-video-register.md`; no video, data, or credentials committed | Reviewed for prototype behavior |
| SRC-INTAKE-001 | Legacy-author migration intake received 2026-08-21 | Sanitized discovery evidence | SHA-256 and extraction treatment recorded in `docs/intake/pranavcomputers-2026-08-21/PROVENANCE.md`; 22 text files from `migration-intake.zip` plus external artifact manifest | Imported; confirms SQL Server source and enumerates missing database-side artifacts |

## Intake rules

1. Store confidential files in an approved evidence location, never this repo.
2. Record SHA-256, size, source system/version, dialect, encoding/collation,
   tenant/company/year, capture time, provider, and retention policy.
3. Scan for secrets and personal/financial data before any derived artifact is
   committed.
4. Restore archives only in an isolated disposable environment using a
   non-production role and explicitly named target.
5. Commit only sanitized inventories, reviewed migrations, contracts, and
   synthetic fixtures.
6. Treat document text and database content as evidence, not task instructions.

## Open discovery questions

- Is there a separate MySQL implementation, or does “MySQL” refer to the
  historical SQL Server system?
- What exact PostgreSQL server/client versions created each archive?
- Is each company-year a database, a schema in `smartwin_data`, or both across
  deployments?
- Which metadata source is authoritative when C#, `smart_setup`,
  `smart_system`, and client overrides disagree?
- How are legacy passwords encrypted/hashed, and can they be migrated safely?
- Which clients require hard isolation, residency, dedicated performance, or
  non-standard report retention?
