# Account Master type matrix — discovery baseline

This matrix compares aggregate legacy field-code counts to directly resolvable
physical PostgreSQL types for `program_top:14`. It contains no client values,
labels, raw expressions, or SQL.

Run it locally against the isolated intake database:

```text
node scripts/profile-account-master-type-matrix.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked matrix hash is
`7d8a2212719be65f3b0ac39a1f7dc4aa1810eec53b5eaa5734de41650b877537`.

Of 87 Account Master metadata fields, 76 resolve directly to a physical column
and 11 do not. The unresolved set includes expression/alias/join behavior and
must become a reviewed source contract before the target can query it.

| Legacy field code | Physical PostgreSQL type | Field mappings |
|---|---|---:|
| `D` | `date` | 1 |
| `D` | `timestamp without time zone` | 2 |
| `I` | `integer` | 13 |
| `I` | unresolved | 2 |
| `N` | `integer` | 2 |
| `N` | `smallint` | 2 |
| `N` | `numeric` | 5 |
| `N` | `money` | 5 |
| `N` | unresolved | 2 |
| `T` | `character varying` | 46 |
| `T` | unresolved | 7 |

The matrix explicitly does not map legacy codes to target types. Five source
fields use `money`, five use `numeric`, and two use timestamp-without-time-zone
values. Financial owners must set target precision/currency/rounding, and
product owners must classify timestamps as dates, local wall times, or instants.
Every matrix row remains `review-required` until that mapping, lookup behavior,
null handling, and golden-output evidence are approved.
