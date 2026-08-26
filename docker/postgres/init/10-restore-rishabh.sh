#!/usr/bin/env sh
set -eu

seed_file="/seed/rishabh-plastic27.dump"

if [ ! -r "$seed_file" ]; then
  echo >&2 "Missing required Rishabh Plastic seed: $seed_file"
  echo >&2 "Copy the authorized PostgreSQL custom dump to database/fixtures/private/rishabh-plastic27.dump, then run docker compose again."
  exit 1
fi

echo "Restoring the private Rishabh Plastic lower-environment seed..."
pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  "$seed_file"

table_count="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'rishabh_plastic27';")"

if [ "$table_count" -eq 0 ]; then
  echo >&2 "The Rishabh Plastic seed restored, but schema rishabh_plastic27 was not found."
  exit 1
fi

echo "Rishabh Plastic seed restored ($table_count tables in rishabh_plastic27)."
