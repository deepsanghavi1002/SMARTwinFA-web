"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * The list behind a bar or a balance (the desktop's ModernGridForm): searchable, sortable by a column heading, in pages, with the
 * list as Excel (a .csv Excel opens) or PDF (the browser's print to PDF).
 */

export type DrillColumn = { name: string; text: string; numeric: boolean };
export type DrillData = { columns: DrillColumn[]; rows: Record<string, string | number>[] };

const PAGE = 15;
const indian = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (column: DrillColumn, value: string | number | undefined) => (column.numeric ? indian.format(Number(value ?? 0)) : String(value ?? ""));
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function DrillTable({ title, data, onClose }: { title: string; data: DrillData; onClose: () => void }) {
  const [find, setFind] = useState("");
  const [sort, setSort] = useState<{ name: string; down: boolean } | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = find.trim().toLowerCase();
    let list = needle === "" ? data.rows : data.rows.filter((row) => data.columns.some((column) => cell(column, row[column.name]).toLowerCase().includes(needle)));
    if (sort) {
      const column = data.columns.find((entry) => entry.name === sort.name);
      list = [...list].sort((a, b) => {
        const [x, y] = [a[sort.name], b[sort.name]];
        const order = column?.numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
        return sort.down ? -order : order;
      });
    }
    return list;
  }, [data, find, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  const numeric = data.columns.filter((column) => column.numeric);

  const download = (name: string, type: string, text: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const excel = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [data.columns.map((column) => quote(column.text)).join(","), ...rows.map((row) => data.columns.map((column) => (column.numeric ? String(row[column.name] ?? 0) : quote(String(row[column.name] ?? "")))).join(","))];
    download(`${title.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv`, "text/csv;charset=utf-8", `﻿${lines.join("\r\n")}`);
  };
  const pdf = () => {
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return;
    const head = data.columns.map((column) => `<th style="text-align:${column.numeric ? "right" : "left"}">${escapeHtml(column.text)}</th>`).join("");
    const body = rows.map((row) => `<tr>${data.columns.map((column) => `<td style="text-align:${column.numeric ? "right" : "left"}">${escapeHtml(cell(column, row[column.name]))}</td>`).join("")}</tr>`).join("");
    popup.document.write(`<!doctype html><title>${escapeHtml(title)}</title><style>body{font:12px Segoe UI,Arial,sans-serif;margin:20px}h2{margin:0 0 10px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd;padding:4px 8px}th{background:#eef1f8}</style><h2>${escapeHtml(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="dash-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dash-drill">
        <header>
          <h3>{title}</h3>
          <input type="search" placeholder="Search…" value={find} onChange={(event) => { setFind(event.target.value); setPage(0); }} autoFocus aria-label="Search" />
          <button type="button" className="pc-btn pc-btn-outline" onClick={excel}>Excel</button>
          <button type="button" className="pc-btn pc-btn-outline" onClick={pdf}>PDF</button>
          <button type="button" className="pc-btn pc-btn-danger" onClick={onClose}>Close</button>
        </header>
        <div className="dash-drill-scroll">
          <table>
            <thead><tr>{data.columns.map((column) => (
              <th key={column.name} className={column.numeric ? "num" : ""} onClick={() => setSort((current) => (current?.name === column.name ? { name: column.name, down: !current.down } : { name: column.name, down: false }))}>
                {column.text}{sort?.name === column.name ? (sort.down ? " ▼" : " ▲") : ""}
              </th>))}</tr></thead>
            <tbody>
              {shown.map((row, index) => <tr key={index}>{data.columns.map((column) => <td key={column.name} className={column.numeric ? "num" : ""}>{cell(column, row[column.name])}</td>)}</tr>)}
              {shown.length === 0 && <tr><td colSpan={data.columns.length} className="empty">No records found</td></tr>}
            </tbody>
          </table>
        </div>
        <footer>
          <span>{rows.length} record{rows.length === 1 ? "" : "s"}</span>
          {numeric.map((column) => <span key={column.name}>Total {column.text}: <b>{indian.format(rows.reduce((sum, row) => sum + Number(row[column.name] ?? 0), 0))}</b></span>)}
          <span className="pc-spacer" />
          <button type="button" className="pc-btn pc-btn-outline" disabled={at === 0} onClick={() => setPage(at - 1)}>‹ Prev</button>
          <span>Page {at + 1} / {pages}</span>
          <button type="button" className="pc-btn pc-btn-outline" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next ›</button>
        </footer>
      </div>
    </div>
  );
}
