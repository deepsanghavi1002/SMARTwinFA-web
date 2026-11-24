import type { Client } from "pg";
import { calculateSalary, defaultPaidDays, emiDue, monthDaysOf, type CalcSetup, type CalcStructureRow } from "./calc";
import { getSetup } from "./service";

/**
 * Payroll Phase 2 work: pay periods, attendance, processing into slips, and the slip reads behind the Salary Register and the Payslip.
 * Runs inside the request's transaction with the company schema on the search_path (service.ts prepare).
 *
 * A period goes Open (O) -> Processed (P) -> Locked (L). Attendance and processing change only while it is not locked; processing again
 * replaces the period's slips (one slip per staff member per month - the table's unique key).
 */

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const day = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : "");
function fail(message: string): never { throw new Error(message); }

export type Period = Readonly<{ id: number; year: number; month: number; from: string; to: string; days: number; status: "O" | "P" | "L"; slips: number; net: number }>;

function periodOf(row: Record<string, unknown>): Period {
  const from = day(row.from_date), to = day(row.to_date);
  return {
    id: num(row.period_id), year: num(row.pay_year), month: num(row.pay_month), from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
    status: text(row.status) as Period["status"], slips: num(row.slips), net: num(row.net),
  };
}

const PERIOD_SQL = `SELECT p.*, (SELECT COUNT(*) FROM pay_slip s WHERE s.period_id = p.period_id) AS slips,
                           COALESCE((SELECT SUM(s.net_payable) FROM pay_slip s WHERE s.period_id = p.period_id), 0) AS net
                      FROM pay_period p`;

export async function listPeriods(client: Client): Promise<Period[]> {
  return (await client.query(`${PERIOD_SQL} ORDER BY p.pay_year DESC, p.pay_month DESC`)).rows.map(periodOf);
}

async function readPeriod(client: Client, id: number, lock = false): Promise<Period> {
  if (!Number.isInteger(id)) fail("Pay period is required");
  const row = (await client.query(`${PERIOD_SQL} WHERE p.period_id = $1${lock ? " FOR UPDATE OF p" : ""}`, [id])).rows[0] ?? fail("The pay period does not exist");
  return periodOf(row);
}

/** Opens (or finds) the pay period of a month. */
export async function openPeriod(client: Client, operator: string, yearValue: unknown, monthValue: unknown): Promise<Period[]> {
  const year = Number(yearValue), month = Number(monthValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) fail("Year must be between 2000 and 2100");
  if (!Number.isInteger(month) || month < 1 || month > 12) fail("Month must be between 1 and 12");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  await client.query(
    "INSERT INTO pay_period (pay_year, pay_month, from_date, to_date, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (pay_year, pay_month) DO NOTHING",
    [year, month, `${year}-${pad(month)}-01`, `${year}-${pad(month)}-${pad(last)}`, operator],
  );
  return listPeriods(client);
}

function asCalcSetup(setup: Awaited<ReturnType<typeof getSetup>>["setup"]): CalcSetup { return setup; }

/** Staff who are paid for the period: active, joined by its last day and not gone before its first. */
const ELIGIBLE = `FROM pay_staff_profile p JOIN account a ON a.code = p.code
                   WHERE p.active AND p.join_date IS NOT NULL AND p.join_date <= $2::date AND (p.exit_date IS NULL OR p.exit_date >= $1::date)`;

export async function getAttendance(client: Client, periodId: number) {
  const period = await readPeriod(client, periodId);
  const { setup } = await getSetup(client);
  const rows = (await client.query(
    `SELECT p.code, a.name, p.designation, p.join_date, p.exit_date, t.paid_days, t.remark ${ELIGIBLE.replace("WHERE", "LEFT JOIN pay_attendance t ON t.code = p.code AND t.period_id = $3 WHERE")} ORDER BY a.name`,
    [period.from, period.to, periodId],
  )).rows;
  return {
    period, monthDays: monthDaysOf(setup, period.days),
    rows: rows.map((row) => ({
      code: num(row.code), name: text(row.name), designation: text(row.designation),
      defaultDays: defaultPaidDays(period.from, period.to, day(row.join_date) || null, day(row.exit_date) || null, setup),
      paidDays: row.paid_days === null ? null : num(row.paid_days), remark: text(row.remark),
    })),
  };
}

