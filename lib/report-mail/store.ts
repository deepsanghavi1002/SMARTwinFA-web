/**
 * The tables of emailed reports, in their own schema (web_report); the legacy tables are not changed. Every function runs on the caller's
 * client, inside its transaction. The tables are made on first use, as web_auth's are.
 */
import type { Client } from "pg";
import type { ReportSelection } from "../report/types.ts";
import { MAX_ATTEMPTS, MailRefusal } from "./rules.ts";
import type { MailFormat } from "./rules.ts";

const SCHEMA = "web_report";

/** A job nobody has taken in this time is not sent late by surprise. */
const QUEUE_HOURS = 24;
/** A taken job with no result after this long may or may not have been sent. */
const RUNNING_MINUTES = 15;
const RETRY_MINUTES = 2;

export const REPORT_MAIL_DDL: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.schedule (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     owner_user_id bigint NOT NULL,
     operator_login text NOT NULL,
     company_id integer NOT NULL,
     year_key integer NOT NULL,
     report_name text NOT NULL,
     menu_name text NOT NULL,
     report_key integer NOT NULL,
     name text NOT NULL,
     selection jsonb NOT NULL,
     format text NOT NULL CHECK (format IN ('pdf', 'xlsx')),
     recipients text[] NOT NULL,
     password_salt text NOT NULL DEFAULT '',
     password_mark text NOT NULL DEFAULT '',
     active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now(),
     changed_at timestamptz NOT NULL DEFAULT now(),
     UNIQUE (owner_user_id, operator_login, company_id, year_key, report_name, name)
   )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.job (
     id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     schedule_id bigint NOT NULL REFERENCES ${SCHEMA}.schedule (id) ON DELETE CASCADE,
     requested_by bigint NOT NULL,
     status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'sent', 'failed', 'unknown')),
     attempts integer NOT NULL DEFAULT 0,
     queued_at timestamptz NOT NULL DEFAULT now(),
     next_try_at timestamptz NOT NULL DEFAULT now(),
     started_at timestamptz,
     finished_at timestamptz,
     job_key_hash text,
     error text,
     file_name text,
     file_bytes integer
   )`,
  // One send of a schedule at a time: a second press of Send Now does not make a second email.
  `CREATE UNIQUE INDEX IF NOT EXISTS job_open_key ON ${SCHEMA}.job (schedule_id) WHERE status IN ('queued', 'running')`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.allowed_recipient (
     address text PRIMARY KEY,
     added_by bigint NOT NULL,
     added_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.mailer_state (only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row), seen_at timestamptz NOT NULL)`,
];

/** Runs inside the caller's transaction. */
export async function ensureReportMail(client: Client): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('smartwinfa.web_report.schema'))");
  for (const statement of REPORT_MAIL_DDL) await client.query(statement);
}

/** Saved report views (app/api/report/views): made here too, so a new installation has the table. */
export const SAVED_VIEW_DDL = `CREATE TABLE IF NOT EXISTS smart_system.report_saved_view (
  view_key serial PRIMARY KEY,
  co_key integer NOT NULL,
  user_no integer NOT NULL,
  report_name character varying NOT NULL,
  view_name character varying NOT NULL,
  payload jsonb NOT NULL,
  saved_at timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE (co_key, user_no, report_name, view_name)
)`;

export async function ensureSavedViews(client: Client): Promise<void> {
  const found = (await client.query("SELECT to_regclass('smart_system.report_saved_view') IS NOT NULL AS ok")).rows[0];
  if (found?.ok !== true) await client.query(SAVED_VIEW_DDL);
}

export type ScheduleInput = Readonly<{
  ownerUserId: number; operator: string; companyId: number; yearKey: number; reportName: string; menuName: string; reportKey: number;
  name: string; selection: ReportSelection; format: MailFormat; recipients: readonly string[]; passwordSalt: string; passwordMark: string;
}>;

export type Schedule = ScheduleInput & Readonly<{ id: number; active: boolean }>;

