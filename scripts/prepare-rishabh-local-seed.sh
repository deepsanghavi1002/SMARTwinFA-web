#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dump="${1:-$HOME/Downloads/rishabh_plastic27_backup.sql}"
target_dir="$repo_root/database/fixtures/private"
target_dump="$target_dir/rishabh-plastic27.dump"

if [[ ! -f "$source_dump" ]]; then
  echo "Rishabh Plastic PostgreSQL dump not found: $source_dump" >&2
  echo "Pass its path as the first argument." >&2
  exit 1
fi

if ! pg_restore --list "$source_dump" | grep -q 'SCHEMA - rishabh_plastic27 '; then
  echo "The supplied file is not the expected Rishabh Plastic PostgreSQL custom dump." >&2
  exit 1
fi

mkdir -p "$target_dir"
install -m 600 "$source_dump" "$target_dump"

echo "Private Rishabh Plastic seed prepared at: $target_dump"
echo "It is ignored by Git and can now be restored by compose.local.yaml."
