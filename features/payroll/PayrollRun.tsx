"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { messageBox } from "../ui/MessageBox";
import { download } from "../../lib/export/table";
import { xlsx } from "../../lib/export/xlsx";
import type { ExportColumn } from "../../lib/export/table";
import { attendanceFromSheet, readSheet } from "../../lib/payroll/sheetRead";
import { money, usePayroll, type Props, type Screen } from "./Payroll";

/**
 * PAYROLL (Phase 2): Attendance, Process Payroll, Salary Register and Payslip. A pay period is a calendar month; it goes Open -> Processed -> Locked.
 * Attendance may be typed or imported from an Excel / CSV file (a device's export); a staff member with no days entered is paid the month's default.
 */

type Period = { id: number; year: number; month: number; from: string; to: string; days: number; status: "O" | "P" | "L"; slips: number; net: number };
type Line = { name: string; type: "E" | "D"; seq: number; amount: number };
type Slip = {
  slipId: number; code: number; name: string; designation: string; department: string; joinDate: string; bankName: string; bankAcNo: string; bankIfsc: string;
  panNo: string; pfNo: string; uanNo: string; esiNo: string; paidDays: number; monthDays: number; gross: number; totalDed: number; net: number; pfEr: number; esiEr: number; lines: Line[];
};
type AttendanceRow = { code: number; name: string; designation: string; defaultDays: number; paidDays: number | null; remark: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUS = { O: "Open", P: "Processed", L: "Locked" } as const;
const periodName = (p: Period) => `${MONTHS[p.month - 1]} ${p.year}`;

/** The month picker every payroll screen starts with: pick a period, or open a month that has none yet. */
function usePeriods(call: <T>(action: string, data?: unknown) => Promise<T>, fail: (reason: unknown) => unknown, ready: boolean, canOpen: boolean) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    call<{ periods: Period[] }>("periods").then((body) => { setPeriods(body.periods); setPeriodId((current) => current ?? body.periods[0]?.id ?? null); }).catch(fail);
  }, [call, fail, ready]);
  const open = async (year: number, month: number) => {
    try {
      const body = await call<{ periods: Period[] }>("open", { year, month });
      setPeriods(body.periods);
      setPeriodId(body.periods.find((p) => p.year === year && p.month === month)?.id ?? null);
    } catch (reason) { await fail(reason); }
  };
  const refresh = (updated: Period) => setPeriods((list) => list.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  const period = periods.find((p) => p.id === periodId) ?? null;
  return { periods, period, periodId, setPeriodId, open, refresh, canOpen };
}

function PeriodBar({ state }: { state: ReturnType<typeof usePeriods> }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  return (
    <div className="pr-bar">
      <label className="pr-field"><span>Pay period</span>
        <select value={state.periodId ?? ""} onChange={(event) => state.setPeriodId(Number(event.target.value))}>
          {state.periods.length === 0 && <option value="">No period yet</option>}
          {state.periods.map((p) => <option key={p.id} value={p.id}>{periodName(p)} - {STATUS[p.status]}</option>)}
        </select></label>
      {state.canOpen && (
        <>
          <select aria-label="Month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select>
          <input aria-label="Year" type="number" min={2000} max={2100} value={year} onChange={(event) => setYear(Number(event.target.value))} style={{ width: 80 }} />
          <button type="button" onClick={() => void state.open(year, month)}>Open month</button>
        </>
      )}
    </div>
  );
}

const col = (caption: string, kind: ExportColumn["kind"], align: ExportColumn["align"], width: number): ExportColumn => ({ caption, kind, decimals: kind === "number" ? 2 : 0, align, width });

/* ------------------------------------------------------------- attendance */

