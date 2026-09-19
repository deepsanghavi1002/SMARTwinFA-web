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
| SRC-DB-004 | `smart_system` archive | Restricted | Live on both SQL Server instances: 25 tables, 25 primary keys, 26 procedures, 2 functions. Archive SHA-256 `e1506122961941a20fbe347b2c85c374d3f7603b0f84329bba2b7255992379f5` | **Available** (2026-08-24) |
| SRC-DB-005 | Authoritative MySQL schema/data dictionary, if it exists | n/a | No MySQL service, client, server, or data directory exists on the authorized workstation | **Does not exist** — closed 2026-08-24 |
| SRC-DB-006 | PostgreSQL migration work mentioned by user | Confidential source | Located on the legacy workstation, outside Git. Catalogued below as `SRC-PG-001`…`SRC-PG-008` | **Located** (2026-08-24) |
| SRC-DB-007 | Remaining stored procedures/functions | Confidential business logic | 346 live routines in `smart_setup` (335 procedures, 10 scalar functions, 1 table-valued function); 328 converted; 283 archived | **Sized**; intake outstanding |
| SRC-META-001 | Current `MenuMaster` rows | Confidential application metadata | Live: 592 rows, identical on both instances. Supersedes the historical 400-item snapshot | **Available** (2026-08-24) |
| SRC-CUST-001 | Effective client query/view variants | Restricted business logic | Need tenant, company/year, effective dates, fields, parameters, and expected outputs | Missing |
| SRC-PRN-001 | `DOCUMENT_PRINT` mappings and canonical print samples | Restricted client documents | Mappings located: 5 rows in `smart_setup`, 8 in `smart_system`. Canonical print samples still outstanding | **Partially available** (2026-08-24) |

## Workstation evidence added 2026-08-24

Recorded by the [migration gap audit](migration-gap-audit-2026-08-24.md).
Locations are described with the personal Windows username removed. None of
these artifacts are committed to this repository.

