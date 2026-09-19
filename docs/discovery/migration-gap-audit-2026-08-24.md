# Migration gap audit — 2026-08-24

Read-only delta audit of the committed migration plan against the code that
actually exists and against the legacy installation running on the authorized
Windows workstation. This document does not replace
[the roadmap](../migration/roadmap.md) or
[the backlog](../migration/backlog.csv); it supplies evidence for them.

## Audit scope

| Item | Value |
|---|---|
| Web repository commit audited | `000b150a9d11ad141c625eb03ba258fb6a14b2f2` (`main`, "Update CI actions for Node 24") |
| Additional web branches audited | `origin/codex/metadata-contract-foundation`, `origin/codex/source-engine-confirmation` (`58f34af`) |
| Migration-plan baseline commit | `100ad73` ("Add traceable migration architecture and delivery plan") — superseded by `000b150` |
| Legacy repository commit audited | `c3e669835503956787d54bdec9efabbad74b7087` (`main`, merge of PR #18) |
| Legacy inspection method | Read-only Git object queries; the legacy working tree was never checked out, modified, or committed to |
| Audit branch | `audit/migration-gap-2026-08-24` |

## Summary

| Category | Implemented | Partial | Missing | Blocked | Evidence |
|----------|-------------|---------|---------|---------|----------|
| Presentation shell | 3 | 1 | 0 | 0 | `app/page.tsx`, `app/modern-theme.css`, `features/startup/StartupGate.tsx` |
| Identity and session | 0 | 0 | 1 | 0 | No server code exists; `StartupGate.tsx:57` compares against `mock-data.ts` |
| Tenant/company/year context | 0 | 1 | 0 | 0 | `platform/context/tenant-context.ts` (unmerged branch, not wired) |
| Authorization / RBAC | 0 | 1 | 0 | 0 | `platform/rbac/permission-guard.ts` (unmerged branch, not wired) |
| PostgreSQL persistence | 0 | 0 | 1 | 0 | `database/` contains only `README.md`; no migrations, no driver dependency |
| Row-level security | 0 | 0 | 1 | 0 | No database layer exists to enforce it |
| Audit / outbox | 0 | 1 | 0 | 0 | `platform/audit/audit-event.ts` (unmerged branch, not wired) |
| Background jobs | 0 | 1 | 0 | 0 | `platform/jobs/job-state.ts` (unmerged branch, not wired) |
| Addon Master | 0 | 1 | 0 | 0 | `features/addon-master/AddonMaster.tsx` — in-memory only |
| Account Master | 0 | 0 | 1 | 0 | No route, component, API, or schema |
| Voucher / entry workflows | 0 | 0 | 1 | 0 | Menu labels only; selecting an item sets shell state |
| Reports and printing | 0 | 0 | 1 | 0 | `window.print()` only (`AddonMaster.tsx:412`, `:431`) |
| GST / e-invoice / e-way | 0 | 0 | 1 | 0 | Menu labels only |
| Tally / import / export | 0 | 0 | 1 | 0 | Menu labels only |
| Backup and restore | 0 | 0 | 1 | 0 | Menu label only |
| Automated tests and CI | 1 | 1 | 0 | 1 | `.github/workflows/ci.yml`; `tests/rendered-html.test.mjs`; **local verification blocked — no Node.js runtime on this PC** |
| Deployment / monitoring | 1 | 0 | 1 | 0 | `Dockerfile`, `compose.yaml` build the prototype; no monitoring, no SLO |
| Security controls | 0 | 1 | 0 | 0 | `SECURITY.md` and ignore rules exist; no runtime control is implemented |
| Source-engine discovery | 6 | 0 | 0 | 0 | Resolved on this PC — see "Database reality" below |

Counts are capabilities, not backlog rows. "Partial" for the platform modules
means the logic exists and is unit-tested on an unmerged branch but is not
reachable from any route, API, or database.

## What is genuinely implemented

Everything below is on `main` at `000b150` and is verifiable by reading the file.

| Capability | Status | Evidence |
|---|---|---|
| React 19 / TypeScript / Vinext application shell | production-implemented (as a prototype target) | `package.json`, `vite.config.ts`, `worker/index.ts` |
| Server-rendered login shell | integration-tested | `tests/rendered-html.test.mjs:28` asserts status, content type, and markup |
| Legacy/modern presentation toggle | prototype | `StartupGate.tsx:50-56` |
| Nine-group, 49-label navigation shell | prototype | `app/page.tsx:9-19`; asserted in `tests/rendered-html.test.mjs:44-56` |
| Home/splash surface | prototype | `app/page.tsx:72-80` |
| Docker/Compose packaging | prototype | `Dockerfile`, `compose.yaml`; `docker compose config` runs in CI only |
| Clean-install CI (lint, typecheck, build, test, compose validate) | production-implemented | `.github/workflows/ci.yml` |

The whole application is **1,566 lines across 11 source files**. There is no
`app/api` directory, no server action, no repository layer, no database client,
and no dependency on any database driver in `package.json`.

## What remains prototype-only

- **Login.** `StartupGate.tsx:57-60` accepts any non-empty password when the
  username matches the literal `"SRP"` in `features/startup/mock-data.ts:1`.
  There is no hashing, session, cookie, lockout, reset, or audit event.
- **Company/accounting-year selection.** Two hard-coded companies and three
  hard-coded years (`features/startup/mock-data.ts:2-10`). The selection is
  local React state; it is never sent anywhere and never constrains data.
- **Context strip.** `app/page.tsx:68` prints a hard-coded company name, date
  range, and user regardless of what the user selected on the previous screen.
- **Addon Master.** `useState` over `initialAddonRecords`; `save()` reports
  `"Master data saved (mock)"` (`AddonMaster.tsx:81`) and `remove()` reports
  `"Record deleted (mock)"` (`AddonMaster.tsx:85`). Data is lost on reload.
- **Print and refresh.** `window.print()` and a status-message update
  (`AddonMaster.tsx:412-417`, `:431`).
- **Window chrome.** Minimize/maximize/close buttons are decorative
  (`app/page.tsx:46`).

## Unmerged work that the plan does not account for

This is the largest single discrepancy found by the audit. Two branches are
pushed to `origin` and are **not merged into `main`, not referenced by any
committed document, and not covered by the roadmap**:

| Branch | Delta vs `main` | Content |
|---|---|---|
| `codex/metadata-contract-foundation` | 128 files, +15,731 | `platform/` modules, `scripts/` profilers, `docs/intake/` evidence, 36 test files |
| `codex/source-engine-confirmation` | 129 files, +15,766 | The above plus `58f34af` "Confirm SQL Server to PostgreSQL migration direction" |

It contains real, reviewable work:

- `platform/context/tenant-context.ts` — server-owned context resolution,
  membership/company/year validation, scoped cache keys, and
  `app.tenant_id` / `app.company_id` / `app.accounting_year_id` transaction
  settings.
- `platform/rbac/permission-guard.ts` — deny-by-default scoped authorization.
- `platform/auth/session-state.ts` — issue/validate/revoke session lifecycle.
- `platform/database/transaction-context.ts` — scope-bound transactions that
  refuse cross-context reuse.
- `platform/audit/audit-event.ts`, `platform/jobs/job-state.ts`,
  `platform/metadata/registry.ts`, `platform/custom-fields/definition.ts`,
  `platform/migration/bulk-runner.ts`.
- `scripts/repository-safety-check.mjs` plus `npm run security:check`.
- `docs/intake/postgres-local-restore-2026-08-21.md` and
  `docs/intake/postgres-metadata-catalog-2026-08-21.md`, which record an
  isolated PostgreSQL 18.6 restore of all three supplied archives.

**However**, `git grep "platform/" <branch> -- app features` returns nothing:
no UI, route, or API imports any platform module. These are pure functions
validated by `node --test` in isolation. Under
[the definition of done](../migration/definition-of-done.md) they are
`unit-tested`, not `integration-tested` and not production-implemented. They
carry no database, no HTTP surface, and no legacy parity evidence.

**Recommended action:** merge or explicitly close these branches. Leaving
~15.7k lines of platform foundation outside `main` while the backlog records
the same items as `discovered` makes the system of record wrong in both
directions.

## Verification not performed

[Step 4 of the audit could not be executed on this workstation.](../migration/roadmap.md)

| Required check | Result |
|---|---|
| `npm ci` | **not run** — Node.js is not installed |
| `npm run lint` | **not run** — same |
| `npm run typecheck` | **not run** — same |
| `npm test` | **not run** — same |
| production build | **not run** — same |
| `docker compose config` | **not run** — Docker is not installed |

`node`, `npm`, and `docker` are absent from `PATH` and from
`C:\Program Files\nodejs`, `%LOCALAPPDATA%\Programs\nodejs`, `%APPDATA%\npm`,
`%LOCALAPPDATA%\fnm`, and `%USERPROFILE%\.nvm`. Installing software was out of
scope for this audit. The repository's own CI (`.github/workflows/ci.yml`,
Node 24 on `ubuntu-latest`) remains the only executable evidence for the web
build, and this audit did not observe a run of it.

