#!/usr/bin/env bash
set -euo pipefail

for seed_file in /seed/smart_setup.dump /seed/smart_system.dump; do
  if [ ! -r "$seed_file" ]; then
    echo >&2 "Missing required legacy platform metadata export: $seed_file"
    exit 1
  fi

  echo "Restoring $(basename "$seed_file")..."
  pg_restore --no-owner --no-privileges --file - "$seed_file" \
    | sed -E 's/\?(-? )([0-9])/₹\1\2/g' \
    | psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
done

echo "Legacy platform metadata restored."
