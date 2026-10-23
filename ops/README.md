# SMARTwinFA fleet: dashboard + one stack per client

Everything to run many SMARTwinFA clients on one Docker host and watch them from one place.
Written for the setup described in "SMARTwinFA Cloud Setup" (30 clients, Cloudflare Tunnel, cloud storage).

```text
ops/
  smartwinfa.sh            one command for everything below
  fleet/                   the ops stack (one per host)
    compose.yaml           Portainer, Grafana + Loki + Alloy, Uptime Kuma, cloudflared (profile "tunnel")
    alloy/config.alloy     reads every container's log, labels it client / service / level
    loki-config.yaml       log store, 30 days
    grafana/               Loki data source + the "SMARTwinFA Clients" dashboard
  client/                  the template every client stack is made from
    compose.yaml           web + api + postgres + nightly backup, all labelled smartwinfa.client=<id>
    postgres-init/         restores the client's dump on the first start (or starts empty)
  clients/
    rishabh.env.example    settings of one client (copy to <id>.env; *.env files are not committed)
```

## Run the demo (Rishabh Plastic)

Needs Docker (Docker Desktop on Windows/macOS, Docker Engine on Linux). From the repository folder:

```bash
ops/smartwinfa.sh build-local          # build the app images from this checkout (tag "local")
ops/smartwinfa.sh fleet up             # Portainer :9000, Grafana :3001, Uptime Kuma :3002
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

## Daily use

| Task | Command |
|---|---|
| New client | `ops/smartwinfa.sh client new <id>`, edit `ops/clients/<id>.env`, `client up <id>` |
| Update one client | `ops/smartwinfa.sh client update <id> <version>` (prints the rollback command) |
| Roll back | `ops/smartwinfa.sh client update <id> <previous version>` |
| Backup now | `ops/smartwinfa.sh client backup <id>` (nightly backups run on their own at `BACKUP_HOUR`) |
| Logs | Grafana > SMARTwinFA Clients, pick the client; or `ops/smartwinfa.sh client logs <id>` |
| Stop / start | `ops/smartwinfa.sh client down <id>` / `client up <id>`, or the buttons in Portainer |

## Going live behind Cloudflare

1. Cloudflare Zero Trust > Networks > Tunnels: create a tunnel, copy its token into `ops/fleet/.env` as `TUNNEL_TOKEN`.
2. `ops/smartwinfa.sh fleet tunnel` starts cloudflared on the fleet network.
3. In the tunnel, add a public hostname per client: `rishabh.your-domain.com` -> `http://rishabh-web:3000`;
   staff tools: `ops.your-domain.com` -> `http://portainer:9000`, `logs.your-domain.com` -> `http://grafana:3000`.
4. Zero Trust > Access: an application per hostname with who may log in (staff with MFA; each client's users only on their address).
5. Keep `WEB_BIND=127.0.0.1` and `FLEET_BIND=127.0.0.1` so nothing is reachable except through the tunnel.

## Not done yet (see the PDF, section 6)

- `/api/health` answers "ok" even when the database is empty or unreachable; it should test the database.
- The app logs plain text (stack traces show as many lines in Grafana); a JSON logger with client, user and request id is planned.
- Images are built locally (`build-local`); production should pull versioned images from GitHub Container Registry built by CI.
- Backups stay in the stack's `backups` volume; add an rclone sync to Cloudflare R2 / Backblaze B2 for offsite copies.