Consequently every "lint/type/build/test passes" claim in
[`README.md`](../../README.md) and
[`current-state.md`](current-state.md) is **documentation-only on this machine**
and is inherited from CI, not independently reproduced here.

## Database reality — resolved

The plan recorded conflicting evidence about SQL Server, MySQL, and
PostgreSQL, and treated the source engine as blocking. **The workstation
resolves it.**

### Engines actually present and running

| Engine | Version | Service | Role |
|---|---|---|---|
| Microsoft SQL Server | 2008 R2 RTM 10.50.1600.1, Developer Edition | `MSSQLSERVER` (running, automatic) | Archive/legacy instance — 148 non-system databases |
| Microsoft SQL Server | 2022 RTM 16.0.1000.6, Express Edition | `MSSQL$SQLEXPRESS22` (running, automatic) | Active instance — 32 non-system databases |
| PostgreSQL | 18 | `postgresql-x64-18` (running, automatic) | Migration target; data directory on a dedicated local data volume |
| MySQL | — | **no service, no client, no server, no data directory** | Does not exist on this machine |

1. **The running legacy application uses Microsoft SQL Server.** Both instances
   carry `SMART_SETUP` and `SMART_SYSTEM` with identical metadata row counts
   (`MenuMaster` 592, `PROGRAM_TOP` 49, `SECURITY` 465).
