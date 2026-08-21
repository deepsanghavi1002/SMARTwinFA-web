# Security policy

## Prototype warning

The current application is an interface prototype. It includes mock
credentials/data and does not provide production authentication, authorization,
tenant isolation, persistence, or secure session handling. It must remain on a
trusted development network until the production security gates are complete.

## Never commit

- `connection.ini` or any server name/password file.
- Client or production database exports, including custom-format PostgreSQL
  archives that happen to use a `.sql` extension.
- `.env` files, API keys, TLS/private keys, database URLs, or access tokens.
- Real PAN, GST, Aadhaar, bank, address, phone, email, invoice, ledger, payroll,
  or other client data.
- Raw client-specific query bundles unless they have been reviewed, sanitized,
  and approved as source artifacts.

Use synthetic fixtures for automated tests. Keep confidential source archives
in an access-controlled evidence store and reference them by hash only.

## Required production controls

- Server-side authentication and deny-by-default authorization for every route
  and operation; hiding a menu item is not an access control.
- Request-scoped tenant, company, and accounting-year context.
- Composite tenant-aware keys plus PostgreSQL row-level security as defense in
  depth for shared tables.
- Separate database owner, migrator, runtime, read/reporting, and job-worker
  roles with least privilege.
- Secrets supplied by a managed secret store; TLS for every network connection.
- Parameter binding for values and allowlisted catalog mappings for identifiers.
  Tenant/schema names must never come directly from an HTTP request.
- Append-only audit events for security, configuration, financial, migration,
  printing, export, and destructive operations.
- Cross-tenant negative tests in CI and before every release.
- Credential rotation and forced password reset for any legacy password that
  cannot be proven to use a modern one-way password hash.

## Reporting a vulnerability

Do not open a public issue containing exploit details, secrets, or client data.
Notify the repository owners through the private channel agreed by the project
team, including reproduction steps and affected versions without attaching
production exports.
