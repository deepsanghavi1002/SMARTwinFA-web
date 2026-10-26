"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { useWindowActive } from "../ui/activeWindow";

/**
 * The list behind a bar or a balance (the desktop's ModernGridForm): searchable, sortable by a column heading, in pages, with the
 * list as Excel (a .csv Excel opens) or PDF (the browser's print to PDF).
 */

export type DrillColumn = { name: string; text: string; numeric: boolean };
export type DrillData = { columns: DrillColumn[]; rows: Record<string, string | number>[] };

const SIZES = [15, 25, 50, 100];
/** The look of a cell by its column: a party name gets an initial badge, a document no a code chip, a book a tag, a date a muted line. */
const kindOf = (column: DrillColumn): "name" | "doc" | "tag" | "date" | "amount" | "text" => {
  if (column.numeric) return "amount";
  const key = `${column.name} ${column.text}`.toLowerCase();
  if (/(^|[ _])date($|[ _])/.test(key)) return "date";
  if (/doc[ _]?no|voucher|entry[ _]?no|invoice/.test(key)) return "doc";
  if (/book|type|status|group|category/.test(key)) return "tag";
  if (/(^|[ _])(name|party|account|particular)/.test(key)) return "name";
  return "text";
};
const HUES = [222, 262, 188, 152, 28, 336, 204, 100];
const hueOf = (text: string) => HUES[[...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];
const initials = (text: string) => text.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase() || "•";
const indian = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (column: DrillColumn, value: string | number | undefined) => (column.numeric ? indian.format(Number(value ?? 0)) : String(value ?? ""));
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function DrillTable({ title, data, accent = "#4a5ff0", onClose, onOpen }: { title: string; data: DrillData; accent?: string; onClose: () => void; /** Enter or a double click on a row: its detail (the voucher, the account's ledger). */ onOpen?: (row: Record<string, string | number>) => void }) {
  const [find, setFind] = useState("");
  const [sort, setSort] = useState<{ name: string; down: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(SIZES[0]);
  const [cursor, setCursor] = useState(0);
  /** The filter menu: closed, open at its first level, or open with one submenu ("search" or a column's name). */
  const [menu, setMenu] = useState<{ sub: string | null } | null>(null);
  /** The columns the search box looks in (all at first). */
  const [searchIn, setSearchIn] = useState<ReadonlySet<string>>(() => new Set(data.columns.map((column) => column.name)));
  /** Values chosen from "Filter by <column>": one value a column. */
  const [filters, setFilters] = useState<Readonly<Record<string, string>>>({});
  const menuOpen = useRef(false);
  useEffect(() => { menuOpen.current = menu !== null; });
  const body = useRef<HTMLDivElement>(null);

  const inFront = useWindowActive();
  const latest = useRef<{ move: (step: number) => void; open: () => void }>({ move: () => undefined, open: () => undefined });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A window opened from the list (the voucher) has the keyboard while this one is behind.
      if (!inFront.current) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (menuOpen.current) setMenu(null); else onClose(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "PageDown" ? 10 : event.key === "PageUp" ? -10 : 0;
      if (step !== 0) { event.preventDefault(); event.stopPropagation(); latest.current.move(step); return; }
      if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); event.stopPropagation(); latest.current.open(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, inFront]);

  /** The text columns with few values (a book, a type ...) can be filtered by a value. */
  const filterable = useMemo(() => data.columns.filter((column) => {
    if (column.numeric) return false;
    const values = new Set(data.rows.map((row) => String(row[column.name] ?? "")));
    return values.size > 1 && values.size <= 30 && values.size * 2 <= Math.max(data.rows.length, 2);
  }).map((column) => ({ column, values: [...new Set(data.rows.map((row) => String(row[column.name] ?? "")))].filter((value) => value !== "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })) })), [data]);
  const activeFilters = Object.keys(filters).length;

  const rows = useMemo(() => {
    const needle = find.trim().toLowerCase();
    let list = data.rows;
    for (const [name, value] of Object.entries(filters)) list = list.filter((row) => String(row[name] ?? "") === value);
    if (needle !== "") list = list.filter((row) => data.columns.some((column) => searchIn.has(column.name) && cell(column, row[column.name]).toLowerCase().includes(needle)));
    if (sort) {
      const column = data.columns.find((entry) => entry.name === sort.name);
      list = [...list].sort((a, b) => {
        const [x, y] = [a[sort.name], b[sort.name]];
        const order = column?.numeric ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
        return sort.down ? -order : order;
      });
    }
    return list;
  }, [data, find, sort, filters, searchIn]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * size, at * size + size);
  const numeric = data.columns.filter((column) => column.numeric);
  const here = Math.min(cursor, Math.max(shown.length - 1, 0));
  useEffect(() => {
    latest.current = {
      move: (step) => {
        const next = here + step;
        if (next < 0) { if (at > 0) { setPage(at - 1); setCursor(size - 1); } else setCursor(0); }
        else if (next >= shown.length) { if (at < pages - 1) { setPage(at + 1); setCursor(0); } else setCursor(shown.length - 1); }
        else setCursor(next);
      },
      open: () => { if (onOpen && shown[here]) onOpen(shown[here]); },
    };
  });
  useEffect(() => { body.current?.querySelector<HTMLElement>("tr.dash-cur")?.scrollIntoView({ block: "nearest" }); }, [here, at, size]);

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
    download(`${title.replace(/[^A-Za-z0-9_-]+/g, "_")}.csv`, "text/csv;charset=utf-8", `\uFEFF${lines.join("\r\n")}`);
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

  const grand = (column: DrillColumn) => rows.reduce((sum, row) => sum + Number(row[column.name] ?? 0), 0);
  const kinds = data.columns.map(kindOf);
  /** The page numbers shown: the first, the last and a window round the current one. */
  const numbers = Array.from(new Set([0, 1, at - 1, at, at + 1, pages - 2, pages - 1].filter((n) => n >= 0 && n < pages))).sort((x, y) => x - y);
  const cellView = (column: DrillColumn, kind: ReturnType<typeof kindOf>, row: Record<string, string | number>) => {
    const text = cell(column, row[column.name]);
    if (kind === "name" && text !== "") return <span className="dash-party"><i style={{ ["--h" as string]: hueOf(text) }}>{initials(text)}</i><span>{text}</span></span>;
    if (kind === "doc" && text !== "") return <span className="dash-doc">{text}</span>;
    if (kind === "tag" && text !== "") return <span className="dash-tag" style={{ ["--h" as string]: hueOf(text) }}>{text}</span>;
    if (kind === "amount") return <><small>₹</small>{text}</>;
    return text;
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a press on the backdrop outside the box closes it; Escape does from the keyboard
    <div className="dash-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="dash-drill" style={{ ["--accent" as string]: accent }}>
        <header>
          <span className="dash-drill-badge"><Icon name="list" /></span>
          <div className="dash-drill-title">
            <h3>{title}</h3>
            <small>{rows.length} record{rows.length === 1 ? "" : "s"}{rows.length !== data.rows.length ? ` found of ${data.rows.length}` : ""}</small>
          </div>
          <label className="dash-drill-search">
            <Icon name="search" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the list opens with the cursor in its search box */}
            <input type="search" placeholder="Search…" value={find} onChange={(event) => { setFind(event.target.value); setPage(0); setCursor(0); }} autoFocus aria-label="Search" />
          </label>
          <div className="dash-menu-wrap">
            <button type="button" className={`dash-drill-filter${activeFilters > 0 || searchIn.size < data.columns.length ? " on" : ""}`} aria-label="Filters" aria-haspopup="menu" aria-expanded={menu !== null} onClick={() => setMenu(menu ? null : { sub: null })}><Icon name="clear" /></button>
            {menu && (
              <>
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the shade behind the open menu closes it on a press outside; Escape does from the keyboard */}
                <div className="dash-menu-shade" onMouseDown={() => setMenu(null)} />
                <div className="dash-menu" role="menu">
                  <div className="dash-menu-item-wrap">
                    <button type="button" role="menuitem" className={`dash-menu-item${menu.sub === "search" ? " open" : ""}`} onClick={() => setMenu({ sub: menu.sub === "search" ? null : "search" })}>Search in Columns<b>›</b></button>
                    {menu.sub === "search" && (
                      <div className="dash-menu dash-menu-sub" role="menu">
                        {data.columns.map((column) => (
                          <button key={column.name} type="button" role="menuitemcheckbox" aria-checked={searchIn.has(column.name)} className="dash-menu-item" onClick={() => { const next = new Set(searchIn); if (next.has(column.name)) { if (next.size > 1) next.delete(column.name); } else next.add(column.name); setSearchIn(next); setPage(0); setCursor(0); }}>
                            <span className={`dash-check${searchIn.has(column.name) ? " on" : ""}`}>{searchIn.has(column.name) ? "✓" : ""}</span>{column.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {filterable.map(({ column, values }) => (
                    <div key={column.name} className="dash-menu-item-wrap">
                      <button type="button" role="menuitem" className={`dash-menu-item${menu.sub === column.name ? " open" : ""}${filters[column.name] !== undefined ? " active" : ""}`} onClick={() => setMenu({ sub: menu.sub === column.name ? null : column.name })}>Filter by {column.text}<b>›</b></button>
                      {menu.sub === column.name && (
                        <div className="dash-menu dash-menu-sub" role="menu">
                          {values.map((value) => (
                            <button key={value} type="button" role="menuitemradio" aria-checked={filters[column.name] === value} className={`dash-menu-item${filters[column.name] === value ? " active" : ""}`} onClick={() => { setFilters((current) => { const next = { ...current }; if (next[column.name] === value) delete next[column.name]; else next[column.name] = value; return next; }); setPage(0); setCursor(0); setMenu(null); }}>{value}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <button type="button" role="menuitem" className="dash-menu-item" onClick={() => { setFilters({}); setSearchIn(new Set(data.columns.map((column) => column.name))); setFind(""); setPage(0); setCursor(0); setMenu(null); }}>Clear All Filters</button>
                </div>
              </>
            )}
          </div>
          <button type="button" className="pc-btn pc-btn-outline" onClick={excel}><Icon name="excel" />Excel</button>
          <button type="button" className="pc-btn pc-btn-outline" onClick={pdf}><Icon name="pdf" />PDF</button>
          <button type="button" className="pc-btn pc-btn-danger" onClick={onClose}><Icon name="cancel" />Close</button>
        </header>
        {activeFilters > 0 && (
          <div className="dash-drill-chips">
            {Object.entries(filters).map(([name, value]) => <button key={name} type="button" onClick={() => setFilters((current) => { const next = { ...current }; delete next[name]; return next; })}>{data.columns.find((column) => column.name === name)?.text}: <b>{value}</b> ×</button>)}
          </div>
        )}
        <div className="dash-drill-scroll" ref={body}>
          <table>
            <thead><tr>{data.columns.map((column) => (
              <th key={column.name} className={column.numeric ? "num" : ""} onClick={() => setSort((current) => (current?.name === column.name ? { name: column.name, down: !current.down } : { name: column.name, down: false }))}>
                {column.text}<span className={`dash-sort${sort?.name === column.name ? " on" : ""}`}>{sort?.name === column.name ? (sort.down ? "▼" : "▲") : "↕"}</span>
              </th>))}</tr></thead>
            <tbody>
              {shown.map((row, index) => <tr key={index} className={index === here ? "dash-cur" : ""} onClick={() => setCursor(index)} onDoubleClick={() => { setCursor(index); if (onOpen) onOpen(row); }}>{data.columns.map((column, position) => <td key={column.name} className={`dash-k-${kinds[position]}${column.numeric ? " num" : ""}${column.numeric && Number(row[column.name] ?? 0) < 0 ? " neg" : ""}`}>{cellView(column, kinds[position], row)}</td>)}</tr>)}
              {shown.length === 0 && <tr className="dash-none"><td colSpan={data.columns.length} className="empty">No records found</td></tr>}
            </tbody>
          </table>
        </div>
        <footer>
          {numeric.map((column) => <span key={column.name} className="dash-drill-total">Total {column.text}<b>₹ {indian.format(grand(column))}</b></span>)}
          <span className="pc-spacer" />
          {onOpen && <span className="dash-drill-hint"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> / double-click: detail</span>}
          <label className="dash-drill-size">Rows<select value={size} onChange={(event) => { setSize(Number(event.target.value)); setPage(0); }}>{SIZES.map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <nav className="dash-pager" aria-label="Pages">
            <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">‹</button>
            {numbers.map((number, index) => <span key={number} className="dash-pager-item">{index > 0 && number - numbers[index - 1] > 1 && <em>…</em>}<button type="button" className={number === at ? "on" : ""} onClick={() => setPage(number)}>{number + 1}</button></span>)}
            <button type="button" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">›</button>
          </nav>
        </footer>
      </div>
    </div>
  );
}