2. **No separate MySQL implementation exists.** "MySQL migration" is
   terminology, not a source engine. `SRC-DB-005` can be closed as
   *does-not-exist* rather than *missing*, and `DISC-DB-001` is unblocked.
3. **Company-year data are separate physical databases**, not schemas. They are
   named `<CLIENT>_<YY>`, with optional `_BIGLOG` and `_IMAGE` companions. This
   answers the open question in [`source-register.md`](source-register.md).
4. **`smart_system` is not missing.** It is live on both instances: 25 tables,
   26 procedures, 2 functions, 25 primary keys.

### Authorization data is not where the plan assumes

| Table | `SMART_SETUP` rows | `SMART_SYSTEM` rows |
|---|---:|---:|
| `SECURITY` | **465** | 0 |
| `USER_MASTER` | **8** | 4 |
| `LOGIN` | — | 0 |
| `COMPANY` | — | 176 |
| `CNAME` | — | 175 |
| `YEAR_AC` | — | 16 |
| `DASHBOARD_DETAIL` | — | 19 |
| `DOCUMENT_PRINT` | 5 | 8 |

[`current-state.md`](current-state.md) states that "`smart_system` holds users,
rights, …". On this deployment the populated rights store is
`SMART_SETUP.SECURITY` (465 rows) and `SMART_SETUP.USER_MASTER` (8 rows);
`SMART_SYSTEM.SECURITY` and `SMART_SYSTEM.LOGIN` are **empty**. `SMART_SYSTEM`
holds company, company-name, year, and dashboard routing. `ARCH-005` and
`SEC-WAVE-001` must be planned against `SMART_SETUP`, not `SMART_SYSTEM`.

