#!/usr/bin/env bash
# SMARTwinFA on a fresh Ubuntu server (22.04 / 24.04): Docker, the code, the control panel and the Rishabh Plastic demo.
#
#   curl -fsSL <raw link of this file> -o setup-server.sh      (or copy the file over)
#   sudo bash setup-server.sh                                   # control panel + Rishabh demo
#   sudo TUNNEL_TOKEN=<token> bash setup-server.sh              # ... and publish through your Cloudflare Tunnel
#
# Settings (environment variables, all optional):
#   REPO_URL      default https://github.com/deepsanghavi1002/SMARTwinFA-web.git (private: use a GitHub token, see below)
#   BRANCH        default ops-fleet-dashboard
#   FOLDER        default /srv/smartwinfa/SMARTwinFA-web
#   GITHUB_TOKEN  read-only GitHub token for the private repository (Settings > Developer settings > Fine-grained tokens)
#   TUNNEL_TOKEN  Cloudflare Zero Trust > Networks > Tunnels > your tunnel > token
#   SEED_DUMP     path to rishabh-plastic27.dump on this server, restored on the first start
# Safe to run again: finished steps are skipped.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/deepsanghavi1002/SMARTwinFA-web.git}"
BRANCH="${BRANCH:-ops-fleet-dashboard}"
FOLDER="${FOLDER:-/srv/smartwinfa/SMARTwinFA-web}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$*"; }
done_() { printf '    \033[32m%s\033[0m\n' "$*"; }
die() { printf '\n\033[33m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo bash $0"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "warning: tested on Ubuntu; this is ${PRETTY_NAME:-unknown}"

step "System packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git ufw >/dev/null
done_ "git, curl, ufw installed"

step "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null || die "docker compose plugin missing"
done_ "$(docker --version)"
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then usermod -aG docker "$SUDO_USER"; fi

step "Firewall: only SSH comes in (the tunnel connects out)"
# The port of the SSH connection running this script (4th field of SSH_CONNECTION), so the firewall never locks you out.
ssh_port="$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')"
[ -n "$ssh_port" ] || ssh_port="$(sshd -T 2>/dev/null | awk '$1 == "port" {print $2; exit}')"
if [ -n "$ssh_port" ]; then
  ufw allow "$ssh_port"/tcp >/dev/null
  ufw --force enable >/dev/null
  done_ "ufw on, inbound allowed: SSH port $ssh_port only (Docker-published ports stay on 127.0.0.1)"
else
  ssh_port=22
  echo "    could not tell the SSH port; firewall left unchanged (allow your SSH port, then: ufw enable)"
fi

step "Code: $FOLDER (branch $BRANCH)"
mkdir -p "$(dirname "$FOLDER")"
clone_url="$REPO_URL"
if [ -n "${GITHUB_TOKEN:-}" ]; then clone_url="${REPO_URL/https:\/\//https:\/\/x-access-token:${GITHUB_TOKEN}@}"; fi
if [ ! -d "$FOLDER/.git" ]; then
  git clone --branch "$BRANCH" "$clone_url" "$FOLDER" || die "git clone failed. For the private repository run again with GITHUB_TOKEN=<read-only token>."
  git -C "$FOLDER" remote set-url origin "$REPO_URL"   # do not keep the token in .git/config
else
  git -C "$FOLDER" fetch "$clone_url" "$BRANCH" && git -C "$FOLDER" checkout -q "$BRANCH" && git -C "$FOLDER" merge -q --ff-only FETCH_HEAD
fi
done_ "code ready"
cd "$FOLDER"

if [ -n "${SEED_DUMP:-}" ]; then
  step "Rishabh Plastic database dump"
  [ -r "$SEED_DUMP" ] || die "dump not found: $SEED_DUMP"
  mkdir -p database/fixtures/private && cp "$SEED_DUMP" database/fixtures/private/rishabh-plastic27.dump
  done_ "copied; restored on the first start of the Rishabh stack"
fi

step "Rishabh Plastic settings"
if [ ! -f ops/clients/rishabh.env ]; then
  sed "s/^DB_PASSWORD=.*/DB_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')/" ops/clients/rishabh.env.example > ops/clients/rishabh.env
  chmod 600 ops/clients/rishabh.env
  done_ "created ops/clients/rishabh.env"
else done_ "ops/clients/rishabh.env kept"; fi

step "Building the app images (5-15 minutes the first time)"
ops/smartwinfa.sh build-local

step "Control panel"
ops/smartwinfa.sh fleet up
if [ -n "${TUNNEL_TOKEN:-}" ]; then
  if grep -q '^TUNNEL_TOKEN=' ops/fleet/.env; then sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$TUNNEL_TOKEN|" ops/fleet/.env; else echo "TUNNEL_TOKEN=$TUNNEL_TOKEN" >> ops/fleet/.env; fi
  chmod 600 ops/fleet/.env
  ops/smartwinfa.sh fleet tunnel
  done_ "cloudflared started"
fi

step "Rishabh Plastic"
ops/smartwinfa.sh client up rishabh
ops/smartwinfa.sh list

grafana="$(grep -E '^GRAFANA_ADMIN_PASSWORD=' ops/fleet/.env | cut -d= -f2)"
cat <<EOF

SMARTwinFA is running on this server (only reachable on the server itself or through the tunnel).
  Rishabh Plastic  http://127.0.0.1:4101   tunnel: rishabh-plastic.<your-domain> -> http://rishabh-web:3000
  Portainer        http://127.0.0.1:9000   user admin, password in $FOLDER/ops/fleet/.portainer-admin-password
  Grafana          http://127.0.0.1:3001   user admin, password $grafana
  Uptime Kuma      http://127.0.0.1:3002
From your PC without the tunnel:  ssh -p $ssh_port -L 9000:127.0.0.1:9000 -L 3001:127.0.0.1:3001 -L 4101:127.0.0.1:4101 ${SUDO_USER:-ubuntu}@<server>
  then open http://localhost:9000 etc. on your PC.
EOF
