"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { formatDesktopDate, parseDesktopDate } from "../../lib/master-program/legacy";
import type { EntryColumn, EntryDefinition, EntryGrid, EntryOption, SaveOutcome } from "../../lib/small-entry/types";
import { smallEntryCall } from "./api";
import { commitCell, isNumberColumn, sameValue, shownValue, typingAllowed } from "./cells";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { editorKindOf, useEditorTools } from "../grid/EditorTools";
import { filterHolds, kindOfFieldType, sortedDistinct } from "../grid/filter";
import { findTyped, selectionTotals as totalsOf } from "../grid/totals";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { SearchCombo } from "../ui/SearchCombo";
import { ArrangeColumns } from "../grid/ArrangeColumns";
import { comboPlace } from "../grid/comboPlace";
import { exportTableFrom, NOT_SUMMED } from "../grid/exportTable";
import { GridButtons } from "../grid/GridButtons";
import { refreshQuestion } from "../grid/prompts";
import { nextEntryCell, rowChanged } from "../grid/rows";
import { GridCombo } from "../grid/GridCombo";
import type { GridComboPlace } from "../grid/GridCombo";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useGridOutput } from "../grid/useGridOutput";

/**
 * Small_Entry, the one screen every SMALL_ENTRY menu opens (Godown Opening, Journal Entry,
 * Payment Allotment, ...). The menu names an entry_properties entry; its first combo, header
 * controls, grid columns and what Save writes all come from that entry's setup.
 *
 * Flow, as on the desktop: choose the header (first combo and controls), leave the first
 * combo (Enter or Show) to fill the grid, edit the open cells, Save. After a save the grid
 * clears and the header is ready for the next one.
 */

const ROW_HEIGHT = 22;


type SaveReply = SaveOutcome & { needs?: "edit-password" };
type Cursor = { row: number; col: number };

