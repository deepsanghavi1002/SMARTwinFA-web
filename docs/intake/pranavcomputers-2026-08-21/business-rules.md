# Business Rules

## Confirmed from source

- Database access is SQL Server-specific and uses three logical database roles.
- Company and financial-year selection changes the active company database and
  date context.
- User rights, license values, entry style, print book, year/dashboard flags,
  and delivery flags gate behavior in source.
- Report generation is metadata-driven and can construct dynamic SQL, unions,
  filters, groups, slabs, and date columns.
- Repost, year-open, balance transfer, import, restore, and report formatting are
  delegated to stored procedures or database operations.
- Printing can produce Crystal output, direct printer output, PDF, e-mail, and
  WhatsApp delivery depending on flags and configuration.

## Unresolved and must not be guessed

Debit/credit posting, GST/tax calculation, rounding, stock valuation, discount
and allocation rules, interest, numbering, accounting-year close/open details,
period locking, import validation, edit/delete/cancel semantics, trigger side
effects, transaction boundaries, and rollback behavior. These require routine
bodies, schema constraints/triggers, setup metadata, representative sanitized
data, and legacy-vs-destination parity tests.

## Required evidence matrix

For each rule, capture source object/path, input fixture, expected output,
database writes, error behavior, permissions/license context, effective date,
and an owner sign-off. Keep conflicting or client-specific observations as
separate cases rather than collapsing them into one rule.
