# Legacy SQL Server read-only intake

The lower-environment SQL Express instance is the authoritative legacy source.
PostgreSQL archives and converted routines are comparative migration evidence,
not the source of truth.

`scripts/intake-legacy-sqlserver.mjs` discovers the SQL Server catalogue using
the existing `Connection.INI` convention. It never runs routines, selects
application rows, writes to the source, or emits a server name, password,
connection string, raw SQL, view definition, or routine body.

Run from the web repository only after the lower environment is reachable:

```text
node scripts/intake-legacy-sqlserver.mjs \
  --ini /outside/repository/Connection.INI \
  --output /private/tmp/smartwinfa/sqlserver-sanitized-2026-08-24.json \
  --private-output /private/tmp/smartwinfa/sqlserver-objects-2026-08-24.json \
  --observed-on 2026-08-24 \
  --allow-legacy-sa
```

`--allow-legacy-sa` is explicit because the desktop program conventionally
uses `sa`; a dedicated, least-privilege read-only SQL Server login is preferred
when it can be created. If the lower environment has a self-signed SQL Server
certificate, add `--trust-server-certificate`. Do not use that flag for an
untrusted or production server.

The sanitized output is aggregate-only and is safe to review before a derived
document is committed. The optional private output contains only object names,
columns, types, and constraint names; it remains outside Git and is restricted
evidence. Neither output contains rows, routine/view definitions, or
credentials.

After the first inventory, the team will register the actual SQL Server version,
database count, object counts, metadata/control-plane structure, company/year
routing, custom-view differences, and routine conversion queue. Every write
path remains blocked until its source behavior, permissions, transactions, and
accounting effects have a reviewed PostgreSQL target contract.
