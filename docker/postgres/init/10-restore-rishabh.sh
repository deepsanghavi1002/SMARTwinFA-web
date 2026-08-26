#!/usr/bin/env sh
set -eu

seed_file="/seed/rishabh-plastic27.dump"

if [ ! -r "$seed_file" ]; then
  echo >&2 "Missing required Rishabh Plastic seed: $seed_file"
  echo >&2 "Copy the authorized PostgreSQL custom dump to database/fixtures/private/rishabh-plastic27.dump, then run docker compose again."
  exit 1
fi

psql_do() {
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set ON_ERROR_STOP=1 --quiet --no-psqlrc --command "$1"
}

echo "Restoring the private Rishabh Plastic lower-environment seed..."

# The dump stores money as pre-formatted currency text ("? 1,234.56", negatives
# as "?- 1,234.56"): the rupee symbol was already lost to an encoding conversion
# upstream, so PostgreSQL cannot parse those literals as money under any locale.
# Text columns contain stray "?" bytes too, so a blanket substitution over the
# data stream would corrupt real values. Instead demote only the money columns
# to text, load verbatim, then normalize and promote them back.
pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --schema-only \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  "$seed_file"

psql_do "
CREATE TABLE public.smartwinfa_money_columns AS
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'rishabh_plastic27' AND data_type = 'money';

DO \$\$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM public.smartwinfa_money_columns LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE text',
                   target.table_schema, target.table_name, target.column_name);
  END LOOP;
END
\$\$;
"

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --data-only \
  --disable-triggers \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  "$seed_file"

psql_do "
DO \$\$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM public.smartwinfa_money_columns LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN %I TYPE money USING '
      'NULLIF(regexp_replace(%I, ''[^0-9.-]'', '''', ''g''), '''')::numeric::money',
      target.table_schema, target.table_name, target.column_name, target.column_name);
  END LOOP;
END
\$\$;

DROP TABLE public.smartwinfa_money_columns;
"

table_count="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'rishabh_plastic27';")"

if [ "$table_count" -eq 0 ]; then
  echo >&2 "The Rishabh Plastic seed restored, but schema rishabh_plastic27 was not found."
  exit 1
fi

money_count="$(psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'rishabh_plastic27' AND data_type = 'money';")"

echo "Rishabh Plastic seed restored ($table_count tables in rishabh_plastic27, $money_count money columns normalized)."