This independently corroborates the intake note on
`codex/source-engine-confirmation` that the restored `smart_system`'s "empty
security and login record sets cannot prove authorization behaviour" — the
records were never there to begin with.

### The PostgreSQL conversion silently dropped all integrity objects

Comparing the live SQL Server company-year database against the PostgreSQL
custom archive of the same database (`SRC-DB-001`), as catalogued in
[`database-inventory.md`](database-inventory.md):

| Object | SQL Server source | PostgreSQL archive | Delta |
|---|---:|---:|---|
| Tables | 78 | 75 | **3 tables absent** |
| Primary keys | **72** | 0 | **all lost** |
| Unique indexes | **164** | 0 | **all lost** |
| Non-clustered indexes | **25** | 0 | **all lost** |
| Identity columns | **82** | 0 (36 sequences in `smart_setup` only) | **all lost** |
| Foreign keys | 0 | 0 | none in either |
| Check constraints | 0 | 0 | none in either |
| Views | 0 | 0 | none in either |
| Triggers | 0 | 0 | none in either |

`SMART_SETUP` on SQL Server: 38 tables, 35 primary keys, 165 unique indexes,
42 identity columns. `SMART_SYSTEM`: 25 tables, 25 primary keys, 165 unique
indexes, 27 identity columns.

This materially changes `DB-INTEGRITY-001`. [`database-inventory.md`](database-inventory.md)
concludes that "the samples enforce very little relational integrity" and that
constraints "must not simply be added based on names… First measure duplicates,
orphans…". That conclusion was drawn from the *archive*, not the *source*. The
authoritative primary keys, unique indexes, and identity columns **exist in SQL
Server today and can be extracted directly**. Profiling is still required for
foreign keys (genuinely absent in both) and for the 45 logical relationships in
`DATABASE_KEYS`, but candidate-key discovery is no longer necessary for the
72 tables that already declare one.

The absence of foreign keys and check constraints is confirmed as a genuine
property of the legacy design, not an artefact of the export.

### Routine conversion is further along than the plan records

An unregistered SQL Server → PostgreSQL procedure conversion exists on this
workstation, in a `postgresql/` folder inside the legacy installation
directory:

| Stage | Count | Source |
|---|---:|---|
| Routines live in `SMART_SETUP` (SQL Server) | **346** (335 procedures, 10 scalar functions, 1 table-valued function) | `sys.objects` |
| Routines statically checked by the conversion | 328 | `validation_report.md` |
| Converted and passing static checks | 255 (284 `CREATE OR REPLACE` statements) | `procedures_validated.sql` |
| Converted but needing review | 73 (72 `CREATE OR REPLACE` statements) | `procedures_needs_review.sql` |
| Signatures present in the PostgreSQL archive | 283 across 282 names | [`database-inventory.md`](database-inventory.md) |

Two gaps follow: **18 live routines were never submitted to the conversion**
(346 − 328), and **45 converted routines are not present in the restored
archive** (328 − 283). Recorded failure classes in the review queue include
`END IF without IF`, `END; closes IF`, unclosed `BEGIN`, `ELSIF outside IF`,
residual `TOP n`, `GOTO (no equivalent)`, `+=`, and up to 32 dynamic-cursor
TODOs in a single routine. These are parse-level defects, so `DISC-PROC-001`
and `DB-PROC-001` now have a concrete, sized work queue rather than an
unknown.

## Addon Master vertical slice — measured gap (MST-ADDON-001)

The web prototype corresponds to legacy program `MASTER_ADDON_SUB`,
`PROGRAM_TOP_KEY = 2`, screen heading `MASTER : ADDON SUB`. It persists to
`ADDON_SUB` in the company-year database.

