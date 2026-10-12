"use client";

import { useMemo, useState } from "react";
import type { GroupSpec } from "../../lib/report/groupBy";
import { PIVOT_AGGREGATES, PIVOT_COUNT_KEY, PIVOT_MAX_COLUMNS, pivotColumnCount, pivotFields, pivotSpecKey, pivotValueColumns, valueCaption } from "../../lib/report/pivot";
import type { PivotAggregate, PivotSpec, PivotValue } from "../../lib/report/pivot";
import type { ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";

/**
 * Pivot (web only), like Excel's PivotTable field list: drag a field into Rows or Columns, a number column into Values (or use the
 * arrow buttons), set how each value is totalled, and Apply turns the grid into the cross table. Clear goes back to the report as it was.
 * It works on the rows already on screen, so it is instant and the same for every report.
 */

type Zone = "rows" | "columns" | "values";
const EMPTY: PivotSpec = { rows: [], columns: [], values: [] };

export function PivotPanel({ output, spec, onApply, onClose }: { output: ReportOutput; spec: PivotSpec | null; onApply: (spec: PivotSpec | null) => void; onClose: () => void }) {
  useEscapeClose(onClose);
  const [draft, setDraft] = useState<PivotSpec>(spec ?? EMPTY);
  const [dragging, setDragging] = useState<{ kind: "field"; spec: GroupSpec } | { kind: "value"; key: string } | null>(null);
  const [over, setOver] = useState<Zone | null>(null);

  const fields = useMemo(() => pivotFields(output), [output]);
  const numbers = useMemo(() => pivotValueColumns(output), [output]);
  const labelOfField = (field: GroupSpec) => fields.find((candidate) => pivotSpecKey(candidate.spec) === pivotSpecKey(field))?.label ?? field.key;
  const entries = output.rows.filter((row) => row.kind === "data").length;

  const used = new Set([...draft.rows, ...draft.columns].map(pivotSpecKey));
  const free = fields.filter((field) => !used.has(pivotSpecKey(field.spec)));
  const usedValues = new Set(draft.values.map((value) => value.key));
  const freeValues = [...numbers.map((column) => ({ key: column.key, label: column.caption })), { key: PIVOT_COUNT_KEY, label: "Count of rows" }].filter((value) => !usedValues.has(value.key));

  const wide = draft.values.length > 0 ? pivotColumnCount(output, draft) : 0;
  const tooWide = wide > PIVOT_MAX_COLUMNS;
  const ready = draft.values.length > 0 && draft.rows.length + draft.columns.length > 0 && !tooWide;

  const addField = (zone: "rows" | "columns", field: GroupSpec) => setDraft((current) => {
    const key = pivotSpecKey(field);
    const rows = current.rows.filter((entry) => pivotSpecKey(entry) !== key);
    const columns = current.columns.filter((entry) => pivotSpecKey(entry) !== key);
    return zone === "rows" ? { ...current, rows: [...rows, field], columns } : { ...current, rows, columns: [...columns, field] };
  });
  const addValue = (key: string) => setDraft((current) => (current.values.some((value) => value.key === key) ? current : { ...current, values: [...current.values, { key, aggregate: key === PIVOT_COUNT_KEY ? "count" : "sum" }] }));
  const removeField = (field: GroupSpec) => setDraft((current) => ({ ...current, rows: current.rows.filter((entry) => pivotSpecKey(entry) !== pivotSpecKey(field)), columns: current.columns.filter((entry) => pivotSpecKey(entry) !== pivotSpecKey(field)) }));
  const removeValue = (key: string) => setDraft((current) => ({ ...current, values: current.values.filter((value) => value.key !== key) }));
  const setAggregate = (key: string, aggregate: PivotAggregate) => setDraft((current) => ({ ...current, values: current.values.map((value) => (value.key === key ? { ...value, aggregate } : value)) }));
  const move = (zone: "rows" | "columns", index: number, by: -1 | 1) => setDraft((current) => {
    const list = [...current[zone]];
    const target = index + by;
    if (target < 0 || target >= list.length) return current;
    [list[index], list[target]] = [list[target], list[index]];
    return { ...current, [zone]: list };
  });

  const drop = (zone: Zone) => {
    if (dragging?.kind === "field" && zone !== "values") addField(zone, dragging.spec);
    else if (dragging?.kind === "value" && zone === "values") addValue(dragging.key);
    setDragging(null);
    setOver(null);
  };
  const zoneProps = (zone: Zone) => ({
    onDragOver: (event: React.DragEvent) => { if ((dragging?.kind === "field" && zone !== "values") || (dragging?.kind === "value" && zone === "values")) { event.preventDefault(); setOver(zone); } },
    onDragLeave: () => setOver((current) => (current === zone ? null : current)),
    onDrop: (event: React.DragEvent) => { event.preventDefault(); drop(zone); },
    className: `rp-pivot-zone ${over === zone ? "rp-pivot-over" : ""}`,
  });

  const fieldChip = (field: GroupSpec, zone: "rows" | "columns", index: number) => (
    <span key={pivotSpecKey(field)} className="rp-pivot-chip" draggable onDragStart={() => setDragging({ kind: "field", spec: field })} onDragEnd={() => { setDragging(null); setOver(null); }}>
      <button type="button" className="rp-pivot-chip-move" onClick={() => move(zone, index, -1)} disabled={index === 0} aria-label="Move earlier">‹</button>
      {labelOfField(field)}
      <button type="button" className="rp-pivot-chip-move" onClick={() => move(zone, index, 1)} disabled={index === draft[zone].length - 1} aria-label="Move later">›</button>
      <button type="button" className="rp-pivot-chip-x" onClick={() => removeField(field)} aria-label={`Remove ${labelOfField(field)}`}>×</button>
    </span>
  );

  return (
    <aside className="rp-chart rp-pivot" aria-label="Pivot">
      <div className="rp-chart-head">
        <b><Icon name="groupby" />Pivot</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close pivot">×</button>
      </div>
      <p className="rp-chart-note">Turns the {entries.toLocaleString("en-IN")} rows on screen into a cross table. Drag a field into Rows or Columns and a number into Values, or use the arrow buttons.</p>
      {fields.length === 0 && numbers.length === 0 ? <p className="rp-chart-empty">This report has nothing to pivot.</p> : (
        <>
          <div className="rp-pivot-list">
            <h4>Fields</h4>
            <div className="rp-pivot-chips">
              {free.length === 0 && <i className="rp-pivot-empty">all fields are in use</i>}
              {free.map((field) => (
                <span key={pivotSpecKey(field.spec)} className="rp-pivot-chip rp-pivot-free" draggable onDragStart={() => setDragging({ kind: "field", spec: field.spec })} onDragEnd={() => { setDragging(null); setOver(null); }}>
                  {field.label}
                  <button type="button" className="rp-pivot-chip-add" onClick={() => addField("rows", field.spec)} title="Add to Rows">→ Rows</button>
                  <button type="button" className="rp-pivot-chip-add" onClick={() => addField("columns", field.spec)} title="Add to Columns">→ Cols</button>
                </span>
              ))}
            </div>
            <h4>Numbers</h4>
            <div className="rp-pivot-chips">
              {freeValues.length === 0 && <i className="rp-pivot-empty">all numbers are in use</i>}
              {freeValues.map((value) => (
                <span key={value.key} className="rp-pivot-chip rp-pivot-free" draggable onDragStart={() => setDragging({ kind: "value", key: value.key })} onDragEnd={() => { setDragging(null); setOver(null); }}>
                  {value.label}
                  <button type="button" className="rp-pivot-chip-add" onClick={() => addValue(value.key)} title="Add to Values">→ Values</button>
                </span>
              ))}
            </div>
          </div>
          <div {...zoneProps("rows")}><h4>Rows</h4><div className="rp-pivot-chips">{draft.rows.length === 0 && <i className="rp-pivot-empty">drop fields here</i>}{draft.rows.map((field, index) => fieldChip(field, "rows", index))}</div></div>
          <div {...zoneProps("columns")}><h4>Columns</h4><div className="rp-pivot-chips">{draft.columns.length === 0 && <i className="rp-pivot-empty">drop fields here</i>}{draft.columns.map((field, index) => fieldChip(field, "columns", index))}</div></div>
          <div {...zoneProps("values")}>
            <h4>Values</h4>
            <div className="rp-pivot-chips">
              {draft.values.length === 0 && <i className="rp-pivot-empty">drop numbers here</i>}
              {draft.values.map((value: PivotValue) => (
                <span key={value.key} className="rp-pivot-chip" draggable onDragStart={() => setDragging({ kind: "value", key: value.key })} onDragEnd={() => { setDragging(null); setOver(null); }}>
                  {value.key === PIVOT_COUNT_KEY ? "Count of rows" : (
                    <>
                      <select value={value.aggregate} onChange={(event) => setAggregate(value.key, event.target.value as PivotAggregate)} aria-label="How to total">
                        {PIVOT_AGGREGATES.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
                      </select>
                      {" of "}{numbers.find((column) => column.key === value.key)?.caption ?? value.key}
                    </>
                  )}
                  <button type="button" className="rp-pivot-chip-x" onClick={() => removeValue(value.key)} aria-label={`Remove ${valueCaption(value, output.columns)}`}>×</button>
                </span>
              ))}
            </div>
          </div>
          {tooWide && <p className="rp-chart-note rp-pivot-warn">That would be {wide.toLocaleString("en-IN")} columns (the most is {PIVOT_MAX_COLUMNS}): choose a field with fewer values for Columns.</p>}
          <div className="rp-groupby-buttons">
            <button type="button" className="mp-btn mp-btn-green" onClick={() => onApply(draft)} disabled={!ready}>Apply</button>
            <button type="button" className="mp-btn mp-btn-plain" onClick={() => { setDraft(EMPTY); onApply(null); }} disabled={spec === null && draft.rows.length + draft.columns.length + draft.values.length === 0}>Clear</button>
          </div>
          {spec !== null && <p className="rp-chart-note">The grid shows this pivot. Clear brings back the report.</p>}
        </>
      )}
    </aside>
  );
}
