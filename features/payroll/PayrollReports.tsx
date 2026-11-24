"use client";

import { useEffect, useMemo, useState } from "react";
import { download } from "../../lib/export/table";
import { xlsx } from "../../lib/export/xlsx";
import type { ExportCell, ExportColumn } from "../../lib/export/table";
import { money, usePayroll, type Props } from "./Payroll";

/**
 * PAYROLL (Phase 5): Advance and Loans, Bank Transfer Sheet, PF / ESI / PT Statement and Untagged Vouchers. Loans are repaid by an instalment taken from
 * the salary slip each month; advances are the Salary advance and Recovery tags on vouchers. The rest only read what payroll and the accounts hold.
 */

type Period = { id: number; year: number; month: number; status: "O" | "P" | "L" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodName = (p: { year: number; month: number }) => `${MONTHS[p.month - 1]} ${p.year}`;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const col = (caption: string, kind: ExportColumn["kind"], align: ExportColumn["align"], width: number): ExportColumn => ({ caption, kind, decimals: kind === "number" ? 2 : 0, align, width });
const sumOf = <T,>(rows: readonly T[], pick: (row: T) => number) => rows.reduce((t, r) => t + pick(r), 0);

function exportSheet(company: string, title: string, columns: ExportColumn[], rows: ExportCell[][], totals?: (number | null)[]) {
  download(xlsx({ company, title, subtitle: [], columns, rows, totals }, title.slice(0, 30)), `${title}.xlsx`, XLSX);
}

function usePeriodList(call: <T>(action: string, data?: unknown) => Promise<T>, fail: (reason: unknown) => unknown, ready: boolean, withAll: boolean) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    call<{ periods: Period[] }>("periods").then((body) => { setPeriods(body.periods); if (!withAll) setPeriodId((c) => c ?? body.periods[0]?.id ?? null); }).catch(fail);
  }, [call, fail, ready, withAll]);
  return { periods, periodId, setPeriodId };
}

/* ------------------------------------------------------- advance and loans */

type OutRow = { code: number; name: string; advanceGiven: number; advanceRecovered: number; advanceBalance: number; loanTaken: number; loanDeducted: number; loanBalance: number; total: number };
type Loan = { id: number; code: number; name: string; date: string; principal: number; emi: number; startYear: number; startMonth: number; note: string; active: boolean; deducted: number; balance: number };
type LoanForm = { id: number | null; code: number | null; date: string; principal: string; emi: string; startYear: number; startMonth: number; note: string; active: boolean };

