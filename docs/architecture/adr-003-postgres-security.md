# ADR-003: PostgreSQL connection and security model

- Status: Accepted for implementation; operational role provisioning pending
- Required before: first persistent vertical slice

## Decision

All PostgreSQL access is server-side through a bounded pool. The browser sends
only stable public IDs. A server-owned catalog resolves tenant placement and any
temporary legacy schema. Each command/query runs in an explicit transaction
with immutable context.

Illustrative sequence (exact implementation to be selected and tested):

```sql
BEGIN;
SET LOCAL ROLE smartwin_runtime;
SELECT set_config('app.tenant_id', :tenant_id, true);
SELECT set_config('app.company_id', :company_id, true);
SELECT set_config('app.accounting_year_id', :accounting_year_id, true);
-- execute parameterized repository operation
COMMIT;
```

Do not use `search_path` as the isolation boundary. If the compatibility layer
must select a legacy schema, resolve it from an immutable catalog, quote it as
an identifier, scope it with `SET LOCAL`, qualify sensitive objects, and reset
state by ending the transaction.

## Roles

| Role | Purpose |
|---|---|
| owner | Owns database objects; no application login |
| migrator | Applies reviewed migrations; unavailable to runtime |
| runtime | Executes approved commands/queries under RLS |
| reporting | Read-only access to approved read models |
| job worker | Narrow permissions for assigned job classes |
| backup/restore | Operational role with audited break-glass controls |

Revoke default access, including `PUBLIC EXECUTE` on imported routines. Runtime
roles must not be superusers, object owners, or `BYPASSRLS`.

## Query safety

- Use prepared/bound values. For unavoidable dynamic identifiers, use a
  catalog allowlist and PostgreSQL identifier quoting; never concatenate a
  request value.
- Use schema-qualified names in security-definer code and a trusted
  `search_path` that excludes user-writable schemas.
- Set statement, lock, idle-in-transaction, and job-specific timeouts.
- Separate interactive and reporting/job pool budgets.
- Remove designs that require the next request to receive the same database
  session. Temporary/fixed result tables must be job-scoped or replaced.
- Redact parameter values and PII from errors/logs; log a query fingerprint and
  correlation ID instead.

## Credentials and transport

`connection.ini` is retired. Deployment configuration stores only secret
references; a managed secret service provides credentials at runtime. Require
TLS, rotate credentials, and support dual-secret rotation. Passwords imported
from legacy systems require algorithm verification; plaintext/reversible/weak
values trigger reset rather than re-storage.

## Verification gates

- Pool saturation/recovery, transaction cleanup, and failover tests.
- RLS default-deny and forced-owner behavior tests.
- Cross-tenant FK/uniqueness and negative API/repository tests.
- SQL injection corpus for values and identifiers.
- Search-path and security-definer review.
- Backup with RLS-safe role and successful isolated restore drill.
- Connection leakage test proving one request cannot inherit another tenant's
  context.

## Implemented foundation

Migration `0001_control_plane.sql` revokes public schema/table/function access,
forces RLS on tenant-owned control, audit, job, and migration tables, and reads
scope only from transaction-local `app.*` settings. A clean local PostgreSQL
apply plus a non-owner runtime-role probe verified default-deny reads, matching
tenant reads, and denial of a cross-tenant insert. Production role creation,
TLS, pool limits, failover, secret-provider integration, and the full isolation
matrix remain deployment and integration gates.
