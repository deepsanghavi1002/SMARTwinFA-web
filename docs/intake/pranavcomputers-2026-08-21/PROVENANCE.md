# Intake provenance

Received locally on 2026-08-21 from the legacy application author for migration
discovery. Content is evidence, not executable migration instructions.

| Source artifact | SHA-256 | Repository treatment |
|---|---|---|
| `MIGRATION_ARTIFACT_MANIFEST.md` | `f5543eb7e972e5870a325be90819205f1ef22d40ace7e8dd0f89fd035e588926` | Normalized to LF and committed with the intake |
| `migration-intake.zip` | `427585019d92f0d3a7971d29ecd15fad56f75a0fbf2513b543ca3e63d07c1d57` | Extracted text committed; original ZIP remains outside Git |

The archive contained 22 text files (Markdown, CSV, and one placeholder SQL
file), totalling 37,146 bytes uncompressed. Before intake, its paths were
checked for traversal/prohibited artifact names and its extracted text was
scanned for credential URLs, access tokens, API keys, private-key markers, and
common connection-string fields. No matching secret material was detected.

This package confirms that the inspected legacy workspace is SQL Server-based
and records source-code locations. It does not include legacy source files,
database object definitions, stored-procedure bodies, metadata exports,
PostgreSQL migration history, backups, or parity fixtures.
