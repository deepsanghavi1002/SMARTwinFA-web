"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addonFields } from "./mock-data";
import type { AddonRecord } from "./types";

/**
 * The Update / Delete list, as a spreadsheet.
 *
 * The desktop program shows every record of the master in one C1FlexGrid and lets the
 * operator rearrange it: filter a column, type to find a row, drag a column wider or to
 * another place, freeze the leading columns so they stay put while scrolling right, and
 * make the rows taller. None of that comes free in a browser, so it is written here.
 *
 * Column widths, order, frozen count and row height are kept in localStorage, which is
 * per browser rather than per login - the web app has no per-user settings table yet.
 */

type ColumnState = { key: keyof AddonRecord; label: string; width: number };
type SortState = { key: keyof AddonRecord; dir: "asc" | "desc" } | null;

const LAYOUT_KEY = "smartwinfa.addon-update-grid.v1";
const DEFAULT_WIDTH = 150;
const MIN_WIDTH = 60;
const MIN_ROW_HEIGHT = 20;
const MAX_ROW_HEIGHT = 64;

const defaultColumns = (): ColumnState[] =>
  addonFields.map((field) => ({ key: field.key, label: field.label, width: field.key === "name" ? 210 : DEFAULT_WIDTH }));

type SavedLayout = { order: string[]; widths: Record<string, number>; frozen: number; rowHeight: number };

/** A layout is only reused while it still describes the same set of columns. */
function loadLayout(): SavedLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedLayout;
    const known = new Set(addonFields.map((field) => String(field.key)));
    if (!Array.isArray(saved.order) || saved.order.length !== known.size) return null;
    if (!saved.order.every((key) => known.has(key))) return null;
    return saved;
  } catch {
    return null;
  }
}

