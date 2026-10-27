#!/usr/bin/env bash
# SMARTwinFA fleet: one ops stack (dashboard, logs, uptime) and one stack per client on this Docker host.
#
#   ops/smartwinfa.sh fleet up|down|status         the ops stack (Portainer, Grafana + Loki + Alloy, Uptime Kuma)
#   ops/smartwinfa.sh fleet tunnel                  also start cloudflared (needs TUNNEL_TOKEN in ops/fleet/.env)
#   ops/smartwinfa.sh client new <id>               create ops/clients/<id>.env from the Rishabh example
#   ops/smartwinfa.sh client up|down|status|logs <id>
#   ops/smartwinfa.sh client backup <id>            dump the client's database now
#   ops/smartwinfa.sh client restore <id> <dump>    load a PostgreSQL custom dump into the client's database
#   ops/smartwinfa.sh client update <id> <version>  switch the client to another image version and restart it
#   ops/smartwinfa.sh fleet enroll <id>             register an on-prem client in Portainer; writes its agent keys into ops/clients/<id>.env
#   ops/smartwinfa.sh site up|down|status <id>      on the client's own machine: the stack + tunnel, support agent, log agent, offsite backup
#   ops/smartwinfa.sh site support <id> on|off      the client switches your support agent on or off
#   ops/smartwinfa.sh list                          every client on this host with state and version
#   ops/smartwinfa.sh build-local                   build the app images from this repository (tag "local")
set -euo pipefail

# On Windows (Git Bash) give docker real Windows paths (D:/...) and stop Git Bash rewriting "/..." arguments.
winpwd() { pwd -W 2>/dev/null || pwd; }
export MSYS_NO_PATHCONV=1
OPS="$(cd "$(dirname "$0")" && winpwd)"
ROOT="$(cd "$OPS/.." && winpwd)"
FLEET="$OPS/fleet"
CLIENTS="$OPS/clients"

