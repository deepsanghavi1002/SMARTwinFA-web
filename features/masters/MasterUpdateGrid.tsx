"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sanitise, valueProblem } from "./field-rules";
import type { FieldRules } from "./field-rules";
import type { MasterEdit, MasterField, MasterRow } from "./types";

/**
 * The Update / Delete list of any master, as a spreadsheet.
 *
 * The desktop program shows every record of the master in one C1FlexGrid and lets the
 * operator rearrange it: filter a column, type to find a row, drag a column wider or to
 * another place, freeze the leading columns so they stay put while scrolling right, and
 * make the rows taller. None of that comes free in a browser, so it is written here.
 *
 * On top of that the grid does the two things the desktop's Update/Delete screen does
 * that a plain list cannot: it edits a value in the cell rather than sending the
 * operator to the form for every correction, and it ticks many rows at once to delete
 * or export them. Both are optional - a master that passes no `onCommit` gets a
 * read-only grid, and one that passes no `onDelete` gets no delete.
 *
 * Column widths, order, frozen count and row height are kept in localStorage under the
 * master's own key, which is per browser rather than per login - the web app has no
 * per-user settings table yet.
 */

type ColumnState = { key: string; label: string; width: number };
type SortState = { key: string; dir: "asc" | "desc" } | null;
type SavedLayout = { order: string[]; widths: Record<string, number>; frozen: number; rowHeight: number };
/** The one cell currently open for typing. */
type EditingCell = { id: number; key: string };

const DEFAULT_WIDTH = 150;
const MIN_WIDTH = 60;
const MIN_ROW_HEIGHT = 20;
const MAX_ROW_HEIGHT = 64;
const ROWNUM_WIDTH = 40;
const TICK_WIDTH = 28;