export function PayrollOutstanding({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("outstanding", menuShortName, title, onClose);
  const [rows, setRows] = useState<OutRow[]>([]);
  const [company, setCompany] = useState("");
  const [loans, setLoans] = useState<Loan[]>([]);
  const [staff, setStaff] = useState<{ code: number; name: string }[]>([]);
  const [form, setForm] = useState<LoanForm | null>(null);

  const refresh = () => Promise.all([
    call<{ rows: OutRow[]; company: string }>("report").then((b) => { setRows(b.rows); setCompany(b.company); }),
    call<{ loans: Loan[] }>("loans").then((b) => setLoans(b.loans)),
  ]);
  useEffect(() => {
    if (!ready) return;
    Promise.all([
      call<{ rows: OutRow[]; company: string }>("report").then((b) => { setRows(b.rows); setCompany(b.company); }),
      call<{ loans: Loan[] }>("loans").then((b) => setLoans(b.loans)),
      call<{ staff: { code: number; name: string }[] }>("staff").then((b) => setStaff(b.staff)),
    ]).catch(fail);
  }, [call, fail, ready]);

  const now = new Date();
  const blank = (): LoanForm => ({ id: null, code: null, date: now.toISOString().slice(0, 10), principal: "", emi: "", startYear: now.getFullYear(), startMonth: now.getMonth() + 1, note: "", active: true });
  const save = async () => {
    if (!form) return;
    try {
      await call("saveLoan", { id: form.id, code: form.code, date: form.date, principal: Number(form.principal), emi: Number(form.emi), startYear: form.startYear, startMonth: form.startMonth, note: form.note, active: form.active });
      await refresh(); setForm(null);
    } catch (reason) { await fail(reason); }
  };
  const patch = (change: Partial<LoanForm>) => setForm((c) => (c ? { ...c, ...change } : c));
  const shown = useMemo(() => rows.filter((r) => r.advanceGiven || r.advanceRecovered || r.loanTaken), [rows]);

  const exportRows = () => exportSheet(company, "Advance and Loan Outstanding",
    [col("Staff", "text", "left", 200), col("Advance given", "number", "right", 100), col("Recovered", "number", "right", 100), col("Advance balance", "number", "right", 110), col("Loans", "number", "right", 100), col("Instalments taken", "number", "right", 110), col("Loan balance", "number", "right", 100), col("Total owed", "number", "right", 100)],
    shown.map((r) => [r.name, r.advanceGiven, r.advanceRecovered, r.advanceBalance, r.loanTaken, r.loanDeducted, r.loanBalance, r.total]),
    [null, sumOf(shown, (r) => r.advanceGiven), sumOf(shown, (r) => r.advanceRecovered), sumOf(shown, (r) => r.advanceBalance), sumOf(shown, (r) => r.loanTaken), sumOf(shown, (r) => r.loanDeducted), sumOf(shown, (r) => r.loanBalance), sumOf(shown, (r) => r.total)]);

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <p className="pr-note">Owed by staff: advances given less recovered (from the Salary advance and Recovery tags on vouchers), and loans less the instalments taken from salary slips.</p>
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th className="pr-num">Advance given</th><th className="pr-num">Recovered</th><th className="pr-num">Advance balance</th><th className="pr-num">Loans</th><th className="pr-num">Instalments taken</th><th className="pr-num">Loan balance</th><th className="pr-num">Total owed</th></tr></thead>
          <tbody>
            {shown.map((r) => <tr key={r.code}><td>{r.name}</td><td className="pr-num">{money(r.advanceGiven)}</td><td className="pr-num">{money(r.advanceRecovered)}</td><td className="pr-num">{money(r.advanceBalance)}</td><td className="pr-num">{money(r.loanTaken)}</td><td className="pr-num">{money(r.loanDeducted)}</td><td className="pr-num">{money(r.loanBalance)}</td><td className="pr-num"><b>{money(r.total)}</b></td></tr>)}
            {shown.length === 0 && <tr><td colSpan={8} className="pr-note">No advances or loans yet.</td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr><td>Total</td>{[(r: OutRow) => r.advanceGiven, (r: OutRow) => r.advanceRecovered, (r: OutRow) => r.advanceBalance, (r: OutRow) => r.loanTaken, (r: OutRow) => r.loanDeducted, (r: OutRow) => r.loanBalance, (r: OutRow) => r.total].map((p, i) => <td key={i} className="pr-num">{money(sumOf(shown, p))}</td>)}</tr></tfoot>}
        </table>
      </div>

      <h3 className="pr-head">Loans</h3>
      <table className="pr-table">
        <thead><tr><th>Staff</th><th>Date</th><th className="pr-num">Loan</th><th className="pr-num">Instalment</th><th>From</th><th className="pr-num">Taken</th><th className="pr-num">Balance</th><th>Note</th><th /></tr></thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} className={l.active ? "" : "pr-off"}><td>{l.name}</td><td>{l.date}</td><td className="pr-num">{money(l.principal)}</td><td className="pr-num">{money(l.emi)}</td><td>{MONTHS[l.startMonth - 1]} {l.startYear}</td>
              <td className="pr-num">{money(l.deducted)}</td><td className="pr-num">{money(l.balance)}</td><td>{l.note}</td>
              <td><button type="button" onClick={() => setForm({ id: l.id, code: l.code, date: l.date, principal: String(l.principal), emi: String(l.emi), startYear: l.startYear, startMonth: l.startMonth, note: l.note, active: l.active })}>Edit</button></td></tr>
          ))}
          {loans.length === 0 && <tr><td colSpan={9} className="pr-note">No loans.</td></tr>}
        </tbody>
      </table>
      {form && (
        <fieldset className="pr-edit"><legend>{form.id ? "Edit loan" : "New loan"}</legend>
          <label className="pr-field"><span>Staff</span><select value={form.code ?? ""} onChange={(event) => patch({ code: Number(event.target.value) })}>
            <option value="">Choose…</option>{staff.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
          <label className="pr-field"><span>Loan date</span><input type="date" value={form.date} onChange={(event) => patch({ date: event.target.value })} /></label>
          <label className="pr-field"><span>Loan amount</span><input type="number" min={0} step="0.01" value={form.principal} onChange={(event) => patch({ principal: event.target.value })} /></label>
          <label className="pr-field"><span>Monthly instalment</span><input type="number" min={0} step="0.01" value={form.emi} onChange={(event) => patch({ emi: event.target.value })} /></label>
          <label className="pr-field"><span>First instalment in</span>
            <select value={form.startMonth} onChange={(event) => patch({ startMonth: Number(event.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <input type="number" min={2000} max={2100} value={form.startYear} onChange={(event) => patch({ startYear: Number(event.target.value) })} style={{ width: 80 }} /></label>
          <label className="pr-field"><span>Note</span><input maxLength={100} value={form.note} onChange={(event) => patch({ note: event.target.value })} /></label>
          <label className="pr-check"><input type="checkbox" checked={form.active} onChange={(event) => patch({ active: event.target.checked })} /> Active (instalments are taken while it is on)</label>
          <div className="pr-actions"><button type="button" className="pr-primary" onClick={() => void save()}>Save</button><button type="button" onClick={() => setForm(null)}>Cancel</button></div>
        </fieldset>
      )}
      <div className="pr-actions">
        <button type="button" onClick={() => setForm(blank())}>Add loan</button>
        <button type="button" disabled={shown.length === 0 || !rights.export} onClick={exportRows}>Export Excel</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- bank sheet */

type BankRow = { code: number; name: string; bankName: string; bankAcNo: string; bankIfsc: string; net: number; paid: number; toPay: number };

export function PayrollBankSheet({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("banksheet", menuShortName, title, onClose);
  const { periods, periodId, setPeriodId } = usePeriodList(call, fail, ready, false);
  const [rows, setRows] = useState<BankRow[]>([]);
  const [company, setCompany] = useState("");
  const [onlyDue, setOnlyDue] = useState(true);
  const period = periods.find((p) => p.id === periodId);

  useEffect(() => {
    if (periodId === null) return;
    let live = true;
    call<{ rows: BankRow[]; company: string }>("sheet", { periodId }).then((b) => { if (live) { setRows(b.rows); setCompany(b.company); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, periodId]);

  const shown = rows.filter((r) => !onlyDue || r.toPay > 0);
  const missing = shown.filter((r) => !r.bankAcNo || !r.bankIfsc);
  const exportXlsx = () => period && exportSheet(company, `Bank Transfer ${periodName(period)}`,
    [col("Staff", "text", "left", 200), col("Bank", "text", "left", 140), col("Account no", "text", "left", 140), col("IFSC", "text", "left", 100), col("Net payable", "number", "right", 100), col("Already paid", "number", "right", 100), col("To transfer", "number", "right", 100)],
    shown.map((r) => [r.name, r.bankName, r.bankAcNo, r.bankIfsc, r.net, r.paid, r.toPay]), [null, null, null, null, sumOf(shown, (r) => r.net), sumOf(shown, (r) => r.paid), sumOf(shown, (r) => r.toPay)]);
  const exportCsv = () => {
    if (!period) return;
    const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Name", "Account no", "IFSC", "Amount"].map(quote).join(","), ...shown.map((r) => [r.name, r.bankAcNo, r.bankIfsc, r.toPay.toFixed(2)].map(quote).join(","))];
    download(lines.join("\r\n"), `Bank Transfer ${periodName(period)}.csv`, "text/csv");
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <div className="pr-bar">
        <label className="pr-field"><span>Pay period</span><select value={periodId ?? ""} onChange={(event) => setPeriodId(Number(event.target.value))}>
          {periods.map((p) => <option key={p.id} value={p.id}>{periodName(p)}</option>)}</select></label>
        <label className="pr-check"><input type="checkbox" checked={onlyDue} onChange={(event) => setOnlyDue(event.target.checked)} /> Only what is still to be paid (net less payouts tagged)</label>
      </div>
      {missing.length > 0 && <p className="pr-warn">No bank account or IFSC for: {missing.map((r) => r.name).join(", ")}. Add them in Staff Payroll Profile.</p>}
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th>Bank</th><th>Account no</th><th>IFSC</th><th className="pr-num">Net payable</th><th className="pr-num">Already paid</th><th className="pr-num">To transfer</th></tr></thead>
          <tbody>
            {shown.map((r) => <tr key={r.code}><td>{r.name}</td><td>{r.bankName}</td><td>{r.bankAcNo}</td><td>{r.bankIfsc}</td><td className="pr-num">{money(r.net)}</td><td className="pr-num">{money(r.paid)}</td><td className="pr-num"><b>{money(r.toPay)}</b></td></tr>)}
            {shown.length === 0 && <tr><td colSpan={7} className="pr-note">{rows.length === 0 ? "No slips for this period." : "Everyone is already paid."}</td></tr>}
          </tbody>
          {shown.length > 0 && <tfoot><tr><td colSpan={4}>Total ({shown.length})</td><td className="pr-num">{money(sumOf(shown, (r) => r.net))}</td><td className="pr-num">{money(sumOf(shown, (r) => r.paid))}</td><td className="pr-num">{money(sumOf(shown, (r) => r.toPay))}</td></tr></tfoot>}
        </table>
      </div>
      <div className="pr-actions">
        <button type="button" disabled={shown.length === 0 || !rights.export} onClick={exportXlsx}>Export Excel</button>
        <button type="button" disabled={shown.length === 0 || !rights.export} onClick={exportCsv}>Export CSV for bank</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------- PF / ESI / PT statement */

type StatRow = { code: number; name: string; pfNo: string; uanNo: string; esiNo: string; pfWage: number; pfEmp: number; pfEr: number; esiWage: number; esiEmp: number; esiEr: number; pt: number };

export function PayrollStatutory({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("statutory", menuShortName, title, onClose);
  const { periods, periodId, setPeriodId } = usePeriodList(call, fail, ready, true);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [company, setCompany] = useState("");

  useEffect(() => {
    if (!ready) return;
    let live = true;
    call<{ rows: StatRow[]; company: string }>("report", { periodId }).then((b) => { if (live) { setRows(b.rows); setCompany(b.company); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, ready, periodId]);

  const label = periodId === null ? "Year to date" : periodName(periods.find((p) => p.id === periodId) ?? { year: 0, month: 1 });
  const keys: ((r: StatRow) => number)[] = [(r) => r.pfWage, (r) => r.pfEmp, (r) => r.pfEr, (r) => r.esiWage, (r) => r.esiEmp, (r) => r.esiEr, (r) => r.pt];
  const exportXlsx = () => exportSheet(company, `PF ESI PT ${label}`,
    [col("Staff", "text", "left", 180), col("UAN", "text", "left", 110), col("PF no", "text", "left", 110), col("ESI no", "text", "left", 110), col("PF wage", "number", "right", 90), col("PF employee", "number", "right", 90), col("PF employer", "number", "right", 90), col("ESI wage", "number", "right", 90), col("ESI employee", "number", "right", 90), col("ESI employer", "number", "right", 90), col("Prof. tax", "number", "right", 80)],
    rows.map((r) => [r.name, r.uanNo, r.pfNo, r.esiNo, r.pfWage, r.pfEmp, r.pfEr, r.esiWage, r.esiEmp, r.esiEr, r.pt]), [null, null, null, null, ...keys.map((k) => sumOf(rows, k))]);

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <div className="pr-bar">
        <label className="pr-field"><span>Pay period</span><select value={periodId ?? ""} onChange={(event) => setPeriodId(event.target.value === "" ? null : Number(event.target.value))}>
          <option value="">Year to date</option>{periods.map((p) => <option key={p.id} value={p.id}>{periodName(p)}</option>)}</select></label>
        <button type="button" disabled={rows.length === 0 || !rights.export} onClick={exportXlsx}>Export Excel</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
      <p className="pr-note">Contributions as worked into the slips. The PF wage is the PF-counting earnings up to the ceiling. Staff with nothing deducted are left out.</p>
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th>UAN</th><th>PF no</th><th>ESI no</th><th className="pr-num">PF wage</th><th className="pr-num">PF employee</th><th className="pr-num">PF employer</th><th className="pr-num">ESI wage</th><th className="pr-num">ESI employee</th><th className="pr-num">ESI employer</th><th className="pr-num">Prof. tax</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.code}><td>{r.name}</td><td>{r.uanNo}</td><td>{r.pfNo}</td><td>{r.esiNo}</td>{keys.map((k, i) => <td key={i} className="pr-num">{money(k(r))}</td>)}</tr>)}
            {rows.length === 0 && <tr><td colSpan={11} className="pr-note">No PF, ESI or professional tax was deducted in this period.</td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={4}>Total ({rows.length})</td>{keys.map((k, i) => <td key={i} className="pr-num">{money(sumOf(rows, k))}</td>)}</tr></tfoot>}
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- untagged vouchers */

type UntaggedLine = { code: number; name: string; ledId: number; date: string; docNo: string; book: string; side: "Dr" | "Cr"; amount: number; untagged: number; over: boolean; narration: string };
type Orphan = { code: number; name: string; tagId: number; periodLabel: string; amount: number };

export function PayrollUntagged({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("untagged", menuShortName, title, onClose);
  const [lines, setLines] = useState<UntaggedLine[]>([]);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [company, setCompany] = useState("");

  useEffect(() => {
    if (!ready) return;
    call<{ lines: UntaggedLine[]; orphans: Orphan[]; company: string }>("report").then((b) => { setLines(b.lines); setOrphans(b.orphans); setCompany(b.company); }).catch(fail);
  }, [call, fail, ready]);

  const exportXlsx = () => exportSheet(company, "Untagged Staff Vouchers",
    [col("Staff", "text", "left", 180), col("Date", "text", "left", 80), col("Voucher", "text", "left", 110), col("Book", "text", "left", 70), col("Dr/Cr", "text", "left", 50), col("Amount", "number", "right", 100), col("Untagged", "number", "right", 100), col("Narration", "text", "left", 260)],
    lines.map((l) => [l.name, l.date, l.docNo, l.book, l.side, l.amount, l.untagged, l.over ? `TAGGED FOR MORE THAN THE LINE. ${l.narration}` : l.narration]), [null, null, null, null, null, sumOf(lines, (l) => l.amount), sumOf(lines, (l) => l.untagged), null]);

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <p className="pr-note">Voucher lines in the enrolled staff ledgers (open year) that are not fully tagged to a pay period. Tag them in Voucher Tagging so Pending Salary ties to the ledger.</p>
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th>Date</th><th>Voucher</th><th>Book</th><th>Dr/Cr</th><th className="pr-num">Amount</th><th className="pr-num">Untagged</th><th>Narration</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.code}-${l.ledId}`} className={l.over ? "pr-bad" : ""}><td>{l.name}</td><td>{l.date}</td><td>{l.docNo}</td><td>{l.book}</td><td>{l.side}</td><td className="pr-num">{money(l.amount)}</td>
                <td className="pr-num">{l.over ? "tagged too much" : money(l.untagged)}</td><td>{l.narration}</td></tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={8} className="pr-note">Every voucher line of the staff ledgers is tagged.</td></tr>}
          </tbody>
          {lines.length > 0 && <tfoot><tr><td colSpan={5}>Total ({lines.length} lines)</td><td className="pr-num">{money(sumOf(lines, (l) => l.amount))}</td><td className="pr-num">{money(sumOf(lines, (l) => l.untagged))}</td><td /></tr></tfoot>}
        </table>
      </div>
      {orphans.length > 0 && <p className="pr-warn">Tags on vouchers that no longer exist in Accounts: {orphans.map((o) => `${o.name} (${o.periodLabel}, ${money(o.amount)})`).join("; ")}. Remove them in Voucher Tagging.</p>}
      <div className="pr-actions">
        <button type="button" disabled={lines.length === 0 || !rights.export} onClick={exportXlsx}>Export Excel</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
    </div>
  );
}

