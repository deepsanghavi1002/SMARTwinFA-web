"use client";

import { useEffect, useRef, useState } from "react";
import { HelpIcon } from "../grid/HelpIcon";
import { useDraggable } from "../grid/useDraggable";

/**
 * The Range print panel (panelRangePrint): the first and last number of a run of entries in the series on the screen. Ok ticks those
 * entries in the Find / Edit list (Btn_Range_print_ok_Click); Print then prints every ticked entry. Quit (or Esc) closes it.
 */
export function RangePanel({ series, onOk, onQuit }: { series: string; onOk: (from: number, to: number) => void; onQuit: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const drag = useDraggable();
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onQuit(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onQuit]);
  const start = Number.parseInt(from, 10);
  const end = Number.parseInt(to, 10);
  const ready = Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start;
  const submit = () => { if (ready) onOk(start, end); };
  const digits = (value: string) => value.replace(/\D/g, "").slice(0, 9);
  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label="Range print">
      <div className="ent-docs ent-range mp-help-scheme" style={drag.style}>
        <div className="mp-help-title" {...drag.handle} title="Drag to move the window">
          <span><HelpIcon name="file-text" /><b className="mp-help-name">RANGE PRINT</b></span>
        </div>
        <div className="ent-range-body">
          <p>Series <b>{series || "—"}</b>: the entries from the first to the last number are ticked in Find / Edit, ready to print.</p>
          <label>From Number <input ref={first} inputMode="numeric" value={from} onChange={(event) => setFrom(digits(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); (event.currentTarget.closest(".ent-range-body")?.querySelector<HTMLInputElement>("input[data-to]"))?.focus(); } }} /></label>
          <label>To Number <input data-to inputMode="numeric" value={to} onChange={(event) => setTo(digits(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} /></label>
        </div>
        <div className="ent-log-foot">
          <button type="button" className="mp-btn mp-btn-green" disabled={!ready} onClick={submit}>Ok</button>
          <button type="button" className="mp-btn mp-btn-red" onClick={onQuit}>Quit</button>
        </div>
      </div>
    </div>
  );
}
