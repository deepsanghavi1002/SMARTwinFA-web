import type { Client } from "pg";
import type { MasterSession } from "../master-program/session";
import { PAYROLL_VERSION, applyPayroll, safeSchema } from "./schema";

/**
 * Payroll Phase 1 work, one function per action of /api/payroll. Every function runs inside the request's transaction with the company
 * schema first on the search_path (prepare), so the SQL is written without a schema name and reaches `account` / `ac_balance` of the company.
 *
 * Staff are never copied: a profile is keyed by the account's code, and the name and opening balance come from account / ac_balance.
 */

export type Setup = Readonly<{
  jvMode: "A" | "B" | "AB"; salaryExpCode: number | null; daysBasis: "CAL" | "FIX"; fixedDays: number;
  pfPct: number; pfEmpPct: number; pfCeiling: number; esiPct: number; esiEmpPct: number; esiCeiling: number; ptAmount: number; ptFromGross: number;
}>;

export type Component = Readonly<{
  id: number; name: string; type: "E" | "D"; calc: "F" | "P"; pf: boolean; esi: boolean; seq: number; system: boolean; active: boolean;
}>;

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const day = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : "");

function fail(message: string): never { throw new Error(message); }

/** Brings the company's payroll tables to the current version (a no-op when they are) and points the search_path at the company. */
export async function prepare(client: Client, session: MasterSession) {
  await client.query(`SET LOCAL search_path TO ${safeSchema(session.companySchema)}, public`);
  const have = (await client.query("SELECT to_regclass('pay_schema_version') IS NOT NULL AS found")).rows[0]?.found === true;
  const version = have ? num((await client.query("SELECT COALESCE(MAX(version), 0) AS v FROM pay_schema_version")).rows[0]?.v) : 0;
  if (version < PAYROLL_VERSION) await applyPayroll(client, session.companySchema);
}

/* ---------------------------------------------------------------- setup */

function setupOf(row: Record<string, unknown>): Setup {
  return {
    jvMode: (text(row.jv_mode) || "AB") as Setup["jvMode"], salaryExpCode: row.salary_exp_code === null ? null : num(row.salary_exp_code),
    daysBasis: (text(row.days_basis) || "CAL") as Setup["daysBasis"], fixedDays: num(row.fixed_days),
    pfPct: num(row.pf_pct), pfEmpPct: num(row.pf_emp_pct), pfCeiling: num(row.pf_ceiling), esiPct: num(row.esi_pct), esiEmpPct: num(row.esi_emp_pct),
    esiCeiling: num(row.esi_ceiling), ptAmount: num(row.pt_amount), ptFromGross: num(row.pt_from_gross),
  };
}

export async function getSetup(client: Client) {
  const row = (await client.query("SELECT * FROM pay_setup WHERE setup_id = 1")).rows[0] ?? fail("The payroll setup row is missing");
  const code = row.salary_exp_code === null ? null : num(row.salary_exp_code);
  const account = code === null ? null : (await client.query("SELECT code, name FROM account WHERE code = $1", [code])).rows[0];
  return { setup: setupOf(row), salaryExpName: account ? text(account.name) : "" };
}

function percent(value: unknown, label: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) fail(`${label} must be between 0 and 100`);
  return n;
}
function amount(value: unknown, label: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 99999999999) fail(`${label} must be a positive amount`);
  return Math.round(n * 100) / 100;
}

export async function saveSetup(client: Client, operator: string, input: Record<string, unknown>) {
  const jvMode = text(input.jvMode);
  if (!["A", "B", "AB"].includes(jvMode)) fail("Salary journal mode must be A, B or Both");
  const daysBasis = text(input.daysBasis);
  if (!["CAL", "FIX"].includes(daysBasis)) fail("Days basis must be calendar or fixed");
  const fixedDays = Number(input.fixedDays);
  if (!Number.isFinite(fixedDays) || fixedDays < 1 || fixedDays > 31) fail("Fixed days must be between 1 and 31");
  let salaryExp: number | null = null;
  if (input.salaryExpCode !== null && input.salaryExpCode !== undefined && input.salaryExpCode !== "") {
    salaryExp = Number(input.salaryExpCode);
    if (!Number.isInteger(salaryExp)) fail("Salary expense account is not valid");
    if ((await client.query("SELECT 1 FROM account WHERE code = $1", [salaryExp])).rowCount === 0) fail("Salary expense account does not exist");
  }
  await client.query(
    `UPDATE pay_setup SET jv_mode = $1, salary_exp_code = $2, days_basis = $3, fixed_days = $4, pf_pct = $5, pf_emp_pct = $6, pf_ceiling = $7,
            esi_pct = $8, esi_emp_pct = $9, esi_ceiling = $10, pt_amount = $11, pt_from_gross = $12, updated_by = $13, updated_at = now()
      WHERE setup_id = 1`,
    [jvMode, salaryExp, daysBasis, fixedDays, percent(input.pfPct, "PF %"), percent(input.pfEmpPct, "Employer PF %"), amount(input.pfCeiling, "PF wage ceiling"),
      percent(input.esiPct, "ESI %"), percent(input.esiEmpPct, "Employer ESI %"), amount(input.esiCeiling, "ESI wage ceiling"),
      amount(input.ptAmount, "Professional tax"), amount(input.ptFromGross, "PT from gross"), operator],
  );
  return getSetup(client);
}

