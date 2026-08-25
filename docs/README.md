# Documentation index

These documents are the migration system of record. GitHub issues may mirror
the backlog, but every issue must keep the stable ID used in this repository.

## Discovery

- [Current state](discovery/current-state.md)
- [Source register](discovery/source-register.md)
- [Demo video register](discovery/demo-video-register.md)
- [Database inventory](discovery/database-inventory.md)
- [Legacy-author intake, 2026-08-21](intake/pranavcomputers-2026-08-21/README.md)
- [PostgreSQL procedure conversion intake, 2026-08-21](intake/postgres-procedures-2026-08-21/README.md)
- [Local PostgreSQL restore evidence, 2026-08-21](intake/postgres-local-restore-2026-08-21.md)
- [`smart_system` metadata profile, 2026-08-21](intake/smart-system-metadata-profile-2026-08-21.md)
- [`smart_system` semantic boundary profile, 2026-08-21](intake/smart-system-contract-profile-2026-08-21.md)

## Architecture

- [Target architecture](architecture/target-architecture.md)
- [ADR-001: tenancy model](architecture/adr-001-tenancy-model.md)
- [ADR-002: metadata queries and client overrides](architecture/adr-002-query-customization.md)
- [ADR-003: PostgreSQL connections and security](architecture/adr-003-postgres-security.md)
- [AI-ready data architecture](architecture/ai-readiness.md)

## Migration

- [Roadmap](migration/roadmap.md)
- [Backlog CSV](migration/backlog.csv)
- [Feature inventory](migration/feature-inventory.md)
- [Database migration plan](migration/database-migration.md)
- [Stored-procedure intake](migration/procedure-intake.md)
- [Definition of done](migration/definition-of-done.md)

## Quality and operations

- [Test strategy](testing/test-strategy.md)
- [Control coverage seed](testing/control-coverage.csv)
- [Traceability template](testing/traceability-template.csv)
- [Cutover runbook](operations/cutover-runbook.md)

## Status vocabulary

Every tracked item uses one of these states:

`discovered → classified → designed → converted → unit-tested → data-parity-tested → flow-tested → load-tested → security-reviewed → tenant-UAT → cutover-ready → live → retired`

`blocked` may be used with a named dependency and owner. `Prototype` is a
separate implementation label and never implies production completion.
