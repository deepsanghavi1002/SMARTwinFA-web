# Next executable slice — 2026-08-24

Derived from [the gap audit](../discovery/migration-gap-audit-2026-08-24.md).
This replaces guesswork about sequencing with the dependencies the audit could
actually verify.

## Why the assumed sequence is not yet correct

The plan proposes:

```text
Login → session → company/year context → RBAC → PostgreSQL
      → tenant isolation → audit → Addon Master persistence and parity
```

The direction is right, but two facts change the starting point.

1. **Steps 2–7 of that chain already exist as unit-tested pure functions** on
   `codex/source-engine-confirmation` — `session-state.ts`,
   `tenant-context.ts`, `permission-guard.ts`, `transaction-context.ts`,
   `audit-event.ts`. Starting from `main` would rewrite ~15.7k lines of
   reviewed work.
2. **Starting with Login is starting with the least-decided component.** The
   audit found that legacy credentials live in `SMART_SETUP.USER_MASTER`
   (8 rows) with rights in `SMART_SETUP.SECURITY` (465 rows) — not in
   `SMART_SYSTEM` as the plan assumes — and the legacy password encoding is
   still unknown and is a business/security decision (see
   [business-owner questions](../discovery/business-owner-questions.md)).
   Password migration blocks Login but blocks nothing else.

The smallest slice producing persistent business value is therefore **not**
Login. It is: *land the platform foundation, add a real PostgreSQL schema, and
make Addon Master persist under a server-derived context* — with a fixed
development identity standing in for Login behind an explicit seam.

## Recommended slice: SLICE-2026-08-24-A — "Addon Master persists"

**Goal:** a signed-in-by-fixture user can create, edit and delete Addon Sub
records that survive a restart, scoped to one tenant/company/accounting year,
authorized by a named permission, written in a transaction, and recorded in an
audit event.

### Backlog IDs in scope

| ID | Contribution |
|---|---|
| `PLAT-CTX-001` | Land and wire the context resolver |
| `PLAT-RBAC-001` | Land and wire the permission guard |
| `PLAT-DB-001` | First real PostgreSQL pool, roles and timeouts |
| `PLAT-RLS-001` | Forced tenant RLS on the new tables |
| `PLAT-AUDIT-001` | Append-only audit for the master write path |
| `DB-CONTROL-001` | Minimal control-plane schema (tenant, company, year, membership, grant) |
| `DB-CUSTOM-001` | `addon_group` and `addon_sub` typed model |
| `MST-ADDON-001` | The vertical slice itself |
| `PLAT-FIXTURE-001` | Disposable PostgreSQL for tests |

Explicitly **out of scope:** `PLAT-AUTH-001` (real Login), metadata compiler,
reports, printing, client overrides.

### Step 0 — unblock the repository (prerequisite, not optional)

Merge `codex/source-engine-confirmation` into `main` via pull request, or
close it with a recorded reason. Until then `main` and the backlog disagree
about ~15.7k lines. Nothing below should start first.

### Files and modules to change

| Path | Change |
|---|---|
| `platform/context/tenant-context.ts` | Merge as-is; no change required |
| `platform/rbac/permission-guard.ts` | Merge as-is |
| `platform/auth/session-state.ts` | Merge as-is |
| `platform/database/transaction-context.ts` | Merge as-is |
| `platform/audit/audit-event.ts` | Merge as-is |
| `platform/database/pool.ts` | **new** — pooled client, TLS, statement/idle timeouts, per-transaction `SET LOCAL` of the three scope settings, guaranteed reset on release |
| `platform/database/addon-sub-repository.ts` | **new** — the only module allowed to read/write `addon_sub`; every method takes a `ScopedTransaction` |
| `app/api/addon-groups/route.ts` | **new** — `GET` list groups for the resolved context |
| `app/api/addon-subs/route.ts` | **new** — `GET` list, `POST` create |
| `app/api/addon-subs/[id]/route.ts` | **new** — `PUT` update, `DELETE` remove |
| `features/addon-master/AddonMaster.tsx` | Replace `useState(initialAddonRecords)` with fetches; keep both presentation modes |
| `features/addon-master/types.ts` | Retype per the source contract (below) |
| `features/addon-master/mock-data.ts` | Reduce to labels/ordering; delete seeded records |
| `database/migrations/0001_control_plane.sql` | **new** |
| `database/migrations/0002_addon_master.sql` | **new** |
| `database/contracts/addon-sub.json` | **new** — expected columns, types, ordering |
| `database/fixtures/synthetic/addon-master.sql` | **new** — synthetic only |

### API contracts

All routes derive context server-side. **No route accepts a tenant, company,
accounting-year, database or schema value from the client.**

```text
GET    /api/addon-groups          -> 200 {groups:[{id,name,ordinal}]}
GET    /api/addon-subs?groupId=   -> 200 {records:[AddonSub]}
POST   /api/addon-subs            -> 201 {record} | 400 validation | 409 duplicate
PUT    /api/addon-subs/{id}       -> 200 {record} | 409 duplicate | 412 stale version
DELETE /api/addon-subs/{id}       -> 204 | 409 referenced
```

Every response is `403` when the permission is absent and `404` — never `403`
— when the row exists in another tenant, so existence is not leaked.

### PostgreSQL schema

