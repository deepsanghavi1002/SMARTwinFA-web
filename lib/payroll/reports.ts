import type { Client } from "pg";
import type { MasterSession } from "../master-program/session";
import { getSetup } from "./service";
import { readLines, readTags } from "./tag";

/**
 * Payroll Phase 5: loans and advances, and the reports that come out of the slips and tags: Advance and Loan Outstanding, Bank Transfer Sheet,
 * PF / ESI / PT Statement and Untagged Vouchers. All of them read; only the loan master writes (pay_loan).
 */

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const day = (value: unknown) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ? String(value).slice(0, 10) : "");
const cents = (value: number) => Math.round(value * 100) / 100;
function fail(message: string): never { throw new Error(message); }

const BOOKS: Readonly<Record<number, string>> = { 4: "Cash", 5: "Discount", 6: "Bank", 19: "Journal" };

/* ---------------------------------------------------------- loans / advances */

export type Loan = Readonly<{ id: number; code: number; name: string; date: string; principal: number; emi: number; startYear: number; startMonth: number; note: string; active: boolean; deducted: number; balance: number }>;

export async function listLoans(client: Client): Promise<Loan[]> {
  const rows = (await client.query(
    `SELECT l.*, a.name, COALESCE((SELECT SUM(d.amount) FROM pay_loan_deduct d WHERE d.loan_id = l.loan_id), 0) AS deducted
       FROM pay_loan l JOIN account a ON a.code = l.code ORDER BY l.active DESC, a.name, l.loan_id`,
  )).rows;
  return rows.map((row) => ({
    id: num(row.loan_id), code: num(row.code), name: text(row.name), date: day(row.loan_date), principal: num(row.principal), emi: num(row.emi), startYear: num(row.start_year), startMonth: num(row.start_month),
    note: text(row.note), active: row.active === true, deducted: cents(num(row.deducted)), balance: cents(num(row.principal) - num(row.deducted)),
  }));
}

