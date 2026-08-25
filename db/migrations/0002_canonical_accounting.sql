BEGIN;
CREATE SCHEMA accounting; CREATE SCHEMA inventory; CREATE SCHEMA metadata;

CREATE TABLE accounting.account (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, account_id uuid NOT NULL DEFAULT gen_random_uuid(), public_id uuid NOT NULL DEFAULT gen_random_uuid(), legacy_id text,
 code text NOT NULL, name text NOT NULL CHECK(btrim(name)<>''), account_type text NOT NULL CHECK(account_type IN('asset','liability','equity','income','expense','customer','supplier','bank','cash','tax','other')),
 currency_code text NOT NULL CHECK(currency_code~'^[A-Z]{3}$'), status text NOT NULL CHECK(status IN('active','inactive','archived')), opening_balance_minor bigint NOT NULL DEFAULT 0, version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(tenant_id,company_id,account_id), UNIQUE(tenant_id,company_id,public_id), UNIQUE(tenant_id,company_id,code), FOREIGN KEY(tenant_id,company_id) REFERENCES control.company(tenant_id,company_id));

CREATE TABLE metadata.custom_field_definition (
 tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id), custom_field_id uuid NOT NULL DEFAULT gen_random_uuid(), stable_id text NOT NULL, entity_type text NOT NULL CHECK(entity_type IN('account','product')),
 value_type text NOT NULL CHECK(value_type IN('text','integer','decimal','date','boolean')), label text NOT NULL CHECK(btrim(label)<>''), required boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 constraints_json jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(constraints_json)='object'), version bigint NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(tenant_id,custom_field_id), UNIQUE(tenant_id,stable_id));

CREATE TABLE accounting.account_custom_value (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, account_id uuid NOT NULL, custom_field_id uuid NOT NULL, value_text text, value_integer bigint, value_decimal numeric(30,10), value_date date, value_boolean boolean,
 PRIMARY KEY(tenant_id,company_id,account_id,custom_field_id), FOREIGN KEY(tenant_id,company_id,account_id) REFERENCES accounting.account(tenant_id,company_id,account_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,custom_field_id) REFERENCES metadata.custom_field_definition(tenant_id,custom_field_id), CHECK(num_nonnulls(value_text,value_integer,value_decimal,value_date,value_boolean)=1));

CREATE TABLE accounting.journal_entry (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, accounting_year_id uuid NOT NULL, journal_entry_id uuid NOT NULL DEFAULT gen_random_uuid(), public_id uuid NOT NULL DEFAULT gen_random_uuid(), entry_number text NOT NULL, entry_date date NOT NULL,
 currency_code text NOT NULL CHECK(currency_code~'^[A-Z]{3}$'), status text NOT NULL CHECK(status IN('draft','posted','reversed')), reversal_of uuid, idempotency_key text NOT NULL CHECK(btrim(idempotency_key)<>''), created_by uuid NOT NULL REFERENCES control.identity(identity_id), posted_at timestamptz,
 PRIMARY KEY(tenant_id,company_id,accounting_year_id,journal_entry_id), UNIQUE(tenant_id,company_id,accounting_year_id,public_id), UNIQUE(tenant_id,company_id,accounting_year_id,entry_number), UNIQUE(tenant_id,company_id,accounting_year_id,idempotency_key),
 FOREIGN KEY(tenant_id,company_id,accounting_year_id) REFERENCES control.accounting_year(tenant_id,company_id,accounting_year_id), FOREIGN KEY(tenant_id,company_id,accounting_year_id,reversal_of) REFERENCES accounting.journal_entry(tenant_id,company_id,accounting_year_id,journal_entry_id),
 CHECK((status='posted')=(posted_at IS NOT NULL)), CHECK((status='reversed')=(reversal_of IS NOT NULL)));

CREATE TABLE accounting.journal_line (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, accounting_year_id uuid NOT NULL, journal_entry_id uuid NOT NULL, line_number integer NOT NULL CHECK(line_number>0), account_id uuid NOT NULL,
 debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor>=0), credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor>=0), PRIMARY KEY(tenant_id,company_id,accounting_year_id,journal_entry_id,line_number),
 FOREIGN KEY(tenant_id,company_id,accounting_year_id,journal_entry_id) REFERENCES accounting.journal_entry(tenant_id,company_id,accounting_year_id,journal_entry_id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,company_id,account_id) REFERENCES accounting.account(tenant_id,company_id,account_id), CHECK((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0)));