| Dimension | Legacy | Web prototype | Gap |
|---|---|---|---|
| Field definitions | **37** (`PROGRAM_BODY` where `PROGRAM_TOP_ID = 2`) | 27 (`features/addon-master/mock-data.ts:4`) | **10 definitions unmodelled** |
| Persistence table | `ADDON_SUB`, **40 columns**, clustered PK `PK_addon_sub` on `SUB_CODE` | none | entire persistence layer |
| Addon groups | `ADDON_FLD`, **118 field definitions**; group key is `ADDON_SUB.PARA_ID` | 8 hard-coded names | group catalogue is data, not a constant |
| Representative row volume | `ADDON_SUB` 1,618 rows; `ADDON_DATA` 22,506; `ADDON_IENTRY` 28,895; `ADDON_AENTRY` 14,061 | 5 seeded records | — |
| Duplicate prevention | declared on `NAME` (`DUPLICATE_CHK` set on field order 4) | implemented in `AddonMaster.tsx:78`, case-insensitive within group | **parity achieved** |
| Required field | `NAME` | implemented (`AddonMaster.tsx:77`) | **parity achieved** |

### Fields present in legacy and absent from the web model

`RELATE` (order 30) → `ADDON_SUB.SUB_RELATE`, which is **`NOT NULL`** in the
source; `save date` (31) → `LAST_SAVEDATE`; `save time` (32) →
`LAST_SAVETIME`; `ADDRESS REQ` (33); `closing bal.` (34); `pk.sub_balance`
(35). Four structural fields are also unmodelled: the screen header, `SR_NO`,
the `SUB MASTER` group selector, and the `PK_SUB_CODE` primary key.

`SUB_RELATE` being `NOT NULL` means **the current web model cannot produce a
valid `ADDON_SUB` insert**, even ignoring authentication. This is a hard
blocker for the slice, not a cosmetic omission.

### Type contract violations

The prototype types every field as `string` (`features/addon-master/types.ts`).
The source disagrees:

| Field | Legacy `FIELD_TYPE` | `ADDON_SUB` column type | Web type |
|---|---|---|---|
| `OPENING BALANCE` | `N` | *(no column — held in a separate balance table, cf. `pk.sub_balance`)* | `string` |
| `MARGIN` | `N` | `PROFIT_MARGIN money` | `string` |
| `LOCAL CODE`, `STD CODE` | `N` | `nvarchar` | `string` |
| `START DATE`, `LAST DATE` | `D` | `SUB_STARTDT`, `SUB_LASTDT` `datetime` | `string` |
| `STATE` | `I` (lookup) | `STATE_ID int` | `string` (state **name**) |

The web stores the state *name*; the source stores a *numeric id*. The
36-entry list in `mock-data.ts:13` is a hard-coded constant with no mapping to
`STATE_ID`. Label drift also exists: legacy `AADHAR NO` vs web `AADHAAR NO`.

`OPENING BALANCE` appears in the screen contract but has no column in
`ADDON_SUB`, so its persistence path must be resolved before the slice can be
called complete.

### Not yet evidenced for this slice

Permissions, tenant/company/year scope, transactions, concurrency, audit
history, real printing, error handling, and legacy parity tests — none exist in
any form. **`MST-ADDON-001` must remain incomplete.** Its status moves from
`discovered` to `prototype` with a measured gap, not toward completion.

## Evidence found on this workstation

