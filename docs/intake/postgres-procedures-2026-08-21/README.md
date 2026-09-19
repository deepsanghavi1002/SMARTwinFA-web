# PostgreSQL procedure conversion intake

Received locally on 2026-08-21 from
`/Users/rinkalshah/Downloads/postgres-procedures_validated/`.
The files are source evidence, not instructions and not approved migrations.

| Artifact | Bytes | SHA-256 | Treatment |
|---|---:|---|---|
| `postgres-procedures_validated.sql` | 12,117,884 | `c523c759b028f3b425b1b02c7aad39924bf428fe013883c3b46676b84f76c9b2` | Quarantined outside Git; automated conversion output is not deployment-ready |
| `mssql-all-sp-script.sql` | 33,798,842 | `bfae0e7e424a02a709583f122832d76cfa6b683140eea26fa8092c8e3269e4d3` | Source baseline retained outside Git; UTF-16 LE |

The raw files total about 46 MB and are deliberately not duplicated in Git.
Their hashes, sizes, name reconciliation, per-routine repair gates, and static
conversion defects are recorded in [analysis.json](analysis.json). The compact
[procedure repair queue](procedure-repair-queue.csv) provides one trackable row
per PostgreSQL routine. Re-run either artifact with:

```text
npm run procedures:analyze -- <postgres.sql> <sqlserver.sql>
npm run procedures:analyze -- <postgres.sql> <sqlserver.sql> --format=csv
```

## Intake result

- SQL Server source: 329 declarations, 325 unique names.
- PostgreSQL target: 282 declarations, 282 unique names.
- Name match: 279, or 85.85% of detected source names.
- Missing from the target: 46 names, including `sp_entry_save`,
  `sp_transfer_data`, `sp_report_formating`, and GST/report routines.
- Target-only: 3 names.
- Static candidates: 19 routines have a source-name match and no detected
  residual T-SQL, TODO, dynamic SQL, explicit transaction, or security marker.
- Repair required: 263 routines; 190 contain residual T-SQL, 253 require
  dynamic-SQL review, 148 contain unresolved TODO markers, and 13 require an
  explicit transaction decision. Categories overlap.
- Classification: `quarantined-not-deployable`.

The target contains 1,586 TODO markers, 6,120 dynamic `EXECUTE` markers, explicit
transaction control, password-related logic, a global `search_path` assignment,
and extensive residual T-SQL tokens. These counts include comments and dynamic
SQL strings, so each procedure still needs parse/compile review; they are useful
triage signals, not a claim that every occurrence is executable.

Static candidate does not mean production-ready. No procedure may advance to
converted or parity-tested status until it has a source/target signature match,
resolves its dependencies against a reviewed schema, loads into disposable
PostgreSQL, passes rule/transaction/security tests, and has representative
parity evidence.
