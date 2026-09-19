# Metadata Intake

No sanitized database export was found. The following metadata is referenced
by source and must be exported from authorized SQL Server databases with IDs,
field order, types, labels, flags, permissions, query references, and effective
dates preserved:

- menu hierarchy, `MenuMaster`, `program_top`, and `program_body`;
- account/product addon fields and entry metadata;
- report properties, controls, control values, output columns, checkboxes,
  styles, help, formatting, and document mappings;
- dashboard user/detail metadata;
- books, series, entry styles, and report routing;
- setup/configuration, company/year routing, users, roles, and rights;
- client/license override metadata.

Export passwords and credential fields as absent or one-way hashed only after
the algorithm and salt/pepper requirements are documented. Never place raw
client rows, financial data, or connection values in this repository.
