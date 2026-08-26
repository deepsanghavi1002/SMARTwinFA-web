# Local Docker setup

This is the local, disposable SMARTwinFA test environment. It runs the web
app, API, and PostgreSQL together with mock data. No customer or production
data belongs in this repository.

## Start

1. Install Docker Desktop.
2. Clone the required branch.
3. Place an approved local PostgreSQL custom dump in the ignored
   `database/fixtures/private/` folder.
4. Copy `docker/local-settings.example` to `.env.docker`, then set the dump
   filename and its schema name in `.env.docker`.
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

## Using another approved company dataset

Use one isolated Compose project and database volume for each data source. Put
only an authorised, read-only PostgreSQL custom dump in the private fixture
folder, then set these two local values:

```text
SMARTWINFA_COMPANY_DUMP=company-copy.dump
LEGACY_COMPANY_SCHEMA=company_schema
```

Never point the application at a live database, commit a dump, or combine data
from two companies in one test database. A SQL Server backup must first be
copied into an approved PostgreSQL custom dump; it is not restored directly by
this Docker stack.
