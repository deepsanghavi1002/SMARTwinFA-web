"use client";

import { useState } from "react";
import { dateColumns, PERIOD_UNITS, specCaption } from "../../lib/report/groupBy";
import type { GroupSpec, PeriodUnit } from "../../lib/report/groupBy";
import type { ReportOutput } from "../../lib/report/types";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";

/**
 * Group By (web only): up to three levels to regroup the rows on screen, outermost first. A level
 * is a text column (party, voucher type, area ...) or a period (day, week, 15 days, month, quarter, year)
 * of a date column (any column that holds dates). Apply regroups the grid with subtotals; Clear goes back to the report as it was.
 */

const LEVELS = 3;

/** A level as a select value: "col:<key>" or "per:<key>:<unit>". */
const encode = (spec: GroupSpec | undefined) => (!spec ? "" : spec.kind === "column" ? `col:${spec.key}` : `per:${spec.key}:${spec.unit}`);
function decode(value: string): GroupSpec | null {
  if (value.startsWith("col:")) return { kind: "column", key: value.slice(4) };
  if (value.startsWith("per:")) {
    const [, key, unit] = value.split(":");
    return key && unit ? { kind: "period", key, unit: unit as PeriodUnit } : null;
  }
  return null;
}

export function GroupByPanel({ output, specs, onApply, onClose }: { output: ReportOutput; specs: readonly GroupSpec[]; onApply: (specs: GroupSpec[]) => void; onClose: () => void }) {
  useEscapeClose(onClose);
  const [draft, setDraft] = useState<string[]>(() => Array.from({ length: LEVELS }, (_, index) => encode(specs[index])));

  const texts = output.columns.filter((column) => column.kind === "text" && column.key !== "HEADING_COLUMN_BY_SYSTEM");
  const dates = dateColumns(output);
  const options: { value: string; label: string }[] = [
    ...texts.map((column) => ({ value: `col:${column.key}`, label: column.caption })),
    ...dates.flatMap((column) => PERIOD_UNITS.map(([unit, name]) => ({ value: `per:${column.key}:${unit}`, label: `${column.caption} by ${name}` }))),
  ];

  const chosen = draft.map(decode).filter((spec): spec is GroupSpec => spec !== null);
  const apply = () => {
    // The same level twice would be one group inside itself: keep the first.
    const seen = new Set<string>();
    onApply(chosen.filter((spec) => { const value = encode(spec); if (seen.has(value)) return false; seen.add(value); return true; }));
  };
  const entries = output.rows.filter((row) => row.kind === "data").length;

  return (
    <aside className="rp-chart rp-groupby" aria-label="Group by">
      <div className="rp-chart-head">
        <b><Icon name="groupby" />Group by</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close group by">×</button>
      </div>
      <p className="rp-chart-note">Regroups the {entries.toLocaleString("en-IN")} rows on screen, outermost group first. Openings, closings and the report&apos;s own subtotals are left out, and the running balance is not shown.</p>
      {options.length === 0 ? <p className="rp-chart-empty">This report has no column to group by.</p> : (
        <>
          {draft.map((value, index) => (
            <label key={index} className="rp-groupby-level">
              <span>{index === 0 ? "Group by" : "Then by"}</span>
              <select value={value} onChange={(event) => setDraft((current) => current.map((entry, at) => (at === index ? event.target.value : entry)))}>
                <option value="">{index === 0 ? "— choose —" : "— none —"}</option>
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ))}
          <div className="rp-groupby-buttons">
            <button type="button" className="mp-btn mp-btn-green" onClick={apply} disabled={chosen.length === 0}>Apply</button>
            <button type="button" className="mp-btn mp-btn-plain" onClick={() => { setDraft(Array.from({ length: LEVELS }, () => "")); onApply([]); }} disabled={specs.length === 0 && chosen.length === 0}>Clear</button>
          </div>
          {specs.length > 0 && <p className="rp-chart-note">Grouped by {specs.map((spec) => specCaption(spec, output.columns)).join(" › ")}. Create Tree opens and closes the groups; F6 shows only the subtotals.</p>}
        </>
      )}
    </aside>
  );
}
