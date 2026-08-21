# ADR-001: Hybrid cell-based tenancy

- Status: Proposed
- Decision owner: Project architecture/security owners
- Required before: production schema design

## Context

The legacy system resolves a company-year database/schema after login and then
stores that choice in process-global state. This fits a single-user desktop
process but creates connection, migration, cross-year reporting, and isolation
problems on the web. Client behavior also varies through metadata, license IDs,
company/database-name branches, and query/report files.

## Options considered

| Model | Advantages | Costs/risks |
|---|---|---|
| Database per tenant/company/year | Strong physical isolation; closest to some legacy deployments | Exploding database count, annual provisioning, hard cross-year reporting, connection/migration overhead |
| Schema per tenant/company/year | Easier initial import; familiar object names | Thousands of schemas, unsafe dynamic `search_path`, global migrations, pool/session fragility |
| Shared tables with tenant keys | Efficient operations and cross-year analytics; one canonical schema | Requires disciplined composite keys, RLS, isolation tests, and noisy-neighbor controls |
| Cell-based hybrid | Shared canonical model with bounded blast radius and dedicated placement when needed | Requires a routing control plane and cell operations |

## Decision

Adopt a cell-based hybrid target:

1. Standard tenants use shared canonical tables inside a bounded data cell.
2. Every business key and relationship carries `tenant_id`; company/year scope
   is explicit.
3. PostgreSQL RLS is forced on tenant tables for runtime roles, with
   transaction-scoped context.
4. Large/regulatory tenants may receive a dedicated cell/database while using
   the same application contracts and migration versions.
5. A temporary compatibility adapter may read legacy client/year schemas. It
   must resolve mappings from a server-owned catalog and may not accept an
   identifier from the browser.
6. New accounting years are records, not new database/schema names.

## Required invariants

- Composite primary/unique/foreign keys cannot reference rows across tenants.
- Runtime roles do not own tables and cannot bypass RLS.
- Background workers set the same tenant context as request handlers.
- Cache, queue, object-store, log, trace, metric, and idempotency keys are
  tenant-scoped.
- Migration tooling records cell, tenant, company, year, version, checksum,
  attempt, and reconciliation status.
- Automated tests prove cross-tenant reads/writes fail for APIs, direct
  repositories, reports, exports, jobs, and print artifacts.

## Implemented foundation

`platform/context/tenant-context.ts` now resolves an immutable context from a
server-owned membership and company-year catalog. A selection supplies only a
membership, company, and accounting-year identifier; tenant identity is derived
from the membership and the matching company/year must be open and permitted.
The module also derives tenant/company/year-scoped cache/job keys and
transaction-local PostgreSQL setting values.

This is a tested contract, not production identity or routing. Real
memberships, roles, company/year records, cell placement, sessions, PostgreSQL
transactions, and RLS remain dependent on `smart_system`, the approved control
plane schema, and the PostgreSQL platform implementation.

## Revisit criteria

Revisit only with measured evidence: cell size/latency, operational cost,
residency requirements, tenant data volume, backup/restore duration, or a
regulatory isolation mandate.
