# Business-owner questions

Questions that technical inspection cannot answer. Every question previously
listed as "open discovery" that the
[2026-08-24 gap audit](migration-gap-audit-2026-08-24.md) resolved has been
removed from this list rather than repeated.

## Already answered — do not ask again

| Former question | Answer | Source |
|---|---|---|
| Is there a separate MySQL implementation? | No. No MySQL service, client, server or data directory exists on the authorized workstation. "MySQL" was terminology. | Gap audit, "Database reality" |
| Which engine does the running legacy application use? | Microsoft SQL Server — 2008 R2 (archive instance) and 2022 Express (active instance). | Gap audit |
| Is each company-year a database or a schema? | A separate physical database named `<CLIENT>_<YY>`, with optional `_BIGLOG` and `_IMAGE` companions. | Gap audit |
| Is `smart_system` available? | Yes — live on both instances; 25 tables, 25 primary keys, 26 procedures. | Gap audit |
| What is the current `MenuMaster` content? | 592 rows, live and readable. | Gap audit |
| Does a PostgreSQL conversion exist? | Yes — 328 routines statically checked, 255 passing, 73 needing review. | `SRC-PG-001`…`SRC-PG-003` |

## Open — security and identity

1. **How are legacy passwords stored in `SMART_SETUP.USER_MASTER`?** The audit
   deliberately did not read credential columns. Whether they are plaintext,
   reversibly encrypted, or hashed determines whether accounts can be migrated
   silently or every user must reset. This is the single decision blocking
   `PLAT-AUTH-001`.
2. **`Connection.INI` stores a `Password` key in plaintext beside `ServerName`.**
   Confirm this credential is scheduled for retirement with the legacy client,
   and that it is not shared across client sites. If it is shared, rotation is
   a pre-migration security task, not a cutover task.
3. **Who may grant cross-company or cross-year access?** `SMART_SETUP.SECURITY`
   holds 465 rows for 8 users. Confirm whether that grant model is per-user,
   per-role, or per-machine before it is normalized.
4. **Which clients require hard isolation, data residency, dedicated
   performance, or non-standard report retention?** Unchanged and still
   required for `ARCH-001`.

## Open — data scope and retirement

5. **Which of the 148 databases on the archive instance are still in scope?**
   Only 32 exist on the active instance. Confirm which are live clients, which
   are historical accounting years to migrate read-only, and which can be
   excluded entirely. This directly sizes `CUT-WAVE-001`.
6. **Are the `_BIGLOG` and `_IMAGE` companion databases in scope for
   migration, archival, or retirement?**
7. **`ADDON_FLD` holds 118 add-on field definitions, but the web prototype
   assumes 8 addon groups.** Confirm the correct default group set and whether
   groups differ per client.
8. **Are `ADDRESS REQ`, `closing bal.` and `pk.sub_balance` still in active
   use on the Addon Sub screen?** They exist in the source field contract and
   are unmodelled in the prototype. Retiring them is cheaper than migrating
   them, but only the owner can decide.
9. **Where should `OPENING BALANCE` for an Addon Sub persist?** It appears in
   the screen contract but has no `ADDON_SUB` column.

## Open — accounting semantics

10. **Canonical money, rounding and currency rules.** The source uses SQL
    Server `money` and the archive uses PostgreSQL `money` under an
    `English_India.1252` locale that does not exist on Linux hosts. The target
    should use `numeric`; the owner must approve scale and rounding
    (`ARCH-007`).
11. **Which metadata source is authoritative when C#, `smart_setup`,
    `smart_system` and client overrides disagree?** Unchanged and still
    required for `ARCH-002`.
12. **Are the 91 known `Smartwinfa_License` branches all still active?**
    Each must become a versioned override with an owner and a retirement date,
    or be deleted (`CUST-CLOSE-001`).

## Open — reporting and licensing

13. **Which of the ~214 unique report basenames are still used?** Migrating
    322 Crystal templates is the single largest reporting cost; a used/unused
    split changes the estimate more than any technical decision.
14. **Is there an entitlement to Crystal Reports and ComponentOne runtimes for
    a server-side or containerized target**, or must reporting be rebuilt
    without them?

## Open — operations

15. **The most recent full backup in the active instance's history is dated
    2026-07-24 and no Agent job schedules backups.** Confirm whether backups
    are taken by an external tool. If not, this is a live production risk
    independent of the migration.
16. **Target SLO, RPO, RTO, supported platforms and capacity** remain
    undecided (`ARCH-008`).
