"use client";

import { useEffect, useMemo, useState } from "react";
import { messageBox } from "../ui/MessageBox";
import { download } from "../../lib/export/table";
import { xlsx } from "../../lib/export/xlsx";
import type { ExportColumn } from "../../lib/export/table";
import { money, usePayroll, type Props } from "./Payroll";

/**
 * PAYROLL (Phase 3): Voucher Tagging and Pending Salary. The vouchers are the ones already entered in Accounts (Cash / Bank / Journal); a tag only
 * says which pay period and kind of payment a voucher line is for. Nothing is written to the accounts.
 */

type Period = { id: number; year: number; month: number; status: "O" | "P" | "L" };
type TagType = "SAL" | "PAY" | "ADV" | "REC" | "OTH";
type Tag = { tagId: number; periodId: number; periodLabel: string; type: TagType; amount: number; note: string; by: string; at: string };
type Line = { ledId: number; date: string; docNo: string; book: string; bookNo: number; narration: string; side: "Dr" | "Cr"; amount: number; tagged: number; untagged: number; tags: Tag[]; over: boolean };
type Lines = { name: string; opening: number; lines: Line[]; orphans: (Tag & { ledId: number })[] };
type Staff = { code: number; name: string; active: boolean; opening: number };
type TypeInfo = Record<TagType, { label: string; side: "D" | "C" | "B" }>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodName = (p: Period) => `${MONTHS[p.month - 1]} ${p.year}`;
const drCr = (value: number) => `${money(Math.abs(value))} ${value < 0 ? "Cr" : "Dr"}`;
const col = (caption: string, kind: ExportColumn["kind"], align: ExportColumn["align"], width: number): ExportColumn => ({ caption, kind, decimals: kind === "number" ? 2 : 0, align, width });

/** The tag kind a voucher line most likely is: a debit in cash / bank is a payout, a credit in a journal is the salary, a credit in cash / bank a recovery. */
function suggestType(line: Line): TagType {
  const cashBank = line.bookNo === 4 || line.bookNo === 6;
  if (line.side === "Dr") return cashBank ? "PAY" : "OTH";
  return line.bookNo === 19 ? "SAL" : cashBank ? "REC" : "OTH";
}

/* ---------------------------------------------------------------- tagging */

