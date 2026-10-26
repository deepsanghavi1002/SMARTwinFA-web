import type { Client } from "pg";
import { SESSION_IDLE_HOURS, SESSION_MAX_HOURS } from "./cookies.ts";
import { isRole, type Role } from "./roles.ts";
import { AUTH_SCHEMA } from "./schema.ts";
import { randomToken, tokenHash } from "./tokens.ts";

/** Reads and writes of the web_auth tables. Every function runs on the caller's client, inside its transaction. */

export type UserStatus = "invited" | "active" | "disabled";

export type AuthUser = Readonly<{
  id: number;
  login: string;
  email: string | null;
  displayName: string;
  role: Role;
  status: UserStatus;
  /** The smart_system.user_master login this user works as; the legacy rights of that operator apply. */
  operatorLogin: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}>;

/** The signed-in user of one request. `operator` is the operator the books are opened as, if any yet. */
export type SessionUser = AuthUser & Readonly<{ operator: string | null; sessionHash: string }>;

export type TokenPurpose = "invite" | "reset";

/** Five wrong passwords in a row lock the user for fifteen minutes. */
export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const TOKEN_HOURS: Readonly<Record<TokenPurpose, number>> = { invite: 72, reset: 24 };

export class AuthInputError extends Error {
  constructor(message: string) { super(message); this.name = "AuthInputError"; }
}

const USER_COLUMNS = `u.id, u.login, u.email, u.display_name, u.role, u.status, u.operator_login, u.created_at, u.last_login_at`;

type UserRow = {
  id: string | number; login: string; email: string | null; display_name: string; role: string; status: string;
  operator_login: string | null; created_at: Date | string; last_login_at: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toUser(row: UserRow): AuthUser {
  if (!isRole(row.role)) throw new Error(`Unknown role ${row.role}`);
  return {
    id: Number(row.id),
    login: row.login,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status as UserStatus,
    operatorLogin: row.operator_login,
    createdAt: iso(row.created_at) ?? "",
    lastLoginAt: iso(row.last_login_at),
  };
}

// ---- input checks -------------------------------------------------------------------------

const LOGIN = /^[A-Za-z0-9._@+-]{3,100}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export function cleanLogin(value: unknown): string {
  const login = typeof value === "string" ? value.trim() : "";
  if (!LOGIN.test(login)) throw new AuthInputError("The user name must be 3 to 100 letters, digits or . _ @ + -");
  return login;
}

export function cleanEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email === "") return null;
  if (!EMAIL.test(email)) throw new AuthInputError("The email address is not valid");
  return email;
}

export function cleanDisplayName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (name || fallback).slice(0, 100);
}

// ---- users --------------------------------------------------------------------------------

export async function countUsers(client: Client): Promise<number> {
  return Number((await client.query(`SELECT count(*) AS n FROM ${AUTH_SCHEMA}.app_user`)).rows[0].n);
}

export async function findUserById(client: Client, id: number): Promise<AuthUser | null> {
  const row = (await client.query<UserRow>(`SELECT ${USER_COLUMNS} FROM ${AUTH_SCHEMA}.app_user u WHERE u.id = $1`, [id])).rows[0];
  return row ? toUser(row) : null;
}

/** For sign-in: the user by user name or email, with what the password check needs. */
export async function findUserForLogin(client: Client, login: string) {
  const row = (await client.query<UserRow & { password_hash: string | null; failed_logins: number; locked: boolean }>(
    `SELECT ${USER_COLUMNS}, u.password_hash, u.failed_logins, COALESCE(u.locked_until > now(), false) AS locked
       FROM ${AUTH_SCHEMA}.app_user u
      WHERE lower(u.login) = lower($1) OR lower(u.email) = lower($1)
      ORDER BY (lower(u.login) = lower($1)) DESC
      LIMIT 1`,
    [login.trim()],
  )).rows[0];
  if (!row) return null;
  return { user: toUser(row), passwordHash: row.password_hash, locked: row.locked };
}

export async function recordLoginFailure(client: Client, userId: number): Promise<void> {
  await client.query(
    `UPDATE ${AUTH_SCHEMA}.app_user
        SET failed_logins = failed_logins + 1,
            locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
      WHERE id = $1`,
    [userId, LOCK_AFTER_FAILURES, LOCK_MINUTES],
  );
}

