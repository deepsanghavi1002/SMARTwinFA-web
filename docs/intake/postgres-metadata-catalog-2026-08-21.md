# PostgreSQL metadata catalogue — sanitized intake evidence

This catalogue is the first reproducible extraction from the local
`smart_setup` and representative company-year PostgreSQL intake. It is derived
only from aggregate system-catalog and metadata statistics. It contains no
client rows, labels, query text, routine bodies, user details, password values,
or connection settings. The machine-readable counterpart is
[`postgres-metadata-catalog-2026-08-21.json`](postgres-metadata-catalog-2026-08-21.json).

## What it establishes

- `smart_setup` exposes 49 master-program definitions, 1,308 field definitions,
  592 menu records, 216 stored query definitions, 45 application-level key
  relationships, and 704 entry-control records.
- Account Master is `program_top:14`. It has 87 ordered field definitions;
  76 participate in add/update modes; 27 are compulsory; 4 have validations;
  12 have lookup query definitions; and 2 have duplicate checks.
- The restored company schema has no primary keys, foreign keys, views, or
  triggers. The 45 logical relationships in `database_keys` are therefore
  migration evidence to profile and verify, not constraints that can be copied
  blindly.
- Account Master query/add-on definitions are represented only by source
  length and checksum. They have not been approved, compiled, or executed.

## Immediate execution sequence

1. Extract a sanitized program/menu/key dependency graph and identify every
   metadata record that points to missing `smart_system` data or dynamic SQL.
2. Build a typed Account Master definition from reviewed field contracts,
   replacing raw query text with allowlisted tables, columns, operators, and
   bound parameters.
3. Profile the Account Master company tables for candidate keys, duplicates,
   orphaned logical relationships, money/date/flag domains, and custom-field
   projections before creating target constraints.
4. Only then implement the authenticated, tenant/company/year-scoped Account
   Master read path; writes remain blocked until the save routine, permissions,
   and side effects have been verified.

The source remains discovery-only. It is not a production connection, a
permission model, or evidence of functional/accounting parity.