/** Keeps the schedule of this owner and name, with a copy of the selection as it is now. */
export async function saveSchedule(client: Client, input: ScheduleInput): Promise<number> {
  const row = (await client.query(
    `INSERT INTO ${SCHEMA}.schedule (owner_user_id, operator_login, company_id, year_key, report_name, menu_name, report_key, name, selection, format, recipients, password_salt, password_mark)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
     ON CONFLICT (owner_user_id, operator_login, company_id, year_key, report_name, name) DO UPDATE SET menu_name = EXCLUDED.menu_name, report_key = EXCLUDED.report_key,
       selection = EXCLUDED.selection, format = EXCLUDED.format, recipients = EXCLUDED.recipients, password_salt = EXCLUDED.password_salt, password_mark = EXCLUDED.password_mark, active = true, changed_at = now()
     RETURNING id`,
    [input.ownerUserId, input.operator.toUpperCase(), input.companyId, input.yearKey, input.reportName, input.menuName, input.reportKey, input.name, JSON.stringify(input.selection), input.format, [...input.recipients], input.passwordSalt, input.passwordMark],
  )).rows[0];
  return Number(row.id);
}

export async function readSchedule(client: Client, id: number): Promise<Schedule | null> {
  const row = (await client.query(`SELECT * FROM ${SCHEMA}.schedule WHERE id = $1`, [id])).rows[0];
  return row ? {
    id: Number(row.id), ownerUserId: Number(row.owner_user_id), operator: String(row.operator_login), companyId: Number(row.company_id), yearKey: Number(row.year_key),
    reportName: String(row.report_name), menuName: String(row.menu_name), reportKey: Number(row.report_key), name: String(row.name), selection: row.selection as ReportSelection,
    format: row.format as MailFormat, recipients: row.recipients as string[], passwordSalt: String(row.password_salt), passwordMark: String(row.password_mark), active: row.active === true,
  } : null;
}

/** Closes jobs that waited too long, or were taken and never reported. */
export async function expireJobs(client: Client): Promise<void> {
  await client.query(`UPDATE ${SCHEMA}.job SET status = 'failed', finished_at = now(), error = 'Not sent: the mailer program did not take it within ${QUEUE_HOURS} hours' WHERE status = 'queued' AND queued_at < now() - interval '${QUEUE_HOURS} hours'`);
  await client.query(`UPDATE ${SCHEMA}.job SET status = 'unknown', finished_at = now(), job_key_hash = NULL, error = 'No result came back. Check whether the email arrived before sending again' WHERE status = 'running' AND started_at < now() - interval '${RUNNING_MINUTES} minutes'`);
}

export async function queueJob(client: Client, scheduleId: number, requestedBy: number): Promise<number> {
  await expireJobs(client);
  const row = (await client.query(`INSERT INTO ${SCHEMA}.job (schedule_id, requested_by) VALUES ($1, $2) ON CONFLICT (schedule_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING id`, [scheduleId, requestedBy])).rows[0];
  if (!row) throw new MailRefusal("This report is already waiting to be sent");
  return Number(row.id);
}

/** Whether this schedule has a job waiting or being sent (its recipients and selection must not change under it). */
export async function hasOpenJob(client: Client, owner: Readonly<{ ownerUserId: number; operator: string; companyId: number; yearKey: number; reportName: string; name: string }>): Promise<boolean> {
  await expireJobs(client);
  const found = await client.query(
    `SELECT 1 FROM ${SCHEMA}.job j JOIN ${SCHEMA}.schedule s ON s.id = j.schedule_id WHERE j.status IN ('queued', 'running') AND s.owner_user_id = $1 AND s.operator_login = $2 AND s.company_id = $3 AND s.year_key = $4 AND s.report_name = $5 AND s.name = $6 LIMIT 1`,
    [owner.ownerUserId, owner.operator.toUpperCase(), owner.companyId, owner.yearKey, owner.reportName, owner.name],
  );
  return found.rows.length > 0;
}

/** Takes the oldest waiting job; two takers never get the same one. */
export async function claimJob(client: Client, jobKeyHash: string): Promise<{ jobId: number; scheduleId: number; attempts: number } | null> {
  await expireJobs(client);
  const row = (await client.query(
    `UPDATE ${SCHEMA}.job SET status = 'running', attempts = attempts + 1, started_at = now(), job_key_hash = $1
     WHERE id = (SELECT id FROM ${SCHEMA}.job WHERE status = 'queued' AND next_try_at <= now() ORDER BY queued_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, schedule_id, attempts`,
    [jobKeyHash],
  )).rows[0];
  return row ? { jobId: Number(row.id), scheduleId: Number(row.schedule_id), attempts: Number(row.attempts) } : null;
}