export async function saveLoan(client: Client, operator: string, input: Record<string, unknown>) {
  const code = Number(input.code);
  if (!Number.isInteger(code)) fail("Staff is required");
  if (!(await client.query("SELECT 1 FROM pay_staff_profile WHERE code = $1", [code])).rowCount) fail("This staff member is not enrolled in payroll");
  const date = text(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail("Loan date is not valid");
  const principal = cents(Number(input.principal)), emi = cents(Number(input.emi));
  if (!(principal > 0)) fail("The loan amount must be more than zero");
  if (!(emi > 0)) fail("The monthly instalment must be more than zero");
  if (emi > principal) fail("The instalment cannot be more than the loan");
  const startYear = Number(input.startYear), startMonth = Number(input.startMonth);
  if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100 || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) fail("Start month is not valid");
  const note = text(input.note);
  if (note.length > 100) fail("The note is too long (100 characters at most)");
  const active = input.active !== false;
  const id = input.id === undefined || input.id === null ? null : Number(input.id);
  if (id === null) {
    await client.query("INSERT INTO pay_loan (code, loan_date, principal, emi, start_year, start_month, note, active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [code, date, principal, emi, startYear, startMonth, note || null, active, operator]);
  } else {
    const old = (await client.query("SELECT code, principal FROM pay_loan WHERE loan_id = $1 FOR UPDATE", [id])).rows[0] ?? fail("The loan does not exist");
    const deducted = num((await client.query("SELECT COALESCE(SUM(amount), 0) AS s FROM pay_loan_deduct WHERE loan_id = $1", [id])).rows[0]?.s);
    // Once instalments have been taken the loan's staff member and amount stay: the slips already carry them.
    if (deducted > 0 && (num(old.code) !== code || cents(num(old.principal)) !== principal)) fail("Instalments have already been taken from salary; the staff member and loan amount can no longer change");
    if (principal < deducted) fail("The loan amount cannot be less than what has already been taken");
    await client.query("UPDATE pay_loan SET code = $2, loan_date = $3, principal = $4, emi = $5, start_year = $6, start_month = $7, note = $8, active = $9 WHERE loan_id = $1", [id, code, date, principal, emi, startYear, startMonth, note || null, active]);
  }
  return listLoans(client);
}

export type Outstanding = Readonly<{
  code: number; name: string;
  advanceGiven: number; advanceRecovered: number; advanceBalance: number;
  loanTaken: number; loanDeducted: number; loanBalance: number; total: number;
}>;

/** Per staff member: advances given (ADV tags) less recovered (REC tags), and loans less the instalments taken. A plus balance is owed by the staff member. */
export async function outstanding(client: Client): Promise<Outstanding[]> {
  const staff = (await client.query("SELECT p.code, a.name FROM pay_staff_profile p JOIN account a ON a.code = p.code ORDER BY p.active DESC, a.name")).rows;
  const tags = new Map<number, { adv: number; rec: number }>();
  for (const row of (await client.query("SELECT code, tag_type, SUM(amount) AS s FROM pay_voucher_tag WHERE NOT reversed AND tag_type IN ('ADV', 'REC') GROUP BY code, tag_type")).rows) {
    const t = tags.get(num(row.code)) ?? { adv: 0, rec: 0 };
    if (text(row.tag_type) === "ADV") t.adv = num(row.s); else t.rec = num(row.s);
    tags.set(num(row.code), t);
  }
  const loans = new Map<number, { taken: number; deducted: number }>();
  for (const row of (await client.query(
    `SELECT l.code, SUM(l.principal) AS taken, COALESCE(SUM((SELECT SUM(d.amount) FROM pay_loan_deduct d WHERE d.loan_id = l.loan_id)), 0) AS deducted FROM pay_loan l WHERE l.active GROUP BY l.code`,
  )).rows) loans.set(num(row.code), { taken: num(row.taken), deducted: num(row.deducted) });
  return staff.map((s) => {
    const t = tags.get(num(s.code)) ?? { adv: 0, rec: 0 }, l = loans.get(num(s.code)) ?? { taken: 0, deducted: 0 };
    const advanceBalance = cents(t.adv - t.rec), loanBalance = cents(l.taken - l.deducted);
    return { code: num(s.code), name: text(s.name), advanceGiven: cents(t.adv), advanceRecovered: cents(t.rec), advanceBalance, loanTaken: cents(l.taken), loanDeducted: cents(l.deducted), loanBalance, total: cents(advanceBalance + loanBalance) };
  });
}

/* --------------------------------------------------------------- bank sheet */

export async function bankSheet(client: Client, periodId: number) {
  const period = (await client.query("SELECT pay_year, pay_month, status FROM pay_period WHERE period_id = $1", [periodId])).rows[0] ?? fail("The pay period does not exist");
  const rows = (await client.query(
    `SELECT s.code, a.name, s.net_payable, p.bank_name, p.bank_ac_no, p.bank_ifsc,
            COALESCE((SELECT SUM(t.amount) FROM pay_voucher_tag t WHERE t.code = s.code AND t.period_id = s.period_id AND t.tag_type = 'PAY' AND NOT t.reversed), 0) AS paid
       FROM pay_slip s JOIN pay_staff_profile p ON p.code = s.code JOIN account a ON a.code = s.code WHERE s.period_id = $1 ORDER BY a.name`,
    [periodId],
  )).rows;
  return {
    year: num(period.pay_year), month: num(period.pay_month), status: text(period.status),
    rows: rows.map((r) => {
      const net = num(r.net_payable), paid = cents(num(r.paid));
      return { code: num(r.code), name: text(r.name), bankName: text(r.bank_name), bankAcNo: text(r.bank_ac_no), bankIfsc: text(r.bank_ifsc), net, paid, toPay: Math.max(0, cents(net - paid)) };
    }),
  };
}

/* -------------------------------------------------------- statutory statement */

/** PF / ESI / PT per staff member for a period, or for every slip of the open year when no period is chosen. */
export async function statutory(client: Client, session: MasterSession, periodId: number | null) {
  const { setup } = await getSetup(client);
  const slips = (await client.query(
    `SELECT s.slip_id, s.code, a.name, p.pf_no, p.uan_no, p.esi_no, s.pf_emp, s.pf_er, s.esi_emp, s.esi_er,
            COALESCE((SELECT SUM(l.amount) FROM pay_slip_line l WHERE l.slip_id = s.slip_id AND l.line_name = 'PROF TAX'), 0) AS pt,
            COALESCE((SELECT SUM(l.amount) FROM pay_slip_line l JOIN pay_component c ON c.component_id = l.component_id WHERE l.slip_id = s.slip_id AND l.line_type = 'E' AND c.pf_applicable), 0) AS pf_wage,
            COALESCE((SELECT SUM(l.amount) FROM pay_slip_line l JOIN pay_component c ON c.component_id = l.component_id WHERE l.slip_id = s.slip_id AND l.line_type = 'E' AND c.esi_applicable), 0) AS esi_wage
       FROM pay_slip s JOIN pay_period pp ON pp.period_id = s.period_id JOIN pay_staff_profile p ON p.code = s.code JOIN account a ON a.code = s.code
      WHERE ($1::int IS NULL OR s.period_id = $1) AND pp.to_date >= $2::date AND pp.from_date <= $3::date ORDER BY a.name, pp.pay_year, pp.pay_month`,
    [periodId, day(session.tarikh1), day(session.tarikh2)],
  )).rows;
  const by = new Map<number, { code: number; name: string; pfNo: string; uanNo: string; esiNo: string; pfWage: number; pfEmp: number; pfEr: number; esiWage: number; esiEmp: number; esiEr: number; pt: number }>();
  for (const r of slips) {
    const t = by.get(num(r.code)) ?? { code: num(r.code), name: text(r.name), pfNo: text(r.pf_no), uanNo: text(r.uan_no), esiNo: text(r.esi_no), pfWage: 0, pfEmp: 0, pfEr: 0, esiWage: 0, esiEmp: 0, esiEr: 0, pt: 0 };
    // The wage the contribution was worked on: the PF-counting earnings up to the ceiling; ESI's only when ESI was taken.
    if (num(r.pf_emp) > 0) t.pfWage += Math.min(num(r.pf_wage), setup.pfCeiling);
    if (num(r.esi_emp) > 0) t.esiWage += num(r.esi_wage);
    t.pfEmp += num(r.pf_emp); t.pfEr += num(r.pf_er); t.esiEmp += num(r.esi_emp); t.esiEr += num(r.esi_er); t.pt += num(r.pt);
    by.set(t.code, t);
  }
  const rows = [...by.values()].map((t) => ({ ...t, pfWage: cents(t.pfWage), pfEmp: cents(t.pfEmp), pfEr: cents(t.pfEr), esiWage: cents(t.esiWage), esiEmp: cents(t.esiEmp), esiEr: cents(t.esiEr), pt: cents(t.pt) }))
    .filter((t) => t.pfEmp > 0 || t.esiEmp > 0 || t.pt > 0);
  return { rows };
}

/* ------------------------------------------------------------ untagged lines */

/** Every voucher line of the enrolled staff ledgers (open year) that is not fully tagged, or tagged for more than it is, and tags whose voucher is gone. */
export async function untaggedReport(client: Client, session: MasterSession) {
  const staff = (await client.query("SELECT p.code, a.name FROM pay_staff_profile p JOIN account a ON a.code = p.code ORDER BY a.name")).rows;
  const codes = staff.map((s) => num(s.code));
  if (codes.length === 0) return { lines: [], orphans: [] };
  const lines = await readLines(client, session, codes);
  const tags = await readTags(client, codes);
  const out: { code: number; name: string; ledId: number; date: string; docNo: string; book: string; side: "Dr" | "Cr"; amount: number; untagged: number; over: boolean; narration: string }[] = [];
  for (const s of staff) {
    const code = num(s.code);
    for (const l of lines.get(code) ?? []) {
      const tagged = cents(tags.filter((t) => t.code === code && t.ledId === l.ledId).reduce((t, x) => t + x.tag.amount, 0));
      const amount = Math.abs(l.net), left = cents(amount - tagged);
      if (left > 0.004 || left < -0.004) out.push({ code, name: text(s.name), ledId: l.ledId, date: l.date, docNo: l.docNo, book: BOOKS[l.bookNo] ?? `Book ${l.bookNo}`, side: l.net > 0 ? "Dr" : "Cr", amount, untagged: Math.max(0, left), over: left < -0.004, narration: l.narration });
    }
  }
  const live = new Set(codes.flatMap((code) => (lines.get(code) ?? []).map((l) => `${code}:${l.ledId}`)));
  const names = new Map(staff.map((s) => [num(s.code), text(s.name)]));
  const orphans = tags.filter((t) => !live.has(`${t.code}:${t.ledId}`)).map((t) => ({ code: t.code, name: names.get(t.code) ?? "", tagId: t.tag.tagId, periodLabel: t.tag.periodLabel, amount: t.tag.amount }));
  return { lines: out, orphans };
}