| Evidence ID | Artifact | Location (username removed) | Size / date | SHA-256 | Handling | Unblocks |
|---|---|---|---|---|---|---|
| SRC-ENG-001 | SQL Server 2008 R2 instance, 148 databases | local default instance | live | n/a | Restricted — never export | DISC-DB-001 |
| SRC-ENG-002 | SQL Server 2022 Express instance, 32 databases | local named instance | live | n/a | Restricted — never export | DISC-DB-001, DISC-SYS-001 |
| SRC-ENG-003 | PostgreSQL 18 service and data directory | local fixed drive | live | n/a | Restricted | DISC-PG-001 |
| SRC-ENG-004 | MySQL absence confirmed | whole machine | n/a | n/a | n/a | closes SRC-DB-005 |
| SRC-PG-001 | `procedures_validated.sql` — 255 converted routines | legacy install `postgresql/` | 12,136,820 B, 2026-08-22 | `b625583bdc145ce6b5f234f973543ba4c1af05eca4ca83a073d70a51db4e34fd` | Confidential business logic — not committed | DISC-PG-001, DB-PROC-001 |
| SRC-PG-002 | `procedures_needs_review.sql` — 73 routines | legacy install `postgresql/` | 9,005,627 B, 2026-08-22 | `fdf8bba7b292a6130e6067a7f53961ce035d3273cad1f8941f889e2b46dbe8d0` | Confidential business logic — not committed | DISC-PROC-001, DB-PROC-001 |
| SRC-PG-003 | `validation_report.md` — 328 checked, 255 pass, 73 review | legacy install `postgresql/` | 18,427 B, 2026-07-24 | `fe997eb5544994fa6d3be3304028f71b2e75781bf9f1b04f569c896ee81be228` | Reviewed as evidence | DISC-PROC-001 |
| SRC-PG-004 | `sp_version_changes_fixed.sql` | legacy install `postgresql/` | 125,246 B, 2026-08-13 | `57d6fc46f3e4c63887db5b221755aa5b10dd1591228a143100331467b8816ca2` | Confidential | DB-PROC-001 |
| SRC-PG-005 | `sp_bill_print_pg.sql` (duplicated as `sp_bill_print_pg(1).sql`) | legacy install `postgresql/` | 174,443 B, 2026-07-23 | `c9e920a3b53d60946daf696f587b426fc788f032b583edce9cbe5a26439526b3` | Confidential | PRN-REP-001 |
| SRC-PG-006 | `hotfix_sp_fill_rpt_control.sql` | legacy install `postgresql/` | 15,150 B, 2026-08-22 | `73384c9bc993e766f94c16beb7483a76cfb532695b5e088a777bd350e4de599e` | Confidential | DB-PROC-001 |
| SRC-PG-007 | `posgresqlautogenprimarykey1time.txt` — identity/PK generation notes | legacy install `postgresql/` | 4,615 B, 2026-07-21 | `8465d63ea760d81fa68465a5f99ca699fa1e1a88920cad98e69a0f06b2945f20` | Reviewed as evidence | DB-INTEGRITY-001 |
| SRC-PG-008 | `DataStructureChange.txt` / `DataStructureReverse.txt` | legacy install `postgresql/` | 4,818 B each, 2026-07-22 / 2026-07-25 | `26df39255af2194fd0aaf25c3896b86a589a22c176d06dccc7f29b75bcf87fac`, `4da893024ff2ff791bec6605b5300667195f038aa05565bab9bf749be07864f8` | Reviewed as evidence | DB-MAP-001 |
| SRC-META-002 | Live `MenuMaster` — 592 rows, both instances | `SMART_SETUP` | live | n/a | Application metadata — export sanitized only | DISC-MENU-001 |
| SRC-META-003 | Live program metadata — `PROGRAM_TOP` 49, `PROGRAM_BODY` 1,308, `ENTRY_CONTROL` 704, `QUERY_TABLE` 216, `DATABASE_KEYS` 45 | `SMART_SETUP` | live | n/a | Application metadata | DISC-META-001 |
| SRC-PRN-002 | `DOCUMENT_PRINT` — 5 rows in `SMART_SETUP`, 8 in `SMART_SYSTEM` | live | live | n/a | Restricted | DISC-PRINT-001 |
| SRC-LEG-002 | Legacy Crystal templates — 322 `.rpt` in legacy `HEAD`; only 2 present in the local working tree | legacy repository | — | n/a | Licensed/confidential — never copied | DISC-PRINT-001 |
| SRC-LEG-003 | Legacy build — `SMARTwinFA.exe` v1.0.0.0, rebuilt 2026-08-24 | legacy `bin/Debug` | — | n/a | Confidential | DISC-LEGACY-001 |
| SRC-CFG-001 | `Connection.INI` — keys `ServerName`, `Password` under `[DATABASE]` | legacy install and repository root | 94–119 B | withheld | **Plaintext password in configuration — never commit** | ARCH-003 |
| SRC-INTAKE-001 | `migration-intake/` handoff pack | legacy repository working tree | 2026-08-21 | n/a | Already committed as `docs/intake/pranavcomputers-2026-08-21/` on `codex/source-engine-confirmation` | — |

`.NET Framework 4.8.09037` is installed, matching the legacy target. The
legacy solution is actively developed: the working tree was rebuilt on the day
of this audit.

