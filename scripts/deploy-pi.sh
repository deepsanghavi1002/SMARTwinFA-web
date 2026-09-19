#!/usr/bin/env bash
set -euo pipefail

pi_host="${SMARTWINFA_PI_HOST:-192.168.0.197}"
pi_user="${SMARTWINFA_PI_USER:?Set SMARTWINFA_PI_USER to an SSH-authorized Pi account}"
release="${SMARTWINFA_RELEASE:-$(git rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M%S)}"
remote_root="${SMARTWINFA_PI_ROOT:-deployments/smartwinfa-web}"
remote_release="${remote_root}/releases/${release}"

ssh_target="${pi_user}@${pi_host}"
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "${ssh_target}" \
  "mkdir -p '${remote_release}'"

rsync -az \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '.next/' \
  --exclude '.wrangler/' \
  ./ "${ssh_target}:${remote_release}/"

ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "${ssh_target}" \
  "cd '${remote_release}' && SMARTWINFA_RELEASE='${release}' docker compose up --build -d && curl --retry 12 --retry-delay 5 --retry-connrefused --fail http://127.0.0.1:4173/api/health && ln -sfn 'releases/${release}' '${remote_root}/current'"

printf 'Deployed %s to http://%s:4173\n' "${release}" "${pi_host}"