export function PayrollAttendance({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("attendance", menuShortName, title, onClose);
  const state = usePeriods(call, fail, ready, true);
  const { periodId } = state;
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [edited, setEdited] = useState<Record<number, { paid: string; remark: string }>>({});
  const [monthDays, setMonthDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (periodId === null) return;
    call<{ rows: AttendanceRow[]; monthDays: number }>("get", { periodId }).then((body) => {
      setRows(body.rows); setMonthDays(body.monthDays);
      setEdited(Object.fromEntries(body.rows.map((r) => [r.code, { paid: r.paidDays === null ? "" : String(r.paidDays), remark: r.remark }])));
    }).catch(fail);
  }, [call, fail, periodId]);

  const locked = state.period?.status === "L";
  const set = (code: number, change: Partial<{ paid: string; remark: string }>) => setEdited((current) => ({ ...current, [code]: { ...(current[code] ?? { paid: "", remark: "" }), ...change } }));

  const save = async () => {
    if (periodId === null || busy) return;
    setBusy(true);
    try {
      const body = await call<{ rows: AttendanceRow[] }>("save", { periodId, rows: rows.map((r) => ({ code: r.code, paidDays: edited[r.code]?.paid ?? "", remark: edited[r.code]?.remark ?? "" })) });
      setRows(body.rows);
      await messageBox.alert("Attendance saved.", title);
    } catch (reason) { await fail(reason); } finally { setBusy(false); }
  };

  const importFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      const found = attendanceFromSheet(await readSheet(chosen));
      const byCode = new Map(rows.map((r) => [r.code, r])), byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r]));
      let matched = 0;
      const unmatched: string[] = [];
      const next = { ...edited };
      for (const item of found) {
        const target = (item.code !== null ? byCode.get(item.code) : undefined) ?? byName.get(item.name.trim().toLowerCase());
        if (!target) { unmatched.push(item.code !== null ? `#${item.code}` : item.name || "(blank)"); continue; }
        if (item.paidDays < 0 || item.paidDays > 31) { unmatched.push(`${target.name} (${item.paidDays} days)`); continue; }
        next[target.code] = { paid: String(item.paidDays), remark: item.remark || next[target.code]?.remark || "" };
        matched += 1;
      }
      setEdited(next);
      await messageBox.alert(`${matched} staff filled from the file. Check the days, then press Save.${unmatched.length ? `\n\nNot matched or not valid (${unmatched.length}): ${unmatched.slice(0, 15).join(", ")}${unmatched.length > 15 ? "…" : ""}` : ""}`, "Import attendance", unmatched.length ? "warning" : "info");
    } catch (reason) { await fail(reason); } finally { if (file.current) file.current.value = ""; }
  };

  const exportSheet = () => {
    if (!state.period) return;
    const bytes = xlsx({
      company: "", title: `Attendance ${periodName(state.period)}`, subtitle: [],
      columns: [col("Code", "number", "right", 70), col("Name", "text", "left", 220), col("Paid Days", "number", "right", 90), col("Remark", "text", "left", 200)],
      rows: rows.map((r) => [r.code, r.name, Number(edited[r.code]?.paid || r.defaultDays), edited[r.code]?.remark ?? ""]),
    }, "Attendance");
    download(bytes, `Attendance ${periodName(state.period)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <PeriodBar state={state} />
      <p className="pr-note">Paid days = days worked + paid leave and holidays (month has {monthDays}). Leave a box empty to pay the default shown in grey.</p>
      <table className="pr-table">
        <thead><tr><th>Staff</th><th>Designation</th><th className="pr-num">Default</th><th>Paid days</th><th>Remark</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td>{r.name} <small>#{r.code}</small></td><td>{r.designation}</td><td className="pr-num">{r.defaultDays}</td>
              <td><input type="number" min={0} max={31} step="0.5" disabled={locked} placeholder={String(r.defaultDays)} value={edited[r.code]?.paid ?? ""} onChange={(event) => set(r.code, { paid: event.target.value })} style={{ width: 80 }} /></td>
              <td><input maxLength={100} disabled={locked} value={edited[r.code]?.remark ?? ""} onChange={(event) => set(r.code, { remark: event.target.value })} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="pr-note">No staff are paid in this period (enrol staff with a joining date first).</td></tr>}
        </tbody>
      </table>
      <div className="pr-actions">
        <button type="button" className="pr-primary" disabled={busy || locked || periodId === null} onClick={() => void save()}>Save</button>
        <button type="button" disabled={locked || rows.length === 0} onClick={() => file.current?.click()}>Import Excel / CSV</button>
        <button type="button" disabled={rows.length === 0 || !rights.export} onClick={exportSheet}>Export sheet</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
        <input ref={file} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
      </div>
      {locked && <p className="pr-note">This period is locked. Unlock it in Process Payroll to change attendance.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- process */

type Skipped = { code: number; name: string; reason: string };

function useSlips(call: <T>(action: string, data?: unknown) => Promise<T>, fail: (reason: unknown) => unknown, periodId: number | null, status: string | undefined) {
  const [slips, setSlips] = useState<Slip[]>([]);
  const [company, setCompany] = useState("");
  // Loads when the period changes or its status does (processing / locking).
  useEffect(() => {
    if (periodId === null) return;
    let live = true;
    call<{ slips: Slip[]; companyName: string }>("slips", { periodId }).then((body) => { if (live) { setSlips(body.slips); setCompany(body.companyName); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, periodId, status]);
  return { slips: periodId === null ? [] : slips, company, set: setSlips };
}

export function PayrollProcess({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("process", menuShortName, title, onClose);
  const state = usePeriods(call, fail, ready, true);
  const { slips, set } = useSlips(call, fail, state.periodId, state.period?.status);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [busy, setBusy] = useState(false);
  const period = state.period;
  const totals = useMemo(() => slips.reduce((t, s) => ({ gross: t.gross + s.gross, ded: t.ded + s.totalDed, net: t.net + s.net }), { gross: 0, ded: 0, net: 0 }), [slips]);

  const act = async (action: "process" | "lock" | "unlock") => {
    if (!period || busy) return;
    if (action === "process" && period.status === "P" && !(await messageBox.confirm("This period is already processed. Process again and replace its slips?", title))) return;
    if (action === "lock" && !(await messageBox.confirm("Lock this period? Attendance and processing are closed until it is unlocked.", title))) return;
    setBusy(true);
    try {
      const body = await call<{ slips?: Slip[]; skipped?: Skipped[]; period?: Period }>(action, { periodId: period.id });
      if (body.slips) { set(body.slips); setSkipped(body.skipped ?? []); }
      const list = await call<{ periods: Period[] }>("periods");
      list.periods.filter((p) => p.id === period.id).forEach((p) => state.refresh(p));
    } catch (reason) { await fail(reason); } finally { setBusy(false); }
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <PeriodBar state={state} />
      <div className="pr-actions">
        <button type="button" className="pr-primary" disabled={busy || !period || period.status === "L"} onClick={() => void act("process")}>Process payroll</button>
        <button type="button" disabled={busy || period?.status !== "P"} onClick={() => void act("lock")}>Lock period</button>
        <button type="button" disabled={busy || period?.status !== "L"} onClick={() => void act("unlock")}>Unlock</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
      <div className="pr-tiles">
        <div><small>Slips</small><b>{slips.length}</b></div><div><small>Gross</small><b>{money(totals.gross)}</b></div>
        <div><small>Deductions</small><b>{money(totals.ded)}</b></div><div><small>Net payable</small><b>{money(totals.net)}</b></div>
      </div>
      {skipped.length > 0 && <p className="pr-warn">Not processed: {skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}</p>}
      <table className="pr-table">
        <thead><tr><th>Staff</th><th className="pr-num">Days</th><th className="pr-num">Gross</th><th className="pr-num">Deductions</th><th className="pr-num">Net payable</th></tr></thead>
        <tbody>
          {slips.map((s) => <tr key={s.slipId}><td>{s.name} <small>#{s.code}</small></td><td className="pr-num">{s.paidDays}/{s.monthDays}</td><td className="pr-num">{money(s.gross)}</td><td className="pr-num">{money(s.totalDed)}</td><td className="pr-num">{money(s.net)}</td></tr>)}
          {slips.length === 0 && <tr><td colSpan={5} className="pr-note">{period ? "No slips yet. Enter attendance if needed, then press Process payroll." : "Open a month to begin."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- register */

export function PayrollRegister({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("register", menuShortName, title, onClose);
  const state = usePeriods(call, fail, ready, false);
  const { slips, company } = useSlips(call, fail, state.periodId, state.period?.status);

  // One column for each pay head that appears on any slip, earnings then deductions, each in its structure's order.
  const heads = useMemo(() => {
    const seen = new Map<string, Line>();
    for (const s of slips) for (const l of s.lines) if (!seen.has(`${l.type}:${l.name}`)) seen.set(`${l.type}:${l.name}`, l);
    const all = [...seen.values()];
    return { earn: all.filter((l) => l.type === "E").sort((a, b) => a.seq - b.seq), ded: all.filter((l) => l.type === "D").sort((a, b) => a.seq - b.seq) };
  }, [slips]);
  const amountOf = (s: Slip, head: Line) => s.lines.find((l) => l.type === head.type && l.name === head.name)?.amount ?? 0;
  const sum = (pick: (s: Slip) => number) => slips.reduce((t, s) => t + pick(s), 0);

  const exportXlsx = () => {
    if (!state.period) return;
    const columns = [col("Staff", "text", "left", 200), col("Days", "number", "right", 60), ...heads.earn.map((h) => col(h.name, "number", "right", 90)), col("Gross", "number", "right", 100),
      ...heads.ded.map((h) => col(h.name, "number", "right", 90)), col("Total Ded.", "number", "right", 100), col("Net Payable", "number", "right", 110)];
    const rows = slips.map((s) => [s.name, s.paidDays, ...heads.earn.map((h) => amountOf(s, h)), s.gross, ...heads.ded.map((h) => amountOf(s, h)), s.totalDed, s.net]);
    const totals = [null, null, ...heads.earn.map((h) => sum((s) => amountOf(s, h))), sum((s) => s.gross), ...heads.ded.map((h) => sum((s) => amountOf(s, h))), sum((s) => s.totalDed), sum((s) => s.net)];
    download(xlsx({ company, title: `Salary Register ${periodName(state.period)}`, subtitle: [], columns, rows, totals }, "Salary Register"), `Salary Register ${periodName(state.period)}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <PeriodBar state={state} />
      <div className="pr-actions"><button type="button" disabled={slips.length === 0 || !rights.export} onClick={exportXlsx}>Export Excel</button><button type="button" onClick={() => void quit()}>Quit</button></div>
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th className="pr-num">Days</th>{heads.earn.map((h) => <th key={`E${h.name}`} className="pr-num">{h.name}</th>)}<th className="pr-num">Gross</th>
            {heads.ded.map((h) => <th key={`D${h.name}`} className="pr-num">{h.name}</th>)}<th className="pr-num">Total Ded.</th><th className="pr-num">Net Payable</th></tr></thead>
          <tbody>
            {slips.map((s) => (
              <tr key={s.slipId}><td>{s.name}</td><td className="pr-num">{s.paidDays}</td>{heads.earn.map((h) => <td key={`E${h.name}`} className="pr-num">{money(amountOf(s, h))}</td>)}<td className="pr-num">{money(s.gross)}</td>
                {heads.ded.map((h) => <td key={`D${h.name}`} className="pr-num">{money(amountOf(s, h))}</td>)}<td className="pr-num">{money(s.totalDed)}</td><td className="pr-num"><b>{money(s.net)}</b></td></tr>
            ))}
            {slips.length === 0 && <tr><td colSpan={4} className="pr-note">No slips for this period. Process payroll first.</td></tr>}
          </tbody>
          {slips.length > 0 && (
            <tfoot><tr><td>Total ({slips.length})</td><td />{heads.earn.map((h) => <td key={`E${h.name}`} className="pr-num">{money(sum((s) => amountOf(s, h)))}</td>)}<td className="pr-num">{money(sum((s) => s.gross))}</td>
              {heads.ded.map((h) => <td key={`D${h.name}`} className="pr-num">{money(sum((s) => amountOf(s, h)))}</td>)}<td className="pr-num">{money(sum((s) => s.totalDed))}</td><td className="pr-num">{money(sum((s) => s.net))}</td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- payslip */

const esc = (value: string | number) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function slipHtml(s: Slip, company: string, period: Period) {
  const earn = s.lines.filter((l) => l.type === "E"), ded = s.lines.filter((l) => l.type === "D");
  const rows = Math.max(earn.length, ded.length);
  const body = Array.from({ length: rows }, (_, i) => `<tr><td>${esc(earn[i]?.name ?? "")}</td><td class="n">${earn[i] ? money(earn[i].amount) : ""}</td><td>${esc(ded[i]?.name ?? "")}</td><td class="n">${ded[i] ? money(ded[i].amount) : ""}</td></tr>`).join("");
  const info = (label: string, value: string) => (value ? `<div><span>${label}</span> ${esc(value)}</div>` : "");
  return `<section class="slip"><h2>${esc(company)}</h2><h3>Payslip for ${esc(periodName(period))}</h3>
    <div class="info">${info("Name", `${s.name} (#${s.code})`)}${info("Designation", s.designation)}${info("Department", s.department)}${info("Joined", s.joinDate)}
    ${info("Paid days", `${s.paidDays} of ${s.monthDays}`)}${info("PAN", s.panNo)}${info("PF no", s.pfNo)}${info("UAN", s.uanNo)}${info("ESI no", s.esiNo)}${info("Bank", [s.bankName, s.bankAcNo, s.bankIfsc].filter(Boolean).join(" · "))}</div>
    <table><thead><tr><th>Earnings</th><th class="n">Amount</th><th>Deductions</th><th class="n">Amount</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td>Gross</td><td class="n">${money(s.gross)}</td><td>Total deductions</td><td class="n">${money(s.totalDed)}</td></tr><tr class="net"><td colspan="3">Net payable</td><td class="n">${money(s.net)}</td></tr></tfoot></table>
    <p class="sign">Computer generated payslip</p></section>`;
}

export function PayrollPayslip({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("payslip", menuShortName, title, onClose);
  const state = usePeriods(call, fail, ready, false);
  const { slips, company } = useSlips(call, fail, state.periodId, state.period?.status);
  const [pick, setPick] = useState<number | "all">("all");
  const chosen = pick === "all" ? slips : slips.filter((s) => s.code === pick);

  const print = () => {
    if (!state.period || chosen.length === 0) return;
    const win = window.open("", "_blank");
    if (!win) { void messageBox.alert("The browser blocked the print window. Allow pop-ups for this site.", title, "warning"); return; }
    const css = "body{font:13px Arial,sans-serif;margin:0}.slip{width:720px;margin:20px auto;border:1px solid #333;padding:16px;page-break-after:always}h2,h3{margin:2px 0;text-align:center}.info{display:grid;grid-template-columns:1fr 1fr;gap:3px 16px;margin:10px 0}.info span{color:#555;display:inline-block;min-width:90px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:4px 6px;text-align:left}.n{text-align:right}tfoot td{font-weight:bold}.net td{font-size:15px}.sign{text-align:center;color:#666;margin:10px 0 0}";
    win.document.write(`<!doctype html><title>Payslip ${esc(periodName(state.period))}</title><style>${css}</style>${chosen.map((s) => slipHtml(s, company, state.period as Period)).join("")}`);
    win.document.close(); win.focus(); win.print();
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <PeriodBar state={state} />
      <div className="pr-bar">
        <label className="pr-field"><span>Staff</span>
          <select value={pick} onChange={(event) => setPick(event.target.value === "all" ? "all" : Number(event.target.value))}>
            <option value="all">All staff ({slips.length})</option>{slips.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select></label>
        <button type="button" className="pr-primary" disabled={chosen.length === 0 || !rights.print} onClick={print}>Print payslip{chosen.length > 1 ? "s" : ""}</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
      {chosen.length === 0 && <p className="pr-note">No slips for this period. Process payroll first.</p>}
      {chosen.slice(0, 3).map((s) => (
        <div key={s.slipId} className="pr-slip" dangerouslySetInnerHTML={{ __html: state.period ? slipHtml(s, company, state.period) : "" }} />
      ))}
      {chosen.length > 3 && <p className="pr-note">Preview shows the first 3 of {chosen.length}; Print prints all of them.</p>}
    </div>
  );
}

export type { Screen };
