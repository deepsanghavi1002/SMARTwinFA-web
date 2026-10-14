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
import { activeScope, useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Plot } from "../piechart/Plot";
import { sliceColor } from "../piechart/ChartView";
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

/** Each point's change on the one before (first: none), as the desktop's legend shows it. */
function changes(points: Point[]): (number | null)[] {
  return points.map((point, index) => (index === 0 ? null : points[index - 1].value !== 0 ? Math.round(((point.value - points[index - 1].value) / points[index - 1].value) * 10000) / 100 : 0));
}

function Bars({ points, size, onPick }: { points: Point[]; size: { width: number; height: number }; onPick: (point: Point) => void }) {
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
  return (
    <svg className="pc-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart">
      {ticks.map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#eef1f5" /><text x={left - 6} y={y(value) + 4} textAnchor="end" fontFamily={font} fontSize={11} fill="#6b7686">{short(value)}</text></g>)}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#9aa5b8" />
      {points.map((point, index) => {
        const cx = left + index * band + band / 2;
        const barW = Math.min(band * 0.7, 56);
        return (
          <g key={point.label} onClick={() => onPick(point)} style={{ cursor: "pointer" }}>
            <title>{`${point.label}\n${money(point.value)}`}</title>
            <rect x={cx - barW / 2} y={Math.min(y(0), y(point.value))} width={barW} height={Math.max(Math.abs(y(point.value) - y(0)), 1)} rx={3} fill={sliceColor(index)} />
            {band >= 40 && <text x={cx} y={(point.value >= 0 ? y(point.value) - 5 : y(point.value) + 14)} textAnchor="middle" fontFamily={font} fontSize={11} fontWeight={600} fill="#28324a">{short(point.value)}</text>}
            <text x={cx} y={bottom + 16} textAnchor="middle" fontFamily={font} fontSize={12} fill="#28324a">{point.label}</text>
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
  const [drill, setDrill] = useState<{ title: string; table: DrillData } | null>(null);
  const [busy, setBusy] = useState("Loading");
  const [fatal, setFatal] = useState("");
  const [message, setMessage] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
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
      const result = await call<{ table: DrillData }>("month", { kind, month: point.month });
      setDrill({ title: `${label} - ${point.label}`, table: result.table });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The list could not be loaded"); setMessageRed(true);
    } finally { setBusy(""); }
  };
  const openBalance = async (key: Balance) => {
    setBusy("Loading");
    try {
      const result = await call<{ title: string; table: DrillData }>("balance", { balance: key });
      setDrill(result);
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
                      <Plot>{(size) => <Bars points={points} size={size} onPick={(point) => void pick(chart.kind, chart.title, point)} />}</Plot>
                      <ul className="dash-legend">
                        {points.map((point, index) => (
                          <li key={point.label} onClick={() => void pick(chart.kind, chart.title, point)}>
                            <i style={{ background: sliceColor(index) }} />
                            <span>{point.label} - {money(point.value)}{deltas[index] !== null && <em className={(deltas[index] as number) >= 0 ? "up" : "down"}> {deltas[index]}%</em>}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  : <p className="pc-empty">{busy ? "" : "No data for the period"}</p>}
              </section>
            );
          })}
        </div>

        {data?.balances && (
          <>
            <h3 className="dash-asof">As On Today</h3>
            <div className="dash-balances">
              {BALANCES.map((balance) => (
                <button key={balance.key} type="button" className="pc-card dash-balance" style={{ ["--accent" as string]: balance.accent }} onClick={() => void openBalance(balance.key)} title="Click to see the accounts">
                  <small>{balance.title}</small>
                  <b>₹ {money(data.balances![balance.key])}</b>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {tools.popups}
      {drill && <DrillTable title={drill.title} data={drill.table} onClose={() => setDrill(null)} />}
      <ScreenStatus hotKeys="" message={message} error={messageRed} version="" rows="" totals="" />
    </div>
  );
}
