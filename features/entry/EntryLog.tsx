"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EntryLog as EntryLogData } from "../../lib/entry/log";

/**
 * The Log window of an entry (ShowGridForm): each save of the entry in its own column, the
 * Add first. A cell that differs from the one before it is coloured the way the desktop does:
 * yellow for a first change, green when the cell before was yellow, red when it was green.
 */

type Tone = "" | "yellow" | "green" | "red";

const same = (current: string, previous: string) => {
  const a = Number(current.trim());
  const b = Number(previous.trim());
  if (current.trim() !== "" && previous.trim() !== "" && Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return current.trim().toLowerCase() === previous.trim().toLowerCase();
};

/** DataGridView's cell colours for one row. */
function tones(cells: readonly string[]): Tone[] {
  const out: Tone[] = cells.map(() => "");
  for (let index = 1; index < cells.length; index += 1) {
    if (cells[index] === "" || cells[index - 1] === "" || same(cells[index], cells[index - 1])) continue;
    out[index] = out[index - 1] === "yellow" ? "green" : out[index - 1] === "green" ? "red" : "yellow";
  }
  return out;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

export function EntryLog({ log, title, onClose }: { log: EntryLogData; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const heading = (index: number) => (index === 0 ? "Add Value" : `Edit Value ${index}`);
  const shown = useMemo(() => log.rows.map((row) => ({ row, tone: tones(row.cells) })), [log]);

  useEffect(() => {
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);

  /** Export: a CSV the spreadsheet opens (the desktop's Excel file keeps the colours; a CSV cannot). */
  const exportCsv = () => {
    const lines = [["Group", "Field", ...log.versions.map((_v, index) => heading(index))].map(csvCell).join(",")];
    for (const { row } of shown) lines.push([row.kind === "head" ? "" : row.group, row.name, ...row.cells].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title} Log.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label={`${title} Log`}>
      <div className="ent-log">
        <div className="ent-log-title">{title} Log</div>
        {log.rows.length === 0 ? <p className="ent-log-empty">No log records for this entry.</p> : (
          <div className="ent-log-scroll">
            <table className="ent-log-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Field</th>
                  {log.versions.map((version, index) => (
                    <th key={index} title={`${version.user}  ${version.machine}`}>
                      {heading(index)}
                      <small>{version.user} · {version.savedate} {version.savetime}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row, tone }, index) => (
                  <tr key={index} className={row.kind === "head" ? "ent-log-head" : undefined}>
                    <td>{row.kind === "head" ? "" : row.group}</td>
                    <td>{row.name}</td>
                    {row.cells.map((cell, at) => <td key={at} className={tone[at] ? `ent-log-${tone[at]}` : undefined}>{row.kind === "head" ? (cell === "" ? "" : cell) : cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ent-log-foot">
          <button type="button" className="mp-btn mp-btn-blue" disabled={log.rows.length === 0} onClick={exportCsv}>Export to CSV</button>
          <button type="button" ref={closeRef} className="mp-btn mp-btn-red" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
