# SMARTwinFA Web

SMARTwinFA Web is the new home for the cross-platform migration of the
SMARTwinFA financial accounting product. It preserves the latest web upgrade
from the legacy repository and adds the architecture, migration controls, and
quality gates needed to reach production parity.

> **Current status: PostgreSQL-backed prototype, not production software.**
> The recorded SMARTwinFA workflows use an isolated PostgreSQL test environment
> with mock data. Production authentication, authorization,
> tenant isolation, statutory integrations, and cutover controls are still not
> complete.

## What is present today

- React 19 and TypeScript application built with Vinext/Vite.
- Responsive legacy and modern presentation modes.
- Mock login and company/accounting-year selection flow.
- Accounting shell with 9 menu groups and 49 visible menu labels.
- Home navigation and branded splash screen.
- In-memory Addon Master prototype with 8 groups, 27 fields, lookup behavior,
  validation, add/update/delete, print, refresh, and responsive layouts.
- Docker/Compose packaging for the interface prototype.
- Passing lint, TypeScript, build, and rendered-shell tests.
- A traceable, phased migration plan covering the metadata runtime, database
  rules, client-specific queries, permissions, reports, printing, testing,
  rollout, and future AI readiness.
- An executable PostgreSQL control-plane migration with tenant-aware composite
  relationships, forced RLS, identity/session/RBAC storage, audit/outbox,
  durable-job, and migration-ledger foundations.
- A canonical accounting/inventory migration for Account Master, typed custom
  values, balanced journals, Product Master, and non-negative stock movements.

The imported UI is based on `SMARTwinFA/web` at legacy commit
`b3970e94991824574fd2106764e1b3e95e377c9e`. Earlier prototype history is also
preserved in this repository.

## Run locally

Install Docker Desktop, then start the complete local environment:

```bash
docker compose --env-file .env.docker -f compose.local.yaml up --build
```

Open [http://localhost:3000](http://localhost:3000). This starts the web app,
API, and isolated PostgreSQL mock database together. The mock-data package and
local settings stay outside GitHub. For the short setup and developer workflow,
see [development-workflow.md](docs/development-workflow.md).

## Required checks

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` performs a production build before running the baseline rendered
application checks. Browser interaction, PostgreSQL contract, permission,
parity, and migration tests are planned gates and must be added alongside each
vertical slice.

## Migration control center

- [Documentation index](docs/README.md)
- [Current-state inventory](docs/discovery/current-state.md)
- [Source and evidence register](docs/discovery/source-register.md)
- [Database inventory](docs/discovery/database-inventory.md)
- [Target architecture](docs/architecture/target-architecture.md)
- [Migration roadmap](docs/migration/roadmap.md)
- [Tracked backlog](docs/migration/backlog.csv)
- [Feature and flow inventory](docs/migration/feature-inventory.md)
- [Database migration plan](docs/migration/database-migration.md)
- [Test strategy](docs/testing/test-strategy.md)
- [Control coverage seed](docs/testing/control-coverage.csv)
- [Definition of done](docs/migration/definition-of-done.md)

## Data safety

Client backups, production data, `connection.ini`, credentials, private test
fixtures, and raw client-specific SQL exports do not belong in this repository.
Only reviewed schema migrations, sanitized metadata, synthetic fixtures, and
source-file hashes may be committed. See [SECURITY.md](SECURITY.md).

## Delivery policy

Migration work is completed as behaviorally complete vertical slices. A copied
screen is not complete until its API behavior, PostgreSQL rules, permissions,
tenant/client overrides, reports/printing effects, audit trail, automated
tests, legacy parity evidence, and user acceptance are all linked to the same
tracker item.
