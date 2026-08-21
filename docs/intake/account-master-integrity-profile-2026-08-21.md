# Account Master integrity profile — discovery baseline

This profile measures aggregate-only integrity facts in the isolated restored
company schema. It contains no client rows, keys, names, addresses, financial
amounts, raw metadata SQL, or procedure bodies.

Run it locally against the isolated intake database:

```text
node scripts/profile-account-master-integrity.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`016948c033137af2ee2f0a233cd29a0f956b38e1493c9ea2e69acbe67ca9b777`.

## Source boundary and type risks

The Account Master metadata references eight source tables, totalling 46,226
rows in the supplied representative company-year. Across them, 14 columns use
PostgreSQL `money` and 14 use timestamp-without-time-zone values. Those values
need business reviews for target `numeric` precision/currency and date-vs-wall-
time semantics; they must not be copied mechanically.

| Table | Rows | Candidate key profile |
|---|---:|---|
| `account` | 5,285 | `code`: no missing or duplicate groups; declared by `database_keys` only |
| `address` | 5,004 | `address_key`: no missing or duplicate groups; inferred only |
| `ac_balance` | 4,577 | `acbal_key`: no missing or duplicate groups; inferred only |
| `addon_data` | 22,506 | `aon_key`: no missing or duplicate groups; inferred only |
| `int_master` | 4,542 | `interest_key`: no missing or duplicate groups; inferred only |
| `balsheet` | 121 | `bs_key`: no missing or duplicate groups; inferred only |
| `idopt_master` | 143 | `idopt_key`: no missing or duplicate groups; inferred only |
| `book_properties` | 48 | `book_key`: no missing or duplicate groups; inferred only |

No candidate is approved for target constraint enforcement: the restored
schema itself has no PK/FK constraints, and uniqueness alone does not prove
the business invariant.

## Required exception decisions

| Candidate relationship | Finding | Required decision before target FK/unique rule |
|---|---|---|
| `address.code → account.code` | 1 unmatched reference; 5 duplicate `(code, address_id)` groups | Repair, preserve an approved legacy exception, or define a different target address identity. |
| `ac_balance.code → account.code` | 1 unmatched reference | Repair or approve historical/deleted-account retention behavior. |
| `int_master.code → account.code` | 1 unmatched reference | Repair or approve historical/deleted-account retention behavior. |

The profile does not modify the intake database. It deliberately marks all
clean candidates `review-required` and all exceptions
`repair-or-exception-required`; no automatic cleanup or constraint migration is
authorized by this result.
