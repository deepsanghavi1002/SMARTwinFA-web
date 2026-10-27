#!/usr/bin/env sh
# First start of a client database: restore the client's PostgreSQL dump (SEED_FILE) when one is supplied.
# Without a seed the database starts empty; import the client's data later (ops/smartwinfa.sh client restore).
set -eu

if [ ! -r "$SEED_FILE" ] || [ -d "$SEED_FILE" ]; then
  echo "No seed for this client ($SEED_FILE); the database starts empty."
  exit 0
fi

echo "Restoring the client seed $SEED_FILE ..."
pg_restore --exit-on-error --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$SEED_FILE"
tables="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$COMPANY_SCHEMA';")"
echo "Seed restored ($tables tables in $COMPANY_SCHEMA)."