`0001_control_plane.sql` creates `tenant`, `company`, `accounting_year`,
`subject`, `membership`, `permission_grant`, and `audit_event`, matching the
types already validated in `platform/context/tenant-context.ts`.

`0002_addon_master.sql` creates:

```text
addon_group(tenant_id, company_id, accounting_year_id, group_id, name, ordinal)
addon_sub  (tenant_id, company_id, accounting_year_id, sub_id,
            group_id, name, short_name, relate,
            margin numeric(18,4), state_id int, start_date date, last_date date,
            address_1..3, city, district, pin_code, remark, contact,
            telephone_no, mobile_no, fax, local_code, std_code,
            pan_no, aadhaar_no, vat_no, cst_no, gst_no, email, website,
            address_required boolean, version int, created_at, updated_at)
```

Required by the audit's findings:

- Composite primary key `(tenant_id, company_id, accounting_year_id, sub_id)` —
  the source's `PK_addon_sub` on `SUB_CODE` alone is not tenant-safe.
- Unique index on `(tenant_id, company_id, accounting_year_id, group_id,
  lower(name))` — implements the source's declared `DUPLICATE_CHK` on `NAME`.
- `relate` **`NOT NULL`**, mirroring `ADDON_SUB.SUB_RELATE`. This is the field
  whose omission currently makes a valid insert impossible.
- `margin numeric`, `state_id integer`, `start_date`/`last_date` as `date` —
  not text. Money uses `numeric`, never PostgreSQL `money`, per
  [ADR-003](../architecture/adr-003-postgres-security.md) and the locale risk
  recorded in [the database inventory](../discovery/database-inventory.md).
- `FORCE ROW LEVEL SECURITY` on both tables with a `tenant_id =
  current_setting('app.tenant_id')` policy.

**Open contract item:** `OPENING BALANCE` appears in the legacy screen contract
but has no `ADDON_SUB` column (the source points at `pk.sub_balance`). It is
**excluded** from this slice and recorded as a follow-up; the slice is not
"Addon Master complete" until its persistence path is resolved.

### Tenant, permission and audit rules

- Context comes only from `resolveTenantContext(...)`; the request may name a
  membership, company and year, and the resolver rejects anything not granted.
- Permissions: `addon_sub:read`, `addon_sub:create`, `addon_sub:update`,
  `addon_sub:delete`, checked by `requirePermission` before any repository call.
- Every write runs inside `beginScopedTransaction` and emits one audit event
  (`addon_sub.created` / `.updated` / `.deleted`) carrying subject, scope,
  record id, and changed-field names — never field values.

### Tests required

| Layer | Tests |
|---|---|
| Unit | Field validation, required `name` and `relate`, numeric/date/state coercion, duplicate detection |
| Migration | Both migrations apply and roll back on a disposable database |
| Repository | CRUD under scope; stale-version update returns 412 |
| RLS | Direct query with another tenant's setting returns zero rows; write fails closed |
| Authorization | Each verb without its grant returns 403; cross-tenant id returns 404 |
| Transaction | Failed write rolls back and emits no audit event |
| API | All routes for success, validation, duplicate, forbidden and not-found |
| Browser | Create → reload → record persists, in both legacy and modern modes |
| Legacy parity | Field set, order and labels match `PROGRAM_BODY` where `PROGRAM_TOP_ID = 2`; duplicate rule matches `DUPLICATE_CHK`; types match `ADDON_SUB` |

Fixtures are synthetic only. No client row, backup or export enters the
repository or CI.

### Acceptance criteria

1. A record created in the UI survives a full restart.
2. Two tenants with identical group and record names never see each other's
   rows, proven by an RLS test that bypasses the repository.
3. Removing any one grant produces `403` at the API, not just a hidden button.
4. Every write has exactly one matching audit event; every rollback has none.
5. The parity test proves the 37-field source contract is either implemented or
   explicitly recorded as deferred with a reason — no silent omissions.
6. CI is green on a clean runner, including the disposable-PostgreSQL job.

### Work classification

| Category | Items |
|---|---|
| **Claude can implement now** | Merging the platform branch; pool, repository, API routes, both migrations, RLS policies, wiring `AddonMaster.tsx`, all test layers, synthetic fixtures |
| **Needs database evidence** | `state_id` domain (extract the legacy state lookup); `OPENING BALANCE` persistence path; `SUB_RELATE` value domain |
| **Needs business-owner confirmation** | Whether `ADDRESS REQ`, `closing bal.` and `pk.sub_balance` are still in use or retired; whether the 8 prototype groups are the correct default set given `ADDON_FLD` holds 118 definitions |
| **Needs data authorization** | Any parity run against real client data |
| **Needs licensed runtime** | Nothing in this slice — printing is deliberately excluded |

### Risks

- **Merging 15.7k unreviewed lines** is itself a risk; it should land as a
  reviewed pull request, not a fast-forward.
- **`state_id` mapping is unresolved.** If the legacy state list is not a
  stable lookup table, storing the id may be wrong; confirm before migrating.
- **Composite keys diverge from the source's single-column PK.** Legacy
  `SUB_CODE` values are not unique across tenants, so a migration mapping table
  from legacy `SUB_CODE` to the composite key is required later.
- **No Node.js runtime on the audited workstation**, so this slice cannot be
  developed or verified there without installing one.
