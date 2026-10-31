# SMARTwinFA fleet: dashboard + one stack per client

Everything to run many SMARTwinFA clients on one Docker host and watch them from one place.
Written for the setup described in "SMARTwinFA Cloud Setup" (30 clients, Cloudflare Tunnel, cloud storage).

```text
ops/
  smartwinfa.sh            one command for everything below
  fleet/                   the ops stack (one per host)
    compose.yaml           the control panel, Portainer, Grafana + Loki + Alloy, Uptime Kuma, the admin site, cloudflared (profile "tunnel")
    panel/                 the control panel: a card per client, and each client's page (no dependencies, Node)
    admin/                 the admin site (Caddy): one address for all of the above
    alloy/config.alloy     reads every container's log, labels it client / service / level
    loki-config.yaml       log store, 30 days
    grafana/               Loki data source + the "SMARTwinFA Clients" dashboard
  client/                  the template every client stack is made from
    compose.yaml           web + its own postgres, both labelled smartwinfa.client=<id> and memory-capped (WEB_MEM_LIMIT, DB_MEM_LIMIT in the client's env file)
    postgres-init/         restores the client's dump on the first start (or starts empty)
  clients/
    rishabh.env.example    settings of one client (copy to <id>.env; *.env files are not committed)
```

## Run the demo (Rishabh Plastic)

Needs Docker (Docker Desktop on Windows/macOS, Docker Engine on Linux). From the repository folder:

```bash
ops/smartwinfa.sh build-local          # build the app images from this checkout (tag "local")
ops/smartwinfa.sh fleet up             # admin site :9090 (Portainer :9000, Grafana :3001/grafana/, Uptime Kuma :3002)
cp ops/clients/rishabh.env.example ops/clients/rishabh.env   # then set DB_PASSWORD
ops/smartwinfa.sh client up rishabh    # Rishabh Plastic on http://localhost:4101
ops/smartwinfa.sh list
```

- **Data:** put the authorised dump at `database/fixtures/private/rishabh-plastic27.dump` before the first
  `client up` and it is restored automatically. Without it the stack starts with an empty database
  (the app opens, but login and reports have no data). Load it later with
  `ops/smartwinfa.sh client restore rishabh database/fixtures/private/rishabh-plastic27.dump`.
- **Passwords:** `fleet up` creates `ops/fleet/.env` (Grafana `admin` password) and
  `ops/fleet/.portainer-admin-password` (Portainer `admin` password). Uptime Kuma asks for an admin on first visit.
- **Uptime check:** in Uptime Kuma add an HTTP monitor `http://rishabh-web:3000/api/health` (every client's web
  container is reachable by `<id>-web` on the shared `smartwinfa-fleet` network).

## The admin site (one address for the staff tools)

`fleet up` also starts `smartwinfa-admin` (Caddy, port `ADMIN_PORT`, default 9090 on `FLEET_BIND`), which puts the three
tools under one address such as `https://admin.smartwinfa.com`:

| Path | Tool |
|---|---|
| `/` | the control panel (see below) |
| `/grafana/` | Grafana: the "SMARTwinFA Clients" logs dashboard |
| `/portainer/` | Portainer: stacks and containers |
| everything else (`/dashboard`, `/status/...`) | Uptime Kuma (it cannot run under a sub-path) |

- Publish it in the Cloudflare tunnel as `admin.smartwinfa.com` -> `http://smartwinfa-admin:80`. cloudflared runs in
  Docker on the `smartwinfa-fleet` network, so it reaches the container by name (not `localhost:9090`).
- Set `ADMIN_URL=https://admin.smartwinfa.com` in `ops/fleet/.env` so Grafana's links use the public address.
- Each tool keeps its own sign-in. The site adds no password of its own: Portainer and Grafana use the `Authorization`
  header themselves, so HTTP basic auth in front of them breaks them. Put a Cloudflare Access application on the address
  (staff emails, with MFA). Until then, anyone who finds the address reaches the tools' login pages.
- Memory is capped per tool (`mem_limit` in `fleet/compose.yaml`, about 1.4 GB in all at most) so the dashboard cannot
  crowd out the clients on a small server.
