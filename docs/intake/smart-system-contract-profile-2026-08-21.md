# `smart_system` semantic boundary profile

This aggregate-only profile advances `DISC-SYS-001` from table inventory to a
reviewable target boundary. It contains no row values, credentials, raw SQL,
routine bodies, client identifiers, or routing names. Reproduce it locally:

```text
node scripts/profile-smart-system-contracts.mjs \
  --database smartwin_data_intake \
  --observed-on 2026-08-21
```

The deterministic profile hash is
`9b5b3988791d1cf424b6aa68859683994d731eedbe387d01f7b8195c3766a3c8`.

| Boundary | Aggregate evidence | Target decision |
|---|---|---|
| Company/year routing | 173 company rows all have a routing-name candidate; 16/16 year rows have valid date ranges; company has one PK, year has none; no FKs or duplicate candidate keys | Treat keys and routing names as candidates only. Resolve them through a server-owned catalog after source/runtime confirmation; never accept schema/database identifiers from a request. |
| Dashboards | 19 definitions and 19 assignments; all definitions contain at least one raw-query slot; no aggregate orphan or duplicate-key finding | Quarantine query text. Convert reviewed definitions to typed, versioned metadata and bind assignments to stable IDs and scoped permissions. |
| Print staging | 0 top/body/bottom rows and 8 request rows; none of the four tables has a PK/FK; 61 `money` columns | Do not reproduce shared staging. Use tenant/company/year-scoped, job-owned immutable snapshots with reviewed numeric semantics and retention. |
| Identity/rights | 4 users, 0 security rows, 0 login rows; all 4 user rows contain credential material in at least one credential-like field | Do not copy legacy credential fields. Authentication, password handling, and effective rights remain blocked pending authoritative behavior and an approved reset/migration strategy. |

## Gate effect

This closes only the safe structural-contract portion of control-plane
discovery. `DISC-SYS-001`, `ARCH-005`, and production authentication/RBAC stay
open because empty security/login evidence cannot prove effective behavior.
The dashboard queries and credential-bearing fields remain quarantined and are
never emitted by the profiler.
