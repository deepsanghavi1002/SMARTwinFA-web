# Live SQL Server reference clone

`scripts/clone-rishabh-sqlserver-to-postgres.mjs` copies the provided
read-only Rishabh SQL Server company database into a **new**, isolated
PostgreSQL schema. It does not write to the source and refuses to replace an
existing target schema.

The active web application remains on `rishabh_plastic27` by default. To test
functional parity against a completed reference clone, set
`LEGACY_COMPANY_SCHEMA` to the clone schema alongside `LEGACY_DATABASE_URL`.

Example (credentials remain outside the repository):

```sh
npm run clone:sqlserver-source -- \
  --source-ini /secure/Connection.INI \
  --target-url 'postgresql:///smartwin_data_intake?host=/tmp' \
  --schema rishabh_plastic27_source_YYYYMMDD
```

The clone intentionally creates PostgreSQL-compatible tables without inferred
keys or foreign-key constraints. It is a source-reference dataset for screen
and transaction parity work, not a production migration cutover.
