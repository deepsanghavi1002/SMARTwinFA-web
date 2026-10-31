"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormulaColumn } from "../../lib/report/formulaColumns";
import { FORMULA_KEY, workOut } from "../../lib/report/formulaColumns";
import { FormulaError, normalizeFormula, parseFormula, letterOf } from "../../lib/report/sheetFormula";
import type { ReportOutput } from "../../lib/report/types";
import { FORMULA_HELP, HELP_GROUPS, HELP_NOT_AVAILABLE, fillExample } from "../../lib/report/formulaHelp";

/**
 * Add Column: a column added to the report's output at run time, with a spreadsheet-style formula (=QTY*RATE for each row,
 * =SUM(QTY*RATE) for one figure). Its cells follow the formula; Excel gets the same formula as a real one.
 */
export function FormulaColumns({ output, shown, specs, onChange, onClose, others }: {
  /** The other open reports and their columns (for the easy lookup). */
  others?: () => { title: string; columns: readonly string[] }[];
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
  /** Minimized: only a small bar shows (on top of every window, so the other tabs can be looked at); what is typed is kept. */
  const [minimized, setMinimized] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const formulaInput = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    if (minimized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, minimized]);

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
  // The easy lookup: a few choices write the VLOOKUP formula (any other open window with data).
  const [lookupOpen, setLookupOpen] = useState(false);
  const [pick, setPick] = useState({ report: "", mine: "", theirs: "", bring: "", zero: true, exact: true });
  // The easy SUMIF: adds up (counts, averages) the figures that match, in this report or in another open one.
  const [sumOpen, setSumOpen] = useState(false);
  const [sum, setSum] = useState({ fn: "SUMIF", source: "", sumCol: "", whereCol: "", same: true, mine: "", op: "=", value: "" });
  // Pick a formula: every function in plain words; a click writes its example, with this report's columns, into the Formula box.
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const [helpGroup, setHelpGroup] = useState<string>("All");
  const wanted = helpQuery.trim().toLowerCase();
  const helpList = FORMULA_HELP.filter((item) => (helpGroup === "All" || item.group === helpGroup) && (wanted === "" || `${item.name} ${item.task}`.toLowerCase().includes(wanted)));
  const applyHelp = (item: (typeof FORMULA_HELP)[number]) => {
    setFormula(fillExample(item.example, output.columns.map((column) => ({ caption: column.caption, kind: column.kind }))));
    if (name.trim() === "" && item.title) setName(item.title);
    setError("");
    setHelpOpen(false);
    formulaInput.current?.focus();
  };
  // Look up, step by step: a plain question for each, the columns picked from lists, then the formula is written.
  const [guide, setGuide] = useState<"find" | "nth" | "where" | "count" | "">("");
  const [steps, setSteps] = useState({ mine: "", where: "", bring: "", column: "", line: "1", missing: "Not found" });
  const pickable = shown.filter((column) => column.key !== editing).map((column) => column.caption);
  const stepOf = (key: "mine" | "where" | "bring" | "column") => (pickable.includes(steps[key]) ? steps[key] : key === "bring" ? (pickable[1] ?? pickable[0] ?? "") : (pickable[0] ?? ""));
  const writeGuide = () => {
    const [mine, where, bring, column] = [stepOf("mine"), stepOf("where"), stepOf("bring"), stepOf("column")];
    const quote = (text: string) => text.replace(/"/g, '""');
    if (guide === "find") { setFormula(`XLOOKUP([${mine}], [${where}], [${bring}], ${steps.missing.trim() === "" ? "0" : `"${quote(steps.missing)}"`})`); if (name.trim() === "") setName(bring.replace(/[.]+$/, "")); }
    else if (guide === "nth") { setFormula(`INDEX([${column}], ${Math.max(1, Math.trunc(Number(steps.line)) || 1)})`); if (name.trim() === "") setName(`${column.replace(/[.]+$/, "")} Line ${Math.max(1, Math.trunc(Number(steps.line)) || 1)}`); }
    else if (guide === "where") { setFormula(`MATCH([${mine}], [${where}], 0)`); if (name.trim() === "") setName("Line No"); }
    else if (guide === "count") { setFormula(`ROWS([${column}])`); if (name.trim() === "") setName("Total Lines"); }
    else return;
    setError("");
    setHelpOpen(false);
    formulaInput.current?.focus();
  };
  const columnList = (key: "mine" | "where" | "bring" | "column") => (
    <select value={stepOf(key)} onChange={(event) => setSteps({ ...steps, [key]: event.target.value })}>{pickable.map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select>
  );
  const lookupGuide = () => (
    <ul className="fc-help-list fc-guide">
      <li className="fc-guide-card">
        <div><b>Bring a figure from another open report</b><span>For example the rate from the Item Master, or a party&apos;s balance from the Ledger report. Open that report first.</span></div>
        <button type="button" className="pc-btn pc-btn-primary" onClick={() => { setHelpOpen(false); setLookupOpen(true); }}>Start</button>
      </li>
      <li className="fc-guide-card">
        <div><b>Find the same name in another column of this report, and bring that line&apos;s figure</b><span>For example: for each Voucher No, bring the Amount of the line where that Voucher No is in the Reference column.</span></div>
        <button type="button" className={`pc-btn ${guide === "find" ? "pc-btn-outline" : "pc-btn-primary"}`} onClick={() => setGuide(guide === "find" ? "" : "find")}>{guide === "find" ? "Close" : "Start"}</button>
        {guide === "find" && (
          <div className="fc-guide-form">
            <label>1. The value to look for is in my column{columnList("mine")}</label>
            <label>2. Look for it in this column{columnList("where")}</label>
            <label>3. When found, bring me the figure of this column{columnList("bring")}</label>
            <label>4. If it is not found, show<input value={steps.missing} onChange={(event) => setSteps({ ...steps, missing: event.target.value })} placeholder="Not found (empty gives 0)" /></label>
            <button type="button" className="pc-btn pc-btn-primary" onClick={writeGuide}>Write the formula for me</button>
          </div>
        )}
      </li>
      <li className="fc-guide-card">
        <div><b>Serial number of each line (1, 2, 3...)</b><span>A Sr. No. column that counts the lines.</span></div>
        <button type="button" className="pc-btn pc-btn-primary" onClick={() => applyHelp({ name: "ROW", group: "Look up", task: "", example: "=ROW()", title: "Sr No" })}>Use</button>
      </li>
      <li className="fc-guide-card">
        <div><b>The figure on a particular line of a column</b><span>For example the 5th line of the Amount column, shown on every line.</span></div>
        <button type="button" className={`pc-btn ${guide === "nth" ? "pc-btn-outline" : "pc-btn-primary"}`} onClick={() => setGuide(guide === "nth" ? "" : "nth")}>{guide === "nth" ? "Close" : "Start"}</button>
        {guide === "nth" && (
          <div className="fc-guide-form">
            <label>1. Take it from this column{columnList("column")}</label>
            <label>2. Line number<input type="number" min={1} value={steps.line} onChange={(event) => setSteps({ ...steps, line: event.target.value })} /></label>
            <button type="button" className="pc-btn pc-btn-primary" onClick={writeGuide}>Write the formula for me</button>
          </div>
        )}
      </li>
      <li className="fc-guide-card">
        <div><b>On which line is a value</b><span>Gives the line number where the same value is found in another column.</span></div>
        <button type="button" className={`pc-btn ${guide === "where" ? "pc-btn-outline" : "pc-btn-primary"}`} onClick={() => setGuide(guide === "where" ? "" : "where")}>{guide === "where" ? "Close" : "Start"}</button>
        {guide === "where" && (
          <div className="fc-guide-form">
            <label>1. The value to look for is in my column{columnList("mine")}</label>
            <label>2. Look for it in this column{columnList("where")}</label>
            <button type="button" className="pc-btn pc-btn-primary" onClick={writeGuide}>Write the formula for me</button>
          </div>
        )}
      </li>
      <li className="fc-guide-card">
        <div><b>How many lines a column has</b><span>The count of the lines, shown on every line.</span></div>
        <button type="button" className={`pc-btn ${guide === "count" ? "pc-btn-outline" : "pc-btn-primary"}`} onClick={() => setGuide(guide === "count" ? "" : "count")}>{guide === "count" ? "Close" : "Start"}</button>
        {guide === "count" && (
          <div className="fc-guide-form">
            <label>Count the lines of this column{columnList("column")}</label>
            <button type="button" className="pc-btn pc-btn-primary" onClick={writeGuide}>Write the formula for me</button>
          </div>
        )}
      </li>
    </ul>
  );
  const reports = lookupOpen || sumOpen ? (others?.() ?? []) : [];
  const chosen = reports.find((report) => report.title === pick.report) ?? reports[0];
  const putLookup = () => {
    if (!chosen) return;
    const mine = pick.mine || shown[0]?.caption || "";
    const theirs = chosen.columns.includes(pick.theirs) ? pick.theirs : chosen.columns[0];
    const bring = chosen.columns.includes(pick.bring) ? pick.bring : (chosen.columns[1] ?? chosen.columns[0]);
    const from = chosen.columns.indexOf(theirs), to = chosen.columns.indexOf(bring);
    const quote = (text: string) => text.replace(/"/g, '""');
    const core = `VLOOKUP([${mine}], "${quote(chosen.title)}!${quote(theirs)}:${quote(bring)}", ${Math.abs(to - from) + 1}, ${pick.exact ? 0 : 1})`;
    setFormula(pick.zero ? `IFERROR(${core}, 0)` : core);
    if (name.trim() === "") setName(bring.replace(/[.]+$/, ""));
    setError("");
    formulaInput.current?.focus();
  };
  const mineColumns = shown.filter((column) => column.key !== editing).map((column) => column.caption);
  const sourceReport = reports.find((report) => report.title === sum.source);
  const sourceColumns = sum.source !== "" && sourceReport ? [...sourceReport.columns] : mineColumns;
  const putSum = () => {
    const quote = (text: string) => text.replace(/"/g, '""');
    const here = sum.source === "" || !sourceReport;
    const ref = (caption: string) => (here ? `[${caption}]` : `"${quote(sourceReport!.title)}!${quote(caption)}"`);
    const whereCol = sourceColumns.includes(sum.whereCol) ? sum.whereCol : sourceColumns[0];
    const sumCol = sourceColumns.includes(sum.sumCol) ? sum.sumCol : (sourceColumns[1] ?? sourceColumns[0]);
    let criteria: string;
    if (sum.same) criteria = `[${mineColumns.includes(sum.mine) ? sum.mine : mineColumns[0]}]`;
    else {
      const typed = sum.value.trim();
      const plain = quote(typed);
      if (sum.op === "=") criteria = typed !== "" && Number.isFinite(Number(typed.replace(/,/g, ""))) ? typed.replace(/,/g, "") : `"${plain}"`;
      else if (sum.op === "begins") criteria = `"${plain}*"`;
      else if (sum.op === "contains") criteria = `"*${plain}*"`;
      else criteria = `"${sum.op}${plain}"`;
    }
    setFormula(sum.fn === "COUNTIF" ? `COUNTIF(${ref(whereCol)}, ${criteria})` : `${sum.fn}(${ref(whereCol)}, ${criteria}, ${ref(sumCol)})`);
    if (name.trim() === "") setName(sum.fn === "COUNTIF" ? "Count" : sumCol.replace(/[.]+$/, ""));
    setError("");
    formulaInput.current?.focus();
  };
  const edit = (spec: FormulaColumn) => { setEditing(spec.key); setName(spec.caption); setFormula(spec.formula); setDecimals(spec.decimals); setError(""); input.current?.focus(); };

  // On the page itself (not inside the report's window), so it stays in sight when another tab is brought to the front.
  if (typeof document === "undefined") return null;
  if (minimized) {
    return createPortal(
      <div className="fc-mini" role="dialog" aria-label="Add Column (minimized)">
        <strong>Add Column</strong>
        <button type="button" aria-label="Restore" title="Restore" onClick={() => setMinimized(false)}>▢</button>
        <button type="button" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </div>,
      document.body,
    );
  }
  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a press on the backdrop outside the box closes it; Escape does from the keyboard
    <div className="dash-modal" role="dialog" aria-modal="true" aria-label="Add Column" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dash-drill fc-dialog">
        <header><span className="fc-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg></span><h3>Add Column</h3><button type="button" className="pc-btn pc-btn-outline fc-min" title="Minimize: the other tabs can be looked at, and the formula is kept" onClick={() => setMinimized(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" /></svg>Minimize</button><button type="button" className="pc-btn pc-btn-danger fc-close" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>Close</button></header>
        <div className="fc-body">
          <div className="fc-row">
            <label><span className="fc-cap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 12c0 1.7 3.6 3 8 3s8-1.3 8-3M4 17c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>Column name</span><input ref={input} value={name} placeholder="e.g. Amount" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} /></label>
            <label><span className="fc-cap">Decimals</span><select value={decimals} onChange={(event) => setDecimals(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          </div>
          <label className="fc-formula"><span className="fc-cap"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 7h6M9 12h2M13 12h2M9 16h2M13 16h2" /></svg>Formula</span>
            <input ref={formulaInput} value={formula} placeholder="=QTY*RATE      =SUM(QTY*RATE)      =IF(C>0, C*D, 0)" onChange={(event) => setFormula(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") save(); }} spellCheck={false} />
          </label>
          <div className="fc-lookup">
            <button type="button" className="pc-btn pc-btn-outline" onClick={() => setLookupOpen((open) => !open)}>{lookupOpen ? "Hide the easy lookup" : "Fetch a figure from another open report (easy lookup)"}</button>
            {lookupOpen && (reports.length === 0
              ? <p className="fc-hint">No other report is open. Open the report you want to take the figure from (in its own window), then come back here.</p>
              : (
                <div className="fc-lookup-box">
                  <label>1. Take it from report<select value={chosen?.title ?? ""} onChange={(event) => setPick({ ...pick, report: event.target.value, theirs: "", bring: "" })}>{reports.map((report) => <option key={report.title} value={report.title}>{report.title}</option>)}</select></label>
                  <label>2. My column that has the same name / number<select value={pick.mine} onChange={(event) => setPick({ ...pick, mine: event.target.value })}>{shown.filter((column) => column.key !== editing).map((column) => <option key={column.key} value={column.caption}>{column.caption}</option>)}</select></label>
                  <label>3. Their column that has it too<select value={pick.theirs} onChange={(event) => setPick({ ...pick, theirs: event.target.value })}>{(chosen?.columns ?? []).map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select></label>
                  <label>4. Bring me their column<select value={pick.bring} onChange={(event) => setPick({ ...pick, bring: event.target.value })}>{(chosen?.columns ?? []).map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select></label>
                  <label className="fc-check"><input type="checkbox" checked={pick.exact} onChange={(event) => setPick({ ...pick, exact: event.target.checked })} /> Same name only (exact match)</label>
                  <label className="fc-check"><input type="checkbox" checked={pick.zero} onChange={(event) => setPick({ ...pick, zero: event.target.checked })} /> Show 0 when it is not found</label>
                  <button type="button" className="pc-btn pc-btn-primary" onClick={putLookup}>Write the formula for me</button>
                  <p className="fc-hint">It fills the Formula box above (and the column name if empty); then press Add Column. If the other report has the name on many lines, their figures are added up.</p>
                </div>
              ))}
          </div>
          <div className="fc-lookup">
            <button type="button" className="pc-btn pc-btn-outline" onClick={() => setSumOpen((open) => !open)}>{sumOpen ? "Hide the easy add-up" : "Add up / count the figures that match (easy SUMIF)"}</button>
            {sumOpen && (
              <div className="fc-lookup-box">
                <label>What do you want<select value={sum.fn} onChange={(event) => setSum({ ...sum, fn: event.target.value })}><option value="SUMIF">Add up the figures</option><option value="COUNTIF">Count the lines</option><option value="AVERAGEIF">Average of the figures</option></select></label>
                <label>1. Look in<select value={sum.source} onChange={(event) => setSum({ ...sum, source: event.target.value, sumCol: "", whereCol: "" })}><option value="">This report</option>{reports.map((report) => <option key={report.title} value={report.title}>{report.title}</option>)}</select></label>
                {sum.fn !== "COUNTIF" && <label>2. Add up this column<select value={sourceColumns.includes(sum.sumCol) ? sum.sumCol : (sourceColumns[1] ?? sourceColumns[0] ?? "")} onChange={(event) => setSum({ ...sum, sumCol: event.target.value })}>{sourceColumns.map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select></label>}
                <label>3. Only the lines where this column<select value={sourceColumns.includes(sum.whereCol) ? sum.whereCol : (sourceColumns[0] ?? "")} onChange={(event) => setSum({ ...sum, whereCol: event.target.value })}>{sourceColumns.map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select></label>
                <label>4. is<select value={sum.same ? "same" : "typed"} onChange={(event) => setSum({ ...sum, same: event.target.value === "same" })}><option value="same">the same as my column (on each line of this report)</option><option value="typed">a value I type</option></select></label>
                {sum.same
                  ? <label>My column<select value={mineColumns.includes(sum.mine) ? sum.mine : (mineColumns[0] ?? "")} onChange={(event) => setSum({ ...sum, mine: event.target.value })}>{mineColumns.map((caption, at) => <option key={`${caption}${at}`} value={caption}>{caption}</option>)}</select></label>
                  : (
                    <div className="fc-row">
                      <label>Condition<select value={sum.op} onChange={(event) => setSum({ ...sum, op: event.target.value })}><option value="=">equals</option><option value="<>">is not</option><option value=">">is more than</option><option value=">=">is at least</option><option value="<">is less than</option><option value="<=">is at most</option><option value="begins">begins with</option><option value="contains">contains</option></select></label>
                      <label>Value<input value={sum.value} onChange={(event) => setSum({ ...sum, value: event.target.value })} placeholder="e.g. Cash or 1000" /></label>
                    </div>
                  )}
                <button type="button" className="pc-btn pc-btn-primary" onClick={putSum}>Write the formula for me</button>
                <p className="fc-hint">It fills the Formula box above; then press Add Column. &quot;The same as my column&quot; gives every line the total of all the matching lines; a typed value gives one figure on the last line.</p>
              </div>
            )}
          </div>
          <div className="fc-lookup">
            <button type="button" className="pc-btn pc-btn-outline" onClick={() => setHelpOpen((open) => !open)}>{helpOpen ? "Hide the formula list" : `Pick a formula from the full list (${FORMULA_HELP.length} functions, in simple words)`}</button>
            {helpOpen && (
              <div className="fc-help">
                <input className="fc-help-find" value={helpQuery} onChange={(event) => setHelpQuery(event.target.value)} placeholder="Type what you want to do: round, total, if, date, text, lookup..." aria-label="Search the formulas" />
                <div className="fc-help-groups">
                  {["All", ...HELP_GROUPS].map((group) => <button key={group} type="button" className={helpGroup === group ? "fc-on" : ""} onClick={() => setHelpGroup(group)}>{group}</button>)}
                </div>
                {helpGroup === "Look up" && wanted === "" ? lookupGuide() : <ul className="fc-help-list">
                  {helpList.map((item) => (
                    <li key={`${item.group}-${item.name}`}>
                      <div><b>{item.name}</b> <span>{item.task}</span><code>{fillExample(item.example, output.columns.map((column) => ({ caption: column.caption, kind: column.kind })))}</code></div>
                      <button type="button" className="pc-btn pc-btn-primary" onClick={() => applyHelp(item)}>Use</button>
                    </li>
                  ))}
                  {helpList.length === 0 && <li className="fc-help-none">Nothing matches. Try another word.</li>}
                </ul>}
                <p className="fc-hint">Not here: {HELP_NOT_AVAILABLE}</p>
              </div>
            )}
          </div>
          {error && <p className="fc-error" role="alert">{error}</p>}
          <div className="fc-info"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg><p className="fc-hint">
            A column named on its own is the cell of the row; inside SUM, AVERAGE, MIN, MAX or COUNT it is the whole column, so <b>=SUM(QTY*RATE)</b> adds up each row&apos;s QTY times RATE (one figure, shown on the last row).
            Not sure how? Press &quot;Pick a formula from the full list&quot;, find what you want to do in plain words and press Use: it writes the formula with your columns. Also: + - * / ^ &amp; % ( ), = &lt;&gt; &lt; &gt; &lt;= &gt;=, IF, AND, OR, NOT, ROUND, ABS, INT, SQRT, MOD, IFERROR, SUMIF(range, criteria, sum_range), COUNTIF, AVERAGEIF, VLOOKUP(&quot;value&quot;,&quot;Report!C:H&quot;,column,0) (another open report; a value on several lines of it adds their figures up). In Excel the column is a real formula.
          </p></div>
          <div className="fc-columns" aria-label="Columns you can use">
            {shown.filter((column) => column.key !== editing).map((column, index) => (
              <button key={column.key} type="button" title={`Insert [${column.caption}]`} onClick={() => { setFormula((current) => `${current}[${column.caption}]`); formulaInput.current?.focus(); }}>
                <b>{letterOf(shown.findIndex((entry) => entry.key === column.key) + 1 || index + 1)}</b> {column.caption}
              </button>
            ))}
          </div>
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
        <footer className="fc-foot">
          <div className="fc-actions"><button type="button" className="pc-btn pc-btn-primary" onClick={save}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>{editing ? "Update Column" : "Add Column"}</button>{editing && <button type="button" className="pc-btn pc-btn-outline" onClick={() => { setEditing(null); setName(""); setFormula(""); setError(""); }}>Cancel</button>}</div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