CREATE TABLE inventory.product (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, product_id uuid NOT NULL DEFAULT gen_random_uuid(), public_id uuid NOT NULL DEFAULT gen_random_uuid(), code text NOT NULL, name text NOT NULL CHECK(btrim(name)<>''), unit_code text NOT NULL,
 status text NOT NULL CHECK(status IN('active','inactive','archived')), PRIMARY KEY(tenant_id,company_id,product_id), UNIQUE(tenant_id,company_id,public_id), UNIQUE(tenant_id,company_id,code), FOREIGN KEY(tenant_id,company_id) REFERENCES control.company(tenant_id,company_id));

CREATE TABLE inventory.stock_movement (
 tenant_id uuid NOT NULL, company_id uuid NOT NULL, accounting_year_id uuid NOT NULL, stock_movement_id uuid NOT NULL DEFAULT gen_random_uuid(), product_id uuid NOT NULL, movement_date date NOT NULL,
 movement_type text NOT NULL CHECK(movement_type IN('opening','receipt','issue','transfer_in','transfer_out','adjustment','production_in','production_out','reversal')), quantity numeric(30,10) NOT NULL CHECK(quantity<>0), unit_cost_minor bigint CHECK(unit_cost_minor>=0), currency_code text CHECK(currency_code~'^[A-Z]{3}$'), source_type text NOT NULL, source_id uuid NOT NULL, idempotency_key text NOT NULL,
 PRIMARY KEY(tenant_id,company_id,accounting_year_id,stock_movement_id), UNIQUE(tenant_id,company_id,accounting_year_id,idempotency_key), FOREIGN KEY(tenant_id,company_id,accounting_year_id) REFERENCES control.accounting_year(tenant_id,company_id,accounting_year_id), FOREIGN KEY(tenant_id,company_id,product_id) REFERENCES inventory.product(tenant_id,company_id,product_id), CHECK((unit_cost_minor IS NULL)=(currency_code IS NULL)));

CREATE FUNCTION accounting.assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,accounting AS $$
DECLARE t uuid; c uuid; y uuid; e uuid; s text; d numeric; cr numeric; n bigint; BEGIN t:=COALESCE(NEW.tenant_id,OLD.tenant_id);c:=COALESCE(NEW.company_id,OLD.company_id);y:=COALESCE(NEW.accounting_year_id,OLD.accounting_year_id);e:=COALESCE(NEW.journal_entry_id,OLD.journal_entry_id);
 SELECT status INTO s FROM accounting.journal_entry WHERE tenant_id=t AND company_id=c AND accounting_year_id=y AND journal_entry_id=e;
 IF s='posted' THEN SELECT count(*),coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0) INTO n,d,cr FROM accounting.journal_line WHERE tenant_id=t AND company_id=c AND accounting_year_id=y AND journal_entry_id=e; IF n<2 OR d<=0 OR d<>cr THEN RAISE EXCEPTION 'posted journal must contain balanced nonzero lines'; END IF; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER journal_line_balance AFTER INSERT OR UPDATE OR DELETE ON accounting.journal_line DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.assert_journal_balanced();
CREATE CONSTRAINT TRIGGER journal_entry_balance AFTER INSERT OR UPDATE ON accounting.journal_entry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION accounting.assert_journal_balanced();

CREATE FUNCTION inventory.prevent_negative_stock() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,inventory AS $$ DECLARE q numeric; BEGIN SELECT coalesce(sum(quantity),0) INTO q FROM inventory.stock_movement WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND accounting_year_id=NEW.accounting_year_id AND product_id=NEW.product_id; IF q<0 THEN RAISE EXCEPTION 'stock quantity cannot become negative'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER stock_nonnegative AFTER INSERT OR UPDATE ON inventory.stock_movement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory.prevent_negative_stock();

CREATE INDEX account_name_idx ON accounting.account(tenant_id,company_id,lower(name)); CREATE INDEX journal_date_idx ON accounting.journal_entry(tenant_id,company_id,accounting_year_id,entry_date DESC); CREATE INDEX stock_product_date_idx ON inventory.stock_movement(tenant_id,company_id,accounting_year_id,product_id,movement_date);
DO $$ DECLARE r regclass; BEGIN FOREACH r IN ARRAY ARRAY['accounting.account'::regclass,'accounting.account_custom_value'::regclass,'accounting.journal_entry'::regclass,'accounting.journal_line'::regclass,'inventory.product'::regclass,'inventory.stock_movement'::regclass,'metadata.custom_field_definition'::regclass] LOOP EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',r); EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',r); EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',r); END LOOP; END $$;
REVOKE ALL ON SCHEMA accounting,inventory,metadata FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA accounting,inventory,metadata FROM PUBLIC; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA accounting,inventory,metadata FROM PUBLIC;
COMMIT;