export type JobOutcome = "sent" | "retry" | "failed" | "unknown";

/** The result of a taken job. Only the holder of its one-time key can report it, once. False when the key does not fit. */
export async function finishJob(client: Client, jobId: number, jobKeyHash: string, outcome: JobOutcome, error: string, file?: Readonly<{ name: string; bytes: number }>): Promise<boolean> {
  const done = await client.query(
    `UPDATE ${SCHEMA}.job SET
       status = CASE WHEN $3 = 'retry' THEN CASE WHEN attempts < ${MAX_ATTEMPTS} THEN 'queued' ELSE 'failed' END ELSE $3 END,
       next_try_at = now() + interval '${RETRY_MINUTES} minutes',
       finished_at = CASE WHEN $3 = 'retry' AND attempts < ${MAX_ATTEMPTS} THEN NULL ELSE now() END,
       error = NULLIF($4, ''), file_name = COALESCE($5, file_name), file_bytes = COALESCE($6, file_bytes), job_key_hash = NULL
     WHERE id = $1 AND status = 'running' AND job_key_hash = $2`,
    [jobId, jobKeyHash, outcome, error.slice(0, 500), file?.name ?? null, file?.bytes ?? null],
  );
  return done.rowCount === 1;
}

export async function noteFile(client: Client, jobId: number, name: string, bytes: number): Promise<void> {
  await client.query(`UPDATE ${SCHEMA}.job SET file_name = $2, file_bytes = $3 WHERE id = $1`, [jobId, name, bytes]);
}

export type JobLine = Readonly<{ id: number; name: string; status: string; queuedAt: string; finishedAt: string | null; error: string; recipients: string[]; format: MailFormat }>;

/** The sends of one owner for one company and report, newest first. */
export async function jobHistory(client: Client, ownerUserId: number, operator: string, companyId: number, reportName: string): Promise<JobLine[]> {
  const rows = (await client.query(
    `SELECT j.id, s.name, j.status, j.queued_at, j.finished_at, j.error, s.recipients, s.format FROM ${SCHEMA}.job j JOIN ${SCHEMA}.schedule s ON s.id = j.schedule_id
     WHERE s.owner_user_id = $1 AND s.operator_login = $2 AND s.company_id = $3 AND s.report_name = $4 ORDER BY j.id DESC LIMIT 20`,
    [ownerUserId, operator.toUpperCase(), companyId, reportName],
  )).rows;
  return rows.map((row) => ({
    id: Number(row.id), name: String(row.name), status: String(row.status), queuedAt: new Date(row.queued_at).toISOString(), finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    error: String(row.error ?? ""), recipients: row.recipients as string[], format: row.format as MailFormat,
  }));
}

export async function approvedAddresses(client: Client): Promise<string[]> {
  return (await client.query(`SELECT address FROM ${SCHEMA}.allowed_recipient ORDER BY address`)).rows.map((row) => String(row.address));
}

export async function approveAddress(client: Client, address: string, userId: number): Promise<void> {
  await client.query(`INSERT INTO ${SCHEMA}.allowed_recipient (address, added_by) VALUES ($1, $2) ON CONFLICT (address) DO NOTHING`, [address, userId]);
}

export async function removeAddress(client: Client, address: string): Promise<void> {
  await client.query(`DELETE FROM ${SCHEMA}.allowed_recipient WHERE address = $1`, [address]);
}

export async function noteMailer(client: Client): Promise<void> {
  await client.query(`INSERT INTO ${SCHEMA}.mailer_state (only_row, seen_at) VALUES (true, now()) ON CONFLICT (only_row) DO UPDATE SET seen_at = now()`);
}

/** Whether the mailer program asked for work in the last two minutes. */
export async function mailerRunning(client: Client): Promise<boolean> {
  return (await client.query(`SELECT 1 FROM ${SCHEMA}.mailer_state WHERE seen_at > now() - interval '2 minutes'`)).rows.length > 0;
}
