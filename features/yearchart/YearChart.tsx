"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { yearCall } from "./api";

/**
 * Analysis > Multi Year > Chart Report (the desktop's Report_MultyYearChart): the company's years that meet From .. Upto as paired
 * columns, Purchase against Sale or Payment against Receipt, each labelled with its amount and its change on the year before, and
 * three cards below: the two totals (with their share) and the difference. Save writes the chart as a picture.
 */

type Books = "SalePurchase" | "BankCash";
type Year = { year: string; receipt: number; payment: number };

const indian = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number) => indian.format(value);
const percent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const change = (now: number, before: number) => (before !== 0 ? ((now - before) * 100) / before : 0);

const FONT = "Segoe UI, Arial, sans-serif";
const BLUE = "#0000ff", GREEN = "#008000", RED = "#ff0000";

const Columns = forwardRef<SVGSVGElement, { size: { width: number; height: number }; years: Year[]; payHead: string; recHead: string; title: string }>(function Columns({ size, years, payHead, recHead, title }, ref) {
  const W = size.width, H = size.height;
  const left = 110, right = W - 20, top = 80, bottom = H - 50;
  const values = years.flatMap((entry) => [entry.payment, entry.receipt]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const rough = (max - min) / 5 || 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const unit = [1, 2, 2.5, 5, 10].find((step) => step * power >= rough)! * power;
  const lo = Math.floor(min / unit) * unit, hi = Math.ceil(max / unit) * unit;
  const y = (value: number) => bottom - ((value - lo) / (hi - lo)) * (bottom - top);
  const band = (right - left) / years.length;
  const ticks = Array.from({ length: Math.round((hi - lo) / unit) + 1 }, (_, i) => lo + i * unit);
  const label = (x: number, base: number, value: number, index: number, before: number | null) => {
    const lines = [money(value), ...(index > 0 && before !== null ? [`(${percent(change(value, before))})`] : [])];
    return lines.map((line, at) => <text key={at} x={x} y={base - 6 - (lines.length - 1 - at) * 15} textAnchor="middle" fontFamily={FONT} fontSize={12} fill="#000">{line}</text>);
  };
  const bar = band * 0.3;
  return (
    <svg ref={ref} className="pc-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={title}>
      <rect width={W} height={H} fill="#fff" />
      <text x={W / 2} y={22} textAnchor="middle" fontFamily={FONT} fontSize={18} fontWeight={700} fill={RED}>{title}</text>
      <rect x={W / 2 - 100} y={34} width={10} height={10} fill={BLUE} /><text x={W / 2 - 86} y={43} fontFamily={FONT} fontSize={13} fill="#28324a">{payHead}</text>
      <rect x={W / 2 + 10} y={34} width={10} height={10} fill={GREEN} /><text x={W / 2 + 24} y={43} fontFamily={FONT} fontSize={13} fill="#28324a">{recHead}</text>
      {ticks.map((value) => <text key={value} x={left - 6} y={y(value) + 4} textAnchor="end" fontFamily={FONT} fontSize={12} fill={RED}>{new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(value)}</text>)}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="#9aa5b8" />
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#9aa5b8" />
      {years.map((entry, index) => {
        const cx = left + index * band + band / 2;
        const previous = index > 0 ? years[index - 1] : null;
        const bars: [number, number, string, number | null][] = [[cx - bar, entry.payment, BLUE, previous?.payment ?? null], [cx, entry.receipt, GREEN, previous?.receipt ?? null]];
        return (
          <g key={entry.year}>
            {bars.map(([x, value, color, before]) => (
              <g key={color}>
                <title>{`${color === BLUE ? payHead : recHead} Amt : ${entry.year}\nValue: ${money(value)}${index > 0 && before !== null ? ` (${percent(change(value, before))})` : ""}`}</title>
                <rect x={x} y={Math.min(y(0), y(value))} width={bar} height={Math.abs(y(value) - y(0))} fill={color} />
                {label(x + bar / 2, Math.min(y(0), y(value)), value, index, before)}
              </g>
            ))}
            <text x={cx} y={bottom + 18} textAnchor="middle" fontFamily={FONT} fontSize={13} fill={RED}>{entry.year}</text>
          </g>
        );
      })}
      <text x={(left + right) / 2} y={H - 8} textAnchor="middle" fontFamily={FONT} fontSize={14} fontWeight={700} fill={RED}>Year</text>
    </svg>
  );
});

export function YearChart({ reportName, menuShortName, title, onClose }: { reportName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [from, setFrom] = useState("");
  const [upto, setUpto] = useState("");
  const [books, setBooks] = useState<Books>("SalePurchase");
  const [years, setYears] = useState<Year[] | null>(null);
  const [shown, setShown] = useState<Books>("SalePurchase");
  const [busy, setBusy] = useState("Loading");
  const [fatal, setFatal] = useState("");
  const [message, setMessage] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const windowActive = useWindowActive();
  const tools = useEditorTools(useMemo(() => parseDesktopDate(yearStart), [yearStart]));
  useAltHotkeys(screen);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) throw new Error("No company is selected");
    return yearCall<T>(selection, reportName, menuShortName, action, payload);
  }, [selection, reportName, menuShortName]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const setup = await call<{ yearStart: string; yearEnd: string }>("setup");
        if (!live) return;
        setYearStart(setup.yearStart); setYearEnd(setup.yearEnd); setFrom(setup.yearStart); setUpto(setup.yearEnd);
        setBusy("");
      } catch (error) {
        if (live) { setFatal(error instanceof Error ? error.message : "The chart report could not be opened"); setBusy(""); }
      }
    })();
    return () => { live = false; };
  }, [call]);

  const generate = useCallback(async () => {
    setBusy("Generating"); setMessage(""); setMessageRed(false);
    try {
      const result = await call<{ years: Year[] }>("chart", { books, from, upto });
      setYears(result.years); setShown(books);
      if (result.years.length === 0) { setMessage("No year found for the selection"); setMessageRed(true); }
    } catch (error) {
      setYears(null);
      setMessage(error instanceof Error ? error.message : "The chart could not be generated"); setMessageRed(true);
    } finally {
      setBusy("");
    }
  }, [call, books, from, upto]);

  const reset = () => { setFrom(yearStart); setUpto(yearEnd); setBooks("SalePurchase"); setYears(null); setMessage(""); };

  const leave = useCallback(async () => {
    if (!(await messageBox.confirm("Are You Sure Want To Quit ?", "Report Multy Year Quit"))) return;
    onClose();
  }, [onClose]);
  useWindowCloser(leave);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !windowActive.current || event.defaultPrevented) return;
      if (!screen.current || !activeScope()?.contains(screen.current)) return;
      event.preventDefault();
      void leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave, windowActive]);

  const sale = shown === "SalePurchase";
  const recHead = sale ? "Sale" : "Receipt";
  const payHead = sale ? "Purchase" : "Payment";
  const heading = sale ? "Yearly Purchase vs Sale" : "Yearly Payment vs Receipt";
  const totalReceipt = years?.reduce((sum, entry) => sum + entry.receipt, 0) ?? 0;
  const totalPayment = years?.reduce((sum, entry) => sum + entry.payment, 0) ?? 0;
  const both = totalReceipt + totalPayment;
  const diff = totalReceipt - totalPayment;
  const diffPercent = totalPayment !== 0 ? (Math.abs(diff) * 100) / totalPayment : 0;
  const has = Boolean(years && years.length > 0);

  const save = async () => {
    const element = svg.current;
    if (!element || !has) { setMessage("Generate a chart first"); setMessageRed(true); return; }
    const box = element.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = box.width * 2; canvas.height = box.height * 2;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(element))}`;
    try { await image.decode(); } catch { setMessage("The chart could not be saved"); setMessageRed(true); return; }
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const name = ["Multi_Year", shown, from, upto].join("_").replace(/[^A-Za-z0-9_-]+/g, "_");
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.download = `${name}.jpeg`;
    link.click();
    setMessage(`${name}.jpeg saved`); setMessageRed(false);
  };

  if (fatal) return <div className="pc-screen"><p className="mp-fatal" role="alert">{fatal}</p></div>;

  return (
    <div ref={screen} className={`pc-screen pc-year${busy ? " rp-working" : ""}`} role="region" aria-label={title} aria-busy={Boolean(busy)}>
      <div className="pc-card pc-filters">
        <label className="pc-field"><span>From Date</span><DateField ariaLabel="From Date" value={from} tools={tools} onChange={setFrom} required /></label>
        <label className="pc-field"><span>Upto</span><DateField ariaLabel="Upto" value={upto} tools={tools} onChange={setUpto} required /></label>
        <label className="pc-field"><span>Select</span>
          <select value={books} onChange={(event) => setBooks(event.target.value as Books)}><option>SalePurchase</option><option>BankCash</option></select>
        </label>
        <span className="pc-spacer" />
        <div className="pc-buttons">
          <button type="button" data-hotkey="k" aria-keyshortcuts="Alt+K" className="pc-btn pc-btn-primary" onClick={() => void generate()} disabled={Boolean(busy)}><Icon name="ok" /><HotkeyLabel text="View Report" hotkey="k" /></button>
          <button type="button" data-hotkey="s" aria-keyshortcuts="Alt+S" className="pc-btn pc-btn-outline" onClick={() => void save()} disabled={!has}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>
          <button type="button" data-hotkey="r" aria-keyshortcuts="Alt+R" className="pc-btn pc-btn-outline" onClick={reset}><Icon name="refresh" /><HotkeyLabel text="Reset" hotkey="r" /></button>
          <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="pc-btn pc-btn-danger" onClick={() => void leave()}><Icon name="close" /><HotkeyLabel text="Close" hotkey="q" /></button>
        </div>
      </div>

      <section className="pc-card pc-chart" aria-label="Chart">
        <h3>{heading}</h3>
        <p className="pc-sub">{`Comparison of total ${sale ? "purchases and sales" : "payments and receipts"} for the selected year`}</p>
        {has ? <Plot minWidth={years!.length * 190 + 140}>{(size) => <Columns ref={svg} size={size} years={years!} payHead={payHead} recHead={recHead} title={heading} />}</Plot> : <p className="pc-empty">{busy ? "" : "Choose the selection and press View Report."}</p>}
      </section>

      <div className="pc-kpis">
        <div className="pc-card pc-kpi" style={{ ["--kpi" as string]: "#2979ff" }}><b>₹</b><div><small>{sale ? "Total Purchase" : "Total Payment"}</small><strong>₹ {money(has ? totalPayment : 0)}</strong><em>{(both ? (totalPayment * 100) / both : 0).toFixed(2)}%</em></div></div>
        <div className="pc-card pc-kpi" style={{ ["--kpi" as string]: "#4caf50" }}><b>₹</b><div><small>{sale ? "Total Sale" : "Total Receipt"}</small><strong>₹ {money(has ? totalReceipt : 0)}</strong><em>{(both ? (totalReceipt * 100) / both : 0).toFixed(2)}%</em></div></div>
        <div className="pc-card pc-kpi" style={{ ["--kpi" as string]: "#7c4dff" }}><b>⚖</b><div><small>{sale ? "Sale vs Purchase Difference" : "Receipt vs Payment Difference"}</small><strong>₹ {money(has ? Math.abs(diff) : 0)}</strong><em>{`${diff >= 0 ? "+" : "-"}${diffPercent.toFixed(2)}%`}</em>
          {has && <span>{diff >= 0 ? (sale ? "More sales than purchases" : "More receipts than payments") : (sale ? "More purchases than sales" : "More payments than receipts")}</span>}</div></div>
      </div>
      {tools.popups}
      <ScreenStatus hotKeys="" message={message} error={messageRed} version="" rows="" totals="" />
    </div>
  );
}
