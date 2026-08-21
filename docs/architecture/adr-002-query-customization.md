# ADR-002: Versioned query/view manifests, not raw client SQL

- Status: Proposed
- Required before: migrating any generic master, entry, report, or dashboard

## Context

Legacy screens concatenate `program_top` fragments, ordered `program_body`
fields, token replacement, table/condition metadata, client `addon_fld`
columns, and hard-coded C# branches. The sample Account Master expects 87 fixed
and 33 client fields. Procedures use extensive dynamic SQL and client schema
names. Raw tenant SQL in a web request path would create injection, privilege,
versioning, pooling, and regression risks.

## Decision

Create a versioned metadata compiler and registry:

```text
definition source
  → parse and normalize
  → validate identifiers, parameters, permissions, joins, and output fields
  → compile a typed query/read-model contract
  → run syntax + tenant-isolation + golden-result tests
  → approve and activate a version
```

The application executes an active compiled definition by stable ID. It does
not accept raw SQL or a schema/table name from the browser.

## Manifest minimum

- Stable feature/screen/action ID and legacy metadata IDs.
- Version, owner, change reason, source hash, effective dates, and status.
- Named typed parameters, defaults, validation, and authorization scope.
- Catalog-owned table/field identifiers and supported joins/operators.
- Ordered output field ID, label, type, nullability, formatting, and lineage.
- Write command, affected aggregates, transaction/isolation requirements, and
  audit event for mutable actions.
- Override scope and precedence: global → module → tenant → company →
  accounting year.
- Expected row shape, ordering, pagination, performance budget, and golden
  test fixtures.
- Rollback target and compatibility window.

## Custom fields

Replace tenant-specific physical columns with versioned custom-field
definitions plus typed values. Validated JSONB may hold sparse values during
transition, but fields used for joins, uniqueness, range filters, reporting,
or financial rules require explicit typed/indexed projections. Field IDs remain
stable when labels change.

## Temporary compatibility path

Legacy SQL may run only in an isolated compatibility repository when:

- its source and dialect are recorded;
- identifiers come from an allowlisted catalog and are quoted safely;
- all values use bound parameters;
- output is checked against a typed contract;
- the query has tenant, permission, timeout, row-limit, and audit controls;
- a tracker item names its replacement/retirement date.

String interpolation such as `|sys.yearid|`, unqualified columns, client-name
branches, and session-dependent `zz_resultset_*` tables are prohibited in the
target runtime.

## Implemented foundation

`platform/metadata/definition.ts` provides the first source-independent
registry boundary. It validates a metadata manifest before future persistence
or compilation, rejects raw SQL properties, restricts identifiers to the
catalog-shaped format, requires an audit event for write actions, and resolves
only active/effective definitions with deterministic override precedence:
global → module → tenant → company → accounting year.

`platform/metadata/registry.ts` adds the controlled lifecycle around those
contracts. Definitions enter as drafts and can only advance through validated,
approved, active, and retired states. It rejects duplicate identities, skipped
approval states, and overlapping active versions at the same scope while
allowing a more-specific tenant/company/year override. Each transition emits
immutable audit evidence.

These foundations are deliberately not a SQL compiler or execution path. Client definitions,
catalog entries, PostgreSQL queries, permissions, source hashes, golden
fixtures, and approval workflow remain blocked until their authoritative source
artifacts are received and reviewed.

## Account Master acceptance example

`MST-ACCOUNT-001` cannot close until tests prove:

- the exact standard and client-added field set, order, types, labels, and
  visibility;
- the fiscal-year parameter is consistent and never hard-coded;
- all joins and filters are qualified;
- add/update/delete validation and transaction behavior;
- permission behavior and cross-tenant denial;
- result and write-side-effect parity for representative clients/years;
- safe behavior when a custom field is added, changed, disabled, or missing.