export async function saveAttendance(client: Client, operator: string, periodId: number, input: unknown) {
  const period = await readPeriod(client, periodId, true);
  if (period.status === "L") fail("This pay period is locked");
  if (!Array.isArray(input)) fail("Attendance rows are required");
  const staff = new Set((await client.query(`SELECT p.code ${ELIGIBLE}`, [period.from, period.to])).rows.map((row) => num(row.code)));
  for (const raw of input as Record<string, unknown>[]) {
    const code = Number(raw.code);
    if (!staff.has(code)) fail(`Staff #${raw.code} is not paid in this period`);
    if (raw.paidDays === null || raw.paidDays === undefined || raw.paidDays === "") {
      await client.query("DELETE FROM pay_attendance WHERE period_id = $1 AND code = $2", [periodId, code]);
      continue;
    }
    const paid = Number(raw.paidDays);
    if (!Number.isFinite(paid) || paid < 0 || paid > 31) fail(`Staff #${code}: paid days must be between 0 and 31`);
    const remark = text(raw.remark);
    if (remark.length > 100) fail(`Staff #${code}: the remark is too long`);
    await client.query(
      `INSERT INTO pay_attendance (period_id, code, paid_days, remark, saved_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (period_id, code) DO UPDATE SET paid_days = EXCLUDED.paid_days, remark = EXCLUDED.remark, saved_by = EXCLUDED.saved_by, saved_at = now()`,
      [periodId, code, Math.round(paid * 100) / 100, remark || null, operator],
    );
  }
  return getAttendance(client, periodId);
}

/** Works out every eligible staff member's slip for the period and replaces the period's slips with them. */
export async function processPeriod(client: Client, operator: string, periodId: number) {
  const period = await readPeriod(client, periodId, true);
  if (period.status === "L") fail("This pay period is locked; unlock it to process again");
  if ((await client.query("SELECT 1 FROM pay_slip WHERE period_id = $1 AND jv_led_key IS NOT NULL LIMIT 1", [periodId])).rowCount) {
    fail("A salary journal is already linked to this period's slips; they cannot be re-processed");
  }
  const { setup } = await getSetup(client);
  const calcSetup = asCalcSetup(setup);
  const staff = (await client.query(
    `SELECT p.code, a.name, p.pay_basis, p.pf_on, p.esi_on, p.pt_on, p.join_date, p.exit_date, t.paid_days
       ${ELIGIBLE.replace("WHERE", "LEFT JOIN pay_attendance t ON t.code = p.code AND t.period_id = $3 WHERE")} ORDER BY a.name`,
    [period.from, period.to, periodId],
  )).rows;

  // The structure in force on the period's last day: the latest set that started on or before it.
  const structures = (await client.query(
    `SELECT s.code, s.component_id, s.amount, c.comp_name, c.comp_type, c.calc_mode, c.pf_applicable, c.esi_applicable, c.seq
       FROM pay_salary_structure s JOIN pay_component c ON c.component_id = s.component_id
      WHERE c.active AND s.effective_from = (SELECT MAX(x.effective_from) FROM pay_salary_structure x WHERE x.code = s.code AND x.effective_from <= $1::date)`,
    [period.to],
  )).rows;
  const byCode = new Map<number, CalcStructureRow[]>();
  for (const row of structures) {
    const list = byCode.get(num(row.code)) ?? [];
    list.push({ componentId: num(row.component_id), name: text(row.comp_name), type: text(row.comp_type) as "E" | "D", calc: text(row.calc_mode) as "F" | "P",
      pf: row.pf_applicable === true, esi: row.esi_applicable === true, seq: num(row.seq), amount: num(row.amount) });
    byCode.set(num(row.code), list);
  }

  await client.query("DELETE FROM pay_slip WHERE period_id = $1", [periodId]);
  // Loans being repaid: each active loan that has started takes its instalment, capped at what is still owed after the earlier months' slips.
  const loans = (await client.query(
    `SELECT l.loan_id, l.code, l.principal, l.emi,
            COALESCE((SELECT SUM(d.amount) FROM pay_loan_deduct d JOIN pay_slip s ON s.slip_id = d.slip_id JOIN pay_period p ON p.period_id = s.period_id
                       WHERE d.loan_id = l.loan_id AND (p.pay_year, p.pay_month) < ($1::int, $2::int)), 0) AS done
       FROM pay_loan l WHERE l.active AND (l.start_year, l.start_month) <= ($1::int, $2::int) ORDER BY l.loan_id`,
    [period.year, period.month],
  )).rows;
  const emiByCode = new Map<number, { loanId: number; amount: number }[]>();
  for (const loan of loans) {
    const amount = emiDue(num(loan.principal), num(loan.done), num(loan.emi));
    if (amount <= 0) continue;
    const list = emiByCode.get(num(loan.code)) ?? [];
    list.push({ loanId: num(loan.loan_id), amount });
    emiByCode.set(num(loan.code), list);
  }
  const skipped: { code: number; name: string; reason: string }[] = [];
  let made = 0;
  for (const row of staff) {
    const code = num(row.code);
    const base = byCode.get(code);
    const emis = emiByCode.get(code) ?? [];
    const emiTotal = Math.round(emis.reduce((t, e) => t + e.amount, 0) * 100) / 100;
    const rows = base && emiTotal > 0 ? [...base, { componentId: 0, name: "LOAN EMI", type: "D" as const, calc: "F" as const, pf: false, esi: false, seq: 800, amount: emiTotal }] : base;
    if (!rows || rows.length === 0) { skipped.push({ code, name: text(row.name), reason: "No salary structure from this date" }); continue; }
    const paidDays = row.paid_days === null ? defaultPaidDays(period.from, period.to, day(row.join_date) || null, day(row.exit_date) || null, calcSetup) : num(row.paid_days);
    const result = calculateSalary({
      setup: calcSetup, payBasis: text(row.pay_basis) as "M" | "D", pfOn: row.pf_on === true, esiOn: row.esi_on === true, ptOn: row.pt_on === true,
      calendarDays: period.days, paidDays, structure: rows,
    });
    if (result.gross <= 0) { skipped.push({ code, name: text(row.name), reason: "Nothing earned (0 paid days)" }); continue; }
    const slip = (await client.query(
      `INSERT INTO pay_slip (period_id, code, paid_days, month_days, gross, pf_emp, esi_emp, pt, other_ded, total_ded, net_payable, pf_er, esi_er, processed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING slip_id`,
      [periodId, code, result.paidDays, result.monthDays, result.gross, result.pfEmp, result.esiEmp, result.pt, result.otherDed, result.totalDed, result.net, result.pfEr, result.esiEr, operator],
    )).rows[0];
    for (const line of result.lines) {
      await client.query("INSERT INTO pay_slip_line (slip_id, component_id, line_name, line_type, seq, amount) VALUES ($1,$2,$3,$4,$5,$6)", [num(slip.slip_id), line.componentId && line.componentId > 0 ? line.componentId : null, line.name, line.type, line.seq, line.amount]);
    }
    if (emiTotal > 0) for (const emi of emis) await client.query("INSERT INTO pay_loan_deduct (slip_id, loan_id, amount) VALUES ($1,$2,$3)", [num(slip.slip_id), emi.loanId, emi.amount]);
    made += 1;
  }
  await client.query("UPDATE pay_period SET status = 'P' WHERE period_id = $1", [periodId]);
  return { made, skipped, ...(await getSlips(client, periodId)) };
}