export function AddonUpdateGrid({
  records,
  selectedId,
  onSelect,
  groupName,
}: {
  records: AddonRecord[];
  selectedId: number | null;
  onSelect: (record: AddonRecord) => void;
  groupName: string;
}) {
  // Read straight from storage while building the first state, rather than correcting it
  // afterwards in an effect. The grid only mounts once the operator opens the Update tab,
  // so this never runs during server rendering and cannot cause a hydration mismatch.
  const [columns, setColumns] = useState<ColumnState[]>(() => {
    const saved = loadLayout();
    if (!saved) return defaultColumns();
    return saved.order.map((key) => {
      const field = addonFields.find((candidate) => String(candidate.key) === key)!;
      return { key: field.key, label: field.label, width: saved.widths[key] ?? DEFAULT_WIDTH };
    });
  });
  const [frozen, setFrozen] = useState(() => loadLayout()?.frozen ?? 1);
  const [rowHeight, setRowHeight] = useState(() => loadLayout()?.rowHeight ?? 24);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  /** Column key -> the values ticked in its filter. Absent means "no filter". */
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);

  useEffect(() => {
    try {
      const layout: SavedLayout = {
        order: columns.map((column) => String(column.key)),
        widths: Object.fromEntries(columns.map((column) => [String(column.key), column.width])),
        frozen,
        rowHeight,
      };
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // a browser refusing storage just means the layout is not remembered
    }
  }, [columns, frozen, rowHeight]);

  // Close an open filter when the click lands anywhere else.
  useEffect(() => {
    if (openFilter === null) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".xl-filter, .xl-filter-button")) setOpenFilter(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openFilter]);

  /** Distinct values of a column, for its filter list. Blanks are shown as "(blank)". */
  const valuesOf = (key: keyof AddonRecord) => {
    const seen = new Set<string>();
    for (const record of records) seen.add(String(record[key] ?? "").trim());
    return [...seen].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = records.filter((record) => {
      for (const [key, allowed] of Object.entries(filters)) {
        if (!allowed.includes(String(record[key as keyof AddonRecord] ?? "").trim())) return false;
      }
      if (!needle) return true;
      // instant search looks across every column, the way Ctrl+F would
      return columns.some((column) => String(record[column.key] ?? "").toLowerCase().includes(needle));
    });
    if (sort) {
      const { key, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const left = String(a[key] ?? "");
        const right = String(b[key] ?? "");
        return dir === "asc" ? left.localeCompare(right, undefined, { numeric: true }) : right.localeCompare(left, undefined, { numeric: true });
      });
    }
    return rows;
  }, [records, filters, search, sort, columns]);

  /** Left offset of each frozen column, so they stack correctly while scrolling. */
  const frozenOffsets = useMemo(() => {
    const offsets: number[] = [];
    let running = 0;
    for (const column of columns) {
      offsets.push(running);
      running += column.width;
    }
    return offsets;
  }, [columns]);

  const startResize = (key: keyof AddonRecord, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columns.find((column) => column.key === key)?.width ?? DEFAULT_WIDTH;
    const move = (moveEvent: MouseEvent) => {
      const width = Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX);
      setColumns((current) => current.map((column) => (column.key === key ? { ...column, width } : column)));
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  const dropColumn = (targetKey: string) => {
    const sourceKey = dragKey.current;
    dragKey.current = null;
    if (!sourceKey || sourceKey === targetKey) return;
    setColumns((current) => {
      const from = current.findIndex((column) => String(column.key) === sourceKey);
      const to = current.findIndex((column) => String(column.key) === targetKey);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const toggleFilterValue = (key: string, value: string) => {
    setFilters((current) => {
      // No stored filter means every value is ticked, so unticking one has to start from
      // the full list - otherwise the first click would keep that value instead of hiding it.
      const all = valuesOf(key as keyof AddonRecord);
      const chosen = current[key] ?? all;
      const next = chosen.includes(value) ? chosen.filter((item) => item !== value) : [...chosen, value];
      const copy = { ...current };
      if (next.length === all.length) delete copy[key]; else copy[key] = next;
      return copy;
    });
  };

  const activeFilters = Object.keys(filters).length;

  return (
    <div className="xl-grid-wrap">
      <div className="xl-toolbar">
        <input
          className="xl-search"
          placeholder="Search all columns…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search all columns"
        />
        <span className="xl-count">
          {visible.length} of {records.length} {records.length === 1 ? "row" : "rows"}
          {activeFilters > 0 && ` · ${activeFilters} filtered`}
        </span>
        <button type="button" onClick={() => { setFilters({}); setSearch(""); setSort(null); }} disabled={!activeFilters && !search && !sort}>
          Clear Filters
        </button>
        <label className="xl-freeze">
          Freeze
          <select value={frozen} onChange={(event) => setFrozen(Number(event.target.value))} aria-label="Frozen columns">
            {[0, 1, 2, 3, 4].map((count) => <option key={count} value={count}>{count === 0 ? "None" : `${count} col${count > 1 ? "s" : ""}`}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setRowHeight((height) => Math.max(MIN_ROW_HEIGHT, height - 3))} aria-label="Shorter rows">Row −</button>
        <button type="button" onClick={() => setRowHeight((height) => Math.min(MAX_ROW_HEIGHT, height + 3))} aria-label="Taller rows">Row +</button>
        <button type="button" onClick={() => { setColumns(defaultColumns()); setFrozen(1); setRowHeight(24); }}>Reset Layout</button>
      </div>

      <div className="xl-scroll">
        <table className="xl-grid" style={{ width: columns.reduce((total, column) => total + column.width, 40) }}>
          <thead>
            <tr style={{ height: 26 }}>
              <th className="xl-rownum" style={{ left: 0 }}>#</th>
              {columns.map((column, index) => {
                const isFrozen = index < frozen;
                const key = String(column.key);
                return (
                  <th
                    key={key}
                    className={`${isFrozen ? "xl-frozen" : ""} ${filters[key] ? "xl-has-filter" : ""}`}
                    style={{ width: column.width, ...(isFrozen ? { left: frozenOffsets[index] + 40 } : {}) }}
                    draggable
                    onDragStart={() => { dragKey.current = key; }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropColumn(key)}
                    title="Drag to move · double-click edge to resize"
                  >
                    <button className="xl-head-label" type="button" onClick={() => setSort((current) => current?.key === column.key && current.dir === "asc" ? { key: column.key, dir: "desc" } : { key: column.key, dir: "asc" })}>
                      {column.label}
                      {sort?.key === column.key && <i>{sort.dir === "asc" ? "▲" : "▼"}</i>}
                    </button>
                    <button className="xl-filter-button" type="button" aria-label={`Filter ${column.label}`} onClick={() => setOpenFilter(openFilter === key ? null : key)}>▾</button>
                    {openFilter === key && (
                      <div className="xl-filter">
                        <div className="xl-filter-actions">
                          <button type="button" onClick={() => setFilters((current) => { const copy = { ...current }; delete copy[key]; return copy; })}>Show all</button>
                        </div>
                        <ul>
                          {valuesOf(column.key).map((value) => (
                            <li key={value || "(blank)"}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={filters[key] ? filters[key].includes(value) : true}
                                  onChange={() => toggleFilterValue(key, value)}
                                />
                                {value === "" ? <em>(blank)</em> : value}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <span className="xl-resize" onMouseDown={(event) => startResize(column.key, event)} role="presentation" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((record, rowIndex) => (
              <tr
                key={record.id}
                className={record.id === selectedId ? "xl-selected" : ""}
                style={{ height: rowHeight }}
                onClick={() => onSelect(record)}
                onKeyDown={(event) => { if (event.key === "Enter") onSelect(record); }}
                tabIndex={0}
              >
                <td className="xl-rownum" style={{ left: 0 }}>{rowIndex + 1}</td>
                {columns.map((column, index) => {
                  const isFrozen = index < frozen;
                  return (
                    <td
                      key={String(column.key)}
                      className={isFrozen ? "xl-frozen" : ""}
                      style={{ width: column.width, ...(isFrozen ? { left: frozenOffsets[index] + 40 } : {}) }}
                    >
                      {String(record[column.key] ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td className="xl-empty" colSpan={columns.length + 1}>No record matches the search or filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="xl-footer">
        <span>{groupName}</span>
        <span>Click a row to open it for update or delete</span>
      </div>
    </div>
  );
}
