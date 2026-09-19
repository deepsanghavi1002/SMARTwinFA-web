"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";
import { evaluate } from "./calculate";

/**
 * A small calculator for numeric cells: work out 12.5 x 48 + 150 and put the answer in
 * the cell, the way an accountant would with a desk calculator. The expression is parsed
 * here (numbers, + - * / %, brackets); nothing typed is ever run as code.
 */

const KEYS = ["7", "8", "9", "/", "4", "5", "6", "*", "1", "2", "3", "-", "0", ".", "%", "+"];

export function Calculator({ initial, decimals, onUse, onClose, style, dragHandle }: { initial: string; decimals: number; onUse: (value: string) => void; onClose: () => void; style?: CSSProperties; dragHandle?: HTMLAttributes<HTMLDivElement> }) {
  const [expression, setExpression] = useState(initial.replace(/,/g, ""));
  const box = useRef<HTMLInputElement>(null);
  // The cell's value starts selected, so typing replaces it and a key button adds to it.
  useEffect(() => { box.current?.focus(); box.current?.select(); }, []);
  const result = evaluate(expression);
  const places = Math.max(0, Math.min(6, decimals));
  const shown = result === null ? "" : result.toFixed(places);
  const apply = () => { if (result !== null) onUse(shown); };
  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); apply(); }
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };
  return (
    <div className="mp-calc" role="dialog" aria-label="Calculator" style={style}>
      <div className="mp-calc-title mp-drag-handle" {...dragHandle} title="Drag to move">Calculator</div>
      <input
        className="mp-calc-input"
        aria-label="Expression"
        value={expression}
        ref={box}
        onChange={(event) => setExpression(event.target.value)}
        onKeyDown={keys}
      />
      <div className="mp-calc-result" aria-live="polite">{expression.trim() === "" ? "0" : result === null ? "—" : `= ${Number(shown).toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places })}`}</div>
      <div className="mp-calc-keys">
        {KEYS.map((key) => <button key={key} type="button" onClick={() => { setExpression((current) => current + key); box.current?.focus(); }}>{key === "*" ? "×" : key === "/" ? "÷" : key}</button>)}
        <button type="button" onClick={() => setExpression((current) => current + "(")}>(</button>
        <button type="button" onClick={() => setExpression((current) => current + ")")}>)</button>
        <button type="button" onClick={() => setExpression((current) => current.slice(0, -1))} aria-label="Backspace">⌫</button>
        <button type="button" onClick={() => { setExpression(""); box.current?.focus(); }} title="Clear the figure">C</button>
      </div>
      <div className="mp-calc-actions">
        <button type="button" className="mp-btn mp-btn-plain" onClick={() => onUse("")} title="Empty the cell">Clear Field</button>
        <button type="button" className="mp-btn mp-btn-green" disabled={result === null} onClick={apply}>Use</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