export function SmallEntry({ entryName, menuShortName, title, onClose }: { entryName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [def, setDef] = useState<EntryDefinition | null>(null);
  const [fatal, setFatal] = useState("");
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState("Loading");
  const [first, setFirst] = useState<EntryOption | null>(null);
  const [controls, setControls] = useState<Record<string, string>>({});
  const [grid, setGrid] = useState<EntryGrid | null>(null);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [edited, setEdited] = useState<ReadonlySet<number>>(new Set());
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [find, setFind] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [yearStart, setYearStart] = useState<Date | null>(null);
  const [who, setWho] = useState({ company: "", user: "" });
  /** A combo cell's open list: where it shows, and a letter that opened it. */
  const [comboAt, setComboAt] = useState<GridComboPlace | null>(null);
  const [columnChooser, setColumnChooser] = useState(false);
  /** Type to find: the letters typed so far in the current column (not while editing). */
  const [typed, setTyped] = useState("");
  /** The other end of a row selection (a position in the rows shown), for Excel's Sum / Count / Average. */
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const dragSelect = useRef(false);
  /**
   * As the master: after an arrow, page or click move, letters search the column; after an edit
   * (and the move Enter or Tab makes from it) they start editing the cell the cursor is on.
   */
  const findMode = useRef(true);
  /**
   * As the master: after Enter or Tab takes a value, the cell the cursor moves to opens for editing
   * at once. The move lands on the next render, so the editor opens from an effect.
   */
  const editOnArrive = useRef(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const gridFocus = useRef<HTMLDivElement>(null);
  useAltHotkeys(screenRef);
  // The shared grid library (features/grid): column filters, and the editors' calculator, calendar and date typing.
  const columnFilters = useColumnFilters();
  const { filters, clearAll: clearFilters } = columnFilters;
  const tools = useEditorTools(yearStart);
  useEffect(() => {
    const release = () => { dragSelect.current = false; };
    document.addEventListener("mouseup", release);
    return () => document.removeEventListener("mouseup", release);
  }, []);

  const ask = useCallback((text: string, heading: string, buttons: ("OK" | "Yes" | "No" | "Cancel")[] = ["OK"], defaultButton?: "OK" | "Yes" | "No" | "Cancel") => messageBox.ask(text, heading, buttons, { defaultButton }), []);
  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) return Promise.reject(new Error("No company is open"));
    return smallEntryCall<T>(selection, entryName, menuShortName, action, payload);
  }, [selection, entryName, menuShortName]);

  // ---- Small_Entry_Load (and the module password Main_Menu_New asks first)
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    smallEntryCall<{ entry: EntryDefinition; warnings: string[]; yearStart: string; companyName: string; userName: string }>(selection, entryName, menuShortName, "entry")
      .then(async (body) => {
        if (cancelled) return;
        setDef(body.entry);
        setYearStart(new Date(body.yearStart));
        setWho({ company: body.companyName, user: body.userName });
        setWarnings([...body.entry.unsupported, ...body.warnings]);
        setFirst(body.entry.firstCombo?.options[0] ?? null);
        setControls(Object.fromEntries(body.entry.controls.map((control) => [control.name, control.initial])));
        if (!body.entry.rights.modulePassword) { setLocked(false); return; }
        for (;;) {
          const password = await messageBox.prompt("Enter Password", "Password", { password: true });
          if (cancelled) return;
          if (password === null) { onClose(); return; }
          const check = await smallEntryCall<{ ok: boolean; message: string }>(selection, entryName, menuShortName, "module-password", { password }).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
          if (cancelled) return;
          if (check.ok) { setLocked(false); return; }
          await messageBox.ask(check.message, "Password");
        }
      })
      .catch((error: unknown) => { if (!cancelled) setFatal(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [selection, entryName, menuShortName, onClose]);

  // The visible area decides how many rows are drawn.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid]);

  const state = useCallback(() => ({ firstCombo: first, controls }), [first, controls]);
  /** The columns as the operator lays them out: order, hidden ones, widths (features/grid/useColumnLayout). */
  const setupColumns = useMemo(() => grid?.columns.filter((column) => column.visible) ?? [], [grid]);
  const layout = useColumnLayout(setupColumns, 0, (column) => Math.max(40, column.width));
  const { columns, widthOf } = layout;

  // ---- Cmb_FirstCombo_Leave: fill the grid
  const loadGrid = useCallback(async (firstChoice: EntryOption | null) => {
    if (!def || locked) return;
    for (const control of def.controls) {
      if (control.compulsory && (controls[control.name] ?? "").trim() === "") { await ask(`${control.label} is required`, "Entry Validation"); return; }
    }
    setBusy("Data generation");
    setMessage("");
    try {
      const body = await call<{ grid: EntryGrid & { warnings: string[] } }>("grid", { state: { firstCombo: firstChoice, controls } });
      setWarnings([...def.unsupported, ...body.grid.warnings]);
      if (body.grid.rows.length === 0) {
        await ask(`Entry Not Found For The Selection ${firstChoice?.text ?? ""}`, "Entry Not Found");
        return;
      }
      setGrid(body.grid);
      setRecords(body.grid.rows.map((row) => ({ ...row })));
      setEdited(new Set());
      setSort(null);
      setFind("");
      clearFilters();
      setTyped("");
      setSelectionEnd(null);
      setScrollTop(0);
      scroller.current?.scrollTo({ top: 0 });
      const firstEditable = body.grid.columns.filter((column) => column.visible).findIndex((column) => column.editable);
      setCursor({ row: 0, col: Math.max(0, firstEditable) });
      findMode.current = true;
      Promise.resolve().then(() => gridFocus.current?.focus({ preventScroll: true }));
    } catch (error) {
      await ask(error instanceof Error ? error.message : String(error), "Entry");
    } finally {
      setBusy("");
    }
  }, [def, locked, controls, call, ask, clearFilters]);

  const kindOf = useCallback((column: EntryColumn) => kindOfFieldType(column.fieldType), []);
  /**
   * Filters, search and sort read the values as loaded, as the master's Update grid does, so a
   * row does not jump or vanish while it is being edited.
   */
  const stored = useCallback((index: number) => grid?.rows[index] ?? records[index] ?? {}, [grid, records]);
  /** Whether a row passes every column filter but `except` (the one whose list is being opened). */
  const passesFilters = useCallback((index: number, except?: string) => Object.entries(filters).every(([key, filter]) => {
    if (key === except) return true;
    const column = grid?.columns.find((candidate) => candidate.key === key);
    const raw = stored(index)[key] ?? "";
    return !column || filterHolds(kindOf(column), filter, raw, shownValue(column, raw));
  }), [filters, grid, stored, kindOf]);
  const searchHolds = useCallback((index: number) => {
    const needle = find.trim().toLowerCase();
    return needle === "" || columns.some((column) => shownValue(column, stored(index)[column.key] ?? "").toLowerCase().includes(needle));
  }, [find, columns, stored]);

  // Rows as shown: column filters, then the search over every shown column; a heading click sorts.
  const shownRows = useMemo(() => {
    let indexes = records.map((_, index) => index).filter((index) => passesFilters(index) && searchHolds(index));
    if (sort) {
      const column = columns.find((candidate) => candidate.key === sort.key);
      const kind = column ? kindOf(column) : "text";
      const value = (index: number) => stored(index)[sort.key] ?? "";
      indexes = [...indexes].sort((a, b) => {
        const order = kind === "number" ? (Number(value(a).replace(/,/g, "") || 0) - Number(value(b).replace(/,/g, "") || 0))
          : kind === "date" ? (parseDesktopDate(value(a))?.getTime() ?? 0) - (parseDesktopDate(value(b))?.getTime() ?? 0)
          : value(a).localeCompare(value(b), undefined, { numeric: true, sensitivity: "base" });
        return sort.dir === "asc" ? order : -order;
      });
    }
    return indexes;
  }, [records, columns, sort, passesFilters, searchHolds, kindOf, stored]);

  /** A column's distinct values as shown, for its filter list (after the other filters and the search). */
  const valuesOf = (column: EntryColumn) => sortedDistinct(records.map((_, index) => index).filter((index) => passesFilters(index, column.key) && searchHolds(index)).map((index) => shownValue(column, stored(index)[column.key] ?? "")));
  const filtering = Object.keys(filters).length > 0 || find.trim() !== "" || sort !== null;

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const endIndex = Math.min(shownRows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 10);
  const unsaved = edited.size > 0 || editing;

  /** Keeps the cursor's cell in view, below the heading and right of the row-number column. */
  const reveal = useCallback((row: number, col: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = (row + 1) * ROW_HEIGHT;
    if (top < element.scrollTop + ROW_HEIGHT) element.scrollTop = top - ROW_HEIGHT;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    const rowNumber = element.querySelector<HTMLElement>(".mp-rownum")?.offsetWidth ?? 0;
    const left = rowNumber + columns.slice(0, col).reduce((sum, column) => sum + widthOf(column), 0);
    const right = left + (columns[col] ? widthOf(columns[col]) : 0);
    if (left - rowNumber < element.scrollLeft) element.scrollLeft = left - rowNumber;
    else if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
  }, [columns, widthOf]);

  const moveTo = useCallback((row: number, col: number) => {
    const next = { row: Math.max(0, Math.min(shownRows.length - 1, row)), col: Math.max(0, Math.min(columns.length - 1, col)) };
    setCursor(next);
    reveal(next.row, next.col);
  }, [shownRows.length, columns.length, reveal]);

  /** A row keeps its changed mark only while it differs from what was loaded (a value typed back clears it). */
  const settleEdited = useCallback((index: number, next: Readonly<Record<string, string>>) => {
    const changed = rowChanged(columns, next, grid?.rows[index], sameValue);
    setEdited((current) => { const copy = new Set(current); if (changed) copy.add(index); else copy.delete(index); return copy; });
  }, [columns, grid]);

  /** Ctrl+Z, as the master's Restore Cell Value: the cell goes back to the value it was loaded with. */
  const restoreCell = (position: number, column: EntryColumn) => {
    const index = shownRows[position];
    const loaded = grid?.rows[index];
    if (index === undefined || !loaded || !column.editable) return;
    const next = { ...records[index], [column.key]: loaded[column.key] ?? "" };
    delete next[`${column.key}__key`];
    setRecords((current) => current.map((record, at) => (at === index ? next : record)));
    settleEdited(index, next);
  };

  const startEdit = useCallback((initial?: string) => {
    const column = columns[cursor.col];
    const record = records[shownRows[cursor.row]];
    if (!column || !record || !column.editable) return;
    const value = record[column.key] ?? "";
    const number = Number(value.replace(/,/g, "") || 0);
    // As the master: a number editor opens blank on a zero, so the figure is typed afresh, and
    // otherwise with the column's decimal places (the database keeps four).
    const shown = !isNumberColumn(column) ? value : number === 0 ? "" : Number.isFinite(number) ? number.toFixed(column.fieldType === "I" ? 0 : Math.max(0, Math.min(4, column.decimals))) : value;
    setEditText(initial ?? shown);
    findMode.current = false;
    setTyped("");
    setSelectionEnd(null);
    // A combo cell (a list column) opens its list under the cell, as the master's do.
    setComboAt(column.options ? comboPlace(document.querySelector(`.mp-grid [data-cell="${cursor.row}:${CSS.escape(column.key)}"]`), column.options.map((option) => option.text)) : null);
    if (column.options) setEditText(value);
    setEditing(true);
  }, [columns, cursor, records, shownRows]);

  useEffect(() => {
    if (!editOnArrive.current || editing) return;
    editOnArrive.current = false;
    if (columns[cursor.col]?.editable) Promise.resolve().then(() => startEdit());
  }, [cursor, editing, columns, startEdit]);

  /** C1dg_SmallEntryGrid_ValidateEdit + AfterEdit: check the value, mark the row edited. */
  const commit = useCallback(async (typedText?: string): Promise<boolean> => {
    const column = columns[cursor.col];
    const index = shownRows[cursor.row];
    if (!column || index === undefined) { setEditing(false); return true; }
    let text = typedText ?? editText;
    // A combo cell takes only an entry of its list (or nothing); the entry's key goes with the text for saving.
    const option = column.options?.find((candidate) => candidate.text === text);
    if (column.options && text.trim() !== "" && !option) { await ask(`Choose ${column.caption} from its list`, "Entry Validation"); return false; }
    // Dates take the master's short forms (2309, 23sep, 0109+5) and are kept dd/MMM/yyyy.
    if (column.fieldType === "D" && text.trim() !== "") {
      const date = tools.typedDate(text, records[index][column.key] ?? "");
      if (!date) { await ask(`"${text}" is not a date. Type it as 2309, 23sep, 23/09/2026, or 0109+5 for five days on.`, "Invalid Date"); return false; }
      text = formatDesktopDate(date);
    }
    const outcome = commitCell(column, text);
    if (!outcome.ok) { await ask(outcome.message, "Entry Validation"); return false; }
    setRecords((current) => current.map((record, at) => (at === index ? { ...record, [column.key]: outcome.value, ...(column.options ? { [`${column.key}__key`]: option?.value ?? "" } : {}) } : record)));
    settleEdited(index, { ...records[index], [column.key]: outcome.value });
    setEditing(false);
    gridFocus.current?.focus({ preventScroll: true });
    return true;
  }, [columns, cursor, shownRows, editText, ask, records, tools, settleEdited]);

  const finishCombo = async (text: string, step: 0 | 1 | -1) => {
    setEditText(text);
    if (!(await commit(text))) return;
    if (step === 0) return;
    const col = nextEditable(cursor.col, step);
    if (col >= 0) { editOnArrive.current = true; moveTo(cursor.row, col); }
  };

  const nextEditable = useCallback((from: number, step: 1 | -1) => {
    for (let col = from + step; col >= 0 && col < columns.length; col += step) if (columns[col].editable) return col;
    return -1;
  }, [columns]);

  const editorKeys = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const column = columns[cursor.col];
    if (column && tools.keys(event, editorKindOf(column.fieldType), editText, setEditText, column.decimals)) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); gridFocus.current?.focus({ preventScroll: true }); return; }
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
      event.preventDefault();
      if (!(await commit())) return;
      if (event.key === "Tab") {
        const col = nextEditable(cursor.col, event.shiftKey ? -1 : 1);
        editOnArrive.current = true;
        if (col >= 0) moveTo(cursor.row, col); else moveTo(cursor.row + (event.shiftKey ? -1 : 1), event.shiftKey ? columns.length - 1 : Math.max(0, nextEditable(-1, 1)));
      } else if (event.key === "Enter") {
        // Enter goes across the row's open columns (Opening, then Rate), then to the next row's first.
        const next = nextEntryCell(columns.map((candidate) => candidate.editable), cursor.row, cursor.col, shownRows.length);
        if (next) { editOnArrive.current = true; moveTo(next.row, next.col); }
      } else { findMode.current = true; moveTo(cursor.row + (event.key === "ArrowUp" ? -1 : 1), cursor.col); }
    }
  };

  /** A cell's text as the grid shows it, by its position in the rows shown. */
  const shownAt = (position: number, column: EntryColumn) => shownValue(column, records[shownRows[position]]?.[column.key] ?? "");

  const gridKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || shownRows.length === 0) return;
    const page = Math.max(1, Math.floor(viewHeight / ROW_HEIGHT) - 1);
    const column = columns[cursor.col];
    // Shift+↑ / Shift+↓ select rows, for Excel's Sum / Count / Average of a number column.
    if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const end = Math.max(0, Math.min(shownRows.length - 1, (selectionEnd ?? cursor.row) + (event.key === "ArrowDown" ? 1 : -1)));
      setSelectionEnd(end === cursor.row ? null : end);
      reveal(end, cursor.col);
      return;
    }
    // Ctrl+Shift+← / →: the current column moves one place; the cursor goes with it (as the master).
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && column) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      if (columns[cursor.col + step]) { layout.shiftColumn(column.key, step); setCursor({ row: cursor.row, col: cursor.col + step }); }
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("se-find")?.focus(); return; }
    if (event.ctrlKey && event.key.toLowerCase() === "z") { event.preventDefault(); if (column) restoreCell(cursor.row, column); return; }
    // Type to find, as the master's grid: letters search the current column, Backspace takes one back, Esc clears.
    if (typed !== "" && (event.key === "Backspace" || event.key === "Escape")) {
      event.preventDefault();
      const search = event.key === "Escape" ? "" : typed.slice(0, -1);
      setTyped(search);
      if (search !== "" && column) {
        const found = findTyped(shownRows.map((_, position) => position), search, (position) => shownAt(position, column));
        if (found >= 0) moveTo(found, cursor.col);
      }
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && column) {
      event.preventDefault();
      if (!findMode.current && column.editable) {
        if (column.options) startEdit(); else if (typingAllowed(column, event.key)) startEdit(event.key);
        return;
      }
      const search = typed + event.key;
      const found = findTyped(shownRows.map((_, position) => position), search, (position) => shownAt(position, column));
      if (found >= 0) { setTyped(search.toUpperCase()); setSelectionEnd(null); moveTo(found, cursor.col); }
      return;
    }
    setTyped("");
    if (!event.shiftKey && event.key !== "Shift") setSelectionEnd(null);
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"].includes(event.key)) findMode.current = true;
    const moves: Record<string, () => void> = {
      ArrowDown: () => moveTo(cursor.row + 1, cursor.col),
      ArrowUp: () => moveTo(cursor.row - 1, cursor.col),
      ArrowRight: () => moveTo(cursor.row, cursor.col + 1),
      ArrowLeft: () => moveTo(cursor.row, cursor.col - 1),
      PageDown: () => moveTo(cursor.row + page, cursor.col),
      PageUp: () => moveTo(cursor.row - page, cursor.col),
      Home: () => (event.ctrlKey ? moveTo(0, 0) : moveTo(cursor.row, 0)),
      End: () => (event.ctrlKey ? moveTo(shownRows.length - 1, columns.length - 1) : moveTo(cursor.row, columns.length - 1)),
      Enter: () => startEdit(),
      F2: () => startEdit(),
      Tab: () => { const col = nextEditable(cursor.col, event.shiftKey ? -1 : 1); if (col >= 0) moveTo(cursor.row, col); },
    };
    const move = moves[event.key];
    if (move) { event.preventDefault(); move(); return; }
    if (event.key === "Escape") { event.preventDefault(); void leave(); }
  };

  /**
   * The selected rows' Sum / Count / Average in the status bar, as Excel (and the master) show
   * them: two or more rows selected on a number column.
   */
  const totals = (() => {
    const column = columns[cursor.col];
    if (editing || selectionEnd === null || !column || !["N", "C"].includes(column.fieldType)) return null;
    const from = Math.min(cursor.row, selectionEnd);
    const to = Math.max(cursor.row, selectionEnd);
    const values: string[] = [];
    for (let position = from; position <= to; position += 1) values.push(records[shownRows[position]]?.[column.key] ?? "");
    return totalsOf(values, column.decimals);
  })();
  const inSelection = (position: number) => selectionEnd !== null && position >= Math.min(cursor.row, selectionEnd) && position <= Math.max(cursor.row, selectionEnd);

  /** Print, Preview, Excel, PDF and CSV of the grid as shown (features/grid/useGridOutput). */
  const buildTable = () => exportTableFrom(
    {
      company: who.company,
      title: def?.caption || title,
      titleRight: def?.firstCombo && first ? `${def.firstCombo.label}: ${first.text}` : "",
      footerCenter: shownRows.length === records.length ? `${records.length} records` : `${shownRows.length} of ${records.length} records (filtered)${sort ? ", sorted" : ""}`,
    },
    columns.map((column) => {
      const kind = column.options ? "text" : kindOf(column);
      return { caption: column.caption, kind, decimals: column.decimals, align: kind === "number" ? "right" : kind === "date" ? "center" : column.align === "C" ? "center" : column.align === "R" ? "right" : "left", width: widthOf(column), summed: ["N", "C"].includes(column.fieldType) && !NOT_SUMMED.test(column.key) };
    }),
    shownRows.map((index) => columns.map((column) => records[index][column.key] ?? "")),
  );
  const output = useGridOutput({
    table: buildTable,
    name: `${def?.caption || title}${first ? ` - ${first.text}` : ""}`,
    sheet: first?.text || "Entry",
    csv: () => [columns.map((column) => column.caption), ...shownRows.map((index) => columns.map((column) => shownValue(column, records[index][column.key] ?? "")))],
    shownRows: shownRows.length,
    totalRows: records.length,
    unsaved,
    userName: who.user,
    width: columns.reduce((sum, column) => sum + widthOf(column), 0),
    ask,
    onPreviewClose: () => gridFocus.current?.focus({ preventScroll: true }),
  });

  // ---- Quit_Click / Cancel_Click / Refresh_Click / Save_Click
  const leave = async () => {
    if ((await ask("Returning To Main Menu ? ", "Confirmation", ["Yes", "No"])) === "Yes") onClose();
  };

  const clearGrid = useCallback(() => {
    setGrid(null);
    setRecords([]);
    setEdited(new Set());
    setEditing(false);
    setFind("");
    setSort(null);
    clearFilters();
    setTyped("");
    setSelectionEnd(null);
  }, [clearFilters]);

  const cancel = async () => {
    if (unsaved && (await ask("There are unsaved changes in the grid.\nDiscard the changes?", "Discard Changes", ["Yes", "No"], "No")) !== "Yes") return;
    clearGrid();
  };

  const refresh = async () => {
    // As the master: changed rows (and a cell being typed in) are counted, and No is the default.
    const pending = edited.size + (editing && !edited.has(shownRows[cursor.row]) ? 1 : 0);
    if ((await ask(refreshQuestion(pending), "Refresh", ["Yes", "No"], "No")) !== "Yes") return;
    setEditing(false);
    await loadGrid(first);
  };

  const save = async () => {
    if (!def || !grid) return;
    if (editing && !(await commit())) return;
    if (!def.rights.edit) { await ask("Entry Rights Not Available For User", "Rights Validation"); return; }
    if (edited.size === 0) { await ask("Nothing has been changed", "Entry Save"); return; }
    if ((await ask("Save Entry To Data ?", "Entry Add Save", ["Yes", "No", "Cancel"])) !== "Yes") return;
    let editPassword: string | undefined;
    if (def.rights.editPassword) {
      const password = await messageBox.prompt("Enter Password", "Edit Password", { password: true });
      if (password === null) return;
      editPassword = password;
    }
    setBusy("Saving");
    try {
      const rows = [...edited].sort((a, b) => a - b).map((index) => ({ values: records[index], deleted: false }));
      const reply = await call<SaveReply>("save", { state: state(), rows, editPassword });
      if (!reply.ok) { await ask(reply.message, reply.needs ? "Password" : "Entry Validation"); return; }
      setWarnings([...def.unsupported, ...reply.warnings]);
      setMessage(reply.message);
      clearGrid();
    } catch (error) {
      await ask(error instanceof Error ? error.message : String(error), "Entry Validation");
    } finally {
      setBusy("");
    }
  };

  if (fatal) return <div className="mp-screen"><div className="mp-combos"><b>{title}</b></div><p className="mp-fatal" role="alert">{fatal}</p></div>;

  const current = grid ? records[shownRows[cursor.row]] : undefined;
  return (
    <div ref={screenRef} className={`mp-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.caption || title}>
      <div className="mp-combos">
        {def?.controls.map((control) => (
          <div className="mp-combo" key={control.name} title={control.tooltip || undefined}>
            <span>{control.label}</span>
            {control.type === "LB" ? (
              <SearchCombo
                ariaLabel={control.label}
                options={control.options}
                value={control.options.find((option) => option.text === controls[control.name]) ?? null}
                disabled={Boolean(grid) || Boolean(busy)}
                onChoose={(option) => setControls((currentControls) => ({ ...currentControls, [control.name]: option.text }))}
              />
            ) : (
              <input
                className="mp-control"
                aria-label={control.label}
                value={controls[control.name] ?? ""}
                disabled={Boolean(grid) || Boolean(busy)}
                onChange={(event) => { const value = event.target.value; setControls((currentControls) => ({ ...currentControls, [control.name]: value })); }}
                onBlur={(event) => {
                  if (control.type !== "DT") return;
                  const date = parseDesktopDate(event.target.value);
                  if (date) setControls((currentControls) => ({ ...currentControls, [control.name]: formatDesktopDate(date) }));
                }}
              />
            )}
          </div>
        ))}
        {def?.firstCombo && (
          <div className="mp-combo">
            <span>{def.firstCombo.label}</span>
            {/* Leaving the first combo fills the grid: Enter (or a choice) does it here. */}
            <SearchCombo
              ariaLabel={def.firstCombo.label}
              options={def.firstCombo.options}
              value={first}
              reselect
              disabled={Boolean(grid) || Boolean(busy)}
              focus={!locked && !grid}
              onChoose={(option) => { setFirst(option); void loadGrid(option); }}
            />
          </div>
        )}
        {!grid && <button type="button" data-hotkey="h" aria-keyshortcuts="Alt+H" className="mp-btn mp-btn-blue" onClick={() => void loadGrid(first)} disabled={Boolean(busy) || locked || (Boolean(def?.firstCombo) && !first)}><Icon name="list" /><HotkeyLabel text="Show" hotkey="h" /></button>}
        {!grid && <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red" onClick={() => void leave()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>}
        {busy && <span className="mp-busy">{busy}…</span>}
        {grid?.balance && <span className="mp-balance">{grid.balance}</span>}
        <span className="mp-heading">{def?.caption || title}{def && def.rights.restricted && !def.rights.edit ? " · Rights: view only" : ""}</span>
      </div>

      {grid ? (
        <div className="mp-update">
          <div className="mp-scroll" ref={scroller} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <div ref={gridFocus} tabIndex={0} role="grid" aria-label={def?.caption || title} aria-rowcount={shownRows.length} className="mp-grid" style={{ height: (shownRows.length + 1) * ROW_HEIGHT }} onKeyDown={gridKeys}>
              <div className="mp-row mp-head" style={{ top: 0 }}>
                <div className="mp-cell mp-rownum" aria-hidden="true" />
                {columns.map((column) => (
                  <div key={column.key} className={`mp-cell ${filters[column.key] ? "mp-filtered" : ""} ${column.editable ? "" : "mp-head-readonly"} ${column.addon ? "mp-head-addon" : ""}`} style={{ width: widthOf(column), textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left" }} title={`${column.caption}${column.editable ? "" : " (read-only)"}${column.tooltip ? ` · ${column.tooltip}` : ""} · click to sort · ▾ to filter`}>
                    <button type="button" className="mp-head-label" onClick={() => setSort((currentSort) => (currentSort?.key === column.key && currentSort.dir === "asc" ? { key: column.key, dir: "desc" } : currentSort?.key === column.key ? null : { key: column.key, dir: "asc" }))}>
                      {column.caption}{sort?.key === column.key && <i>{sort.dir === "asc" ? " ▲" : " ▼"}</i>}
                    </button>
                    <FilterButton caption={column.caption} onOpen={() => columnFilters.open(column.key, valuesOf(column))} />
                    {layout.resizeHandle(column)}
                    <FilterPopup state={columnFilters} columnKey={column.key} caption={column.caption} kind={kindOf(column)} values={columnFilters.openFilter === column.key ? valuesOf(column) : []} area={scroller} />
                  </div>
                ))}
              </div>
              {shownRows.slice(startIndex, endIndex).map((index, offset) => {
                const position = startIndex + offset;
                const record = records[index];
                return (
                  <div key={index} className={`mp-row ${position % 2 ? "mp-alt" : ""} ${position === cursor.row ? "mp-current-row" : ""} ${edited.has(index) ? "mp-edited" : ""} ${inSelection(position) ? "mp-selected" : ""}`} style={{ top: (position + 1) * ROW_HEIGHT }}>
                    <div className="mp-cell mp-rownum" aria-hidden="true">{position === cursor.row ? "▶" : edited.has(index) ? "✎" : ""}</div>
                    {columns.map((column, col) => {
                      const here = position === cursor.row && col === cursor.col;
                      return (
                        <div
                          key={column.key}
                          role="gridcell"
                          data-cell={`${position}:${column.key}`}
                          tabIndex={-1}
                          aria-selected={here}
                          aria-readonly={!column.editable}
                          className={`mp-cell ${here ? "mp-current" : ""} ${column.editable ? "" : "mp-readonly"}`}
                          style={{ width: widthOf(column), textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left" }}
                          onMouseDown={(event) => {
                            if (editing && here) return;
                            event.preventDefault();
                            // Shift+click extends a row selection; dragging down or up with the button held does too.
                            if (event.shiftKey && !editing) { gridFocus.current?.focus({ preventScroll: true }); setSelectionEnd(position === cursor.row ? null : position); return; }
                            if (event.button === 0) dragSelect.current = true;
                            const go = () => { gridFocus.current?.focus({ preventScroll: true }); if (position !== cursor.row) { setTyped(""); findMode.current = true; } setSelectionEnd(null); moveTo(position, col); };
                            if (editing) void commit().then((ok) => { if (ok) go(); }); else go();
                          }}
                          onDoubleClick={() => startEdit()}
                          onMouseEnter={(event) => { if (dragSelect.current && event.buttons === 1 && !editing && position !== (selectionEnd ?? cursor.row)) setSelectionEnd(position === cursor.row ? null : position); }}
                        >
                          {here && editing && column.options ? (
                            <GridCombo
                              options={column.options}
                              current={editText}
                              place={comboAt}
                              onPick={(text, step) => void finishCombo(text, step)}
                              onCancel={() => { setEditing(false); gridFocus.current?.focus({ preventScroll: true }); }}
                            />
                          ) : here && editing ? (
                            <span className="mp-editor-wrap">
                              <input
                                ref={(element) => element?.focus({ preventScroll: true })}
                                className="mp-editor"
                                style={{ textAlign: column.align === "R" ? "right" : "left" }}
                                inputMode={["N", "C", "I"].includes(column.fieldType) ? "decimal" : undefined}
                                value={editText}
                                onChange={(event) => { if (typingAllowed(column, event.target.value)) setEditText(event.target.value); }}
                                onKeyDown={(event) => void editorKeys(event)}
                              />
                              {tools.buttons(editorKindOf(column.fieldType), editText, setEditText, column.decimals)}
                            </span>
                          ) : shownValue(column, record[column.key] ?? "")}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="mp-update mp-empty-grid" aria-hidden="true" />
      )}

      {grid && (
        <GridButtons
          source="small-entry"
          busy={Boolean(busy)}
          save={{ onClick: () => void save(), disabled: !def?.rights.edit || Boolean(def?.unsupported.length), title: def?.unsupported.length ? def.unsupported[0] : undefined }}
          output={output}
          refresh={{ onClick: () => void refresh() }}
          cancel={{ onClick: () => void cancel() }}
          quit={{ onClick: () => void leave() }}
          arrange={{ onClick: () => setColumnChooser(true), hidden: layout.hiddenColumns.length }}
          search={{ id: "se-find", value: find, onChange: (value) => { setFind(value); setCursor({ row: 0, col: cursor.col }); scroller.current?.scrollTo({ top: 0 }); } }}
          clearFilters={filtering ? () => { clearFilters(); setFind(""); setSort(null); } : null}
          count={`${shownRows.length === records.length ? `${records.length} records` : `${shownRows.length} of ${records.length}`}${edited.size ? ` · ${edited.size} changed` : ""}`}
        />
      )}

      <div className="mp-status" role="status">
        <span>{def?.statusHead}</span>
        {current && columns[cursor.col] && <span>Row {cursor.row + 1} · {columns[cursor.col].caption}</span>}
        <span className="mp-message">{typed ? `Find in ${columns[cursor.col]?.caption ?? ""}: ${typed}  (Enter to edit · Backspace · Esc)` : message}</span>
        {totals && <span className="mp-sel-totals" title={`Selected rows of ${columns[cursor.col]?.caption ?? ""}`}>{totals}</span>}
        {editing && columns[cursor.col] && <span>{tools.hint(editorKindOf(columns[cursor.col].fieldType))}</span>}
        {warnings.map((warning) => <span key={warning} className="mp-warning" title={warning}>⚠ {warning}</span>)}
      </div>
      {tools.popups}
      {output.dialogs}
      {columnChooser && (
        <ArrangeColumns
          items={layout.arrangeItems((column) => column.caption)}
          changed={layout.columnOrder.length > 0}
          onMove={layout.placeColumn}
          onToggle={layout.toggleColumn}
          onShowAll={() => layout.setHiddenColumns([])}
          onResetOrder={() => layout.setColumnOrder([])}
          onClose={() => { setColumnChooser(false); gridFocus.current?.focus({ preventScroll: true }); }}
        />
      )}
    </div>
  );
}
