"use client";

import { useEffect, useState } from "react";
import { messageBox } from "../ui/MessageBox";
import { money, usePayroll, type Props } from "./Payroll";

/**
 * PAYROLL (Phase 4): Salary Journal. Gets each slip's salary into the staff ledger in the accounts, one of two ways (Payroll Setup picks which are on):
 * map a journal line the accountant already posted (B), or have payroll make the month's journal through the Voucher save (A) - always shown first as a
 * preview that is rolled back, and written only when the server allows entry saves.
 */

type Period = { id: number; year: number; month: number; status: "O" | "P" | "L" };
type SlipRow = { slipId: number; code: number; name: string; net: number; credited: number; jvLedKey: number | null; jvMode: "A" | "B" | null; jvDoc: string };
type Status = { period: Period; mode: "A" | "B" | "AB"; salaryExpCode: number | null; salaryExpName: string; canPost: boolean; slips: SlipRow[] };
type Candidate = { ledId: number; date: string; docNo: string; book: string; narration: string; amount: number; untagged: number };
type Voucher = { committed: boolean; docNo: string; date: string; total: number; expense: string; narration: string; rows: { name: string; debit: number; credit: number }[]; warnings: string[] };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATE = { O: "Open", P: "Processed", L: "Locked" } as const;

export function PayrollJournal({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("journal", menuShortName, title, onClose);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [mapping, setMapping] = useState<{ slip: SlipRow; lines: Candidate[]; ledId: number | null; amount: string } | null>(null);
  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    call<{ periods: Period[] }>("periods").then((body) => { setPeriods(body.periods); setPeriodId((c) => c ?? body.periods[0]?.id ?? null); }).catch(fail);
  }, [call, fail, ready]);
  useEffect(() => {
    if (periodId === null) return;
    let live = true;
    call<Status>("status", { periodId }).then((body) => { if (live) { setStatus(body); setMapping(null); setVoucher(null); } }).catch(fail);
    return () => { live = false; };
  }, [call, fail, periodId]);

  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); try { await work(); } catch (reason) { await fail(reason); } finally { setBusy(false); } };

  const openMap = (slip: SlipRow) => run(async () => {
    const body = await call<{ net: number; lines: Candidate[] }>("candidates", { slipId: slip.slipId });
    const left = Math.max(0, Math.round((slip.net - slip.credited) * 100) / 100);
    setMapping({ slip, lines: body.lines, ledId: null, amount: String(left) });
  });
  const map = () => run(async () => {
    if (!mapping || mapping.ledId === null || periodId === null) return;
    setStatus(await call<Status>("map", { slipId: mapping.slip.slipId, ledId: mapping.ledId, amount: Number(mapping.amount), periodId }));
    setMapping(null);
  });
  const release = (slip: SlipRow) => run(async () => {
    if (!(await messageBox.confirm(`Take the journal off ${slip.name}'s slip? Its salary-credit tag is reversed.`, title)) || periodId === null) return;
    setStatus(await call<Status>("release", { slipId: slip.slipId, periodId }));
  });
  const preview = () => run(async () => { if (periodId !== null) setVoucher((await call<{ voucher: Voucher }>("preview", { periodId })).voucher); });
  const post = () => run(async () => {
    if (!voucher || periodId === null) return;
    if (!(await messageBox.confirm(`Post journal ${voucher.docNo} for ${money(voucher.total)} dated ${voucher.date}? It is written to the accounts.`, title))) return;
    const body = await call<Status & { voucher: Voucher }>("post", { periodId });
    setStatus(body); setVoucher(null);
    await messageBox.alert(`Journal ${body.voucher.docNo} posted and linked to ${body.slips.length} slips.`, title);
  });

  const mode = status?.mode ?? "AB";
  const unlinked = status ? status.slips.every((s) => s.jvLedKey === null) : false;
  const canCreate = !!status && mode.includes("A") && status.period.status === "P" && status.slips.length > 0 && unlinked && status.slips.every((s) => s.credited === 0);

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <div className="pr-bar">
        <label className="pr-field"><span>Pay period</span>
          <select value={periodId ?? ""} onChange={(event) => setPeriodId(Number(event.target.value))}>
            {periods.length === 0 && <option value="">No period yet</option>}
            {periods.map((p) => <option key={p.id} value={p.id}>{MONTHS[p.month - 1]} {p.year} - {STATE[p.status]}</option>)}
          </select></label>
        {status && <span className="pr-note">Mode: {mode === "AB" ? "A or B" : mode === "A" ? "A (create)" : "B (map)"} · Expense account: {status.salaryExpName || "not chosen"}</span>}
      </div>
      <div className="pr-actions">
        <button type="button" className="pr-primary" disabled={busy || !canCreate} onClick={() => void preview()}>Create salary journal…</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
      {status && status.period.status === "O" && <p className="pr-note">Process payroll for this period first.</p>}

      <table className="pr-table">
        <thead><tr><th>Staff</th><th className="pr-num">Net payable</th><th className="pr-num">Credited in ledger</th><th>Journal</th><th /></tr></thead>
        <tbody>
          {(status?.slips ?? []).map((s) => {
            const left = Math.round((s.net - s.credited) * 100) / 100;
            return (
              <tr key={s.slipId}>
                <td>{s.name} <small>#{s.code}</small></td><td className="pr-num">{money(s.net)}</td>
                <td className={`pr-num ${left > 0.004 ? "pr-badtext" : ""}`}>{money(s.credited)}{left > 0.004 && <small> ({money(left)} to go)</small>}</td>
                <td>{s.jvDoc ? `${s.jvDoc} (${s.jvMode === "A" ? "made by payroll" : "mapped"})` : "—"}</td>
                <td>
                  {mode.includes("B") && left > 0.004 && status?.period.status !== "L" && <button type="button" disabled={busy} onClick={() => void openMap(s)}>Map existing JV</button>}
                  {s.jvMode === "B" && status?.period.status !== "L" && <button type="button" disabled={busy} onClick={() => void release(s)}>Release</button>}
                </td>
              </tr>
            );
          })}
          {status && status.slips.length === 0 && <tr><td colSpan={5} className="pr-note">No slips for this period.</td></tr>}
        </tbody>
      </table>

      {mapping && (
        <fieldset className="pr-edit"><legend>Map a journal line to {mapping.slip.name}</legend>
          <p className="pr-note">Credit lines in this staff ledger that are not fully tagged (journals first). Net payable {money(mapping.slip.net)}.</p>
          <div className="pr-scroll" style={{ maxHeight: 220 }}>
            <table className="pr-table">
              <thead><tr><th /><th>Date</th><th>Voucher</th><th>Book</th><th className="pr-num">Untagged</th><th>Narration</th></tr></thead>
              <tbody>
                {mapping.lines.map((l) => (
                  <tr key={l.ledId} className={mapping.ledId === l.ledId ? "pr-pick" : ""} onClick={() => setMapping({ ...mapping, ledId: l.ledId, amount: String(Math.min(l.untagged, Math.max(0, mapping.slip.net - mapping.slip.credited))) })}>
                    <td><input type="radio" readOnly checked={mapping.ledId === l.ledId} /></td><td>{l.date}</td><td>{l.docNo}</td><td>{l.book}</td><td className="pr-num">{money(l.untagged)}</td><td>{l.narration}</td>
                  </tr>
                ))}
                {mapping.lines.length === 0 && <tr><td colSpan={6} className="pr-note">No untagged credit line in this staff ledger.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pr-bar">
            <label className="pr-field"><span>Amount to map</span><input type="number" min={0} step="0.01" value={mapping.amount} onChange={(event) => setMapping({ ...mapping, amount: event.target.value })} style={{ width: 130 }} /></label>
            <button type="button" className="pr-primary" disabled={busy || mapping.ledId === null} onClick={() => void map()}>Map</button>
            <button type="button" onClick={() => setMapping(null)}>Cancel</button>
          </div>
        </fieldset>
      )}

      {voucher && (
        <fieldset className="pr-edit"><legend>Journal preview (nothing is written yet)</legend>
          <p className="pr-note"><b>{voucher.docNo}</b> dated {voucher.date} · {voucher.narration}</p>
          <table className="pr-table">
            <thead><tr><th>Account</th><th className="pr-num">Debit</th><th className="pr-num">Credit</th></tr></thead>
            <tbody>{voucher.rows.map((r, i) => <tr key={i}><td>{r.name}</td><td className="pr-num">{r.debit ? money(r.debit) : ""}</td><td className="pr-num">{r.credit ? money(r.credit) : ""}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="pr-num">{money(voucher.total)}</td><td className="pr-num">{money(voucher.total)}</td></tr></tfoot>
          </table>
          {voucher.warnings.map((w) => <p key={w} className="pr-warn">{w}</p>)}
          {!status?.canPost && <p className="pr-warn">Entry saving is switched off on this server (SMARTWINFA_ENTRY_SAVE_COMMIT), so this journal can be previewed but not posted here.</p>}
          <div className="pr-actions">
            <button type="button" className="pr-primary" disabled={busy || !status?.canPost} onClick={() => void post()}>Post journal</button>
            <button type="button" onClick={() => setVoucher(null)}>Cancel</button>
          </div>
        </fieldset>
      )}
    </div>
  );
}
