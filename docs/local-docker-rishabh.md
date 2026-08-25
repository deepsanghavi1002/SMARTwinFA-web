# Local Docker stack with Rishabh Plastic data

This is the repeatable lower environment for a developer branch. It starts the
web application, the legacy API, and PostgreSQL together. The web application
is available at `http://localhost:3000`; PostgreSQL is available at
`localhost:5432` by default.

The Rishabh Plastic backup is client data and is deliberately **not committed
to GitHub**. Obtain the approved private data bundle from the project owner.
The stack restores the exact supplied PostgreSQL custom dump on its first
startup.

## One-time setup

1. Install Docker Desktop and ensure it is running.
2. Check out the branch you want to test.
3. Copy `.env.docker.example` to `.env.docker`.
4. Put the authorized PostgreSQL custom backup at:

   ```text
   database/fixtures/private/rishabh-plastic27.dump
   ```

   On macOS/Linux, the helper can prepare it from the supplied backup:

   ```bash
   ./scripts/prepare-rishabh-local-seed.sh /path/to/rishabh_plastic27_backup.sql
   ```

   On Windows, copy and rename the authorized file in Explorer. Its extension
   may be `.sql`, but it must be the PostgreSQL **custom dump** supplied by the
   project owner.

## Start

From the repository root:

```bash
docker compose --env-file .env.docker -f compose.local.yaml up --build
```

The first start imports the private dump. Subsequent starts reuse the Docker
volume and are much faster. Open `http://localhost:3000` after all services are
healthy.

The app uses the `rishabh_plastic27` schema and enables master and entry writes
against this local copy only. Each developer receives an isolated Docker volume
and can freely test data changes without affecting the Pi or another person's
machine.

## pgAdmin or any PostgreSQL client

Use the values in `.env.docker`:

| Field | Default |
| --- | --- |
| Host | `localhost` |
| Port | `5432` |
| Database | `smartwin_data_intake` |
| User | `smartwinfa_web` |
| Password | `SMARTWINFA_DB_PASSWORD` |

## Stop, reset, and branch isolation

Stop services while preserving local test data:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down
```

Delete the local volume and restore a clean Rishabh Plastic copy on the next
start:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down -v
```

For two branches on the same PC, assign different values in each checkout's
`.env.docker`:

```text
COMPOSE_PROJECT_NAME=smartwinfa-feature-a
SMARTWINFA_WEB_PORT=3001
SMARTWINFA_POSTGRES_PORT=5433
```

The dump, `.env.docker`, and all resulting database volumes remain local and
are not pushed to GitHub.
