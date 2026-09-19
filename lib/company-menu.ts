import type { Client } from "pg";
import { readOnly } from "./db";

/**
 * The company selection menu, converted from the desktop's
 * Setup_CompanySelect form.
 *
 * SMARTwinFA is installed per client and every installation carries a
 * different company set, so nothing here may be hard-coded: the operator,
 * accounting-year and company lists are all read from smart_system at
 * request time, exactly as the desktop reads them.
 */

// Read per request, not at module load: the worker's environment is only
// populated once a request is being handled.
function systemSchema() {
  const candidate = process.env.DB_SCHEMA_SYSTEM?.trim() || "smart_system";
  if (!/^[a-z_][a-z0-9_]*$/i.test(candidate)) {
    throw new Error("DB_SCHEMA_SYSTEM must be a PostgreSQL identifier.");
  }
  return candidate;
}

export type Operator = Readonly<{
  userNo: number;
  loginName: string;
  displayName: string;
  userType: string | null;
  department: string | null;
}>;

export type AccountingYear = Readonly<{
  key: number;
  id: string;
  label: string;
}>;

export type Company = Readonly<{
  key: number;
  id: string;
  name: string;
  code: string;
  address: string;
  group: string | null;
  dataName: string;
  /** False when this installation carries no database for the company. */
  available: boolean;
}>;

