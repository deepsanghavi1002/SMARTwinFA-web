"use client";

import { useEffect, useRef, useState } from "react";
import type { FormulaColumn } from "../../lib/report/formulaColumns";
import { FORMULA_KEY, workOut } from "../../lib/report/formulaColumns";
import { FormulaError, normalizeFormula, parseFormula, letterOf } from "../../lib/report/sheetFormula";
import type { ReportOutput } from "../../lib/report/types";

/**
 * Add Column: a column added to the report's output at run time, with a spreadsheet-style formula (=QTY*RATE for each row,
 * =SUM(QTY*RATE) for one figure). Its cells follow the formula; Excel gets the same formula as a real one.
 */
export function FormulaColumns({ output, shown, specs, onChange, onClose }: {
  /** The report's output without the added columns. */
  output: ReportOutput;
  /** The columns as the grid shows them, in order (their place is their Excel letter). */
  shown: readonly { key: string; caption: string }[];
  specs: readonly FormulaColumn[];
  onChange: (specs: readonly FormulaColumn[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [formula, setFormula] = useState("");
  const [decimals, setDecimals] = useState(2);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // What each added column gives: one figure (shown on the last row) or a value for every row.
  const results = new Map(workOut(output, specs).worked.map((item) => [item.column.key, item]));
  const resultText = (key: string) => {
    const item = results.get(key);
    if (!item) return "";
    if (item.error) return item.error;
    if (item.perRow) return "A value on every row; its sum on the subtotals and total";
    const value = item.scalar;
    return `One figure: ${typeof value === "number" ? value.toLocaleString("en-IN", { minimumFractionDigits: item.column.decimals, maximumFractionDigits: item.column.decimals }) : String(value ?? "")} (on the last row). Leave out SUM(...) for a value on every row.`;
  };
  const reportColumns = output.columns.map((column) => ({ key: column.key, caption: column.caption }));
  const everyColumn = [...reportColumns, ...specs.filter((spec) => spec.key !== editing).map((spec) => ({ key: spec.key, caption: spec.caption }))];

  const save = () => {
    setError("");
    try {
      const caption = (name.trim() || `Column${specs.length + 1}`).replace(/[[\]]/g, "");
      if (everyColumn.some((column) => column.caption.toUpperCase() === caption.toUpperCase())) throw new FormulaError(`There is already a column ${caption}`);
      const text = normalizeFormula(formula, shown, everyColumn);
      parseFormula(text);
      const key = editing ?? `${FORMULA_KEY}${Date.now().toString(36)}`;
      const next: FormulaColumn = { key, caption, formula: text, decimals };
      const list = editing ? specs.map((spec) => (spec.key === editing ? next : spec)) : [...specs, next];
      // Worked out once here, so a formula that names no column or cannot be read is refused before it is added.
      const result = workOut(output, list);
      const failure = result.worked.find((item) => item.error);
      if (failure) throw new FormulaError(failure.error);
      onChange(list);
      setName(""); setFormula(""); setEditing(null);
    } catch (failure) {
      setError(failure instanceof FormulaError ? failure.message : "The formula could not be read");
    }
  };
  const edit = (spec: FormulaColumn) => { setEditing(spec.key); setName(spec.caption); setFormula(spec.formula); setDecimals(spec.decimals); setError(""); input.current?.focus(); };

  return (
    <div className="dash-modal" role="dialog" aria-modal="true" aria-label="Add Column" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dash-drill fc-dialog">
        <header><h3>Add Column</h3><button type="button" className="pc-btn pc-btn-danger" onClick={onClose}>Close</button></header>
        <div className="fc-body">
          <div className="fc-row">
            <label>Column name<input ref={input} value={name} placeholder="e.g. Amount" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} /></label>
            <label>Decimals<select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <label className="fc-formula">Formula
            <input value={formula} placeholder="=QTY*RATE      =SUM(QTY*RATE)      =IF(C>0, C*D, 0)" onChange={(event) => setFormula(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} spellCheck={false} />
          </label>
          {error && <p className="fc-error" role="alert">{error}</p>}
          <p className="fc-hint">
            A column named on its own is the cell of the row; inside SUM, AVERAGE, MIN, MAX or COUNT it is the whole column, so <b>=SUM(QTY*RATE)</b> adds up each row&apos;s QTY times RATE (one figure, shown on the last row).
            Also: + - * / ^ &amp; % ( ), = &lt;&gt; &lt; &gt; &lt;= &gt;=, IF, AND, OR, NOT, ROUND, ABS, INT, SQRT, MOD, IFERROR. In Excel the column is a real formula.
          </p>
          <div className="fc-columns" aria-label="Columns you can use">
            {shown.filter((column) => !column.key.startsWith(FORMULA_KEY)).map((column, index) => (
              <button key={column.key} type="button" title={`Insert [${column.caption}]`} onClick={() => { setFormula((current) => `${current}[${column.caption}]`); input.current?.focus(); }}>
                <b>{letterOf(shown.findIndex((entry) => entry.key === column.key) + 1 || index + 1)}</b> {column.caption}
              </button>
            ))}
          </div>
          <div className="fc-actions"><button type="button" className="pc-btn pc-btn-primary" onClick={save}>{editing ? "Update Column" : "Add Column"}</button>{editing && <button type="button" className="pc-btn pc-btn-outline" onClick={() => { setEditing(null); setName(""); setFormula(""); setError(""); }}>Cancel</button>}</div>
          {specs.length > 0 && (
            <table className="fc-list">
              <thead><tr><th>Added column</th><th>Formula</th><th>Result</th><th /></tr></thead>
              <tbody>
                {specs.map((spec) => (
                  <tr key={spec.key}>
                    <td>{spec.caption}</td><td><code>={spec.formula}</code></td><td className="fc-result">{resultText(spec.key)}</td>
                    <td className="fc-buttons"><button type="button" className="pc-btn pc-btn-outline" onClick={() => edit(spec)}>Edit</button><button type="button" className="pc-btn pc-btn-danger" onClick={() => onChange(specs.filter((entry) => entry.key !== spec.key))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