/* ----------------------------------------------------------- components */

export async function listComponents(client: Client): Promise<Component[]> {
  const rows = (await client.query("SELECT * FROM pay_component ORDER BY seq, component_id")).rows;
  return rows.map((row) => ({
    id: num(row.component_id), name: text(row.comp_name), type: text(row.comp_type) as "E" | "D", calc: text(row.calc_mode) as "F" | "P",
    pf: row.pf_applicable === true, esi: row.esi_applicable === true, seq: num(row.seq), system: row.is_system === true, active: row.active === true,
  }));
}

export async function saveComponent(client: Client, input: Record<string, unknown>) {
  const name = text(input.name).toUpperCase();
  if (name === "" || name.length > 40) fail("Component name is required (40 characters at most)");
  const type = text(input.type);
  if (!["E", "D"].includes(type)) fail("Component type must be Earning or Deduction");
  const calc = text(input.calc);
  if (!["F", "P"].includes(calc)) fail("Calculation must be Fixed or % of Basic");
  const seq = Math.trunc(Number(input.seq ?? 0));
  if (!Number.isFinite(seq) || seq < 0 || seq > 999) fail("Sequence must be between 0 and 999");
  const pf = type === "E" && input.pf === true;
  const esi = type === "E" && input.esi === true;
  const active = input.active !== false;
  const id = input.id === undefined || input.id === null ? null : Number(input.id);
  if (id === null) {
    if ((await client.query("SELECT 1 FROM pay_component WHERE comp_name = $1", [name])).rowCount) fail(`Component ${name} already exists`);
    await client.query("INSERT INTO pay_component (comp_name, comp_type, calc_mode, pf_applicable, esi_applicable, seq, active) VALUES ($1, $2, $3, $4, $5, $6, $7)", [name, type, calc, pf, esi, seq, active]);
  } else {
    const row = (await client.query("SELECT is_system FROM pay_component WHERE component_id = $1", [id])).rows[0] ?? fail("Component not found");
    if ((await client.query("SELECT 1 FROM pay_component WHERE comp_name = $1 AND component_id <> $2", [name, id])).rowCount) fail(`Component ${name} already exists`);
    const used = (await client.query("SELECT 1 FROM pay_salary_structure WHERE component_id = $1 LIMIT 1", [id])).rowCount !== 0;
    if (row.is_system === true && (!active || type !== "E")) fail("BASIC is the salary base; it must stay an active earning");
    const was = (await client.query("SELECT comp_name, comp_type, calc_mode FROM pay_component WHERE component_id = $1", [id])).rows[0];
    if (used && (text(was.comp_type) !== type || text(was.calc_mode) !== calc)) fail("This component is in use by a salary structure; its type and calculation can no longer change (switch it off instead)");
    if (row.is_system === true && text(was.comp_name) !== name) fail("A system component cannot be renamed");
    await client.query("UPDATE pay_component SET comp_name = $1, comp_type = $2, calc_mode = $3, pf_applicable = $4, esi_applicable = $5, seq = $6, active = $7 WHERE component_id = $8", [name, type, calc, pf, esi, seq, active, id]);
  }
  return listComponents(client);
}

/* ---------------------------------------------------------------- staff */

