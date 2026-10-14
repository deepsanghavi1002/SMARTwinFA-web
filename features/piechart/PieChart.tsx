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
import { pieCall } from "./api";
import { Plot } from "./Plot";
import { ChartView, CHART_TYPES, sliceColor } from "./ChartView";
import type { ChartType, Slice } from "./ChartView";

/**
 * Report > Extra Report > Pie Chart (the desktop's Report_PieChart): the Sale, Purchase, Receipt or Payment of a period as a
 * quantity or an amount, by month (April first) or by an addon of the accounts / products, drawn as a pie, doughnut, bars
 * and so on, with a legend that lists every slice and the total. A click on a slice names it; Save writes the chart as a picture.
 */

const BOOKS = ["Sale", "Purchase", "Receipt", "Payment"] as const;
const SIDES = ["Quantity", "Amount"] as const;
type Book = (typeof BOOKS)[number];
type Side = (typeof SIDES)[number];
type Addon = { key: number; label: string };

const indian = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function PieChart({ reportName, menuShortName, title, onClose }: { reportName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");
  const [from, setFrom] = useState("");
  const [upto, setUpto] = useState("");
  const [book, setBook] = useState<Book>("Sale");
  const [side, setSide] = useState<Side>("Quantity");
  const [addonKey, setAddonKey] = useState(0);
  const [chartType, setChartType] = useState<ChartType>("Bar");
  const [slices, setSlices] = useState<Slice[] | null>(null);
  /** What the chart on screen was made for (the selectors can move on without it). */
  const [shown, setShown] = useState<{ book: Book; side: Side; addon: string } | null>(null);
  const [busy, setBusy] = useState("Loading");
  const [fatal, setFatal] = useState("");
  const [message, setMessage] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const windowActive = useWindowActive();
  const yearStartDate = useMemo(() => parseDesktopDate(yearStart), [yearStart]);
  const tools = useEditorTools(yearStartDate);
  useAltHotkeys(screen);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) throw new Error("No company is selected");
    return pieCall<T>(selection, reportName, menuShortName, action, payload);
  }, [selection, reportName, menuShortName]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const setup = await call<{ addons: Addon[]; yearStart: string; yearEnd: string }>("setup");
        if (!live) return;
        setAddons(setup.addons);
        setYearStart(setup.yearStart); setYearEnd(setup.yearEnd);
        setFrom(setup.yearStart); setUpto(setup.yearEnd);
        setBusy("");
      } catch (error) {
        if (live) { setFatal(error instanceof Error ? error.message : "The pie chart could not be opened"); setBusy(""); }
      }
    })();
    return () => { live = false; };
  }, [call]);

  // Receipt and Payment have no quantity and no addon (the desktop reads them from the ledger by month only).
  const monthsOnly = book === "Receipt" || book === "Payment";
  const addon = !monthsOnly ? addons.find((entry) => entry.key === addonKey) : undefined;
  const amountSide = monthsOnly || side === "Amount";

  const generate = useCallback(async () => {
    setBusy("Generating");
    setMessage(""); setMessageRed(false);
    try {
      const result = await call<{ slices: Slice[] }>("chart", { book, side: monthsOnly ? "Amount" : side, addonKey: monthsOnly ? 0 : addonKey, from, upto });
      setSlices(result.slices);
      setShown({ book, side: monthsOnly ? "Amount" : side, addon: addon?.label ?? "" });
      if (result.slices.length === 0) { setMessage("No data found for the selection"); setMessageRed(true); }
    } catch (error) {
      setSlices(null); setShown(null);
      setMessage(error instanceof Error ? error.message : "The chart could not be generated"); setMessageRed(true);
    } finally {
      setBusy("");
    }
  }, [call, book, side, monthsOnly, addonKey, addon, from, upto]);

  const reset = () => {
    setFrom(yearStart); setUpto(yearEnd);
    setBook("Sale"); setSide("Quantity"); setAddonKey(0); setChartType("Bar");
    setSlices(null); setShown(null); setMessage("");
  };

  const leave = useCallback(async () => {
    if (!(await messageBox.confirm("Are You Sure Want To Quit ?", "Report Pie Chart Quit"))) return;
    onClose();
  }, [onClose]);
  useWindowCloser(leave);

  // Esc asks to quit, as the desktop does.
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

  const total = slices?.reduce((sum, slice) => sum + slice.value, 0) ?? 0;
  const format = (value: number) => (amountSide ? indian.format(value) : whole.format(value));
  const category = shown?.addon || "Month";

  /** The chart as a Jpeg: the desktop's Chart.SaveImage. */
  const save = async () => {
    const element = svg.current;
    if (!element || !slices || slices.length === 0) { setMessage("Generate a chart first"); setMessageRed(true); return; }
    const box = element.viewBox.baseVal;
    const canvas = document.createElement("canvas");
    canvas.width = box.width * 2; canvas.height = box.height * 2;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = new Image();
    const markup = new XMLSerializer().serializeToString(element);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    try { await image.decode(); } catch { setMessage("The chart could not be saved"); setMessageRed(true); return; }
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const name = [shown?.book, shown?.side, shown?.addon, from, upto].filter(Boolean).join("_").replace(/[^A-Za-z0-9_-]+/g, "_");
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.download = `${name}.jpeg`;
    link.click();
    setMessage(`${name}.jpeg saved`); setMessageRed(false);
  };

  if (fatal) return <div className="pc-screen"><p className="mp-fatal" role="alert">{fatal}</p></div>;

  return (
    <div ref={screen} className={`pc-screen${busy ? " rp-working" : ""}`} role="region" aria-label={title} aria-busy={Boolean(busy)}>
      <div className="pc-card pc-filters">
        <label className="pc-field"><span>From Date</span><DateField ariaLabel="From Date" value={from} tools={tools} onChange={setFrom} required /></label>
        <label className="pc-field"><span>Upto</span><DateField ariaLabel="Upto" value={upto} tools={tools} onChange={setUpto} required /></label>
        <label className="pc-field"><span>Select</span>
          <select value={book} onChange={(event) => setBook(event.target.value as Book)}>{BOOKS.map((name) => <option key={name}>{name}</option>)}</select>
        </label>
        <label className="pc-field"><span>Qty-Amount</span>
          <select value={monthsOnly ? "Amount" : side} disabled={monthsOnly} onChange={(event) => setSide(event.target.value as Side)}>{SIDES.map((name) => <option key={name}>{name}</option>)}</select>
        </label>
        {addons.length > 0 && (
          <label className="pc-field"><span>Addon</span>
            <select value={monthsOnly ? 0 : addonKey} disabled={monthsOnly} onChange={(event) => setAddonKey(Number(event.target.value))}>
              <option value={0}>Blank</option>
              {addons.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
          </label>
        )}
        <label className="pc-field"><span>Chart Type</span>
          <select value={chartType} onChange={(event) => setChartType(event.target.value as ChartType)}>{CHART_TYPES.map((name) => <option key={name}>{name}</option>)}</select>
        </label>
        <span className="pc-spacer" />
        <label className="pc-field pc-total"><span>Total</span><output>{slices && slices.length > 0 ? format(total) : ""}</output></label>
        <div className="pc-buttons">
          <button type="button" data-hotkey="k" aria-keyshortcuts="Alt+K" className="pc-btn pc-btn-primary" onClick={() => void generate()} disabled={Boolean(busy)}><Icon name="ok" /><HotkeyLabel text="View Report" hotkey="k" /></button>
          <button type="button" data-hotkey="s" aria-keyshortcuts="Alt+S" className="pc-btn pc-btn-outline" onClick={() => void save()} disabled={!slices || slices.length === 0}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>
          <button type="button" data-hotkey="r" aria-keyshortcuts="Alt+R" className="pc-btn pc-btn-outline" onClick={reset}><Icon name="refresh" /><HotkeyLabel text="Reset" hotkey="r" /></button>
          <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="pc-btn pc-btn-danger" onClick={() => void leave()}><Icon name="close" /><HotkeyLabel text="Close" hotkey="q" /></button>
        </div>
      </div>

      <div className="pc-body">
        <section className="pc-card pc-chart" aria-label="Chart">
          <h3>{shown ? `${shown.book} ${shown.side} by ${category}` : "Quantity by Month"}</h3>
          {slices && slices.length > 0 && shown
            ? <Plot minWidth={["Column", "Point", "Bubble", "Candlestick", "BoxPlot"].includes(chartType) ? slices.length * 56 + 120 : 0}>{(size) => <ChartView ref={svg} size={size} type={chartType} slices={slices} axisX={category} axisY={shown.side} format={(value) => (shown.side === "Amount" ? indian.format(value) : whole.format(value))}
                onSlice={(slice) => void messageBox.alert(`Clicked: ${slice.label}`, "Message")} />}</Plot>
            : <p className="pc-empty">{busy ? "" : "Choose the selection and press View Report."}</p>}
        </section>
        <section className="pc-card pc-legend" aria-label="Legend">
          <h3>{shown?.addon ? `${shown.addon} Legend` : "Month Legend"}</h3>
          <ul>
            {(slices ?? []).map((slice, index) => (
              <li key={`${slice.label}-${index}`}><i style={{ background: sliceColor(index) }} /><span title={slice.label}>{slice.label} - {format(slice.value)}</span></li>
            ))}
          </ul>
        </section>
      </div>
      {tools.popups}
      <ScreenStatus hotKeys="" message={message} error={messageRed} version="" rows="" totals="" />
    </div>
  );
}
