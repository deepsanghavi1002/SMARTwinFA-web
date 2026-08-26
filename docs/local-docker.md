# Local Docker setup

This is the local, disposable SMARTwinFA test environment. It runs the web
app, API, and PostgreSQL together with mock data. No customer or production
data belongs in this repository.

## Start

1. Install Docker Desktop.
2. Clone the required branch.
3. Obtain the approved mock-data package from the project team and place it in
   the ignored `database/fixtures/private/` folder using the package's setup
   note.
4. Copy `.env.docker.example` to `.env.docker`.
5. Run:

   ```bash
   docker compose --env-file .env.docker -f compose.local.yaml up --build
   ```

Open `http://localhost:3000` when the services are healthy.

## Everyday commands

Stop while keeping your local test data:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down
```

Reset only your own test environment:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down -v
```

For separate feature branches on one computer, use a unique
`COMPOSE_PROJECT_NAME` and different web/PostgreSQL ports in each branch's
`.env.docker`. The complete workflow is in
[development-workflow.md](development-workflow.md).

## The stack needs both intake schemas

The restore expects two custom-format dumps in `database/fixtures/private/`:

| File | Schema | Purpose |
| --- | --- | --- |
| `rishabh-plastic27.dump` | `rishabh_plastic27` | Per-company accounting data |
| `smart-setup.dump` | `smart_setup` | Shared setup/metadata |

Prepare both with:

```bash
node scripts/prepare-rishabh-local-seed.mjs <company-dump> <smart-setup-dump>
```

Seeding the company schema alone leaves the menu catalog, account master and
product master failing with `relation "smart_setup.<table>" does not exist`,
because those three readers query the shared schema. The restore fails fast if
either dump is missing.

Both dumps store money columns as pre-formatted currency text whose currency
symbol was lost to an encoding conversion upstream, so PostgreSQL cannot parse
them as `money` under any locale. The init script demotes only those columns to
text, loads them verbatim, then normalizes and promotes them back. Do not
substitute over the data stream instead: text columns contain the same stray
bytes and would be corrupted.

## If PostgreSQL already runs on the host

`SMARTWINFA_POSTGRES_PORT` defaults to `5432`. On a machine that already runs
its own PostgreSQL server, that port is taken and `legacy-db` cannot bind,
so the stack never becomes healthy. Point the container at a free host port
in your ignored `.env.docker` instead of stopping the host server:

```bash
SMARTWINFA_POSTGRES_PORT=55432
```

Only the published host port changes. The services still reach each other on
`legacy-db:5432` inside the Compose network, and the host's own PostgreSQL is
left untouched.
