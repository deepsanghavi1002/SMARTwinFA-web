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
