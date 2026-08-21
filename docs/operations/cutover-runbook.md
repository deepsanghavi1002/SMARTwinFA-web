# Tenant/company/year cutover runbook

This is a controlled template. Exact commands, owners, timing, SLO/RPO/RTO,
contacts, and rollback thresholds must be filled and rehearsed before use.

## Preconditions

- Scope identifies one tenant, company, accounting year, source snapshot, target
  cell, application/migration/definition/template versions, and owner.
- Feature, client override, permission, report, document, integration, and
  utility coverage for the scope satisfies the definition of done.
- Full rehearsal has completed at least twice with recorded duration and no
  unexplained reconciliation difference.
- UAT/accounting/security/operations approvals are recorded.
- Target capacity, monitoring, alerts, backups, PITR, restore, support, and
  communication are ready.
- Source/target credential and routing changes are scripted, reviewed, and
  recoverable; no secret appears in the runbook/log.
- Explicit no-go and rollback thresholds are approved.

## Readiness record

Record:

- cutover ID and backlog/release IDs;
- source engine/version/database/schema and evidence hashes;
- target cell/database and migration/definition commit/checksums;
- source high-water mark/change-capture position if used;
- row/totals/report/document parity baseline;
- planned freeze, final-sync, decision, routing, validation, and rollback times;
- go/no-go decision makers and technical/business/accounting/security owners;
- affected users/integrations and communication status.

## Execution

1. Confirm monitoring, backup, target health, queue state, storage, and support.
2. Announce the approved write-freeze window.
3. Stop/deny new source writes and drain active jobs/sessions safely.
4. Capture final source snapshot/high-water mark and integrity hash.
5. Run idempotent final delta migration and record every checkpoint.
6. Run automated reconciliation: rows, keys, relationships, null/date/flag
   distributions, financial/stock/tax totals, custom fields, reports, and
   document samples.
7. Business/accounting owner reviews the signed difference report.
8. Execute explicit go/no-go. Silence or elapsed time is not approval.
9. Update control-catalog routing atomically for only the approved scope.
10. Run authenticated smoke flows for roles, entries, reports, printing,
    exports, integrations, audit, and cross-tenant denial.
11. Monitor latency, errors, pool/locks, queues, reconciliation/data quality,
    security events, and support reports continuously through stabilization.

## Rollback

Rollback when an approved threshold is met, including unexplained financial or
tenant-isolation differences, corruption, unavailable critical flow, missed
RPO/RTO, or security disclosure.

1. Stop target writes and preserve forensic/audit evidence.
2. Determine whether any target writes occurred and apply the rehearsed reverse
   sync or transaction replay policy. Never re-enable two writable systems.
3. Atomically restore source routing for the exact scope.
4. Validate source state and critical flows before lifting the freeze.
5. Communicate status and preserve all migration/reconciliation logs.
6. Open a blocking incident/root-cause item; repair and rerun full rehearsal.

## Stabilization and closure

- Compare automated reconciliation at agreed intervals.
- Review failed/slow queries, jobs, exports, documents, integrations, and
  permission denials.
- Resolve or classify every support issue and parity difference.
- Obtain tenant/business/accounting acceptance at the stabilization gate.
- Keep legacy read-only for the approved retention period.
- Move the next tenant/year only after this scope is signed.
- At retirement, archive required evidence, revoke credentials, remove routes
  and scheduled jobs, test archive retrieval, and record decommission approval.