export async function recordLoginSuccess(client: Client, userId: number): Promise<void> {
  await client.query(`UPDATE ${AUTH_SCHEMA}.app_user SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [userId]);
}

export async function listUsers(client: Client): Promise<AuthUser[]> {
  return (await client.query<UserRow>(`SELECT ${USER_COLUMNS} FROM ${AUTH_SCHEMA}.app_user u ORDER BY u.role, lower(u.login)`)).rows.map(toUser);
}

export type NewUser = Readonly<{ login: string; email: string | null; displayName: string; role: Role; operatorLogin: string | null }>;

export async function createUser(client: Client, input: NewUser, actorId: number | null): Promise<AuthUser> {
  const clash = (await client.query(
    `SELECT lower(login) = lower($1) AS same_login FROM ${AUTH_SCHEMA}.app_user
      WHERE lower(login) = lower($1) OR ($2::text IS NOT NULL AND lower(email) = lower($2)) LIMIT 1`,
    [input.login, input.email],
  )).rows[0];
  if (clash) throw new AuthInputError(clash.same_login ? `The user name ${input.login} is already taken` : `${input.email} already belongs to another user`);
  const row = (await client.query<UserRow>(
    `INSERT INTO ${AUTH_SCHEMA}.app_user AS u (login, email, display_name, role, operator_login, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${USER_COLUMNS}`,
    [input.login, input.email, input.displayName, input.role, input.operatorLogin, actorId],
  )).rows[0];
  return toUser(row);
}

export type UserChanges = Readonly<{ status?: "active" | "disabled"; role?: Role; operatorLogin?: string | null; displayName?: string; email?: string | null }>;

export async function updateUser(client: Client, id: number, changes: UserChanges): Promise<AuthUser> {
  const sets: string[] = [];
  const values: unknown[] = [id];
  const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (changes.role !== undefined) set("role", changes.role);
  if (changes.operatorLogin !== undefined) set("operator_login", changes.operatorLogin);
  if (changes.displayName !== undefined) set("display_name", changes.displayName);
  if (changes.email !== undefined) set("email", changes.email);
  // Enabling puts back "invited" for someone who never set a password.
  if (changes.status === "disabled") sets.push(`status = 'disabled'`);
  if (changes.status === "active") sets.push(`status = CASE WHEN password_hash IS NULL THEN 'invited' ELSE 'active' END`);
  if (!sets.length) throw new AuthInputError("Nothing to change");
  const row = (await client.query<UserRow>(`UPDATE ${AUTH_SCHEMA}.app_user u SET ${sets.join(", ")} WHERE u.id = $1 RETURNING ${USER_COLUMNS}`, values)).rows[0];
  if (!row) throw new AuthInputError("The user was not found");
  return toUser(row);
}

// ---- legacy operators ---------------------------------------------------------------------

function systemSchema() {
  const candidate = process.env.DB_SCHEMA_SYSTEM?.trim() || "smart_system";
  if (!/^[a-z_][a-z0-9_]*$/i.test(candidate)) throw new Error("DB_SCHEMA_SYSTEM must be a PostgreSQL identifier.");
  return candidate;
}

/** The active operator's login as smart_system spells it, or null when there is none by that name. */
export async function activeOperatorLogin(client: Client, login: string): Promise<string | null> {
  const row = (await client.query<{ login_name: string }>(
    `SELECT BTRIM(login_name) AS login_name FROM ${systemSchema()}.user_master
      WHERE UPPER(BTRIM(login_name)) = UPPER($1) AND COALESCE(BTRIM(user_pos), 'A') <> 'D' LIMIT 1`,
    [login.trim()],
  )).rows[0];
  return row?.login_name ?? null;
}

// ---- sessions -----------------------------------------------------------------------------

export async function createSession(client: Client, userId: number, operatorLogin: string | null, userAgent: string | null): Promise<string> {
  const token = randomToken();
  await client.query(
    `INSERT INTO ${AUTH_SCHEMA}.session (token_hash, user_id, operator_login, expires_at, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
    [await tokenHash(token), userId, operatorLogin, SESSION_MAX_HOURS, userAgent?.slice(0, 300) ?? null],
  );
  return token;
}

/**
 * The live session's user, or null. A session lives SESSION_MAX_HOURS from sign-in and dies after
 * SESSION_IDLE_HOURS without a request; each use moves the idle clock on. A disabled user's
 * sessions stop working at once.
 */
export async function readSessionUser(client: Client, sessionHash: string): Promise<SessionUser | null> {
  const row = (await client.query<UserRow & { session_operator: string | null }>(
    `WITH live AS (
       UPDATE ${AUTH_SCHEMA}.session s SET last_seen_at = now()
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND s.last_seen_at > now() - make_interval(hours => $2)
       RETURNING s.user_id, s.operator_login
     )
     SELECT ${USER_COLUMNS}, live.operator_login AS session_operator
       FROM live JOIN ${AUTH_SCHEMA}.app_user u ON u.id = live.user_id
      WHERE u.status = 'active'`,
    [sessionHash, SESSION_IDLE_HOURS],
  )).rows[0];
  if (!row) return null;
  const user = toUser(row);
  // Only a platform admin's session carries its own operator; everyone else works as the one they are linked to.
  return { ...user, operator: user.role === "platform_admin" ? row.session_operator : user.operatorLogin, sessionHash };
}

export async function revokeSession(client: Client, sessionHash: string): Promise<void> {
  await client.query(`UPDATE ${AUTH_SCHEMA}.session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sessionHash]);
}

export async function revokeUserSessions(client: Client, userId: number): Promise<void> {
  await client.query(`UPDATE ${AUTH_SCHEMA}.session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

export async function setSessionOperator(client: Client, sessionHash: string, operatorLogin: string | null): Promise<void> {
  await client.query(`UPDATE ${AUTH_SCHEMA}.session SET operator_login = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, [sessionHash, operatorLogin]);
}

// ---- set-password links -------------------------------------------------------------------

/** A new single-use link for the user; any earlier unused link of theirs stops working. */
export async function issuePasswordToken(client: Client, userId: number, purpose: TokenPurpose, actorId: number | null): Promise<string> {
  await client.query(`UPDATE ${AUTH_SCHEMA}.password_token SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const token = randomToken();
  await client.query(
    `INSERT INTO ${AUTH_SCHEMA}.password_token (token_hash, user_id, purpose, created_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [await tokenHash(token), userId, purpose, actorId, TOKEN_HOURS[purpose]],
  );
  return token;
}

/** The link's user while the link is unused, unexpired and the user not disabled; `lock` holds the row for the caller's update. */
export async function readPasswordToken(client: Client, hash: string, lock = false): Promise<{ user: AuthUser; purpose: TokenPurpose } | null> {
  const row = (await client.query<UserRow & { purpose: TokenPurpose }>(
    `SELECT ${USER_COLUMNS}, t.purpose
       FROM ${AUTH_SCHEMA}.password_token t JOIN ${AUTH_SCHEMA}.app_user u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status <> 'disabled'
      ${lock ? "FOR UPDATE OF t" : ""}`,
    [hash],
  )).rows[0];
  return row ? { user: toUser(row), purpose: row.purpose } : null;
}

/** Uses the link: stores the new password, activates the user and ends every session they had. */
export async function setPasswordWithToken(client: Client, hash: string, passwordHash: string): Promise<AuthUser | null> {
  const link = await readPasswordToken(client, hash, true);
  if (!link) return null;
  await client.query(`UPDATE ${AUTH_SCHEMA}.password_token SET used_at = now() WHERE token_hash = $1`, [hash]);
  await client.query(
    `UPDATE ${AUTH_SCHEMA}.app_user SET password_hash = $2, password_set_at = now(), status = 'active', failed_logins = 0, locked_until = NULL WHERE id = $1`,
    [link.user.id, passwordHash],
  );
  await revokeUserSessions(client, link.user.id);
  return { ...link.user, status: "active" };
}

// ---- audit --------------------------------------------------------------------------------

export async function audit(client: Client, actorId: number | null, action: string, targetId: number | null, detail: Record<string, unknown> = {}): Promise<void> {
  await client.query(
    `INSERT INTO ${AUTH_SCHEMA}.audit_event (actor_user_id, action, target_user_id, detail) VALUES ($1, $2, $3, $4)`,
    [actorId, action, targetId, JSON.stringify(detail)],
  );
}
