"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { ScreenStatus } from "../ui/ScreenStatus";
import { activeScope, useWindowActive, useWindowActiveNow, useWindowCloser } from "../ui/activeWindow";
import { Plot } from "../piechart/Plot";
import { useZoom } from "../report/zoom";
import { useWindowLink } from "../ui/windowLink";
import { dashCall } from "./api";
import { DrillTable } from "./DrillTable";
import type { DrillData } from "./DrillTable";

/**
 * Report > Dashboard and Analysis > Multi Year > Yearly Dashboard (the desktop's Dashboard form): five charts (Sales, Purchase, Bank/Cash
 * Receipt, Bank/Cash Payment, Expense), by month within the period or, yearly, one bar a year, each with its total and (not yearly) today's
 * figure; and, not yearly, the five balances as on today. A bar opens its month's vouchers, a balance the accounts behind it.
 */

type Kind = "sale" | "purchase" | "receipt" | "payment" | "expense";
type Balance = "receivable" | "payable" | "expensepayable" | "cash" | "bank";
type Point = { label: string; month: number; value: number };
type Data = { yearly: boolean; series: Record<Kind, Point[]>; today: Record<Kind, number> | null; balances: Record<Balance, number> | null };

const indian = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => indian.format(value);
/** A bar's label: lakhs and crores keep it short. */
const short = (value: number) => {
  const size = Math.abs(value);
  if (size >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (size >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
};

const CHARTS: { kind: Kind; title: string; total: string; today: string; accent: string }[] = [
  { kind: "sale", title: "Sales", total: "Total Sale", today: "Today Sale", accent: "#00a896" },
  { kind: "purchase", title: "Purchase", total: "Total Purchase", today: "Today Purchase", accent: "#2979ff" },
  { kind: "receipt", title: "Bank/Cash Receipt", total: "Total Bank/Cash Receipt", today: "Today Bank/Cash Receipt", accent: "#4caf50" },
  { kind: "payment", title: "Bank/Cash Payment", total: "Total Bank/Cash Payment", today: "Today Bank/Cash Payment", accent: "#ff7043" },
  { kind: "expense", title: "Expense", total: "Total Expense", today: "Today Expense", accent: "#7c4dff" },
];
const BALANCES: { key: Balance; title: string; accent: string }[] = [
  { key: "payable", title: "Outstanding Payable", accent: "#7c4dff" },
  { key: "receivable", title: "Outstanding Receivable", accent: "#2979ff" },
  { key: "expensepayable", title: "Expense Payable", accent: "#ff7043" },
  { key: "bank", title: "Bank Balance", accent: "#4caf50" },
  { key: "cash", title: "Cash Balance", accent: "#03a9f4" },
];

/** The balance tiles' icons (24 x 24 line icons). */
const ICONS: Record<Balance, string> = {
  payable: "M12 3v12m0 0l-4-4m4 4l4-4M4 19h16",
  receivable: "M12 21V9m0 0l-4 4m4-4l4 4M4 5h16",
  expensepayable: "M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2V4zM9 9h6M9 13h6",
  bank: "M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18",
  cash: "M3 7h18v10H3zM12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M6 10v.01M18 14v.01",
};

/** Each point's change on the one before (first: none), as the desktop's legend shows it. */
function changes(points: Point[]): (number | null)[] {
  return points.map((point, index) => (index === 0 ? null : points[index - 1].value !== 0 ? Math.round(((point.value - points[index - 1].value) / points[index - 1].value) * 10000) / 100 : 0));
}

function Bars({ points, size, accent, id, onPick }: { points: Point[]; size: { width: number; height: number }; accent: string; id: string; onPick: (point: Point) => void }) {
  const { width: W, height: H } = size;
  const left = 62, right = W - 10, top = 22, bottom = H - 26;
  const max = Math.max(...points.map((point) => point.value), 0), min = Math.min(...points.map((point) => point.value), 0);
  const rough = (max - min) / 4 || 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const unit = [1, 2, 2.5, 5, 10].find((step) => step * power >= rough)! * power;
  const lo = Math.floor(min / unit) * unit, hi = Math.ceil(max / unit) * unit || unit;
  const y = (value: number) => bottom - ((value - lo) / (hi - lo)) * (bottom - top);
  const band = (right - left) / points.length;
  const ticks = Array.from({ length: Math.round((hi - lo) / unit) + 1 }, (_, i) => lo + i * unit);
  const font = "Segoe UI, Arial, sans-serif";
  /** Where a bar ends (a hairline at least, so a zero month still shows). */
  const tipOf = (value: number) => (Math.abs(y(value) - y(0)) < 1 ? y(0) - (value >= 0 ? 1 : -1) : y(value));
  const peak = points.reduce((best, point, index) => (point.value > points[best].value ? index : best), 0);
  /** A bar with rounded top corners (the bottom stays on the axis). */
  const bar = (x: number, w: number, y0: number, y1: number) => {
    const r = Math.min(7, w / 2, Math.abs(y1 - y0));
    const top = Math.min(y0, y1), bottomEdge = Math.max(y0, y1), up = y1 <= y0;
    return up
      ? `M${x},${bottomEdge} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottomEdge} Z`
      : `M${x},${top} V${bottomEdge - r} Q${x},${bottomEdge} ${x + r},${bottomEdge} H${x + w - r} Q${x + w},${bottomEdge} ${x + w},${bottomEdge - r} V${top} Z`;
  };
  return (
    <svg className="pc-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart">
      <defs>
        <linearGradient id={`dash-up-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={1} /><stop offset="100%" stopColor={accent} stopOpacity={0.55} /></linearGradient>
        <linearGradient id={`dash-soft-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={0.62} /><stop offset="100%" stopColor={accent} stopOpacity={0.28} /></linearGradient>
        <linearGradient id={`dash-down-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef5350" stopOpacity={0.5} /><stop offset="100%" stopColor="#ef5350" stopOpacity={0.95} /></linearGradient>
      </defs>
      {ticks.map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e8ecf5" strokeDasharray={value === 0 ? undefined : "3 4"} /><text x={left - 8} y={y(value) + 4} textAnchor="end" fontFamily={font} fontSize={11} fill="#8a95b0">{short(value)}</text></g>)}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#c5cde0" />
      {points.map((point, index) => {
        const cx = left + index * band + band / 2;
        const barW = Math.min(band * 0.62, 46);
        return (
          <g key={point.label} className="dash-bar" onClick={() => onPick(point)} style={{ cursor: "pointer" }}>
            <title>{`${point.label}\n${money(point.value)}`}</title>
            <rect x={cx - band / 2} y={top} width={band} height={bottom - top} fill="transparent" />
            <path d={bar(cx - barW / 2, barW, y(0), tipOf(point.value))} fill={point.value < 0 ? `url(#dash-down-${id})` : index === peak ? `url(#dash-up-${id})` : `url(#dash-soft-${id})`} />
            {band >= 44 && <text x={cx} y={(point.value >= 0 ? y(point.value) - 7 : y(point.value) + 15)} textAnchor="middle" fontFamily={font} fontSize={10.5} fontWeight={700} fill={index === peak ? "#1f2a4d" : "#6a7592"}>{short(point.value)}</text>}
            <text x={cx} y={bottom + 17} textAnchor="middle" fontFamily={font} fontSize={11.5} fontWeight={index === peak ? 700 : 500} fill={index === peak ? "#1f2a4d" : "#6a7592"}>{point.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Dashboard({ reportName, menuShortName, title, onClose }: { reportName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [yearStart, setYearStart] = useState("");
  const [from, setFrom] = useState("");
  const [upto, setUpto] = useState("");
  const [initial, setInitial] = useState({ from: "", upto: "" });
  const [data, setData] = useState<Data | null>(null);
  const [drill, setDrill] = useState<{ title: string; table: DrillData; accent?: string } | null>(null);
  const [busy, setBusy] = useState("Loading");
  const [fatal, setFatal] = useState("");
  const [message, setMessage] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  /** The period the figures on screen were read for (a bar's list is read for the same). */
  const loaded = useRef({ from: "", upto: "" });
  const windowActive = useWindowActive();
  const tools = useEditorTools(useMemo(() => parseDesktopDate(yearStart), [yearStart]));
  useAltHotkeys(screen);
  const yearly = reportName === "YEAR_DASHBOARD";

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) throw new Error("No company is selected");
    return dashCall<T>(selection, reportName, menuShortName, action, payload);
  }, [selection, reportName, menuShortName]);

  const load = useCallback(async (start: string, end: string) => {
    setBusy("Loading"); setMessage(""); setMessageRed(false);
    try {
      const result = await call<{ data: Data }>("data", { from: start, upto: end });
      setData(result.data);
      loaded.current = { from: start, upto: end };
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : "The dashboard could not be loaded"); setMessageRed(true);
    } finally {
      setBusy("");
    }
  }, [call]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const setup = await call<{ from: string; upto: string; yearStart: string }>("setup");
        if (!live) return;
        setYearStart(setup.yearStart); setFrom(setup.from); setUpto(setup.upto); setInitial({ from: setup.from, upto: setup.upto });
        await load(setup.from, setup.upto);
      } catch (error) {
        if (live) { setFatal(error instanceof Error ? error.message : "The dashboard could not be opened"); setBusy(""); }
      }
    })();
    return () => { live = false; };
  }, [call, load]);

  const leave = useCallback(async () => {
    if (!(await messageBox.confirm("Are You Sure You Want To Quit?", "Dashboard Quit"))) return;
    onClose();
  }, [onClose]);
  useWindowCloser(leave);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !windowActive.current || event.defaultPrevented || drill) return;
      if (!screen.current || !activeScope()?.contains(screen.current)) return;
      event.preventDefault();
      void leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave, windowActive, drill]);

  const pick = async (kind: Kind, label: string, point: Point) => {
    if (yearly || !data) { await messageBox.alert(`You clicked on:\nLabel: ${point.label}\nValue: ${money(point.value)}`, "Chart Click"); return; }
    setBusy("Loading");
    try {
      const result = await call<{ table: DrillData }>("month", { kind, month: point.month, ...loaded.current });
      setDrill({ title: `${label} - ${point.label}`, table: result.table, accent: CHARTS.find((chart) => chart.kind === kind)?.accent });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The list could not be loaded"); setMessageRed(true);
    } finally { setBusy(""); }
  };
  /** Enter or a double click on a row of the list: a voucher opens in its entry, an account in its Ledger. */
  const openZoom = useZoom();
  const openRow = (row: Record<string, string | number>) => {
    if (!openZoom) return;
    const led = Number(row._led) || 0;
    const code = Number(row._code) || 0;
    if (led > 0) openZoom({ entryName: [4, 5, 6, 19].includes(Number(row._book)) ? "VOUCHER" : "INVOICE", ledKey: led });
    else if (code > 0) openZoom({ reportName: "REPORT_LEDGER", acCode: code });
  };
  // An entry saved or deleted in a window opened from this one: the figures are read again when the dashboard is next in front.
  const windowLink = useWindowLink();
  const inFront = useWindowActiveNow();
  useEffect(() => {
    if (!inFront || !windowLink.stale || !from || !upto) return;
    windowLink.clearStale();
    setDrill(null);
    void load(from, upto);
  }, [inFront, windowLink.stale]);
  const openBalance = async (key: Balance) => {
    setBusy("Loading");
    try {
      const result = await call<{ title: string; table: DrillData }>("balance", { balance: key });
      setDrill({ ...result, accent: BALANCES.find((entry) => entry.key === key)?.accent });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The list could not be loaded"); setMessageRed(true);
    } finally { setBusy(""); }
  };

  if (fatal) return <div className="pc-screen"><p className="mp-fatal" role="alert">{fatal}</p></div>;

  return (
    <div ref={screen} className={`pc-screen dash-screen${busy ? " rp-working" : ""}`} role="region" aria-label={title} aria-busy={Boolean(busy)}>
      <div className="pc-card pc-filters">
        <h2 className="dash-title">{yearly ? "YEARLY DASHBOARD" : "DASHBOARD"}</h2>
        <label className="pc-field"><span>From Date</span><DateField ariaLabel="From Date" value={from} tools={tools} onChange={setFrom} required /></label>
        <label className="pc-field"><span>Upto</span><DateField ariaLabel="Upto" value={upto} tools={tools} onChange={setUpto} required /></label>
        <span className="pc-spacer" />
        <div className="pc-buttons">
          <button type="button" data-hotkey="o" aria-keyshortcuts="Alt+O" className="pc-btn pc-btn-primary" onClick={() => void load(from, upto)} disabled={Boolean(busy)}><Icon name="ok" /><HotkeyLabel text="Ok" hotkey="o" /></button>
          <button type="button" data-hotkey="r" aria-keyshortcuts="Alt+R" className="pc-btn pc-btn-outline" onClick={() => { setFrom(initial.from); setUpto(initial.upto); void load(initial.from, initial.upto); }}><Icon name="refresh" /><HotkeyLabel text="Reset" hotkey="r" /></button>
          <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="pc-btn pc-btn-danger" onClick={() => void leave()}><Icon name="close" /><HotkeyLabel text="Quit" hotkey="q" /></button>
        </div>
      </div>

      <div className="dash-body">
        {data?.balances && (
          <>
            <h3 className="dash-asof">Position as on today</h3>
            <div className="dash-balances">
              {BALANCES.map((balance) => (
                <button key={balance.key} type="button" className="pc-card dash-balance" style={{ ["--accent" as string]: balance.accent }} onClick={() => void openBalance(balance.key)} title="Click to see the accounts">
                  <span className="dash-chip"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[balance.key]} /></svg></span>
                  <small>{balance.title}</small>
                  <b className={data.balances![balance.key] < 0 ? "neg" : ""}>₹ {money(data.balances![balance.key])}</b>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="dash-grid">
          {CHARTS.map((chart) => {
            const points = data?.series[chart.kind] ?? [];
            const total = points.reduce((sum, point) => sum + point.value, 0);
            const deltas = changes(points);
            return (
              <section key={chart.kind} className={`pc-card dash-card dash-${chart.kind}`} style={{ ["--accent" as string]: chart.accent }} aria-label={chart.title}>
                <header>
                  <h3>{chart.title}</h3>
                  <div className="dash-figures">
                    <span><small>{chart.total}</small><b>₹ {money(total)}</b><em>Within Period</em></span>
                    {data?.today && <span><small>{chart.today}</small><b>₹ {money(data.today[chart.kind])}</b></span>}
                  </div>
                </header>
                {points.length > 0
                  ? <>
                      <Plot>{(size) => <Bars points={points} size={size} accent={chart.accent} id={chart.kind} onPick={(point) => void pick(chart.kind, chart.title, point)} />}</Plot>
                      <ul className="dash-legend">
                        {points.map((point, index) => (
                          <li key={point.label} onClick={() => void pick(chart.kind, chart.title, point)}>
                            <i />
                            <span>{point.label}<b className="dash-amt">{money(point.value)}</b>{deltas[index] !== null && <em className={(deltas[index] as number) >= 0 ? "up" : "down"}>{(deltas[index] as number) >= 0 ? "▲" : "▼"} {Math.abs(deltas[index] as number)}%</em>}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  : <p className="pc-empty">{busy ? "" : "No data for the period"}</p>}
              </section>
            );
          })}
        </div>
      </div>
      {tools.popups}
      {drill && <DrillTable title={drill.title} data={drill.table} accent={drill.accent} onClose={() => setDrill(null)} onOpen={openRow} />}
      <ScreenStatus hotKeys="" message={message} error={messageRed} version="" rows="" totals="" />
    </div>
  );
}
