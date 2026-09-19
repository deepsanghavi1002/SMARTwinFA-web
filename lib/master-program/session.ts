import type { Client } from "pg";
import { companyLicence } from "../company-license";
import { securityRead, securityWrite, toText } from "./legacy";

/**
 * The desktop's Lib_GlobalVariables.PublicVariable, as far as Master_ProgramGrid reads it.
 *
 * The desktop fills these once, when the operator logs in and picks a company and year.
 * The browser only says which company, year and operator it chose; everything else is
 * read here from smart_system and the company's own setup table, so a request cannot
 * claim a schema, a licence or a user number it was not given.
 */
export type MasterSession = Readonly<{
  /** CO_DATANAME, lowercased: the schema every |sys.db| points at. */
  companySchema: string;
  companyKey: number;
  companyName: string;
  companyGroup: string;
  /** Smartwinfa_License, derived from CO_GROUP exactly as Setup_CompanySelect does. */
  licence: number;
  coStateName: string;
  coGstReq: boolean;
  businessNature: string;
  yearKey: number;
  /** Year_ID, "ddmmyyyyddmmyyyy". */
  yearId: string;
  tarikh1: Date;
  tarikh2: Date;
  userNo: number;
  userType: string;
  loginName: string;
  /** The company's own setup row (dt_compsetup), keyed by lowercase column name. */
  setup: Readonly<Record<string, unknown>>;
  /** smart_system.setup pw_para carries CORIGHTS, (bl_Cowise_RIghts). */
  companyWiseRights: boolean;
  /** Derived flags the form reads from the setup row. */
  flags: Readonly<{
    imageReq: boolean;
    barcodeEntry: boolean;
    barcodeReport: boolean;
    productAccountPosting: boolean;
    productChildParent: boolean;
    partyAccode: boolean;
    colMrpActive: boolean;
    productCode: boolean;
    logFileSpecial: boolean;
  }>;
}>;

export const SYSTEM_SCHEMA = "smart_system";
export const SETUP_SCHEMA = "smart_setup";

/** GST_Start_Date in Lib_GlobalVariables. */
export const GST_START_DATE = new Date(2017, 6, 1);

export type SessionRequest = Readonly<{ companyId: number; yearKey: number; loginName: string }>;

const identifier = /^[a-z_][a-z0-9_]*$/;

export async function readSession(client: Client, request: SessionRequest): Promise<MasterSession> {
  if (!Number.isInteger(request.companyId) || !Number.isInteger(request.yearKey) || toText(request.loginName) === "") {
    throw new Error("Company, accounting year and operator are required");
  }

  const user = (await client.query(
    `SELECT user_no, BTRIM(COALESCE(user_type, '')) AS user_type, BTRIM(login_name) AS login_name
       FROM ${SYSTEM_SCHEMA}.user_master
      WHERE UPPER(BTRIM(login_name)) = UPPER($1) AND COALESCE(BTRIM(user_pos), 'A') <> 'D'
      LIMIT 1`,
    [request.loginName.trim()],
  )).rows[0];
  if (!user) throw new Error("The operator is not present in the company system database");

  const company = (await client.query(
    `SELECT c.co_key, BTRIM(c.name) AS name, LOWER(BTRIM(COALESCE(c.co_dataname, ''))) AS schema_name,
            BTRIM(COALESCE(c.co_group, '')) AS co_group, BTRIM(COALESCE(c.state_name, '')) AS state_name,
            BTRIM(COALESCE(c.gst_req, '')) AS gst_req, BTRIM(COALESCE(c.business_nat, '')) AS business_nat
       FROM ${SYSTEM_SCHEMA}.company c
      WHERE c.co_key = $1 AND c.co_pos = 'A'
        AND c.co_key IN (SELECT c_id FROM ${SYSTEM_SCHEMA}.cname WHERE c_yearid = $2)`,
    [request.companyId, request.yearKey],
  )).rows[0];
  if (!company) throw new Error("The company is not open for this accounting year");
  if (!identifier.test(company.schema_name)) throw new Error("The company's database name is not a valid schema");
  const exists = (await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [company.schema_name])).rowCount;
  if (!exists) throw new Error(`This installation has no database for ${company.name}`);

  const year = (await client.query(
    `SELECT year_key, year_start::date AS year_start, year_end::date AS year_end,
            to_char(year_start::date, 'DDMMYYYY') || to_char(year_end::date, 'DDMMYYYY') AS year_id
       FROM ${SYSTEM_SCHEMA}.year_ac WHERE year_key = $1`,
    [request.yearKey],
  )).rows[0];
  if (!year) throw new Error("The accounting year was not found");

  // The desktop's data connection opens the company database, so an unqualified table in a
  // setup query means the company's table. search_path gives PostgreSQL the same default.
  await client.query(`SET LOCAL search_path TO ${company.schema_name}, ${SETUP_SCHEMA}, public`);
  const setup = (await client.query(`SELECT * FROM ${company.schema_name}.setup LIMIT 1`)).rows[0] ?? {};
  const systemSetup = (await client.query(`SELECT pw_para FROM ${SYSTEM_SCHEMA}.setup LIMIT 1`).catch(() => ({ rows: [] as Record<string, unknown>[] }))).rows[0] ?? {};
  const upper = (column: string) => toText(setup[column]).toUpperCase();

  return {
    companySchema: company.schema_name,
    companyKey: company.co_key,
    companyName: company.name,
    companyGroup: company.co_group,
    licence: companyLicence(company.co_group || null),
    coStateName: company.state_name,
    coGstReq: company.gst_req.toUpperCase().includes("Y"),
    businessNature: company.business_nat,
    yearKey: year.year_key,
    yearId: year.year_id,
    tarikh1: new Date(year.year_start),
    tarikh2: new Date(year.year_end),
    userNo: user.user_no,
    userType: user.user_type,
    loginName: user.login_name,
    setup,
    companyWiseRights: toText(systemSetup.pw_para).toUpperCase().includes("CORIGHTS,"),
    flags: {
      imageReq: upper("image_req") === "Y",
      barcodeEntry: upper("entry_para").includes("BARCODE,"),
      barcodeReport: upper("prn_para").includes("BARCODE,"),
      productAccountPosting: toText(setup.i_posting) === "Y",
      productChildParent: upper("item_para").includes("PROD_CHILD_PARENT,"),
      partyAccode: upper("party_para").includes("ACCODE,"),
      colMrpActive: !upper("entry_para").includes("X_MRP,"),
      productCode: upper("item_para").includes("PRODCODE,"),
      logFileSpecial: upper("logfile") === "S",
    },
  };
}

