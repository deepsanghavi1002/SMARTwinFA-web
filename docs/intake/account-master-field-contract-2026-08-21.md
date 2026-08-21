# Account Master field contract — discovery baseline

This is a non-executable structural baseline for the first vertical slice. It
was produced from the isolated `smart_setup` metadata record `program_top:14`
and never includes client rows, captions, default values, formulas, raw query
text, lookup text, or write behavior.

Run locally against the isolated intake database:

```text
node scripts/export-account-master-contract.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The generated contract contains 87 ordered field mappings across eight source
tables. The checked discovery result has contract hash
`7bb2c8ab75b6ab5f37ada8782371e9e1a00c9512c065b5540db12f13cc81bdbd`.

| Source table | Field mappings |
|---|---:|
| `ACCOUNT` | 37 |
| `ADDRESS` | 33 |
| `AC_BALANCE` | 4 |
| `ADDON_DATA` | 4 |
| `INT_MASTER` | 4 |
| `BALSHEET` | 2 |
| `IDOPT_MASTER` | 2 |
| `BOOK_PROPERTIES` | 1 |

Of the 87 fields, 76 are marked active in each add and update mode, 27 are
marked compulsory, 12 require a lookup contract, and 2 have a duplicate-check
flag. The source uses legacy type codes `T` (53 fields), `N` (16), `I` (15),
and `D` (3); these codes are evidence only and must not be mechanically mapped
to target types.

One field mapping is an expression rather than a direct catalog identifier. The
extractor withholds that expression and marks it `expression-review-required`.
All direct mappings remain `unreviewed`; no target field, lookup, validation,
permission, database constraint, or write command is approved yet.

The next Account Master task is a human-reviewed typed mapping: resolve each
legacy type/length/decimal/required/lookup/duplicate rule, identify candidate
keys and relationships, then create a read-only target definition with bound
parameters. Save/delete behavior stays blocked pending permissions,
`smart_system`, and routine/side-effect evidence.
