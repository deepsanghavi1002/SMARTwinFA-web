# Program/view metadata profile — discovery baseline

This profile captures aggregate `program_top`/`program_body` structure. It
does not export screen labels, table names, raw query fragments, field values,
validation expressions, or lookup definitions.

Run it locally against the isolated intake database:

```text
node scripts/profile-program-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`75d2f42ac6a8416d140066fd8044e690e5f63028d2b931745dec0c5f7580d8cf`.

| Aggregate fact | Count |
|---|---:|
| Programs | 49 (42 master, 7 special) |
| Field definitions | 1,308 |
| Programs with update-query fragments | 47 |
| Programs with update-filter fragments | 43 |
| Programs with update-order fragments | 41 |
| Programs with add-on query/from fragments | 4 / 4 |
| Lookup-query fields | 104 |
| Validation fields | 113 |
| Duplicate-check fields | 14 |
| Compulsory fields | 311 |
| Orphan field records | 5 |
| Programs without field records | 1 |

The five orphan field records and one fieldless program require repair or an
explicit legacy exception. All query, validation, lookup, duplicate-check, and
add-on fragments remain source code to be transformed into reviewed typed
definitions; no fragment is permitted in the web runtime.
