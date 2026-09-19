BEGIN;

CREATE SCHEMA IF NOT EXISTS control;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS migration;

CREATE TABLE control.cell (
  cell_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]{2,49}$'),
  region text NOT NULL,
  secret_reference text NOT NULL CHECK (secret_reference <> ''),
  status text NOT NULL CHECK (status IN ('provisioning','active','draining','retired')),
  schema_version bigint NOT NULL DEFAULT 0 CHECK (schema_version >= 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE control.tenant (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]{2,49}$'),
  display_name text NOT NULL CHECK (display_name <> ''),
  status text NOT NULL CHECK (status IN ('onboarding','active','suspended','retired')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE control.tenant_placement (
  tenant_id uuid PRIMARY KEY REFERENCES control.tenant(tenant_id),
  cell_id uuid NOT NULL REFERENCES control.cell(cell_id),
  placement_version bigint NOT NULL CHECK (placement_version > 0),
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (tenant_id, cell_id)
);

CREATE TABLE control.company (
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  company_id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$'),
  display_name text NOT NULL CHECK (display_name <> ''),
  status text NOT NULL CHECK (status IN ('active','suspended','retired')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, company_id),
  UNIQUE (tenant_id, public_id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE control.accounting_year (
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  accounting_year_id uuid NOT NULL DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$'),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','open','locked','closed')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, company_id, accounting_year_id),
  UNIQUE (tenant_id, company_id, public_id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES control.company(tenant_id, company_id),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE control.identity (
  identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  login_normalized text NOT NULL UNIQUE CHECK (login_normalized = lower(btrim(login_normalized))),
  display_name text NOT NULL CHECK (display_name <> ''),
  status text NOT NULL CHECK (status IN ('pending','active','locked','disabled')),
  password_hash text,
  password_reset_required boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (password_hash IS NULL OR password_hash ~ '^\$argon2(id|i|d)\$')
);

CREATE TABLE control.membership (
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  membership_id uuid NOT NULL DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES control.identity(identity_id),
  status text NOT NULL CHECK (status IN ('invited','active','suspended','retired')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, membership_id),
  UNIQUE (tenant_id, identity_id)
);

CREATE TABLE control.role (
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  role_id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  description text NOT NULL,
  system_role boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, role_id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE control.permission (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text NOT NULL
);

CREATE TABLE control.role_permission (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES control.permission(permission_id),
  PRIMARY KEY (tenant_id, role_id, permission_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES control.role(tenant_id, role_id)
);

CREATE TABLE control.membership_role (
  tenant_id uuid NOT NULL,
  membership_role_id uuid NOT NULL DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  company_id uuid,
  accounting_year_id uuid,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, membership_role_id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, membership_id, role_id, company_id, accounting_year_id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES control.membership(tenant_id, membership_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES control.role(tenant_id, role_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES control.company(tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id, accounting_year_id) REFERENCES control.accounting_year(tenant_id, company_id, accounting_year_id),
  CHECK ((accounting_year_id IS NULL) OR (company_id IS NOT NULL))
);

CREATE TABLE control.session (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES control.identity(identity_id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (expires_at > issued_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE TABLE audit.event (
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  accounting_year_id uuid,
  actor_identity_id uuid REFERENCES control.identity(identity_id),
  correlation_id uuid NOT NULL,
  event_name text NOT NULL CHECK (event_name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','denied','failed')),
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES control.company(tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id, accounting_year_id) REFERENCES control.accounting_year(tenant_id, company_id, accounting_year_id),
  CHECK (accounting_year_id IS NULL OR company_id IS NOT NULL)
);

CREATE TABLE audit.outbox (
  tenant_id uuid NOT NULL,
  outbox_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, event_id, topic),
  FOREIGN KEY (tenant_id, event_id) REFERENCES audit.event(tenant_id, event_id)
);

CREATE TABLE jobs.job (
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  job_id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  accounting_year_id uuid NOT NULL,
  job_type text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  status text NOT NULL CHECK (status IN ('queued','claimed','succeeded','failed','cancelled')),
  requested_by uuid NOT NULL REFERENCES control.identity(identity_id),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 10),
  worker_id text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, job_id),
  UNIQUE (tenant_id, company_id, accounting_year_id, job_type, idempotency_key),
  FOREIGN KEY (tenant_id, company_id, accounting_year_id) REFERENCES control.accounting_year(tenant_id, company_id, accounting_year_id),
  CHECK ((status = 'claimed') = (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('succeeded','failed','cancelled')) = (completed_at IS NOT NULL))
);

CREATE TABLE migration.run (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id uuid NOT NULL REFERENCES control.cell(cell_id),
  tenant_id uuid NOT NULL REFERENCES control.tenant(tenant_id),
  company_id uuid NOT NULL,
  accounting_year_id uuid NOT NULL,
  source_snapshot_id text NOT NULL,
  migration_version text NOT NULL,
  migration_checksum bytea NOT NULL CHECK (octet_length(migration_checksum) = 32),
  status text NOT NULL CHECK (status IN ('planned','running','reconciling','succeeded','failed','rolled_back')),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (tenant_id, company_id, accounting_year_id, source_snapshot_id, migration_version),
  FOREIGN KEY (tenant_id, company_id, accounting_year_id) REFERENCES control.accounting_year(tenant_id, company_id, accounting_year_id)
);

CREATE INDEX membership_identity_idx ON control.membership(identity_id) WHERE status = 'active';
CREATE INDEX session_identity_active_idx ON control.session(identity_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX audit_event_scope_time_idx ON audit.event(tenant_id, company_id, accounting_year_id, occurred_at DESC);
CREATE INDEX outbox_unpublished_idx ON audit.outbox(created_at) WHERE published_at IS NULL;
CREATE INDEX job_claim_idx ON jobs.job(tenant_id, status, created_at) WHERE status = 'queued';

CREATE FUNCTION control.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.tenant_id', true), '')::uuid;

CREATE FUNCTION control.current_company_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.company_id', true), '')::uuid;

CREATE FUNCTION control.current_accounting_year_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
RETURN nullif(current_setting('app.accounting_year_id', true), '')::uuid;

DO $rls$
DECLARE target regclass;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'control.tenant_placement'::regclass, 'control.company'::regclass,
    'control.accounting_year'::regclass, 'control.membership'::regclass,
    'control.role'::regclass, 'control.role_permission'::regclass,
    'control.membership_role'::regclass, 'audit.event'::regclass,
    'audit.outbox'::regclass, 'jobs.job'::regclass, 'migration.run'::regclass
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', target);
  END LOOP;
END $rls$;

CREATE POLICY company_scope ON jobs.job AS RESTRICTIVE
  USING (company_id = nullif(current_setting('app.company_id', true), '')::uuid AND accounting_year_id = nullif(current_setting('app.accounting_year_id', true), '')::uuid)
  WITH CHECK (company_id = nullif(current_setting('app.company_id', true), '')::uuid AND accounting_year_id = nullif(current_setting('app.accounting_year_id', true), '')::uuid);

REVOKE ALL ON SCHEMA control, audit, jobs, migration FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA control, audit, jobs, migration FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA control, audit, jobs, migration FROM PUBLIC;

COMMIT;