/** One security row as dt_compmenurights holds it. */
type SecurityRow = { u_module: string; u_roll_id: string; u_pass_1: string; u_pass_2: string; u_pass_3: string; u_module_pass: string };

export type MenuRights = Readonly<{
  /** False when the operator has no security rows at all: the desktop then allows everything. */
  restricted: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
  /** Passwords a module/add/edit/delete asks for, already decoded. Empty when none. */
  modulePassword: string;
  addPassword: string;
  editPassword: string;
  deletePassword: string;
}>;

/**
 * dt_compmenurights for one module name ("Menu-M_ACCOUNT", "Book-SUNDRY DEBTORS").
 *
 * u_module is stored through Security_write_pw, and each right is one character of
 * u_roll_id read back through Security_read_pw at its own position: add at 2, edit at 4,
 * delete at 6. A module with no row grants the right ("1"), as the save handlers do.
 */
export async function readRights(client: Client, session: MasterSession, moduleName: string): Promise<MenuRights> {
  const params: unknown[] = [session.userNo];
  let companyFilter = "";
  if (session.companyWiseRights) {
    params.push(session.companyName);
    companyFilter = `AND u_co_id IN (SELECT co_key FROM ${SYSTEM_SCHEMA}.company WHERE name = $2)`;
  }
  const all = (await client.query(
    `SELECT u_module, u_roll_id, u_pass_1, u_pass_2, u_pass_3, u_module_pass FROM ${SYSTEM_SCHEMA}.security WHERE u_id = $1 ${companyFilter} ORDER BY security_key`,
    params,
  )).rows as SecurityRow[];
  const encoded = securityWrite(moduleName, 0);
  const row = all.find((candidate) => toText(candidate.u_module) === encoded);
  const flag = (position: number) => {
    if (!row) return true;
    const roll = toText(row.u_roll_id);
    return roll.length > position ? securityRead(roll.charAt(position), position + 1) === "1" : true;
  };
  const password = (value: string | null | undefined) => (toText(value) === "" ? "" : securityRead(toText(value), 0));
  return {
    restricted: all.length > 0,
    add: flag(2),
    edit: flag(4),
    delete: flag(6),
    modulePassword: password(row?.u_module_pass),
    addPassword: password(row?.u_pass_1),
    editPassword: password(row?.u_pass_2),
    deletePassword: password(row?.u_pass_3),
  };
}