- When port 8000 is already taken on the host, set `PORTAINER_EDGE_PORT` (Portainer's edge tunnel for on-prem agents).

### The control panel

The home page of the admin site. Sign in with `PANEL_PASSWORD` from `ops/fleet/.env` (`fleet up` makes one when it
is empty; sign-ins last 12 hours and end when the panel restarts).

- **Clients:** one card per client stack on this host, found by the `smartwinfa.client` label, so a new client appears
  by itself. Green: everything runs. Amber: errors in the last hour, a part still starting, or the last backup is more
  than 36 hours old (or there is none). Red: the app's `/api/health` does not answer, or a part (web, db)
  is stopped or unhealthy. Each card shows the parts, errors in the last hour, the last backup and the app version.
- **A client's page:** its parts (state, uptime, memory, image), errors per hour for 24 hours, its backups, and its logs
  with filters (part, errors / warnings, period, text). **Restart app** restarts the web container (users stay
  signed in). **Backup now** writes `manual-<date>-<time>.dump` next to the nightly ones. **Open in Grafana** opens the
  same client in the logs dashboard for longer searches.
- It uses the Docker socket (to read the containers and for those two actions) and Loki, about 20 MB of memory.
  "Errors" are log lines the log collector labels error, fatal or panic.

## Windows PC with nothing installed

`ops/windows/setup-windows.ps1` does everything: checks Windows (10 22H2 / 11), installs WSL 2, Git and Docker Desktop
with winget, clones this repository (branch `ops-fleet-dashboard`), creates the Rishabh settings, builds the images and
starts the dashboard and the Rishabh stack. In an Administrator PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\setup-windows.ps1                                   # optional: -Folder D:\SMARTwinFA-web -SeedDump C:\path\rishabh-plastic27.dump
```

Windows needs one or two restarts (after WSL and after Docker Desktop); run the script again after each and it continues.

## Daily use

| Task | Command |
|---|---|
| New client | `ops/smartwinfa.sh client new <id>`, edit `ops/clients/<id>.env`, `client up <id>` |
| Update one client | `ops/smartwinfa.sh client update <id> <version>` (prints the rollback command) |
| Roll back | `ops/smartwinfa.sh client update <id> <previous version>` |
| Backup now | `ops/smartwinfa.sh client backup <id>` (the one fleet backup job, `smartwinfa-backup`, dumps every client's own database nightly at `BACKUP_HOUR` set in `ops/fleet/.env`, into `/backups/<client>/`) |
| Logs | Grafana > SMARTwinFA Clients, pick the client; or `ops/smartwinfa.sh client logs <id>` |
| Stop / start | `ops/smartwinfa.sh client down <id>` / `client up <id>`, or the buttons in Portainer |

## Site kit: a client that keeps SMARTwinFA on their own machine (on-prem)

`ops/site/compose.yaml` is added on top of the client stack and gives you control of the client's machine
without opening any port there. Every part connects **out**:

| Part | What it does | Runs when (in `ops/clients/<id>.env`) |
|---|---|---|
| `support-agent` (Portainer Edge Agent) | The machine appears in your Portainer: containers, logs, console, update, restart | `EDGE_KEY` set and `SUPPORT_MODE=on` |
| `log-agent` (Alloy) | Sends only this client's container logs to your Grafana, labelled `client=<id>`, `site=on-prem` | `LOKI_PUSH_URL` set |
| `cloudflared` | The client's users open `https://<id>.your-domain.com` | `SITE_TUNNEL_TOKEN` set |
| `offsite-backup` (rclone) | Copies the nightly backups to cloud storage every hour | `OFFSITE_BUCKET` set |

Onboarding an on-prem client:

```bash
# on your control panel
ops/smartwinfa.sh fleet enroll vaishali      # creates ops/clients/vaishali.env with the agent keys and log address
#   edit it: CLIENT_NAME, COMPANY_SCHEMA, SITE_TUNNEL_TOKEN, OFFSITE_* ...; send the file to the client securely

# on the client's machine (Linux)
ops/smartwinfa.sh build-local                # or set SMARTWINFA_VERSION to a registry image
ops/smartwinfa.sh site up vaishali
# on the client's machine (Windows, Administrator PowerShell)
.\setup-windows.ps1 -SiteEnv C:\path\vaishali.env
```

The client controls your access: `ops/smartwinfa.sh site support vaishali off` stops the support agent (the app,
logs and backups keep running); `... on` lets you in again.

In production set in `ops/fleet/.env` before enrolling: `PORTAINER_EDGE_URL=https://ops.your-domain.com`,
`PORTAINER_EDGE_TUNNEL=<host:port of the Portainer edge tunnel, port 8000>` and
`LOKI_PUSH_URL=https://logs-in.your-domain.com/loki/api/v1/push` (a tunnel hostname to `http://loki:3100` protected by a
Cloudflare Access service token; put the token in each site's `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`).
The Portainer edge tunnel (port 8000) needs its own route; test it with one site before rolling out.

## Going live behind Cloudflare

1. Cloudflare Zero Trust > Networks > Tunnels: create a tunnel, copy its token into `ops/fleet/.env` as `TUNNEL_TOKEN`.
2. `ops/smartwinfa.sh fleet tunnel` starts cloudflared on the fleet network.
3. In the tunnel, add a public hostname per client: `rishabh.your-domain.com` -> `http://rishabh-web:3000`;
   staff tools: `admin.your-domain.com` -> `http://smartwinfa-admin:80` (see "The admin site").
4. Zero Trust > Access: an application per hostname with who may log in (staff with MFA; each client's users only on their address).
5. Keep `WEB_BIND=127.0.0.1` and `FLEET_BIND=127.0.0.1` so nothing is reachable except through the tunnel.

## Not done yet (see the PDF, section 6)

- `/api/health` answers "ok" even when the database is empty or unreachable; it should test the database.
- The app logs plain text (stack traces show as many lines in Grafana); a JSON logger with client, user and request id is planned.
- Images are built locally (`build-local`); production should pull versioned images from GitHub Container Registry built by CI.
- Backups stay in the stack's `backups` volume; add an rclone sync to Cloudflare R2 / Backblaze B2 for offsite copies.