export function PayrollTagging({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("tagging", menuShortName, title, onClose);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [types, setTypes] = useState<TypeInfo | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [code, setCode] = useState<number | null>(null);
  const [data, setData] = useState<Lines | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [form, setForm] = useState<{ ledId: number; periodId: number; type: TagType; amount: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      call<{ staff: Staff[]; types: TypeInfo }>("staff").then((body) => { setStaff(body.staff); setTypes(body.types); }),
      call<{ periods: Period[] }>("periods").then((body) => setPeriods(body.periods)),
    ]).catch(fail);
  }, [call, fail, ready]);

  useEffect(() => {
    if (code === null) return;
    let live = true;
    call<Lines>("lines", { code }).then((body) => { if (live) { setData(body); setForm(null); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, code]);

  const shown = useMemo(() => (data ? data.lines.filter((l) => !onlyOpen || l.untagged > 0 || l.over) : []), [data, onlyOpen]);
  const openLine = (line: Line) => {
    const open = periods.find((p) => p.status !== "L") ?? periods[0];
    if (!open) { void messageBox.alert("Open a pay period first (Attendance or Process Payroll).", title, "warning"); return; }
    setForm({ ledId: line.ledId, periodId: open.id, type: suggestType(line), amount: String(line.untagged), note: "" });
  };

  const send = async (action: "tag" | "untag", payload: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    try { setData(await call<Lines>(action, payload)); setForm(null); } catch (reason) { await fail(reason); } finally { setBusy(false); }
  };

  const formLine = form ? data?.lines.find((l) => l.ledId === form.ledId) : undefined;
  const allowed = (type: TagType) => !types || !formLine || types[type].side === "B" || types[type].side === (formLine.side === "Dr" ? "D" : "C");

  return (
    <div className="mp-screen te-screen pr-screen pr-staff" role="region" aria-label={title}>
      <div className="pr-left">
        <table className="pr-table">
          <thead><tr><th>Staff</th></tr></thead>
          <tbody>
            {staff.map((s) => <tr key={s.code} className={`${s.active ? "" : "pr-off"} ${code === s.code ? "pr-pick" : ""}`} onClick={() => setCode(s.code)}><td>{s.name} <small>#{s.code}</small></td></tr>)}
            {staff.length === 0 && <tr><td className="pr-note">No staff enrolled yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pr-right">
        {!data ? <p className="pr-note">Pick a staff member to see the vouchers in their ledger.</p> : (
          <>
            <h3 className="pr-head">{data.name} <small>Opening {drCr(data.opening)}</small></h3>
            <label className="pr-check"><input type="checkbox" checked={onlyOpen} onChange={(event) => setOnlyOpen(event.target.checked)} /> Show only lines not fully tagged</label>
            <div className="pr-scroll">
              <table className="pr-table">
                <thead><tr><th>Date</th><th>Voucher</th><th>Book</th><th>Dr/Cr</th><th className="pr-num">Amount</th><th className="pr-num">Untagged</th><th>Tagged to</th><th /></tr></thead>
                <tbody>
                  {shown.map((l) => (
                    <FragmentRows key={l.ledId}>
                      <tr className={l.over ? "pr-bad" : ""} title={l.narration}>
                        <td>{l.date}</td><td>{l.docNo}</td><td>{l.book}</td><td>{l.side}</td><td className="pr-num">{money(l.amount)}</td><td className="pr-num">{l.untagged > 0 ? money(l.untagged) : "—"}</td>
                        <td>
                          {l.tags.map((t) => (
                            <span key={t.tagId} className="pr-chip" title={`${t.by} ${t.at}${t.note ? ` · ${t.note}` : ""}`}>
                              {t.periodLabel} · {types?.[t.type].label ?? t.type} · {money(t.amount)}
                              <button type="button" aria-label="Remove tag" disabled={busy} onClick={() => void send("untag", { tagId: t.tagId, code })}>×</button>
                            </span>
                          ))}
                          {l.over && <span className="pr-warn">Voucher changed in Accounts: the tags are more than the line. Remove one.</span>}
                        </td>
                        <td>{l.untagged > 0 && <button type="button" onClick={() => openLine(l)}>Tag</button>}</td>
                      </tr>
                      {form?.ledId === l.ledId && (
                        <tr className="pr-formrow"><td colSpan={8}>
                          <div className="pr-bar">
                            <label className="pr-field"><span>Period</span><select value={form.periodId} onChange={(event) => setForm({ ...form, periodId: Number(event.target.value) })}>
                              {periods.map((p) => <option key={p.id} value={p.id} disabled={p.status === "L"}>{periodName(p)}{p.status === "L" ? " (locked)" : ""}</option>)}</select></label>
                            <label className="pr-field"><span>For</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as TagType })}>
                              {(Object.keys(types ?? {}) as TagType[]).filter(allowed).map((t) => <option key={t} value={t}>{types?.[t].label}</option>)}</select></label>
                            <label className="pr-field"><span>Amount</span><input type="number" min={0} step="0.01" max={l.untagged} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} style={{ width: 120 }} /></label>
                            <label className="pr-field"><span>Note</span><input maxLength={100} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
                            <button type="button" className="pr-primary" disabled={busy} onClick={() => void send("tag", { code, ledId: form.ledId, periodId: form.periodId, tagType: form.type, amount: Number(form.amount), note: form.note })}>Tag</button>
                            <button type="button" onClick={() => setForm(null)}>Cancel</button>
                          </div>
                        </td></tr>
                      )}
                    </FragmentRows>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={8} className="pr-note">{data.lines.length === 0 ? "No vouchers in this staff member's ledger for the open year." : "Every line is tagged."}</td></tr>}
                </tbody>
              </table>
            </div>
            {data.orphans.length > 0 && (
              <p className="pr-warn">Tags on vouchers that no longer exist in Accounts: {data.orphans.map((t) => (
                <span key={t.tagId} className="pr-chip">{t.periodLabel} · {money(t.amount)}<button type="button" aria-label="Remove tag" onClick={() => void send("untag", { tagId: t.tagId, code })}>×</button></span>))}</p>
            )}
          </>
        )}
        <div className="pr-actions"><button type="button" onClick={() => void quit()}>Quit</button></div>
      </div>
    </div>
  );
}

/** A group of table rows under one key (a fragment, named so the file reads plainly). */
function FragmentRows({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/* ---------------------------------------------------------------- pending */

type Recon = {
  code: number; name: string; opening: number; salary: number; paid: number; advance: number; recovered: number; other: number; pending: number;
  glPayable: number; untagged: number; untaggedLines: number; earned: number; notCredited: number; tie: boolean;
};

export function PayrollPending({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready, rights } = usePayroll("pending", menuShortName, title, onClose);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [rows, setRows] = useState<Recon[]>([]);
  const [company, setCompany] = useState("");

  useEffect(() => {
    if (!ready) return;
    call<{ periods: Period[] }>("periods").then((body) => setPeriods(body.periods)).catch(fail);
  }, [call, fail, ready]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    call<{ rows: Recon[]; company: string }>("recon", { periodId }).then((body) => { if (live) { setRows(body.rows); setCompany(body.company); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, ready, periodId]);

  const total = (pick: (r: Recon) => number) => rows.reduce((t, r) => t + pick(r), 0);
  const all = periodId === null;
  const exportXlsx = () => {
    const label = all ? "All periods" : periodName(periods.find((p) => p.id === periodId) as Period);
    const columns = [col("Staff", "text", "left", 200), col("Opening", "number", "right", 100), col("Salary credited", "number", "right", 110), col("Paid", "number", "right", 100), col("Advance", "number", "right", 100),
      col("Recovered", "number", "right", 100), col("Pending (tags)", "number", "right", 110), col("Ledger payable", "number", "right", 110), col("Untagged", "number", "right", 100), col("Slip net", "number", "right", 100), col("Not credited", "number", "right", 100)];
    download(xlsx({ company, title: `Pending Salary - ${label}`, subtitle: [], columns,
      rows: rows.map((r) => [r.name, r.opening, r.salary, r.paid, r.advance, r.recovered, r.pending, r.glPayable, r.untagged, r.earned, r.notCredited]),
      totals: [null, total((r) => r.opening), total((r) => r.salary), total((r) => r.paid), total((r) => r.advance), total((r) => r.recovered), total((r) => r.pending), total((r) => r.glPayable), total((r) => r.untagged), total((r) => r.earned), total((r) => r.notCredited)] }, "Pending Salary"),
      `Pending Salary ${label}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <div className="pr-bar">
        <label className="pr-field"><span>Pay period</span>
          <select value={periodId ?? ""} onChange={(event) => setPeriodId(event.target.value === "" ? null : Number(event.target.value))}>
            <option value="">All periods (whole year)</option>{periods.map((p) => <option key={p.id} value={p.id}>{periodName(p)}</option>)}</select></label>
        <button type="button" disabled={rows.length === 0 || !rights.export} onClick={exportXlsx}>Export Excel</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
      <p className="pr-note">
        Payable amounts: plus is owed to the staff member, minus is owed by them. <b>Pending (tags)</b> = opening + salary credited + recovered − paid − advance, from the tagged vouchers.
        <b> Ledger payable</b> is the closing of the staff ledger in Accounts. They match (✔) when no voucher line is left untagged.{!all && " With one period chosen, the opening, ledger and tie columns are for the whole year."}
      </p>
      <div className="pr-scroll">
        <table className="pr-table">
          <thead><tr><th>Staff</th><th className="pr-num">Opening</th><th className="pr-num">Salary credited</th><th className="pr-num">Paid</th><th className="pr-num">Advance</th><th className="pr-num">Recovered</th>
            <th className="pr-num">Pending (tags)</th><th className="pr-num">Ledger payable</th><th className="pr-num">Untagged</th><th className="pr-num">Slip net</th><th className="pr-num">Not credited</th><th>Tie</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}><td>{r.name}</td><td className="pr-num">{money(r.opening)}</td><td className="pr-num">{money(r.salary)}</td><td className="pr-num">{money(r.paid)}</td><td className="pr-num">{money(r.advance)}</td>
                <td className="pr-num">{money(r.recovered)}</td><td className="pr-num"><b>{money(r.pending)}</b></td><td className="pr-num">{money(r.glPayable)}</td>
                <td className={`pr-num ${r.tie ? "" : "pr-badtext"}`}>{money(r.untagged)}{r.untaggedLines > 0 && <small> ({r.untaggedLines})</small>}</td>
                <td className="pr-num">{money(r.earned)}</td><td className={`pr-num ${r.notCredited > 0.004 ? "pr-badtext" : ""}`}>{money(r.notCredited)}</td><td>{r.tie ? "✔" : "✖"}</td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} className="pr-note">No staff enrolled yet.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr><td>Total</td><td className="pr-num">{money(total((r) => r.opening))}</td><td className="pr-num">{money(total((r) => r.salary))}</td><td className="pr-num">{money(total((r) => r.paid))}</td><td className="pr-num">{money(total((r) => r.advance))}</td>
              <td className="pr-num">{money(total((r) => r.recovered))}</td><td className="pr-num">{money(total((r) => r.pending))}</td><td className="pr-num">{money(total((r) => r.glPayable))}</td><td className="pr-num">{money(total((r) => r.untagged))}</td>
              <td className="pr-num">{money(total((r) => r.earned))}</td><td className="pr-num">{money(total((r) => r.notCredited))}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
