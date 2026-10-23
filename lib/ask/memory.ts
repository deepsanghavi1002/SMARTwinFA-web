import type { Client } from "pg";
import type { MasterSession } from "../master-program/session";
import { SETUP_SCHEMA } from "../master-program/session";

/**
 * Ask AI's memory: what each operator of a company asked, which question it was matched to and which party or product was chosen, so the same
 * question next time is answered at once, a wording the program did not know can be taught (by picking the nearest question), and the panel can
 * list the recent and the most asked questions. One row per operator and question; template 0 marks a question that had no answer (kept so the
 * missing questions can be seen). Stored in SMART_SETUP.ASK_MEMORY, made on first use.
 */

const TABLE = `${SETUP_SCHEMA}.ask_memory`;
let made = false;

/** The table, made when it is not there yet (a write: not for the read-only transaction that answers). */
export async function ensureMemory(client: Client): Promise<void> {
  if (made) return;
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (mem_key bigserial PRIMARY KEY, company_key integer NOT NULL, login_name text NOT NULL, question_norm text NOT NULL, question text NOT NULL,`
    + ` template_id integer NOT NULL DEFAULT 0, party_code integer, times integer NOT NULL DEFAULT 1, taught boolean NOT NULL DEFAULT false, last_used timestamptz NOT NULL DEFAULT now(),`
    + ` UNIQUE (company_key, login_name, question_norm))`);
  made = true;
}

/** The question as it is compared: lower case, letters and digits, single spaces. */
export const normalize = (question: string): string => question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const who = (session: MasterSession) => [session.companyKey, session.loginName.toUpperCase()] as const;

/** What was answered for this question before: its template and, where one was chosen, the party or product. */
export async function recall(client: Client, session: MasterSession, question: string): Promise<{ templateId: number; partyCode: number | null; taught: boolean } | null> {
  const norm = normalize(question);
  if (norm === "") return null;
  const found = (await client.query(`SELECT template_id, party_code, taught FROM ${TABLE} WHERE company_key = $1 AND login_name = $2 AND question_norm = $3 AND template_id > 0`, [...who(session), norm])).rows[0];
  return found ? { templateId: Number(found.template_id), partyCode: found.party_code === null ? null : Number(found.party_code), taught: found.taught === true } : null;
}

/** Keeps (or counts again) a question with the template it was answered by and the party or product chosen. */
export async function remember(client: Client, session: MasterSession, input: { question: string; templateId: number; partyCode?: number; taught?: boolean }): Promise<void> {
  const norm = normalize(input.question);
  if (norm === "" || input.templateId <= 0) return;
  await client.query(
    `INSERT INTO ${TABLE} (company_key, login_name, question_norm, question, template_id, party_code, taught) VALUES ($1, $2, $3, $4, $5, $6, $7)`
    + ` ON CONFLICT (company_key, login_name, question_norm) DO UPDATE SET question = EXCLUDED.question, template_id = EXCLUDED.template_id, party_code = EXCLUDED.party_code,`
    + ` times = ${TABLE}.times + 1, taught = ${TABLE}.taught OR EXCLUDED.taught, last_used = now()`,
    [...who(session), norm, input.question.trim().slice(0, 300), input.templateId, input.partyCode ?? null, input.taught === true]);
}

/** A question nobody could answer (template 0): counted, so the questions that are missing can be seen. */
export async function noteMissed(client: Client, session: MasterSession, question: string): Promise<void> {
  const norm = normalize(question);
  if (norm === "") return;
  await client.query(
    `INSERT INTO ${TABLE} (company_key, login_name, question_norm, question, template_id) VALUES ($1, $2, $3, $4, 0)`
    + ` ON CONFLICT (company_key, login_name, question_norm) DO UPDATE SET times = ${TABLE}.times + 1, last_used = now()`,
    [...who(session), norm, question.trim().slice(0, 300)]);
}

/** Forgets one remembered question (with its chosen party), or every answered question of the operator when none is given. */
export async function forget(client: Client, session: MasterSession, question?: string, scope?: "recent" | "favourite"): Promise<void> {
  // One list only (its Clear all): the most asked are the questions asked more than once, the recent ones the rest.
  if (question === undefined) { await client.query(`DELETE FROM ${TABLE} WHERE company_key = $1 AND login_name = $2 AND template_id > 0${scope === "favourite" ? " AND times > 1" : scope === "recent" ? " AND times <= 1" : ""}`, [...who(session)]); return; }
  await client.query(`DELETE FROM ${TABLE} WHERE company_key = $1 AND login_name = $2 AND question_norm = $3 AND template_id > 0`, [...who(session), normalize(question)]);
}

/**
 * The operator's most asked questions (asked more than once) and, apart from them, the last few asked. A question is in one list only, so the two
 * never show the same thing: a question asked again and again is "most asked", the rest are "recent".
 */
export async function listMemory(client: Client, session: MasterSession): Promise<{ recent: string[]; favourite: string[] }> {
  const pick = async (where: string, order: string, limit: number) => (await client.query(`SELECT question FROM ${TABLE} WHERE company_key = $1 AND login_name = $2 AND template_id > 0${where} ORDER BY ${order} LIMIT ${limit}`, [...who(session)])).rows.map((row) => String(row.question));
  const favourite = await pick(" AND times > 1", "times DESC, last_used DESC", 6);
  const recent = (await pick("", "last_used DESC", 16)).filter((question) => !favourite.includes(question)).slice(0, 6);
  return { recent, favourite };
}