export function MasterUpdateGrid<T extends MasterRow>({
  fields,
  records,
  selectedId,
  onSelect,
  groupName,
  storageKey,
  exportName,
  onCommit,
  onDelete,
}: {
  fields: readonly MasterField<T>[];
  records: readonly T[];
  selectedId: number | null;
  onSelect: (record: T) => void;
  groupName: string;
  /** Distinguishes one master's saved layout from another's. */
  storageKey: string;
  /** Base name of the exported file; defaults to the master's own name. */
  exportName?: string;
  /** Absent means this master cannot be edited in the grid. */
  onCommit?: (edits: MasterEdit<T>[]) => void | Promise<void>;
  /** Absent means this master cannot be deleted from the grid. */
  onDelete?: (ids: number[]) => void | Promise<void>;
}) {
  const layoutKey = `smartwinfa.master-grid.${storageKey}.v1`;

  const defaultColumns = (): ColumnState[] =>
    fields.map((field) => ({ key: field.key, label: field.label, width: field.width ?? DEFAULT_WIDTH }));

  /** A layout is only reused while it still describes the same set of columns. */
  const loadLayout = (): SavedLayout | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(layoutKey);
      if (!raw) return null;
      const saved = JSON.parse(raw) as SavedLayout;
      const known = new Set(fields.map((field) => field.key));
      if (!Array.isArray(saved.order) || saved.order.length !== known.size) return null;
      if (!saved.order.every((key) => known.has(key as Extract<keyof T, string>))) return null;
      return saved;
    } catch {
      return null;
    }
  };

  // Read straight from storage while building the first state, rather than correcting it
  // afterwards in an effect. The grid only mounts once the operator opens the Update tab,
  // so this never runs during server rendering and cannot cause a hydration mismatch.
  const [columns, setColumns] = useState<ColumnState[]>(() => {
    const saved = loadLayout();
    if (!saved) return defaultColumns();
    return saved.order.map((key) => {
      const field = fields.find((candidate) => candidate.key === key)!;
      return { key: field.key, label: field.label, width: saved.widths[key] ?? field.width ?? DEFAULT_WIDTH };
    });
  });
  const [frozen, setFrozen] = useState(() => loadLayout()?.frozen ?? 1);
  const [rowHeight, setRowHeight] = useState(() => loadLayout()?.rowHeight ?? 24);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  /** Column key -> the values ticked in its filter. Absent means "no filter". */
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  /** Narrows the value list inside the open filter; cleared whenever another one opens. */
  const [filterSearch, setFilterSearch] = useState("");
  const dragKey = useRef<string | null>(null);

  /** Edit mode is off until asked for, so a stray double-click cannot change a record. */
  const [editMode, setEditMode] = useState(false);
  /** Record id -> the columns changed on it, as typed. Untouched records are absent. */
  const [drafts, setDrafts] = useState<Record<number, Record<string, string>>>({});
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const fieldMap = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.key, field])) as Record<string, MasterField<T>>,
    [fields],
  );
  const canEdit = typeof onCommit === "function";
  const canDelete = typeof onDelete === "function";
  const selectable = canEdit || canDelete;
  const leadWidth = ROWNUM_WIDTH + (selectable ? TICK_WIDTH : 0);

  useEffect(() => {
    try {
      const layout: SavedLayout = {
        order: columns.map((column) => column.key),
        widths: Object.fromEntries(columns.map((column) => [column.key, column.width])),
        frozen,
        rowHeight,
      };
      window.localStorage.setItem(layoutKey, JSON.stringify(layout));
    } catch {
      // a browser refusing storage just means the layout is not remembered
    }
  }, [columns, frozen, rowHeight, layoutKey]);

  // A different master, or a reread of the same one, must not carry edits across. This
  // is the adjustment React makes during render rather than in an effect, so the grid
  // never paints one frame of the new records still wearing the old rows' edits.
  const [shown, setShown] = useState(records);
  if (shown !== records) {
    setShown(records);
    setDrafts({});
    setTicked([]);
    setEditing(null);
    setNotice("");
  }

  // Close an open filter when the click lands anywhere else.
  useEffect(() => {
    if (openFilter === null) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".xl-filter, .xl-filter-button")) setOpenFilter(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openFilter]);

  /** The stored value of a cell, or the operator's unsaved one when they changed it. */
  const valueOf = (record: T, key: string) => {
    const draft = drafts[record.id];
    if (draft && key in draft) return draft[key];
    return String(record[key as keyof T] ?? "");
  };
  const isDirty = (id: number, key: string) => Boolean(drafts[id] && key in drafts[id]);

  /** Distinct stored values of a column, for its filter list. Blanks are shown as "(blank)". */
  const valuesOf = (key: string) => {
    const seen = new Set<string>();
    for (const record of records) seen.add(String(record[key as keyof T] ?? "").trim());
    return [...seen].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // Filters and search read the STORED value, not the unsaved one: a row must not
    // vanish from under the operator the moment they type a new value into it.
    let rows = records.filter((record) => {
      for (const [key, allowed] of Object.entries(filters)) {
        if (!allowed.includes(String(record[key as keyof T] ?? "").trim())) return false;
      }
      if (!needle) return true;
      // instant search looks across every column, the way Ctrl+F would
      return columns.some((column) => String(record[column.key as keyof T] ?? "").toLowerCase().includes(needle));
    });
    if (sort) {
      const { key, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const left = String(a[key as keyof T] ?? "");
        const right = String(b[key as keyof T] ?? "");
        return dir === "asc"
          ? left.localeCompare(right, undefined, { numeric: true })
          : right.localeCompare(left, undefined, { numeric: true });
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

  const startResize = (key: string, event: React.MouseEvent) => {
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
      const from = current.findIndex((column) => column.key === sourceKey);
      const to = current.findIndex((column) => column.key === targetKey);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  /**
   * Replaces the values a column is filtered to. Storing the complete list would mean
   * the same thing as no filter at all, so that case removes the entry instead - which
   * is what keeps the heading's "filtered" tint honest.
   */
  const setColumnFilter = (key: string, next: string[]) => {
    const all = valuesOf(key);
    setFilters((current) => {
      const copy = { ...current };
      if (next.length === all.length) delete copy[key]; else copy[key] = next;
      return copy;
    });
  };

  /**
   * Ticks or unticks every value the operator can currently SEE in the list. With a
   * search typed in, that is the found values only - the rest keep whatever they were,
   * so a search followed by "select all" narrows to a group instead of discarding it.
   */
  const tickAllShown = (key: string, shown: string[], on: boolean) => {
    const chosen = new Set(filters[key] ?? valuesOf(key));
    for (const value of shown) {
      if (on) chosen.add(value); else chosen.delete(value);
    }
    setColumnFilter(key, [...chosen]);
  };

  const toggleFilterValue = (key: string, value: string) => {
    setFilters((current) => {
      // No stored filter means every value is ticked, so unticking one has to start from
      // the full list - otherwise the first click would keep that value instead of hiding it.
      const all = valuesOf(key);
      const chosen = current[key] ?? all;
      const next = chosen.includes(value) ? chosen.filter((item) => item !== value) : [...chosen, value];
      const copy = { ...current };
      if (next.length === all.length) delete copy[key]; else copy[key] = next;
      return copy;
    });
  };

  /** Why this value cannot be stored, or "" when it can. */
  const complain = (key: string, value: string) => {
    const field = fieldMap[key];
    if (!field) return "";
    const trimmed = value.trim();
    // The master's own rules decide first, so a column set up in program_body is judged
    // by that and not by anything assumed here.
    if (field.rules) {
      const problem = valueProblem(field.rules, field.label, value);
      if (problem !== "") return problem;
    }
    if (field.required && trimmed === "") return `${field.label} cannot be blank.`;
    if (field.numeric && trimmed !== "" && !Number.isFinite(Number(trimmed.replace(/,/g, "")))) {
      return `${field.label} must be a number.`;
    }
    if (field.options && trimmed !== "" && !field.options.includes(trimmed)) {
      return `${trimmed} is not a value ${field.label} accepts.`;
    }
    return "";
  };

  /** Takes what was typed into a cell, keeping it only when it differs from the stored value. */
  const commitCell = (record: T, key: string, raw: string) => {
    const stored = String(record[key as keyof T] ?? "");
    setDrafts((current) => {
      const forRow = { ...(current[record.id] ?? {}) };
      if (raw === stored) delete forRow[key]; else forRow[key] = raw;
      const copy = { ...current };
      if (Object.keys(forRow).length === 0) delete copy[record.id]; else copy[record.id] = forRow;
      return copy;
    });
  };

  const editableColumns = useMemo(
    () => columns.filter((column) => !fieldMap[column.key]?.readOnly),
    [columns, fieldMap],
  );

  /** Tab and Enter walk to the next editable cell, the way a spreadsheet does. */
  const stepFrom = (cell: EditingCell, rows: readonly T[], forward: boolean) => {
    const rowIndex = rows.findIndex((record) => record.id === cell.id);
    const columnIndex = editableColumns.findIndex((column) => column.key === cell.key);
    if (rowIndex < 0 || columnIndex < 0) return null;
    let nextColumn = columnIndex + (forward ? 1 : -1);
    let nextRow = rowIndex;
    if (nextColumn >= editableColumns.length) { nextColumn = 0; nextRow += 1; }
    if (nextColumn < 0) { nextColumn = editableColumns.length - 1; nextRow -= 1; }
    if (nextRow < 0 || nextRow >= rows.length) return null;
    return { id: rows[nextRow].id, key: editableColumns[nextColumn].key };
  };

  const edits: MasterEdit<T>[] = useMemo(
    () =>
      Object.entries(drafts).flatMap(([id, changes]) => {
        const original = records.find((record) => record.id === Number(id));
        if (!original) return [];
        return [{ id: Number(id), changes: changes as MasterEdit<T>["changes"], original }];
      }),
    [drafts, records],
  );
  const changedCells = edits.reduce((total, edit) => total + Object.keys(edit.changes).length, 0);
  const problems = edits.flatMap((edit) =>
    Object.entries(edit.changes)
      .map(([key, value]) => complain(key, String(value)))
      .filter((message) => message !== ""),
  );

  const save = async () => {
    if (!onCommit || edits.length === 0 || problems.length > 0) return;
    setBusy(true);
    try {
      await onCommit(edits);
      setDrafts({});
      setEditing(null);
      setNotice(`${changedCells} change${changedCells === 1 ? "" : "s"} saved.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const removeTicked = async () => {
    if (!onDelete || ticked.length === 0) return;
    const names = ticked
      .map((id) => records.find((record) => record.id === id))
      .map((record) => (record ? String(record[columns[0]?.key as keyof T] ?? record.id) : ""))
      .filter(Boolean);
    const shown = names.slice(0, 5).join("\n");
    const rest = names.length > 5 ? `\n…and ${names.length - 5} more` : "";
    // Deleting records is not undoable from here, so it is always confirmed by name.
    if (!window.confirm(`Delete ${ticked.length} record${ticked.length === 1 ? "" : "s"}?\n\n${shown}${rest}`)) return;
    setBusy(true);
    try {
      await onDelete(ticked);
      setTicked([]);
      setNotice(`${ticked.length} record${ticked.length === 1 ? "" : "s"} deleted.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The records could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Exports what is on screen - the operator's column order and widths decided what
   * matters, and the filters decided which rows do. Unsaved edits are exported as they
   * stand so a review copy shows the intended values.
   */
  const exportCsv = (onlyTicked: boolean) => {
    const rows = onlyTicked ? visible.filter((record) => ticked.includes(record.id)) : visible;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [
      columns.map((column) => quote(column.label)).join(","),
      ...rows.map((record) => columns.map((column) => quote(valueOf(record, column.key))).join(",")),
    ];
    // Excel reads a UTF-8 CSV correctly only when it is told, hence the byte order mark.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${(exportName || groupName || "master").replace(/[^\w.-]+/g, "-")}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(`${rows.length} row${rows.length === 1 ? "" : "s"} exported.`);
  };

  const activeFilters = Object.keys(filters).length;
  const allTicked = visible.length > 0 && visible.every((record) => ticked.includes(record.id));

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
        {canEdit && (
          <button
            type="button"
            className={`xl-mode ${editMode ? "xl-mode-on" : ""}`}
            aria-pressed={editMode}
            onClick={() => {
              // Leaving edit mode with work in hand would silently drop it.
              if (editMode && edits.length > 0) {
                if (!window.confirm("Leave edit mode and discard the unsaved changes?")) return;
                setDrafts({});
              }
              setEditing(null);
              setEditMode((on) => !on);
            }}
          >
            ✎ Edit in grid
          </button>
        )}
        <button type="button" className="xl-export" onClick={() => exportCsv(false)}>↧ Export</button>
      </div>

      {selectable && ticked.length > 0 && (
        <div className="xl-bulkbar">
          <b>{ticked.length} row{ticked.length === 1 ? "" : "s"} ticked</b>
          {canDelete && <button type="button" className="danger" onClick={removeTicked} disabled={busy}>Delete ticked…</button>}
          <button type="button" onClick={() => exportCsv(true)}>Export ticked</button>
          <button type="button" onClick={() => setTicked([])}>Clear ticks</button>
          {editMode && <span className="xl-bulk-hint">Edit-in-grid is on — double-click any cell to change it</span>}
        </div>
      )}

      <div className="xl-scroll">
        <table className="xl-grid" style={{ width: columns.reduce((total, column) => total + column.width, leadWidth) }}>
          <thead>
            <tr style={{ height: 26 }}>
              {selectable && (
                <th className="xl-tick" style={{ left: 0 }}>
                  <input
                    type="checkbox"
                    checked={allTicked}
                    onChange={() => setTicked(allTicked ? [] : visible.map((record) => record.id))}
                    aria-label="Tick every row shown"
                  />
                </th>
              )}
              <th className="xl-rownum" style={{ left: selectable ? TICK_WIDTH : 0 }}>#</th>
              {columns.map((column, index) => {
                const isFrozen = index < frozen;
                const key = column.key;
                return (
                  <th
                    key={key}
                    className={`${isFrozen ? "xl-frozen" : ""} ${filters[key] ? "xl-has-filter" : ""}`}
                    style={{ width: column.width, ...(isFrozen ? { left: frozenOffsets[index] + leadWidth } : {}) }}
                    // A draggable ancestor stops Firefox selecting text inside an input,
                    // so the heading stops being draggable while its filter is open.
                    draggable={openFilter !== key}
                    onDragStart={() => { dragKey.current = key; }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropColumn(key)}
                    title="Drag to move · double-click edge to resize"
                  >
                    <button className="xl-head-label" type="button" onClick={() => setSort((current) => current?.key === key && current.dir === "asc" ? { key, dir: "desc" } : { key, dir: "asc" })}>
                      {column.label}
                      {sort?.key === key && <i>{sort.dir === "asc" ? "▲" : "▼"}</i>}
                    </button>
                    <button
                      className="xl-filter-button"
                      type="button"
                      aria-label={`Filter ${column.label}`}
                      onClick={() => { setFilterSearch(""); setOpenFilter(openFilter === key ? null : key); }}
                    >▾</button>
                    {openFilter === key && (() => {
                      const all = valuesOf(key);
                      const chosen = filters[key] ?? all;
                      const needle = filterSearch.trim().toLowerCase();
                      const label = (value: string) => (value === "" ? "(blank)" : value);
                      const shown = needle ? all.filter((value) => label(value).toLowerCase().includes(needle)) : all;
                      const shownChosen = shown.filter((value) => chosen.includes(value));
                      const allShownTicked = shown.length > 0 && shownChosen.length === shown.length;
                      return (
                        <div className="xl-filter">
                          <div className="xl-filter-find">
                            <input
                              type="search"
                              value={filterSearch}
                              placeholder="Search values…"
                              aria-label={`Search ${column.label} values`}
                              onChange={(event) => setFilterSearch(event.target.value)}
                            />
                          </div>
                          <div className="xl-filter-all">
                            <label>
                              <input
                                type="checkbox"
                                checked={allShownTicked}
                                // Part-ticked is its own state and cannot be expressed in JSX.
                                ref={(box) => { if (box) box.indeterminate = shownChosen.length > 0 && !allShownTicked; }}
                                onChange={() => tickAllShown(key, shown, !allShownTicked)}
                              />
                              <b>{needle ? "(Select all found)" : "(Select all)"}</b>
                              <span className="xl-filter-count">{shownChosen.length}/{shown.length}</span>
                            </label>
                          </div>
                          <ul>
                            {shown.map((value) => (
                              <li key={value || "(blank)"}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={chosen.includes(value)}
                                    onChange={() => toggleFilterValue(key, value)}
                                  />
                                  {value === "" ? <em>(blank)</em> : value}
                                </label>
                              </li>
                            ))}
                            {shown.length === 0 && <li className="xl-filter-none">No value matches “{filterSearch.trim()}”.</li>}
                          </ul>
                          <div className="xl-filter-actions">
                            <button type="button" onClick={() => setColumnFilter(key, all)}>Show all</button>
                            <button type="button" onClick={() => setColumnFilter(key, [])}>Clear</button>
                            <button type="button" onClick={() => setOpenFilter(null)}>Close</button>
                          </div>
                        </div>
                      );
                    })()}
                    <span className="xl-resize" onMouseDown={(event) => startResize(key, event)} role="presentation" />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((record, rowIndex) => (
              <tr
                key={record.id}
                className={`${record.id === selectedId ? "xl-selected" : ""} ${ticked.includes(record.id) ? "xl-ticked" : ""}`}
                style={{ height: rowHeight }}
                // In edit mode a click belongs to the cell, so the form is opened from the
                // row number instead; otherwise the whole row opens it, as it always did.
                onClick={editMode ? undefined : () => onSelect(record)}
                onKeyDown={(event) => { if (event.key === "Enter" && !editMode) onSelect(record); }}
                tabIndex={0}
              >
                {selectable && (
                  <td className="xl-tick" style={{ left: 0 }} onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={ticked.includes(record.id)}
                      onChange={() => setTicked((current) => current.includes(record.id) ? current.filter((id) => id !== record.id) : [...current, record.id])}
                      aria-label={`Tick row ${rowIndex + 1}`}
                    />
                  </td>
                )}
                <td
                  className={`xl-rownum ${editMode ? "xl-rownum-open" : ""}`}
                  style={{ left: selectable ? TICK_WIDTH : 0 }}
                  title={editMode ? "Open this record on the form" : undefined}
                  onClick={editMode ? (event) => { event.stopPropagation(); onSelect(record); } : undefined}
                >
                  {rowIndex + 1}
                </td>
                {columns.map((column, index) => {
                  const isFrozen = index < frozen;
                  const field = fieldMap[column.key];
                  const open = editing?.id === record.id && editing.key === column.key;
                  const dirty = isDirty(record.id, column.key);
                  const value = valueOf(record, column.key);
                  const bad = dirty ? complain(column.key, value) : "";
                  return (
                    <td
                      key={column.key}
                      className={[
                        isFrozen ? "xl-frozen" : "",
                        field?.numeric ? "xl-num" : "",
                        dirty ? "xl-dirty" : "",
                        bad ? "xl-bad" : "",
                        open ? "xl-editing" : "",
                      ].filter(Boolean).join(" ")}
                      style={{ width: column.width, ...(isFrozen ? { left: frozenOffsets[index] + leadWidth } : {}) }}
                      title={bad || undefined}
                      onDoubleClick={() => {
                        if (!editMode || field?.readOnly) return;
                        setEditing({ id: record.id, key: column.key });
                      }}
                    >
                      {open ? (
                        <CellEditor
                          value={value}
                          options={field?.options}
                          rules={field?.rules}
                          onRefused={setNotice}
                          onCancel={() => setEditing(null)}
                          onCommit={(next, move) => {
                            commitCell(record, column.key, next);
                            setEditing(move ? stepFrom({ id: record.id, key: column.key }, visible, move === "next") : null);
                          }}
                        />
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td className="xl-empty" colSpan={columns.length + (selectable ? 2 : 1)}>No record matches the search or filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edits.length > 0 && (
        <div className={`xl-savebar ${problems.length > 0 ? "xl-savebar-bad" : ""}`} role="status">
          <b>{changedCells} unsaved change{changedCells === 1 ? "" : "s"}</b>
          <span>in {edits.length} record{edits.length === 1 ? "" : "s"}</span>
          {problems.length > 0 && <span className="xl-problem">{problems[0]}</span>}
          <span className="xl-savebar-spacer" />
          <button type="button" onClick={() => { setDrafts({}); setEditing(null); }} disabled={busy}>Discard all</button>
          <button type="button" className="xl-save" onClick={save} disabled={busy || problems.length > 0}>
            {busy ? "Saving…" : "Save all"}
          </button>
        </div>
      )}

      <div className="xl-footer">
        <span>{groupName}</span>
        <span>
          {notice
            || (editMode ? "Double-click a cell to edit · click the row number to open the full form"
                         : "Click a row to open it for update or delete")}
        </span>
      </div>
    </div>
  );
}

/**
 * The input that replaces a cell while it is being typed into.
 *
 * It keeps its own text so every keystroke does not re-render the whole grid, and hands
 * the value back on Enter, Tab or blur - Escape throws it away.
 */
function CellEditor({
  value,
  options,
  rules,
  onCommit,
  onCancel,
  onRefused,
}: {
  value: string;
  options?: readonly string[];
  rules?: FieldRules;
  onCommit: (value: string, move?: "next" | "previous") => void;
  onCancel: () => void;
  /** Says why a character was dropped, so the footer can show it once. */
  onRefused: (reason: string) => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);

  /**
   * Everything typed or pasted goes through the column's rules first. The refused
   * characters simply never arrive, which is the browser's equivalent of the desktop
   * refusing the keystroke - without a message box on every key.
   */
  const accept = (raw: string) => {
    if (!rules) return setText(raw);
    const { text: kept, reason } = sanitise(rules, raw);
    setText(kept);
    if (reason !== "") onRefused(reason);
  };

  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) ref.current.select();
  }, []);

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key === "Enter") { event.preventDefault(); onCommit(text); }
    if (event.key === "Tab") { event.preventDefault(); onCommit(text, event.shiftKey ? "previous" : "next"); }
  };

  if (options) {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        className="xl-cell-input"
        value={text}
        onChange={(event) => accept(event.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={keys}
      >
        <option value=""></option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      className="xl-cell-input"
      value={text}
      onChange={(event) => accept(event.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={keys}
    />
  );
}
