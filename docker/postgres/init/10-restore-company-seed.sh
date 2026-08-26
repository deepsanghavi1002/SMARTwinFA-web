#!/usr/bin/env bash
set -euo pipefail

dump_name="${SMARTWINFA_COMPANY_DUMP:?Set SMARTWINFA_COMPANY_DUMP}"
company_schema="${LEGACY_COMPANY_SCHEMA:?Set LEGACY_COMPANY_SCHEMA}"

if [[ "$dump_name" == */* || "$dump_name" == .* || ! "$dump_name" =~ \.(dump|backup)$ ]]; then
  echo >&2 "SMARTWINFA_COMPANY_DUMP must be the filename of a PostgreSQL custom dump."
  exit 1
fi

if [[ ! "$company_schema" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo >&2 "LEGACY_COMPANY_SCHEMA must be a PostgreSQL identifier."
  exit 1
fi

seed_file="/seed/$dump_name"
if [ ! -r "$seed_file" ]; then
  echo >&2 "Missing local company seed: $seed_file"
  echo >&2 "Place the approved PostgreSQL custom dump in database/fixtures/private/ and set SMARTWINFA_COMPANY_DUMP."
  exit 1
fi

echo "Restoring local company test seed: $dump_name"

# Restore through SQL so legacy Indian-currency values represented as `? 1.00`
# are normalised only when the token is immediately followed by a number.
pg_restore --no-owner --no-privileges --file - "$seed_file" \
  | sed -E 's/\?(-? )([0-9])/₹\1\2/g' \
  | psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"

table_count="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$company_schema';")"

if [ "$table_count" -eq 0 ]; then
  echo >&2 "The local seed restored, but schema $company_schema was not found."
  exit 1
fi

echo "Local company test seed restored ($table_count tables in $company_schema)."
