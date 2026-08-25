# Developer workflow

This repository uses Docker Compose for development and lower-environment
testing. Docker is a developer tool only; customer installations will use a
native SMARTwinFA installer and a local PostgreSQL service.

## Working model

Each developer works in a short-lived Git branch with an isolated Compose
project and PostgreSQL volume:

```text
feature branch
  -> web application + legacy API + local PostgreSQL
  -> private Rishabh Plastic seed copy
  -> local browser test
  -> checks, commit, push, pull request
```

No developer should use the Pi database, a colleague's database, or the
source SQL Server as a writable test environment.

## One-time setup

1. Install Docker Desktop. It is supported on Windows, macOS, and Linux.
2. Clone this repository and obtain the approved private Rishabh Plastic
   PostgreSQL dump from the project owner.
3. Copy `.env.docker.example` to `.env.docker`.
4. Place the dump at
   `database/fixtures/private/rishabh-plastic27.dump`.

The dump and `.env.docker` are local-only files. Never commit, upload, or put
them in a pull request. See [local-docker-rishabh.md](local-docker-rishabh.md)
for platform-specific setup details.

## Start a feature environment

Create a branch, then give its environment a unique name and ports in that
checkout's `.env.docker`:

```bash
git checkout -b feature/account-master-editing
```

```text
COMPOSE_PROJECT_NAME=smartwinfa-account-master
SMARTWINFA_WEB_PORT=3001
SMARTWINFA_POSTGRES_PORT=5433
```

Start the complete stack:

```bash
docker compose --env-file .env.docker -f compose.local.yaml up --build
```

Open `http://localhost:3001`. The default ports are `3000` for the web app and
`5432` for PostgreSQL. A unique Compose project name gives each branch its own
containers, network, and database volume, so data changes do not affect other
developers.

Stop without losing data:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down
```

Reset only the current developer's test database and restore a clean local
seed on the next start:

```bash
docker compose --env-file .env.docker -f compose.local.yaml down -v
docker compose --env-file .env.docker -f compose.local.yaml up --build
```

## Implement and test

1. Make one behaviorally meaningful feature change per branch.
2. Test the UI and writes against the local PostgreSQL container.
3. Add or update relevant automated tests.
4. Run the quality gate:

   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```

5. Commit only reviewed source code, tests, database migrations, and
   documentation. Do not include local data, `.env` files, generated output,
   credentials, or Docker volumes.
6. Push the branch and open a pull request:

   ```bash
   git add app features database/migrations tests docs
   git commit -m "Add account master inline editing"
   git push -u origin feature/account-master-editing
   ```

## Database changes

PostgreSQL is the shared application database technology. Docker is merely the
repeatable way developers run it locally.

- Add a new forward migration for each schema change; never alter a released
  migration.
- Make migration behavior deterministic and tenant-aware.
- Test upgrades and repair/rollback behavior against a disposable local
  database.
- Add constraints only after handling legacy duplicates or orphaned records.
- Record any intentional data repair, quarantine, or compatibility decision in
  the associated backlog item and pull request.

## Why Docker is the development standard

Docker Compose provides one repeatable stack across Windows, macOS, and Linux:
the same web app, API runtime, PostgreSQL version, seed/import steps, and
health checks. Running native Node.js and PostgreSQL on every developer machine
would require each person to manage runtime versions, database setup,
environment variables, and branch isolation manually.

Use Docker for development, automated tests, and disposable lower environments.
Use native installers plus a locally managed PostgreSQL service for customer
deployments.
