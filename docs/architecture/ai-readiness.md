# AI-ready data architecture (no AI feature implementation yet)

The current migration will not add AI behavior. It will avoid choices that
would make future, tenant-safe AI unreliable or require direct access to the
transaction database.

## Build now

- Stable IDs and typed contracts for tenants, companies, years, accounts,
  products, vouchers, documents, reports, fields, and actions.
- Business glossary and semantic definitions for balances, tax, stock,
  receivables, ageing, periods, and document states.
- Data lineage from source archive/table/column through transformations to API,
  report, export, and audit output.
- Append-only domain/audit events through a transactional outbox.
- Versioned schemas, metadata definitions, report templates, and calculation
  rules with effective dates.
- Explicit data classification, retention, consent/purpose, and deletion/legal
  hold policy.
- Data-quality metrics for completeness, validity, uniqueness, timeliness,
  reconciliation, and client-override drift.
- Synthetic and de-identified evaluation fixtures separated from production.

## Future access boundary

A future AI service consumes curated, read-only data products or approved
domain APIs. It does not receive a PostgreSQL owner/runtime credential, execute
arbitrary tenant SQL, or inspect another tenant's prompt, retrieval index,
cache, trace, or feedback.

Potential future path:

```text
OLTP + domain events
  → governed tenant-scoped projection
  → redaction/classification policy
  → tenant-scoped search/analytics index
  → AI gateway with tool allowlist and budget
  → human-reviewed action through normal domain API
```

## Future feature gates

Any AI feature must later define:

- user purpose and non-AI fallback;
- authoritative source records and freshness;
- tenant/company/year/role scope and redaction;
- prompt/tool/data versioning and provenance;
- offline evaluation set, accuracy/safety thresholds, and regression suite;
- human confirmation for financial, tax, payment, posting, deletion, export, or
  permission-changing actions;
- hallucination/unsupported-answer behavior;
- cost, latency, rate, retention, feedback, and incident controls;
- complete audit of source references and resulting domain action.

No AI output may directly post accounting entries or mutate financial records.
It must propose a typed command that is validated, authorized, reviewed when
required, and executed through the same domain rules as a human action.
