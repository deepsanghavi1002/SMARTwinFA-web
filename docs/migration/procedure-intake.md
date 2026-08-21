# Stored-procedure and query intake

Use this process whenever additional routines or client SQL are provided. Raw
files remain outside Git until reviewed and sanitized.

## Intake record

Record for each artifact:

- source ID and SHA-256;
- provider/capture date and confidentiality;
- source engine, exact version, database/schema, encoding/collation, SQL mode;
- routine/query name, overload/signature, owner, caller, and business purpose;
- tenant/company/year scope and effective dates;
- tables/views/routines/files/templates it reads or writes;
- input types/defaults/null handling and result-set/output contract;
- transaction/isolation, temp/scratch objects, dynamic SQL, error behavior;
- permissions/security-definer behavior and secret/PII exposure;
- legacy test cases and representative expected results;
- target classification, owner, backlog ID, and status.

## Classification

Choose exactly one target:

1. Domain command: rewrite behind an application transaction and invariant.
2. Read/query: parameterized repository query or reviewed read model.
3. Report: versioned report definition, typed parameters/output, job if heavy.
4. Maintenance/migration: privileged audited job, never a normal user request.
5. Compatibility-only: isolated, time-bounded adapter with a retirement issue.
6. Obsolete/duplicate: retire with evidence that no active menu/client calls it.

## Mandatory review checks

- Identify mixed dialect syntax independently; do not assume “PostgreSQL” from
  the container format or “MySQL” from the program label.
- Replace string-built values with bound parameters.
- Resolve identifiers from allowlisted metadata and quote them safely.
- Qualify objects; review `search_path` and security-definer behavior.
- Replace broad `WHEN OTHERS` with expected error handling and rethrow unknowns.
- Eliminate global/fixed result tables and dependence on the next call receiving
  the same pooled session.
- Replace `SELECT *` with an explicit versioned result contract.
- Remove hard-coded tenant/schema/year names and undefined variables.
- Determine whether DDL/drop/temp behavior can become a durable job/read model.
- Validate monetary precision, date/time semantics, collation, empty vs null,
  ordering, duplicates, and multiple result sets.

## Completion evidence

- Source-to-target mapping and decision reviewed.
- Syntax/static analysis clean for the target dialect.
- Unit and disposable-PostgreSQL contract tests pass.
- Differential results and write side effects match golden legacy cases.
- Authorization, RLS, injection, timeout, rollback, concurrency, and pool reuse
  tests pass.
- Performance plan is within the feature budget.
- Definition version, checksum, deployment, rollback, and audit record exist.

The initial `smart_setup` inventory contains 283 signatures. The procedure
tracker must reconcile to that count, including the overloaded name, and then
expand when new source artifacts arrive.
