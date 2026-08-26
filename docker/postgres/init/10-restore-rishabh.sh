#!/usr/bin/env sh
set -eu

company_seed="/seed/rishabh-plastic27.dump"
setup_seed="/seed/smart-setup.dump"

# The documented intake baseline is two schemas: the per-company schema and the
# shared smart_setup metadata schema. Menu catalog, account master and product
# master all read smart_setup, so a company-only seed leaves them failing.
for seed_file in "$company_seed" "$setup_seed"; do
  if [ ! -r "$seed_file" ]; then
    echo >&2 "Missing required seed: $seed_file"
    echo >&2 "Run: node scripts/prepare-rishabh-local-seed.mjs <company-dump> <smart-setup-dump>"
    exit 1
  fi
done

psql_do() {
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set ON_ERROR_STOP=1 --quiet --no-psqlrc --command "$1"
}

restore_schema() {
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --schema-only \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    "$1"
}

restore_data() {
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --data-only \
    --disable-triggers \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    "$1"
}

echo "Restoring the private lower-environment seeds..."

# Both dumps store money as pre-formatted currency text ("? 1,234.56", negatives
# as "?- 1,234.56"): the rupee symbol was lost to an encoding conversion upstream
# of the dumps, so it is a literal "?" byte and PostgreSQL cannot parse those
# literals as money under any locale. Text columns carry stray "?" bytes too, so
# rewriting the data stream would corrupt real values. Demote only the money
# columns to text, load verbatim, then normalize and promote them back.
restore_schema "$company_seed"
restore_schema "$setup_seed"

psql_do "
CREATE TABLE public.smartwinfa_money_columns AS
SELECT table_schema, table_name, column_name
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND data_type = 'money';

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

restore_data "$company_seed"
restore_data "$setup_seed"

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

count_tables() {
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align \
    --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = '$1';"
}

company_tables="$(count_tables rishabh_plastic27)"
setup_tables="$(count_tables smart_setup)"

if [ "$company_tables" -eq 0 ]; then
  echo >&2 "The seeds restored, but schema rishabh_plastic27 was not found."
  exit 1
fi

if [ "$setup_tables" -eq 0 ]; then
  echo >&2 "The seeds restored, but schema smart_setup was not found."
  exit 1
fi

echo "Seeds restored (rishabh_plastic27: $company_tables tables, smart_setup: $setup_tables tables)."