die() { echo "error: $*" >&2; exit 1; }
need_id() { [[ "${1:-}" =~ ^[a-z0-9][a-z0-9-]{1,30}$ ]] || die "client id must be lower-case letters, digits or '-' (got '${1:-}')"; }
env_of() { local f="$CLIENTS/$1.env"; [ -f "$f" ] || die "missing $f (run: ops/smartwinfa.sh client new $1)"; echo "$f"; }
client_compose() { local id="$1"; shift; docker compose -p "smartwinfa-$id" --env-file "$(env_of "$id")" -f "$OPS/client/compose.yaml" "$@"; }
site_compose() { local id="$1"; shift; docker compose -p "smartwinfa-$id" --env-file "$(env_of "$id")" -f "$OPS/client/compose.yaml" -f "$OPS/site/compose.yaml" "$@"; }
setting() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | tr -d '\r'; }
set_setting() { if grep -qE "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi; }
# The site parts that have their settings filled in (see ops/site/compose.yaml).
site_profiles() {
  local f; f="$(env_of "$1")"; local p=()
  [ -n "$(setting "$f" SITE_TUNNEL_TOKEN)" ] && p+=(--profile tunnel)
  [ -n "$(setting "$f" EDGE_KEY)" ] && [ "$(setting "$f" SUPPORT_MODE)" != "off" ] && p+=(--profile support)
  [ -n "$(setting "$f" LOKI_PUSH_URL)" ] && p+=(--profile logs)
  [ -n "$(setting "$f" OFFSITE_BUCKET)" ] && p+=(--profile offsite)
  echo "${p[@]:-}"
}
fleet_compose() { docker compose -p smartwinfa-fleet --env-file "$FLEET/.env" -f "$FLEET/compose.yaml" "$@"; }

fleet_prepare() {
  if [ ! -f "$FLEET/.env" ]; then
    cp "$FLEET/fleet.env.example" "$FLEET/.env"
    sed -i "s/^GRAFANA_ADMIN_PASSWORD=.*/GRAFANA_ADMIN_PASSWORD=$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')/" "$FLEET/.env"
    echo "created ops/fleet/.env (Grafana admin password inside)"
  fi
  if [ -z "$(setting "$FLEET/.env" PANEL_PASSWORD)" ]; then
    set_setting "$FLEET/.env" PANEL_PASSWORD "$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
    echo "set PANEL_PASSWORD in ops/fleet/.env (the control panel's sign-in)"
  fi
  if [ ! -f "$FLEET/.portainer-admin-password" ]; then
    head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$FLEET/.portainer-admin-password"
    chmod 600 "$FLEET/.portainer-admin-password"
    echo "created ops/fleet/.portainer-admin-password (Portainer user: admin)"
  fi
  docker network inspect smartwinfa-fleet >/dev/null 2>&1 || docker network create smartwinfa-fleet >/dev/null
}

case "${1:-}" in
  fleet)
    case "${2:-}" in
      up) fleet_prepare; fleet_compose up -d
          echo "Admin site http://localhost:$(setting "$FLEET/.env" ADMIN_PORT | grep . || echo 9090)  Portainer http://localhost:9000  Grafana http://localhost:3001/grafana/  Uptime Kuma http://localhost:3002" ;;
      tunnel) fleet_prepare; fleet_compose --profile tunnel up -d ;;
      down) fleet_compose --profile tunnel down ;;
      enroll)
        id="${3:-}"; need_id "$id"; fleet_prepare
        f="$CLIENTS/$id.env"; [ -f "$f" ] || { "$0" client new "$id" >/dev/null; echo "created $f"; }
        url="$(setting "$FLEET/.env" PORTAINER_EDGE_URL)"; url="${url:-http://smartwinfa-fleet-portainer-1:9000}"
        tunnel="$(setting "$FLEET/.env" PORTAINER_EDGE_TUNNEL)"; tunnel="${tunnel:-smartwinfa-fleet-portainer-1:8000}"
        loki="$(setting "$FLEET/.env" LOKI_PUSH_URL)"; loki="${loki:-http://smartwinfa-fleet-loki-1:3100/loki/api/v1/push}"
        api="http://localhost:9000/api"
        jwt="$(curl -fsS -X POST "$api/auth" -H 'content-type: application/json' -d "{\"Username\":\"admin\",\"Password\":\"$(cat "$FLEET/.portainer-admin-password")\"}" | { grep -o '"jwt":"[^"]*"' || true; } | cut -d'"' -f4)"
        [ -n "$jwt" ] || die "could not log in to Portainer on localhost:9000 (is the fleet up?)"
        curl -fsS -X PUT "$api/settings" -H "Authorization: Bearer $jwt" -H 'content-type: application/json' \
          -d "{\"EdgePortainerUrl\":\"$url\",\"Edge\":{\"TunnelServerAddress\":\"$tunnel\"}}" >/dev/null
        ep="$(curl -fsS "$api/endpoints?name=$id" -H "Authorization: Bearer $jwt" | { grep -o '"Id":[0-9]*' || true; } | head -1 | cut -d: -f2)"
        if [ -z "$ep" ]; then
          ep="$(curl -fsS -X POST "$api/endpoints" -H "Authorization: Bearer $jwt" -F "Name=$id" -F EndpointCreationType=4 -F "URL=$url" | { grep -o '"Id":[0-9]*' || true; } | head -1 | cut -d: -f2)"
        fi
        key="$(curl -fsS "$api/endpoints/$ep" -H "Authorization: Bearer $jwt" | { grep -o '"EdgeKey":"[^"]*"' || true; } | cut -d'"' -f4)"
        [ -n "$key" ] || die "Portainer did not return an edge key for $id"
        [ -n "$(setting "$f" EDGE_ID)" ] || set_setting "$f" EDGE_ID "$id-$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        set_setting "$f" EDGE_KEY "$key"
        set_setting "$f" EDGE_INSECURE_POLL "$([ "${url#https}" = "$url" ] && echo 1 || echo 0)"
        set_setting "$f" SUPPORT_MODE on
        set_setting "$f" LOKI_PUSH_URL "$loki"
        echo "$id enrolled (Portainer environment $ep). Copy $f to the client's machine and run there: ops/smartwinfa.sh site up $id" ;;
      status) fleet_compose ps ;;
      *) die "fleet up|down|status|tunnel" ;;
    esac ;;
  client)
    action="${2:-}"; id="${3:-}"; need_id "$id"
    case "$action" in
      new)
        f="$CLIENTS/$id.env"; [ -f "$f" ] && die "$f already exists"
        port=$(( 4100 + $(ls "$CLIENTS"/*.env 2>/dev/null | wc -l) + 1 ))
        sed -e "s/^CLIENT_ID=.*/CLIENT_ID=$id/" -e "s/^CLIENT_NAME=.*/CLIENT_NAME=$id/" -e "s/^WEB_PORT=.*/WEB_PORT=$port/" \
            -e "s/^DB_PASSWORD=.*/DB_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')/" \
            -e "s/^SEED_FILE=.*/SEED_FILE=/" "$CLIENTS/rishabh.env.example" > "$f"
        chmod 600 "$f"
        echo "created $f (web port $port). Set CLIENT_NAME, COMPANY_SCHEMA and SEED_FILE, then: ops/smartwinfa.sh client up $id" ;;
      up) docker network inspect smartwinfa-fleet >/dev/null 2>&1 || docker network create smartwinfa-fleet >/dev/null
          client_compose "$id" up -d
          echo "$id: http://localhost:$(grep -E '^WEB_PORT=' "$(env_of "$id")" | cut -d= -f2)" ;;
      down) client_compose "$id" down ;;
      status) client_compose "$id" ps ;;
      logs) client_compose "$id" logs --tail=200 -f ;;
      backup) client_compose "$id" exec -T backup sh -c 'f=/backups/manual-$(date +%F-%H%M).dump; pg_dump --format=custom --file="$f" && echo "backup: done $f"' ;;
      restore)
        dump="${4:-}"; [ -r "$dump" ] || die "client restore $id <path to .dump>"
        client_compose "$id" exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -U smartwinfa_web -d smartwin_data_intake' < "$dump"
        client_compose "$id" restart api web ;;
      update)
        version="${4:-}"; [ -n "$version" ] || die "client update $id <version>"
        f="$(env_of "$id")"; previous="$(grep -E '^SMARTWINFA_VERSION=' "$f" | cut -d= -f2)"
        sed -i "s/^SMARTWINFA_VERSION=.*/SMARTWINFA_VERSION=$version/" "$f"
        client_compose "$id" up -d web api
        echo "$id: $previous -> $version (roll back with: ops/smartwinfa.sh client update $id $previous)" ;;
      *) die "client new|up|down|status|logs|backup|restore|update <id>" ;;
    esac ;;
  site)
    action="${2:-}"; id="${3:-}"
    case "$action" in
      support) state="${4:-}"; id="${3:-}"; need_id "$id"; f="$(env_of "$id")"
        case "$state" in
          on) set_setting "$f" SUPPORT_MODE on; site_compose "$id" --profile support up -d support-agent; echo "support agent on: the vendor can manage this machine" ;;
          off) set_setting "$f" SUPPORT_MODE off; site_compose "$id" --profile support rm -sf support-agent; echo "support agent off: the vendor can no longer manage this machine" ;;
          *) die "site support <id> on|off" ;;
        esac ;;
      up) need_id "$id"; docker network inspect smartwinfa-fleet >/dev/null 2>&1 || docker network create smartwinfa-fleet >/dev/null
          # shellcheck disable=SC2046
          site_compose "$id" $(site_profiles "$id") up -d --remove-orphans
          echo "$id: http://localhost:$(setting "$(env_of "$id")" WEB_PORT)  parts: $(site_profiles "$id" | sed 's/--profile //g')" ;;
      down) need_id "$id"; site_compose "$id" --profile tunnel --profile support --profile logs --profile offsite down ;;
      status) need_id "$id"; site_compose "$id" --profile tunnel --profile support --profile logs --profile offsite ps ;;
      *) die "site up|down|status <id> | site support <id> on|off" ;;
    esac ;;
  list)
    printf "%-14s %-10s %-24s %s\n" CLIENT STATE VERSION WEB
    for f in "$CLIENTS"/*.env; do
      [ -e "$f" ] || continue
      id="$(basename "$f" .env)"
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id-web" 2>/dev/null || true)"; state="${state:-stopped}"
      printf "%-14s %-10s %-24s http://localhost:%s\n" "$id" "$state" "$(grep -E '^SMARTWINFA_VERSION=' "$f" | cut -d= -f2)" "$(grep -E '^WEB_PORT=' "$f" | cut -d= -f2)"
    done ;;
  build-local)
    docker build -t smartwinfa-web:local -f "$ROOT/Dockerfile" "$ROOT"
    docker build -t smartwinfa-legacy-api:local -f "$ROOT/Dockerfile.legacy-api" "$ROOT" ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
