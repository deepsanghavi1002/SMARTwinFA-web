# Contributing

## Work from a traceable item

Every change must reference a stable backlog ID such as `MST-001`, `DB-008`, or
`QA-004`. Add or update the corresponding row in
`docs/migration/backlog.csv`, then link UI controls, database objects,
permissions, tests, and acceptance evidence in the issue or traceability row.

## Branches and pull requests

- Use short-lived branches prefixed with `codex/`, `feature/`, `fix/`, or the
  team's approved equivalent.
- Follow [the developer workflow](docs/development-workflow.md). Each branch
  must use its own local Compose project and PostgreSQL volume; never test
  writes against a shared, Pi, or source database.
- Keep commits scoped to one behaviorally meaningful slice.
- Do not mix client data, generated builds, local configuration, or unrelated
  legacy cleanup into a product change.
- Pull requests must complete the checklist in
  `.github/PULL_REQUEST_TEMPLATE.md`.

## Local quality gate

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

Feature work also requires the relevant component, API, PostgreSQL integration,
permission, end-to-end, and parity tests described in
`docs/testing/test-strategy.md`.

## Database changes

- Never edit an already-released migration.
- Make forward and rollback/repair behavior explicit.
- Migrations must be deterministic, tenant-aware, resumable when data work is
  involved, and tested against a disposable PostgreSQL instance.
- Add constraints only after validating legacy duplicates/orphans; record any
  quarantine or repair decision.
- Stored procedures from supplied archives are unverified inputs. Rewrite and
  contract-test them; do not mark them migrated merely because PostgreSQL can
  parse the archive.

## Completion

Use `docs/migration/definition-of-done.md`. A screen-only implementation cannot
be closed as complete.
