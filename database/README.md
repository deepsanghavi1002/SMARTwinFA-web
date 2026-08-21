# Database workspace

No production database schema is committed yet. The previous Cloudflare D1
starter example was intentionally removed because the migration target is
PostgreSQL and the source dialect is still being reconciled.

Future reviewed artifacts should use this structure:

```text
database/
  migrations/          # immutable PostgreSQL schema migrations
  reference-data/      # sanitized, versioned shared reference data
  fixtures/synthetic/  # generated test data only
  contracts/           # expected tables, columns, routines, and result shapes
  validation/          # reconciliation queries with no embedded client data
```

Never add raw backups, `connection.ini`, production extracts, or private
fixtures. See `docs/migration/database-migration.md` before introducing a
database library or migration runner.