export async function setLock(client: Client, periodId: number, lock: boolean) {
  const period = await readPeriod(client, periodId, true);
  if (lock && period.status !== "P") fail("Only a processed pay period can be locked");
  if (!lock && period.status !== "L") fail("This pay period is not locked");
  await client.query("UPDATE pay_period SET status = $2 WHERE period_id = $1", [periodId, lock ? "L" : "P"]);
  return { period: await readPeriod(client, periodId) };
}

/** The period's slips with their lines and the staff details a payslip prints: the one read behind the Process, Register and Payslip screens. */
export async function getSlips(client: Client, periodId: number) {
  const period = await readPeriod(client, periodId);
  const slips = (await client.query(
    `SELECT s.*, a.name, p.designation, p.department, p.join_date, p.bank_name, p.bank_ac_no, p.bank_ifsc, p.pan_no, p.pf_no, p.uan_no, p.esi_no
       FROM pay_slip s JOIN pay_staff_profile p ON p.code = s.code JOIN account a ON a.code = s.code WHERE s.period_id = $1 ORDER BY a.name`,
    [periodId],
  )).rows;
  const lines = (await client.query(
    "SELECT l.slip_id, l.line_name, l.line_type, l.seq, l.amount FROM pay_slip_line l JOIN pay_slip s ON s.slip_id = l.slip_id WHERE s.period_id = $1 ORDER BY l.seq, l.line_id",
    [periodId],
  )).rows;
  const bySlip = new Map<number, { name: string; type: "E" | "D"; seq: number; amount: number }[]>();
  for (const line of lines) {
    const list = bySlip.get(num(line.slip_id)) ?? [];
    list.push({ name: text(line.line_name), type: text(line.line_type) as "E" | "D", seq: num(line.seq), amount: num(line.amount) });
    bySlip.set(num(line.slip_id), list);
  }
  return {
    period,
    slips: slips.map((row) => ({
      slipId: num(row.slip_id), code: num(row.code), name: text(row.name), designation: text(row.designation), department: text(row.department),
      joinDate: day(row.join_date), bankName: text(row.bank_name), bankAcNo: text(row.bank_ac_no), bankIfsc: text(row.bank_ifsc), panNo: text(row.pan_no),
      pfNo: text(row.pf_no), uanNo: text(row.uan_no), esiNo: text(row.esi_no),
      paidDays: num(row.paid_days), monthDays: num(row.month_days), gross: num(row.gross), totalDed: num(row.total_ded), net: num(row.net_payable),
      pfEr: num(row.pf_er), esiEr: num(row.esi_er), lines: bySlip.get(num(row.slip_id)) ?? [],
    })),
  };
}
