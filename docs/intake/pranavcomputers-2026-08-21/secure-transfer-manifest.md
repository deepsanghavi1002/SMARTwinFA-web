# Secure Transfer Manifest

Restricted artifacts are intentionally excluded from this repository. Hashes
are not fabricated. The workspace session could inspect the restricted path but
could not run the approved hashing command, so the SHA-256 field remains
`PENDING_SECURE_HASH` until an authorized operator computes it locally.

| Exact local path | SHA-256 | Size | Type | Why needed | Engine/version | Recommended handoff |
|---|---|---:|---|---|---|---|
| `e:\SMARTwinFA\Connection.INI` | `PENDING_SECURE_HASH` | `PENDING_SECURE_SIZE` | Credential-bearing INI | Server/database routing and legacy connection behavior | SQL Server; exact version unknown | Secret manager or encrypted out-of-band transfer; rotate password after use |
| `e:\SMARTwinFA\<smart_system backup path not present>` | Not present | N/A | SQL Server backup | System schema/data and company routing | SQL Server version unknown | Encrypted controlled object storage with restore log |
| `e:\SMARTwinFA\<company/year backup path not present>` | Not present | N/A | SQL Server backup | Accounting schemas/data and parity evidence | SQL Server version unknown | Encrypted controlled object storage with access audit |
| `e:\SMARTwinFA\<rishabh_plastic27 backup path not present>` | Not present | N/A | Client SQL Server backup | Named client migration/parity case | SQL Server version unknown | Authorized encrypted transfer; minimize/redact rows |
| `e:\SMARTwinFA\<smart_setup PostgreSQL backup path not present>` | Not present | N/A | PostgreSQL backup | Existing migration metadata if it exists outside workspace | PostgreSQL version unknown | Preserve separately; do not merge histories |
| `e:\SMARTwinFA\<protected report samples not present>` | Not present | N/A | Financial/personal report samples | Golden-output parity testing | Source engine unknown | Encrypted restricted transfer with redaction and retention policy |

No database backups, raw production data, protected report samples, `.env`,
tokens, API keys, private keys, or additional restricted artifacts were found in
the scoped workspace inventory.
