# Add-on/custom-field metadata profile — discovery baseline

This profile measures the legacy custom-field definition and storage model with
aggregate-only queries. It contains no field labels, formulas, relationship
expressions, client values, PII, raw SQL, or stored-procedure bodies.

Run it locally against the isolated intake database:

```text
node scripts/profile-addon-metadata.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The checked profile hash is
`79144a5339cf1b099413224f35057223f3831abbf2a3ca263994001e3224628c`.

## Definition model

The supplied company-year has 118 add-on definitions: 69 use legacy type code
`I` and 49 use `M`. All 118 carry save, entry, document-print, calculation,
relationship, and positioning markers; 28 are marked for master usage and 13
carry an error marker. These markers are opaque legacy behavior—not target type,
validation, relationship, or rendering rules.

Every add-on definition must become a versioned typed contract with a stable
ID, explicit field type/precision, scope, validation, visibility, lookup,
write mapping, audit behavior, effective date, tenant/company/year override,
and test evidence. Raw marker values and expressions cannot be reused in the
web runtime.

## Storage model and exceptions

`addon_data` holds 22,506 rows. It is a polymorphic legacy projection rather
than a clean Account Master child table:

| Association signal | Rows |
|---|---:|
| Account-code scoped | 4,461 |
| Product scoped | 18,087 |
| Both account and product scoped | 44 |
| Neither scoped | 2 |
| Account codes not found in `account` | 24 |

The dual- and unscoped rows, plus 24 unmatched account codes, require repair
or a deliberate legacy exception before any target association, foreign key, or
custom-field projection is enabled. They also rule out modelling `addon_data`
as a simple `account_custom_field` table.

The profile is read-only and does not authorize migration writes, data repair,
or target constraints.
