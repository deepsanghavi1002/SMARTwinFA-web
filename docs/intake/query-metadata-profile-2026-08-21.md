# Stored-query metadata profile — discovery baseline

This profile records aggregate risk indicators for `query_table`. It does not
export query text, query names, parameters, output columns, token values, or
client data.

Run it locally against the isolated intake database:

```text
node scripts/profile-query-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`c18719eb6ff06860dcda4d3a0495571a759c4c23e5ca131bfc9c604c0b2373df`.

| Aggregate fact | Count |
|---|---:|
| Query records / query-text records | 216 / 216 |
| Other-query text records | 11 |
| Text program-link records | 216 |
| Numeric program-link records | 0 |
| Wildcard-output query records | 7 |
| Legacy `|sys.*|` token query records | 214 |
| Detected `TOP`, `.dbo`, or `EXECUTE` records | 0 / 0 / 0 |

All 216 query records are quarantined from the web runtime. The 214 legacy
tokenized records need per-query parameters supplied by an authorized request
context, while the seven wildcard-output records need an explicit output
contract. Text program links cannot be assumed to be numeric foreign keys; they
need semantic reconciliation with program metadata and running legacy behavior.