### Operational observation

The most recent full backup recorded in the active instance's `msdb`
`backupset` history is dated **2026-07-24** — approximately one month before
this audit. No SQL Server Agent job schedules backups (`SQLAgent$SQLEXPRESS22`
is stopped and disabled). `OPS-DR-001` and `UTIL-BACKUP-001` should treat this
as a current production risk, not only a migration concern.

## Backlog items newly unblocked

| ID | Was | Now | Basis |
|---|---|---|---|
| DISC-DB-001 | blocked | **discovered** | Both engines identified and versioned; MySQL disproven |
| DISC-SYS-001 | blocked | **discovered** | `SMART_SYSTEM` live and inventoried on two instances |
| DISC-PG-001 | blocked | **discovered** | Conversion artefacts located and hashed (SRC-PG-001…008) |
| DISC-MENU-001 | blocked | **discovered** | Live `MenuMaster`, 592 rows, reachable read-only |
| DISC-META-001 | blocked | **discovered** | Full metadata table inventory captured |
| DISC-PRINT-001 | blocked | **partially unblocked** | `DOCUMENT_PRINT` mappings found (13 rows total); the 322 Crystal templates remain licensed artefacts |
| DISC-PROC-001 | discovered | **classified** | 346 live / 328 converted / 255 passing / 73 review / 283 archived — sized |
| DB-INTEGRITY-001 | discovered | **evidence available** | 72 PKs, 164 unique indexes, 82 identity columns extractable from source |

`SRC-DB-005` (MySQL schema) should be reclassified from *Missing* to
*Does not exist*.

## Still genuinely blocked

- **PostgreSQL catalogue verification on this PC.** The local PostgreSQL 18
  service requires a password that this audit did not request, hold, or supply.
  Six directories exist under the data directory's `base/`, consistent with
  three user databases plus templates, but the names could not be confirmed.
  The authoritative PostgreSQL catalogue evidence remains the intake on
  `codex/source-engine-confirmation`, produced on a different machine.
- **Executable web verification** — no Node.js or Docker runtime here.
- **Legacy parity harness** (`DISC-LEGACY-001`) — requires a disposable
  environment and approved representative data; running the legacy application
  was out of scope for a read-only audit.
- **Golden datasets** (`DISC-DATA-001`) — needs data-governance approval.
- **Crystal Reports and ComponentOne runtimes** — licensed binaries; not
  copied, not inventoried beyond file counts.

## Immediate next tasks

1. Merge or close `codex/source-engine-confirmation` and
   `codex/metadata-contract-foundation`. Nothing else should start while 15.7k
   lines of platform foundation sit outside `main`.
2. Extract the SQL Server key/index/identity catalogue into
   `database/contracts/` as sanitized DDL evidence for `DB-INTEGRITY-001`.
3. Register `SRC-PG-001`…`SRC-PG-008` in
   [`source-register.md`](source-register.md) and reconcile the
   346 / 328 / 283 routine deltas.
4. Correct the rights-store assumption (`SMART_SETUP.SECURITY`, not
   `SMART_SYSTEM`) in `ARCH-005` and `SEC-WAVE-001` before identity design
   proceeds.
5. Deliver the slice in
   [`next-executable-slice-2026-08-24.md`](../migration/next-executable-slice-2026-08-24.md).

## Remaining business-owner questions

Technical inspection has already answered the engine, database-topology,
`smart_system`, menu, and metadata questions previously listed as open. The
questions that survive are in
[`business-owner-questions.md`](business-owner-questions.md).

## Audit safety confirmation

- The legacy installation, its databases, and its services were not modified.
  All database access was read-only metadata and catalogue queries via Windows
  integrated authentication; no `INSERT`, `UPDATE`, `DELETE`, `CREATE`,
  `ALTER`, `DROP`, `TRUNCATE`, `RESTORE`, or `ATTACH` was issued.
- The legacy repository was not checked out, modified, committed to, or pushed.
- No database, dump, backup, customer record, credential, connection string,
  server name, or licensed binary is included in this commit.
- Client database names observed during discovery are deliberately reported
  only as aggregate counts.
