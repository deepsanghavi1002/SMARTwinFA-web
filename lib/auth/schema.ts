import type { Client } from "pg";

/**
 * The web sign-in tables, kept in their own schema of each client's database beside the legacy
 * smart_system / smart_setup data, which they never change. Every client installation has its
 * own users: a login on one client's server opens nothing on another's.
 *
 * Nothing applies db/migrations at runtime yet, so the tables are created on first use. Every
 * statement is idempotent, and the advisory lock stops two first requests racing each other.
 */

export const AUTH_SCHEMA = "web_auth";

export const AUTH_DDL: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS ${AUTH_SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${AUTH_SCHEMA}.app_user (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     login text NOT NULL CHECK (length(btrim(login)) BETWEEN 3 AND 100),
     email text,
     display_name text NOT NULL,
     role text NOT NULL CHECK (role IN ('platform_admin', 'company_admin', 'employee')),
     operator_login text,
     password_hash text,
     status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
     failed_logins integer NOT NULL DEFAULT 0,
     locked_until timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by bigint REFERENCES ${AUTH_SCHEMA}.app_user (id),
     password_set_at timestamptz,
     last_login_at timestamptz
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_user_login_key ON ${AUTH_SCHEMA}.app_user (lower(login))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_key ON ${AUTH_SCHEMA}.app_user (lower(email)) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS ${AUTH_SCHEMA}.session (
     token_hash text PRIMARY KEY,
     user_id bigint NOT NULL REFERENCES ${AUTH_SCHEMA}.app_user (id) ON DELETE CASCADE,
     operator_login text,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     user_agent text
   )`,
  `CREATE INDEX IF NOT EXISTS session_user_idx ON ${AUTH_SCHEMA}.session (user_id)`,
  `CREATE TABLE IF NOT EXISTS ${AUTH_SCHEMA}.password_token (
     token_hash text PRIMARY KEY,
     user_id bigint NOT NULL REFERENCES ${AUTH_SCHEMA}.app_user (id) ON DELETE CASCADE,
     purpose text NOT NULL CHECK (purpose IN ('invite', 'reset')),
     created_at timestamptz NOT NULL DEFAULT now(),
     created_by bigint REFERENCES ${AUTH_SCHEMA}.app_user (id),
     expires_at timestamptz NOT NULL,
     used_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS password_token_user_idx ON ${AUTH_SCHEMA}.password_token (user_id)`,
  `CREATE TABLE IF NOT EXISTS ${AUTH_SCHEMA}.audit_event (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     at timestamptz NOT NULL DEFAULT now(),
     actor_user_id bigint,
     action text NOT NULL,
     target_user_id bigint,
     detail jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
];

/** Runs inside the caller's transaction. */
export async function ensureAuthSchema(client: Client): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa.web_auth.schema'))");
  for (const statement of AUTH_DDL) await client.query(statement);
}
