# `smart_system` metadata profile — discovery baseline

This profile records aggregate control-plane facts from the supplied local-only
`smart_system` archive. It exports no rows, passwords, credential fields,
permissions, routing values, query text, or routine bodies.

Run it locally against the isolated intake database:

```text
node scripts/profile-smart-system-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The archive SHA-256 is
`e1506122961941a20fbe347b2c85c374d3f7603b0f84329bba2b7255992379f5`.
The checked profile hash is
`a605e4e7d488fe915eedeecce987e971b57a1587df8e2369af731653c0a7bc0f`.

| Aggregate fact | Count |
|---|---:|
| Tables / columns / exact rows | 24 / 855 / 448 |
| Functions / procedures (not executed) | 12 / 6 |
| Primary keys / foreign keys / `money` columns | 3 / 0 / 65 |
| Company / accounting-year records | 173 / 16 |
| User / security records | 4 / 0 |
| Dashboard-definition / user-dashboard records | 19 / 19 |
| Shared print-staging records | 8 |
| Login records | 0 |

The archive unblocks structural discovery of the control plane, but it cannot
yet establish password migration behavior, effective authorization, company-year
routing, dashboard semantics, or the print-staging lifecycle. In particular,
the empty security and login record sets cannot serve as rights or authentication
parity evidence. All restored routines remain quarantined and were not run.