| Evidence ID | Artifact | Classification | Integrity/evidence | Status |
|---|---|---|---|---|
| SRC-ENG-001 | SQL Server 2008 R2 RTM 10.50.1600.1, Developer Edition — archive instance, 148 non-system databases | Restricted | Live service, running/automatic | Verified |
| SRC-ENG-002 | SQL Server 2022 RTM 16.0.1000.6, Express Edition — active instance, 32 non-system databases; hosts `smart_setup` and `smart_system` | Restricted | Live service, running/automatic | Verified |
| SRC-ENG-003 | PostgreSQL 18 service and data directory (migration target) | Restricted | Live service; catalogue not read — no credential was requested or held | Verified; catalogue unavailable |
| SRC-ENG-004 | MySQL absence | n/a | No service, client, server, or data directory anywhere on the machine | Verified negative |
| SRC-PG-001 | `procedures_validated.sql` — 255 converted routines, 284 `CREATE OR REPLACE` | Confidential business logic | 12,136,820 B, 2026-08-22; SHA-256 `b625583bdc145ce6b5f234f973543ba4c1af05eca4ca83a073d70a51db4e34fd` | Located, not committed |
| SRC-PG-002 | `procedures_needs_review.sql` — 73 routines, 72 `CREATE OR REPLACE` | Confidential business logic | 9,005,627 B, 2026-08-22; SHA-256 `fdf8bba7b292a6130e6067a7f53961ce035d3273cad1f8941f889e2b46dbe8d0` | Located, not committed |
| SRC-PG-003 | `validation_report.md` — 328 checked, 255 pass, 73 review, with failure classes | Confidential | 18,427 B, 2026-07-24; SHA-256 `fe997eb5544994fa6d3be3304028f71b2e75781bf9f1b04f569c896ee81be228` | Reviewed as evidence |
| SRC-PG-004 | `sp_version_changes_fixed.sql` | Confidential business logic | 125,246 B, 2026-08-13; SHA-256 `57d6fc46f3e4c63887db5b221755aa5b10dd1591228a143100331467b8816ca2` | Located, not committed |
| SRC-PG-005 | `sp_bill_print_pg.sql` (byte-identical duplicate `sp_bill_print_pg(1).sql`) | Confidential business logic | 174,443 B, 2026-07-23; SHA-256 `c9e920a3b53d60946daf696f587b426fc788f032b583edce9cbe5a26439526b3` | Located, not committed |
| SRC-PG-006 | `hotfix_sp_fill_rpt_control.sql` | Confidential business logic | 15,150 B, 2026-08-22; SHA-256 `73384c9bc993e766f94c16beb7483a76cfb532695b5e088a777bd350e4de599e` | Located, not committed |
| SRC-PG-007 | `posgresqlautogenprimarykey1time.txt` — identity/primary-key generation notes | Confidential | 4,615 B, 2026-07-21; SHA-256 `8465d63ea760d81fa68465a5f99ca699fa1e1a88920cad98e69a0f06b2945f20` | Reviewed as evidence |
| SRC-PG-008 | `DataStructureChange.txt` / `DataStructureReverse.txt` | Confidential | 4,818 B each, 2026-07-22 / 2026-07-25; SHA-256 `26df39255af2194fd0aaf25c3896b86a589a22c176d06dccc7f29b75bcf87fac`, `4da893024ff2ff791bec6605b5300667195f038aa05565bab9bf749be07864f8` | Reviewed as evidence |
| SRC-META-002 | Live program metadata — `PROGRAM_TOP` 49, `PROGRAM_BODY` 1,308, `ENTRY_CONTROL` 704, `QUERY_TABLE` 216, `DATABASE_KEYS` 45, `HELP_PROPERTIES` 601 | Confidential application metadata | Read-only catalogue queries | Verified |
| SRC-META-003 | Account Master field contract independently verified — `PROGRAM_TOP_KEY` 14 carries exactly 87 `PROGRAM_BODY` rows | Confidential application metadata | Confirms the previously unverified 87-field claim in the database inventory | Verified |
| SRC-META-004 | Addon Sub field contract — `PROGRAM_TOP_KEY` 2 (`MASTER_ADDON_SUB`) carries 37 `PROGRAM_BODY` rows; `ADDON_SUB` has 40 columns and a clustered primary key | Confidential application metadata | Basis for the `MST-ADDON-001` gap measurement | Verified |
| SRC-LEG-002 | 322 Crystal `.rpt` templates present in legacy `HEAD`; only 2 present in the local working tree | Licensed/confidential | Counted by read-only Git object listing; never copied | Verified |
| SRC-LEG-003 | Legacy build `SMARTwinFA.exe` v1.0.0.0, rebuilt 2026-08-24; .NET Framework 4.8.09037 installed | Confidential | The legacy solution is under active development | Verified |
| SRC-CFG-001 | `Connection.INI` — `[DATABASE]` section with `ServerName` and `Password` keys | **Secret** | Key names only; values were never read into any artifact | Verified; values withheld |
| SRC-OPS-001 | Backup history — most recent full backup 2026-07-24; SQL Server Agent stopped and disabled | Restricted | Aggregate `msdb.backupset` query | Verified — live operational risk |

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

Resolved on 2026-08-24 and removed from this list: the MySQL question (no
MySQL exists), the archive version question (PostgreSQL 18.4, dumped by 18.3),
and the company-year topology question (separate physical databases named
`<CLIENT>_<YY>`). See the
[gap audit](migration-gap-audit-2026-08-24.md).

Still open:

- Which metadata source is authoritative when C#, `smart_setup`,
  `smart_system`, and client overrides disagree?
- How are legacy passwords stored in `smart_setup.USER_MASTER`, and can they be
  migrated safely? This is the single decision blocking `PLAT-AUTH-001`.
- Which clients require hard isolation, residency, dedicated performance, or
  non-standard report retention?
- Which of the 148 databases on the archive instance remain in scope, and are
  the `_BIGLOG` / `_IMAGE` companions to be migrated, archived, or retired?

The full list, with the answered questions recorded so they are not asked
again, is in [business-owner questions](business-owner-questions.md).