/** Accounts that are not yet enrolled, matched by name or code, for the enrol picker. */
export async function searchAccounts(client: Client, term: string, includeEnrolled = false) {
  const q = term.trim();
  if (q.length < 2) return [];
  const rows = (await client.query(
    `SELECT a.code, a.name FROM account a
      WHERE COALESCE(a.a_pos, 'A') <> 'D' AND ($3 OR NOT EXISTS (SELECT 1 FROM pay_staff_profile p WHERE p.code = a.code))
        AND (a.name ILIKE $1 OR a.code::text = $2)
      ORDER BY a.name LIMIT 40`,
    [`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, q, includeEnrolled],
  )).rows;
  return rows.map((row) => ({ code: num(row.code), name: text(row.name) }));
}

export async function listStaff(client: Client, session: MasterSession) {
  const rows = (await client.query(
    `SELECT p.code, a.name, p.designation, p.department, p.join_date, p.exit_date, p.active, p.pf_on, p.esi_on, p.pt_on,
            COALESCE((SELECT b.opening FROM ac_balance b WHERE b.code = p.code AND b.year_id = $1 AND b.a_recflag = 'AC' LIMIT 1), 0) AS opening,
            COALESCE((SELECT SUM(CASE WHEN c.comp_type = 'E' AND c.calc_mode = 'F' THEN s.amount ELSE 0 END)
                        FROM pay_salary_structure s JOIN pay_component c ON c.component_id = s.component_id
                       WHERE s.code = p.code AND s.effective_to IS NULL), 0) AS fixed_earnings
       FROM pay_staff_profile p JOIN account a ON a.code = p.code
      ORDER BY p.active DESC, a.name`,
    [session.yearId],
  )).rows;
  return rows.map((row) => ({
    code: num(row.code), name: text(row.name), designation: text(row.designation), department: text(row.department),
    joinDate: day(row.join_date), exitDate: day(row.exit_date), active: row.active === true, pf: row.pf_on === true, esi: row.esi_on === true, pt: row.pt_on === true,
    opening: num(row.opening), fixedEarnings: num(row.fixed_earnings),
  }));
}

export async function getStaff(client: Client, session: MasterSession, code: number) {
  const row = (await client.query(
    `SELECT p.*, a.name,
            COALESCE((SELECT b.opening FROM ac_balance b WHERE b.code = p.code AND b.year_id = $2 AND b.a_recflag = 'AC' LIMIT 1), 0) AS opening
       FROM pay_staff_profile p JOIN account a ON a.code = p.code WHERE p.code = $1`,
    [code, session.yearId],
  )).rows[0] ?? fail("This staff member is not enrolled in payroll");
  // The structure in force now: the rows with no end date. Earlier ones stay as history.
  const open = (await client.query("SELECT component_id, amount, effective_from FROM pay_salary_structure WHERE code = $1 AND effective_to IS NULL ORDER BY effective_from DESC", [code])).rows;
  const history = (await client.query("SELECT DISTINCT effective_from FROM pay_salary_structure WHERE code = $1 ORDER BY effective_from DESC", [code])).rows;
  return {
    profile: {
      code, name: text(row.name), opening: num(row.opening), designation: text(row.designation), department: text(row.department),
      joinDate: day(row.join_date), exitDate: day(row.exit_date), payBasis: text(row.pay_basis) as "M" | "D",
      bankName: text(row.bank_name), bankAcNo: text(row.bank_ac_no), bankIfsc: text(row.bank_ifsc), panNo: text(row.pan_no),
      pfNo: text(row.pf_no), uanNo: text(row.uan_no), esiNo: text(row.esi_no), pfOn: row.pf_on === true, esiOn: row.esi_on === true, ptOn: row.pt_on === true,
      active: row.active === true, remark: text(row.remark),
    },
    structure: open.map((s) => ({ componentId: num(s.component_id), amount: num(s.amount) })),
    effectiveFrom: open.length ? day(open[0].effective_from) : "",
    history: history.map((h) => day(h.effective_from)),
  };
}

function date(value: unknown, label: string, required: boolean): string | null {
  const v = text(value);
  if (v === "") { if (required) fail(`${label} is required`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) fail(`${label} is not a valid date`);
  return v;
}
function limited(value: unknown, max: number, label: string): string | null {
  const v = text(value);
  if (v.length > max) fail(`${label} is too long (${max} characters at most)`);
  return v === "" ? null : v;
}

export async function saveStaff(client: Client, session: MasterSession, operator: string, input: Record<string, unknown>) {
  const code = Number(input.code);
  if (!Number.isInteger(code)) fail("Staff ledger is required");
  const account = (await client.query("SELECT 1 FROM account WHERE code = $1 AND COALESCE(a_pos, 'A') <> 'D'", [code])).rowCount;
  if (!account) fail("This ledger does not exist in the company's accounts");
  const joinDate = date(input.joinDate, "Joining date", true);
  const exitDate = date(input.exitDate, "Exit date", false);
  if (exitDate && joinDate && exitDate < joinDate) fail("Exit date cannot be before the joining date");
  const payBasis = text(input.payBasis) || "M";
  if (!["M", "D"].includes(payBasis)) fail("Pay basis must be Monthly or Daily");
  const ifsc = limited(input.bankIfsc, 15, "IFSC")?.toUpperCase() ?? null;
  const pan = limited(input.panNo, 15, "PAN")?.toUpperCase() ?? null;

  const fields = [
    code, limited(input.designation, 60, "Designation"), limited(input.department, 60, "Department"), joinDate, exitDate, payBasis,
    limited(input.bankName, 60, "Bank name"), limited(input.bankAcNo, 30, "Bank account no"), ifsc, pan,
    limited(input.pfNo, 30, "PF no"), limited(input.uanNo, 20, "UAN"), limited(input.esiNo, 30, "ESI no"),
    input.pfOn === true, input.esiOn === true, input.ptOn === true, input.active !== false, limited(input.remark, 200, "Remark"), operator,
  ];
  await client.query(
    `INSERT INTO pay_staff_profile (code, designation, department, join_date, exit_date, pay_basis, bank_name, bank_ac_no, bank_ifsc, pan_no, pf_no, uan_no, esi_no,
                                    pf_on, esi_on, pt_on, active, remark, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
     ON CONFLICT (code) DO UPDATE SET designation = EXCLUDED.designation, department = EXCLUDED.department, join_date = EXCLUDED.join_date, exit_date = EXCLUDED.exit_date,
       pay_basis = EXCLUDED.pay_basis, bank_name = EXCLUDED.bank_name, bank_ac_no = EXCLUDED.bank_ac_no, bank_ifsc = EXCLUDED.bank_ifsc, pan_no = EXCLUDED.pan_no,
       pf_no = EXCLUDED.pf_no, uan_no = EXCLUDED.uan_no, esi_no = EXCLUDED.esi_no, pf_on = EXCLUDED.pf_on, esi_on = EXCLUDED.esi_on, pt_on = EXCLUDED.pt_on,
       active = EXCLUDED.active, remark = EXCLUDED.remark, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    fields,
  );

  // The salary structure, only when the screen sent one: a new set from the effective date; the set in force until then is closed the day before.
  if (Array.isArray(input.structure) && input.structure.length > 0) {
    const from = date(input.effectiveFrom, "Effective from", true) as string;
    const components = new Map((await listComponents(client)).map((c) => [c.id, c]));
    const rows = (input.structure as Record<string, unknown>[]).map((r) => {
      const id = Number(r.componentId);
      const component = components.get(id) ?? fail("A salary component is not valid");
      if (!component.active) fail(`${component.name} is switched off`);
      const value = Number(r.amount);
      if (!Number.isFinite(value) || value < 0) fail(`${component.name}: the amount must be zero or more`);
      if (component.calc === "P" && value > 100) fail(`${component.name}: a percentage cannot be over 100`);
      return { id, value: Math.round(value * 100) / 100 };
    });
    if (new Set(rows.map((r) => r.id)).size !== rows.length) fail("A salary component is listed twice");
    const basic = [...components.values()].find((c) => c.system && c.name === "BASIC");
    if (basic && !rows.some((r) => r.id === basic.id && r.value > 0)) fail("BASIC must be more than zero");

    const later = (await client.query("SELECT 1 FROM pay_salary_structure WHERE code = $1 AND effective_from > $2 LIMIT 1", [code, from])).rowCount;
    if (later) fail("A salary structure already starts after this date; edit from its date or later");
    await client.query("DELETE FROM pay_salary_structure WHERE code = $1 AND effective_from = $2", [code, from]);
    await client.query("UPDATE pay_salary_structure SET effective_to = ($2::date - 1) WHERE code = $1 AND effective_to IS NULL", [code, from]);
    for (const r of rows) {
      await client.query("INSERT INTO pay_salary_structure (code, component_id, amount, effective_from) VALUES ($1, $2, $3, $4)", [code, r.id, r.value, from]);
    }
  }
  return getStaff(client, session, code);
}