function formatDate(value: string) {
  const day = value.slice(0, 2);
  const monthNumber = Number(value.slice(2, 4));
  const year = value.slice(4, 8);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day}/${months[monthNumber - 1] ?? value.slice(2, 4)}/${year}`;
}

/** Fallback caption for a year row whose year_ac text was never filled in. */
function yearLabel(yearId: string) {
  return yearId.length === 16
    ? `${formatDate(yearId.slice(0, 8))} to ${formatDate(yearId.slice(8, 16))}`
    : yearId;
}

/** USER_YEAR and WEBSITE are stored as comma separated lists. */
function legacyList(value: string | null) {
  if (!value) return null;
  const entries = value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return entries.length ? entries : null;
}

type OperatorScope = Readonly<{ userNo: number; years: string[] | null; groups: string[] | null }>;

/**
 * Setup_CompanySelect scopes both lists by the signed-in operator: USER_YEAR
 * pins the accounting years by caption, WEBSITE pins the companies by
 * CO_SELECT_GROUP. An operator carrying neither sees every year and company.
 */
async function readOperatorScope(client: Client, loginName: string): Promise<OperatorScope> {
  const SYSTEM_SCHEMA = systemSchema();
  const result = await client.query<{ user_no: number; user_year: string | null; website: string | null }>(
    `SELECT user_no, NULLIF(BTRIM(user_year), '') AS user_year, NULLIF(BTRIM(website), '') AS website
     FROM ${SYSTEM_SCHEMA}.user_master
     WHERE UPPER(BTRIM(login_name)) = UPPER($1) AND COALESCE(BTRIM(user_pos), 'A') <> 'D'
     LIMIT 1`,
    [loginName],
  );
  const row = result.rows[0];
  if (!row) throw new Error("The operator is not present in the company system database");
  return { userNo: row.user_no, years: legacyList(row.user_year), groups: legacyList(row.website) };
}

/** The active operators offered on the login screen. */
export async function readOperators(): Promise<Operator[]> {
  const SYSTEM_SCHEMA = systemSchema();
  return readOnly(async (client) => {
    // The obfuscated user_pw column is deliberately never selected, so no
    // credential leaves the database.
    const result = await client.query<{
      user_no: number;
      login_name: string;
      user_name: string | null;
      user_type: string | null;
      user_dept: string | null;
    }>(
      `SELECT user_no, BTRIM(login_name) AS login_name, NULLIF(BTRIM(user_name), '') AS user_name,
              NULLIF(BTRIM(user_type), '') AS user_type, NULLIF(BTRIM(user_dept), '') AS user_dept
       FROM ${SYSTEM_SCHEMA}.user_master
       WHERE COALESCE(BTRIM(user_pos), 'A') <> 'D' AND NULLIF(BTRIM(login_name), '') IS NOT NULL
       ORDER BY login_name`,
    );
    if (!result.rows.length) throw new Error("No active operator is available in the company system database");
    return result.rows.map((row) => ({
      userNo: row.user_no,
      loginName: row.login_name,
      displayName: row.user_name ?? row.login_name,
      userType: row.user_type,
      department: row.user_dept,
    }));
  });
}

/** The accounting years this operator may open, newest first. */
export async function readAccountingYears(loginName: string): Promise<AccountingYear[]> {
  const SYSTEM_SCHEMA = systemSchema();
  return readOnly(async (client) => {
    const scope = await readOperatorScope(client, loginName);
    const columns = `year_key, NULLIF(BTRIM(year_ac), '') AS year_ac,
              to_char(year_start::date, 'DDMMYYYY') || to_char(year_end::date, 'DDMMYYYY') AS year_id`;
    const order = "ORDER BY year_start::date DESC";
    type YearRow = { year_key: number; year_ac: string | null; year_id: string };

    let rows: YearRow[] = [];
    if (scope.years) {
      rows = (await client.query<YearRow>(
        `SELECT ${columns} FROM ${SYSTEM_SCHEMA}.year_ac WHERE BTRIM(year_ac) = ANY($1) ${order}`,
        [scope.years],
      )).rows;
    } else if (scope.groups) {
      rows = (await client.query<YearRow>(
        `SELECT ${columns} FROM ${SYSTEM_SCHEMA}.year_ac
         WHERE year_key IN (
           SELECT DISTINCT c_yearid FROM ${SYSTEM_SCHEMA}.cname
           WHERE c_id IN (SELECT co_key FROM ${SYSTEM_SCHEMA}.company
                          WHERE co_pos = 'A' AND COALESCE(BTRIM(co_select_group), '') = ANY($1))
         ) ${order}`,
        [scope.groups],
      )).rows;
    }
    // The desktop falls back to the full year list when the operator's own
    // restriction matches nothing, rather than leaving the screen empty.
    if (!rows.length) {
      rows = (await client.query<YearRow>(`SELECT ${columns} FROM ${SYSTEM_SCHEMA}.year_ac ${order}`)).rows;
    }
    if (!rows.length) throw new Error("No accounting year is available in the company system database");
    return rows.map((row) => ({ key: row.year_key, id: row.year_id, label: row.year_ac ?? yearLabel(row.year_id) }));
  });
}

/**
 * The companies opened for one accounting year, as the desktop grid lists
 * them. `available` reports whether this installation actually carries the
 * company's own database, so a copy holding one company still shows the
 * client's real list instead of a fabricated one.
 */
export async function readCompanies(loginName: string, yearKey: number): Promise<Company[]> {
  if (!Number.isInteger(yearKey)) {
    throw new Error("An accounting year must be chosen before the company list can be read");
  }
  const SYSTEM_SCHEMA = systemSchema();
  return readOnly(async (client) => {
    const scope = await readOperatorScope(client, loginName);
    const parameters: unknown[] = [yearKey];
    let groupFilter = "";
    if (scope.groups) {
      parameters.push(scope.groups);
      groupFilter = `AND COALESCE(BTRIM(company.co_select_group), '') = ANY($${parameters.length})`;
    }
    const result = await client.query<{
      co_key: number;
      name: string;
      co_short: string | null;
      address: string;
      co_dataname: string;
      co_group: string | null;
      available: boolean;
    }>(
      `SELECT company.co_key,
              BTRIM(company.name) AS name,
              NULLIF(BTRIM(company.co_short), '') AS co_short,
              BTRIM(COALESCE(company.o_address1, '')) AS address,
              BTRIM(COALESCE(company.co_dataname, '')) AS co_dataname,
              NULLIF(BTRIM(company.co_group), '') AS co_group,
              (schemata.schema_name IS NOT NULL) AS available
       FROM ${SYSTEM_SCHEMA}.company AS company
       LEFT JOIN information_schema.schemata AS schemata
         ON schemata.schema_name = LOWER(BTRIM(COALESCE(company.co_dataname, '')))
       WHERE company.co_pos = 'A'
         AND company.co_key IN (SELECT c_id FROM ${SYSTEM_SCHEMA}.cname WHERE c_yearid = $1)
         ${groupFilter}
       ORDER BY company.name`,
      parameters,
    );
    return result.rows.map((row) => ({
      key: row.co_key,
      id: String(row.co_key),
      name: row.name,
      code: row.co_short ?? "",
      address: row.address,
      group: row.co_group,
      dataName: row.co_dataname,
      available: row.available,
    }));
  });
}
