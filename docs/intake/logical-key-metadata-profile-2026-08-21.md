# Logical-key metadata profile — discovery baseline

This profile records aggregate application-level key metadata from
`database_keys`. It does not export table names, field names, record-type
values, relationships, query text, or client rows.

Run it locally against the isolated intake database:

```text
node scripts/profile-logical-key-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`9b05bad240468ea4f2e1becd62b4e5b40ba6b3f3e80444e5cbc9bc737fbd6b1f`.

| Aggregate fact | Count |
|---|---:|
| Key-declaration records / records with a primary-table marker | 45 / 45 |
| Primary first-field records / additional primary-field slots | 45 / 0 |
| Foreign-table records / foreign first-field records | 0 / 0 |
| Additional foreign-field slots | 0 |
| Primary / foreign records missing their first field | 0 / 0 |
| Nonblank record-type categories / blank record-type records | 1 / 0 |

The 45 declarations describe only single-field primary keys and provide no
declared foreign relationships. They are application metadata, not enforced
PostgreSQL constraints, so target key and foreign-key design must be reconciled
against physical schemas, program behavior, and tenant/company boundaries before
approval.
