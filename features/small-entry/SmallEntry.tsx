"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { formatDesktopDate, getPermission, parseDesktopDate, toText } from "../../lib/master-program/legacy";
import type { PermissionSource } from "../../lib/master-program/legacy";
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
import { confirmLeave, refreshQuestion } from "../grid/prompts";
import { nextOpenCell, rowChanged } from "../grid/rows";
import { GridCombo } from "../grid/GridCombo";
import type { GridComboPlace } from "../grid/GridCombo";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useGridOutput } from "../grid/useGridOutput";
import { closedByRow, dropPadding, duplicateInGrid, fitCase, keyPress, numberRules, pairedMessage, rowRuled, styleCase, typingAllowed as setupAllows, validate } from "../grid/rules";
import { tooltipText, zeroAsBlank } from "../grid/cellText";
import { remainingAfterKey, typeAtCaret } from "../grid/caret";
import { keepGridFocus } from "../grid/focus";
import { findNextCell } from "../grid/find";
import { columnLefts, frozenCell, revealColumn, ROW_MARKER_WIDTH } from "../grid/frozen";
import { copyCell as copyOf, gridText, pastedMessage, pasteValue } from "../grid/clipboard";
import type { CopiedCell } from "../grid/clipboard";
import { cellAt, columnMenuItems, GridMenu } from "../grid/GridMenu";
import type { GridMenuPlace } from "../grid/GridMenu";
import { BLANK_COMPULSORY_TITLE, blankCompulsory } from "../grid/compulsory";
import { FoundText } from "../grid/FoundText";
import { DateField } from "../grid/DateField";
import { BANK_RECO, recoDateProblem } from "../../lib/small-entry/bankReco";
import { ENTRY_APPROVED, isLocked, LOCKED_BOOK, PARTY_STOP_MESSAGE } from "../../lib/small-entry/approval";

/**
 * Small_Entry, the one screen every SMALL_ENTRY menu opens (Godown Opening, Journal Entry,
 * Payment Allotment, ...). The menu names an entry_properties entry; its first combo, header
 * controls, grid columns and what Save writes all come from that entry's setup.
 *
 * Flow, as on the desktop: choose the header (first combo and controls), leave the first
 * combo (Enter or Show) to fill the grid, edit the open cells, Save. After a save the grid
 * clears and the header is ready for the next one.
 *
 * The grid's behaviour is the shared grid library's (features/grid), the same as the master's
 * Update grid: typing and validation rules from each column's entry_grid_body setup, row rules
 * that close cells, copy / paste, the right-click menu, frozen columns, search, filters, output.
 */

const ROW_HEIGHT = 22;

type SaveReply = SaveOutcome & { needs?: "edit-password" };
type Cursor = { row: number; col: number };

/** A record's value by field name, whatever case the query gave the column. */
function valueIn(record: Readonly<Record<string, string>> | undefined, name: string): string | undefined {
  if (!record) return undefined;
  const lower = name.split(".").pop()!.trim().toLowerCase();
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? undefined : record[key];
}

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
  /** Rows the Delete key removed (Selected_RowDelete): hidden, and deleted by Save. */
  const [deleted, setDeleted] = useState<ReadonlySet<number>>(new Set());
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
  const [comboStart, setComboStart] = useState("");
  const [columnChooser, setColumnChooser] = useState(false);
  const [menu, setMenu] = useState<GridMenuPlace | null>(null);
  const [copied, setCopied] = useState<CopiedCell | null>(null);
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
  const headRef = useRef<HTMLDivElement>(null);
  /**
   * Enter in the header moves on to the next control, as Tab does (the desktop's KeyPreview). The
   * first combo keeps its own Enter (it fills the grid), and a list with nothing chosen yet keeps
   * the Enter that opened it. The control takes its Enter first (a choice, a typed date).
   */
  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const enter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.shiftKey) return;
      const from = event.target;
      if (!(from instanceof HTMLInputElement) || from.closest(".se-first")) return;
      setTimeout(() => {
        if (from.getAttribute("aria-expanded") === "true") return;
        const fields = [...head.querySelectorAll<HTMLInputElement>(".se-field input:not(:disabled)")];
        const next = fields[fields.indexOf(from) + 1];
        if (next) { next.focus(); next.select(); }
      }, 0);
    };
    head.addEventListener("keydown", enter);
    return () => head.removeEventListener("keydown", enter);
  }, []);
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

  /** The shared message box; the grid takes the keyboard back once it closes. */
  const ask = useCallback((text: string, heading: string, buttons: ("OK" | "Yes" | "No" | "Cancel")[] = ["OK"], defaultButton?: "OK" | "Yes" | "No" | "Cancel") =>
    messageBox.ask(text, heading, buttons, { defaultButton }).then((answer) => { keepGridFocus(gridFocus); return answer; }), []);
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
  /** The columns as the operator lays them out: order, hidden ones, widths, frozen ones (features/grid/useColumnLayout). */
  const setupColumns = useMemo(() => grid?.columns.filter((column) => column.visible) ?? [], [grid]);
  const frozen = Math.min(grid?.frozen ?? 0, setupColumns.length);
  const layout = useColumnLayout(setupColumns, frozen, (column) => Math.max(40, column.width));
  const { columns, widthOf } = layout;
  const licence = def?.licence ?? 0;
  const yearStartText = yearStart ? formatDesktopDate(yearStart) : "";

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
      setDeleted(new Set());
      setSort(null);
      setFind("");
      clearFilters();
      setTyped("");
      setSelectionEnd(null);
      setCopied(null);
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

  // ---- Row rules: what Func_GetPermission reads, and the cells STATUS_AGAINST_FLD or a paired field close
  const permissionSource = useCallback((record: Readonly<Record<string, string>>): PermissionSource => ({
    firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: true },
    fieldValue: (name) => valueIn(record, name),
  }), [first]);
  /** C1dg_SmallEntryGrid_BeforeRowColChange's Func_SetPermission, worked out for any row (by record index). */
  const isEditable = useCallback((index: number, column: EntryColumn) => {
    const record = records[index];
    return column.editable && Boolean(record) && !closedByRow(column.setup, column.editable, record[column.key] ?? "", permissionSource(record));
  }, [records, permissionSource]);

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

  /** Rows not deleted, in the loaded order. */
  const liveRows = useMemo(() => records.map((_, index) => index).filter((index) => !deleted.has(index)), [records, deleted]);
  // Rows as shown: column filters, then the search over every shown column; a heading click sorts.
  const shownRows = useMemo(() => {
    let indexes = liveRows.filter((index) => passesFilters(index) && searchHolds(index));
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
  }, [liveRows, columns, sort, passesFilters, searchHolds, kindOf, stored]);

  /** A column's distinct values as shown, for its filter list (after the other filters and the search). */
  const valuesOf = (column: EntryColumn) => sortedDistinct(liveRows.filter((index) => passesFilters(index, column.key) && searchHolds(index)).map((index) => shownValue(column, stored(index)[column.key] ?? "")));
  const filtering = Object.keys(filters).length > 0 || find.trim() !== "" || sort !== null;

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const endIndex = Math.min(shownRows.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 10);
  const unsaved = edited.size > 0 || editing;
  /** Whether the cell at a position in the rows shown is open for editing on its row. */
  const editableAt = useCallback((position: number, column: EntryColumn | undefined) => Boolean(column) && shownRows[position] !== undefined && isEditable(shownRows[position], column!), [shownRows, isEditable]);
  const captionOf = useCallback((name: string) => grid?.columns.find((column) => column.key.toLowerCase() === name.toLowerCase())?.caption ?? name, [grid]);

  /** Keeps the cursor's cell in view, below the heading and clear of the row marker and the frozen columns. */
  const reveal = useCallback((row: number, col: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = (row + 1) * ROW_HEIGHT;
    if (top < element.scrollTop + ROW_HEIGHT) element.scrollTop = top - ROW_HEIGHT;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    revealColumn(element, columns, widthOf, col, frozen, ROW_MARKER_WIDTH);
  }, [columns, widthOf, frozen]);

  const moveTo = useCallback((row: number, col: number) => {
    const next = { row: Math.max(0, Math.min(shownRows.length - 1, row)), col: Math.max(0, Math.min(columns.length - 1, col)) };
    setCursor(next);
    setMessage("");
    reveal(next.row, next.col);
    keepGridFocus(gridFocus);
  }, [shownRows.length, columns.length, reveal]);

  /** A row keeps its changed mark only while it differs from what was loaded (a value typed back clears it), or is deleted. */
  const settleEdited = useCallback((index: number, next: Readonly<Record<string, string>>) => {
    const changed = deleted.has(index) || rowChanged(columns, next, grid?.rows[index], sameValue);
    setEdited((current) => { const copy = new Set(current); if (changed) copy.add(index); else copy.delete(index); return copy; });
  }, [columns, grid, deleted]);

  /** Ctrl+Z, as the master's Restore Cell Value: the cell goes back to the value it was loaded with. */
  const restoreCell = (position: number, column: EntryColumn) => {
    const index = shownRows[position];
    const loaded = grid?.rows[index];
    if (index === undefined || !loaded || !isEditable(index, column)) return;
    const next = { ...records[index], [column.key]: loaded[column.key] ?? "" };
    delete next[`${column.key}__key`];
    setRecords((current) => current.map((record, at) => (at === index ? next : record)));
    settleEdited(index, next);
  };

  /**
   * Ticks or unticks a tick-box cell (a boolean column), then applies the entry's tick rules
   * (query_condition GV, Small_Entry AfterEdit): ticking fills the linked column from a header
   * control, unticking empties it when the rule says sys.false.blank.
   */
  const toggleTick = useCallback((index: number, column: EntryColumn) => {
    const record = records[index];
    if (!record || !isEditable(index, column)) return;
    const ticked = (record[column.key] ?? "").trim().toLowerCase() !== "true";
    let next: Record<string, string> = { ...record, [column.key]: ticked ? "True" : "False" };
    for (const rule of grid?.tickRules ?? []) {
      if (rule.field.toLowerCase() !== column.key.toLowerCase()) continue;
      const target = Object.keys(next).find((key) => key.toLowerCase() === rule.target.toLowerCase());
      if (!target) continue;
      if (ticked) next = { ...next, [target]: controls[rule.control] ?? "" };
      else if (rule.untickBlank) next = { ...next, [target]: "" };
    }
    setRecords((rows) => rows.map((row, at) => (at === index ? next : row)));
    settleEdited(index, next);
  }, [records, isEditable, grid, controls, settleEdited]);

  /** C1dg_SmallEntryGrid_KeyPressEdit's checks for one key, against the column's setup (features/grid/rules keyPress). */
  const keyContext = (column: EntryColumn, record: Readonly<Record<string, string>> | undefined, editorText: string, remainingText?: string) =>
    ({ setup: column.setup, masterGrid: false, programId: 0, licence, cellValue: record?.[column.key] ?? "", editorText, remainingText, yearStart: yearStartText });
  /** The editor may change to `next`: the number form (cells.ts) and the setup's typing rules. */
  const mayType = (column: EntryColumn, before: string, next: string) => typingAllowed(column, next) && setupAllows(column.setup, before, next);

  const startEdit = useCallback((initial?: string) => {
    const column = columns[cursor.col];
    const index = shownRows[cursor.row];
    const record = records[index];
    if (!column || !record || !isEditable(index, column)) return;
    // A tick box has no editor: Enter, F2 or Space ticks or unticks it.
    if (column.boolean) { toggleTick(index, column); return; }
    const value = record[column.key] ?? "";
    const number = Number(value.replace(/,/g, "") || 0);
    // As the master: a number editor opens blank on a zero, so the figure is typed afresh, and
    // otherwise with the column's decimal places (the database keeps four).
    const shown = !isNumberColumn(column) ? value : number === 0 ? "" : Number.isFinite(number) ? number.toFixed(column.fieldType === "I" ? 0 : Math.max(0, Math.min(4, column.decimals))) : value;
    // StartEdit's Dg_DefaultValue: a blank cell whose column defaults to a header control (defa_fixvalue,
    // Bank Statement's Reco. Date from dtp_date3) opens holding that control's value.
    const defaultFrom = toText(column.setup.defa_fixvalue).trim().toLowerCase();
    const headerDefault = value.trim() === "" && defaultFrom !== "" ? controls[defaultFrom] : undefined;
    setEditText(initial ?? headerDefault ?? shown);
    findMode.current = false;
    setTyped("");
    setSelectionEnd(null);
    // A combo cell (a list column) opens its list under the cell, as the master's do.
    setComboAt(column.options ? comboPlace(document.querySelector(`.mp-grid [data-cell="${cursor.row}:${CSS.escape(column.key)}"]`), column.options.map((option) => option.text)) : null);
    if (column.options) setEditText(value);
    setEditing(true);
  }, [columns, cursor, records, shownRows, isEditable, controls, toggleTick]);

  useEffect(() => {
    if (!editOnArrive.current || editing) return;
    editOnArrive.current = false;
    if (columns[cursor.col] && shownRows[cursor.row] !== undefined && isEditable(shownRows[cursor.row], columns[cursor.col])) Promise.resolve().then(() => startEdit());
  }, [cursor, editing, columns, shownRows, isEditable, startEdit]);

  /** C1dg_SmallEntryGrid_ValidateEdit + AfterEdit: check the value, mark the row edited. */
  const commit = useCallback(async (typedText?: string): Promise<boolean> => {
    const column = columns[cursor.col];
    const index = shownRows[cursor.row];
    if (!column || index === undefined) { setEditing(false); return true; }
    const record = records[index];
    const entered = typedText ?? editText;
    const current = record[column.key] ?? "";
    // Passing through a field without changing it leaves it exactly as it was (no case change, no "changed" mark).
    if (entered === current || (entered === "" && zeroAsBlank(column.setup, Boolean(column.options), current) === "")) {
      setEditing(false);
      gridFocus.current?.focus({ preventScroll: true });
      return true;
    }
    // A combo cell takes only an entry of its list (or nothing); the entry's key goes with the text for saving.
    const option = column.options?.find((candidate) => candidate.text === entered);
    if (column.options && entered.trim() !== "" && !option) { await ask(`Choose ${column.caption} from its list`, "Entry Validation"); return false; }
    // Entry Approved, ValidateEdit: an order of a party over its credit days or limit is not approved.
    if (def?.entryId === ENTRY_APPROVED && (first?.text ?? "").trim() === LOCKED_BOOK && column.key.toLowerCase() === "ent_approve" && entered === "Yes" && isLocked(record)) {
      await ask(PARTY_STOP_MESSAGE, "Party Stop Message");
      setEditing(false);
      gridFocus.current?.focus({ preventScroll: true });
      return false;
    }
    // A letter in the case value_allowed permits; trailing blanks off a field that takes no space.
    let text = column.options ? entered : fitCase(column.setup, dropPadding(column.setup, entered), 0);
    // Dates take the master's short forms (2309, 23sep, 0109+5) and are kept dd/MMM/yyyy.
    if (column.fieldType === "D" && text.trim() !== "") {
      const date = tools.typedDate(text, current);
      if (!date) { await ask(`"${text}" is not a date. Type it as 2309, 23sep, 23/09/2026, or 0109+5 for five days on.`, "Invalid Date"); return false; }
      text = formatDesktopDate(date);
      // Bank Statement: the bank clears an entry on or after its date, within 90 days (Small_Entry AfterEdit).
      if (def?.entryId === BANK_RECO && column.key.toLowerCase() === "reco_date") {
        const problem = recoDateProblem(valueIn(record, "doc_date") ?? "", text);
        if (problem !== "") { await ask(problem, "Bank Reconcilation Message"); return false; }
      }
    }
    // ValidateEdit's setup checks: must contain, allowed characters, contact numbers, compulsory, lengths, range.
    const checked = validate({
      setup: column.setup, masterGrid: false, programId: 0, licence, coGstReq: false, label: column.caption,
      fieldValue: (name) => valueIn(record, name) ?? "",
      captionOf,
      columnValues: (name) => records.map((candidate) => valueIn(candidate, name) ?? ""),
      rowIndex: index + 1,
    }, text);
    if (!checked.ok) { await ask(checked.message ?? "", checked.title ?? "Entry Validation"); return false; }
    const partner = toText(column.setup.value_diff_than);
    if (partner !== "" && text.trim() !== "" && (valueIn(record, partner) ?? "").trim() !== "") { await ask(pairedMessage(column.caption, captionOf(partner)), "Only One Allowed"); return false; }
    if (text !== "" && toText(column.setup.duplichk_fldname1) !== "") {
      const withText = records.map((candidate, at) => (at === index ? { ...candidate, [column.key]: text } : candidate));
      if (duplicateInGrid(withText, index, text, column.setup)) { await ask("Duplicate Entry Found...", "Warning"); return false; }
    }
    const outcome = commitCell(column, text);
    if (!outcome.ok) { await ask(outcome.message, "Entry Validation"); return false; }
    // AfterEdit's style_case; a list keeps its entry's text as the list has it.
    const value = column.options || isNumberColumn(column) ? outcome.value : styleCase(column.setup, outcome.value, licence);
    const next = { ...record, [column.key]: value, ...(column.options ? { [`${column.key}__key`]: option?.value ?? "" } : {}) };
    setRecords((rows) => rows.map((row, at) => (at === index ? next : row)));
    settleEdited(index, next);
    setEditing(false);
    gridFocus.current?.focus({ preventScroll: true });
    return true;
  }, [columns, cursor, shownRows, editText, ask, records, tools, settleEdited, licence, captionOf, def?.entryId, first?.text]);

  const nextEditable = useCallback((from: number, step: 1 | -1) => {
    for (let col = from + step; col >= 0 && col < columns.length; col += step) if (editableAt(cursor.row, columns[col])) return col;
    return -1;
  }, [columns, cursor.row, editableAt]);

  /**
   * Where Enter goes, as on the master: the next open column on this row, else the first open one on
   * the rows below (Entry Approved has one open column, so Enter goes down it row by row). Each
   * row's own rules decide what is open; at most three rows are looked at.
   */
  const nextEntry = useCallback((row: number, col: number): Cursor | null =>
    nextOpenCell((at, c) => editableAt(at, columns[c]), row, col, shownRows.length, columns.length), [shownRows.length, columns, editableAt]);

  const finishCombo = async (text: string, step: 0 | 1 | -1) => {
    setEditText(text);
    if (!(await commit(text))) return;
    setComboStart("");
    if (step === 0) return;
    const next = step === 1 ? nextEntry(cursor.row, cursor.col) : (() => { const col = nextEditable(cursor.col, step); return col >= 0 ? { row: cursor.row, col } : null; })();
    if (next) { editOnArrive.current = true; moveTo(next.row, next.col); }
  };

  const editorKeys = async (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const column = columns[cursor.col];
    if (column && tools.keys(event, editorKindOf(column.fieldType), editText, setEditText, numberRules(column.setup))) return;
    // Esc undoes what was typed: the cell keeps the value it had before editing began.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); gridFocus.current?.focus({ preventScroll: true }); return; }
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab") {
      event.preventDefault();
      if (!(await commit())) return;
      if (event.key === "Tab") {
        const col = nextEditable(cursor.col, event.shiftKey ? -1 : 1);
        editOnArrive.current = true;
        if (col >= 0) moveTo(cursor.row, col); else moveTo(cursor.row + (event.shiftKey ? -1 : 1), event.shiftKey ? columns.length - 1 : Math.max(0, columns.findIndex((candidate) => candidate.editable)));
      } else if (event.key === "Enter") {
        // Enter goes across the row's open columns (Opening, then Rate), then to the next row's first.
        const next = nextEntry(cursor.row, cursor.col);
        if (next) { editOnArrive.current = true; moveTo(next.row, next.col); }
      } else { findMode.current = true; moveTo(cursor.row + (event.key === "ArrowUp" ? -1 : 1), cursor.col); }
      return;
    }
    if (!column) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      // Ctrl+Z: the value as it was loaded.
      event.preventDefault();
      setEditText(grid?.rows[shownRows[cursor.row]]?.[column.key] ?? "");
      return;
    }
    // KeyPressEdit for each typed key: allow_space, value_allowed / value_notallowed, numbers only.
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !column.options) {
      const input = event.currentTarget;
      const key = fitCase(column.setup, event.key, 0);
      const outcome = keyPress(keyContext(column, records[shownRows[cursor.row]], editText, remainingAfterKey(input)), key);
      if (outcome.refused) event.preventDefault();
      else if (key !== event.key) {
        event.preventDefault();
        typeAtCaret(input, key, (after) => { if (mayType(column, editText, after)) setEditText(after); });
      }
      if (outcome.message) await ask(outcome.message, "Typed Character not allowed");
      if (outcome.replaceWith !== undefined) setEditText(outcome.replaceWith);
    }
  };

  /** A cell's text as the grid shows it, by its position in the rows shown. */
  const shownAt = (position: number, column: EntryColumn) => shownValue(column, records[shownRows[position]]?.[column.key] ?? "");

  /** The selected positions (cursor row to selectionEnd) in the order the grid shows them. */
  const selectedPositions = () => {
    const from = Math.min(cursor.row, selectionEnd ?? cursor.row);
    const to = Math.max(cursor.row, selectionEnd ?? cursor.row);
    const positions: number[] = [];
    for (let position = from; position <= to && position < shownRows.length; position += 1) positions.push(position);
    return positions;
  };

  // ---- MnuCopy / MnuPaste (features/grid/clipboard)
  const copyCell = async () => {
    const column = columns[cursor.col];
    const record = records[shownRows[cursor.row]];
    if (!column || !record) return;
    const value = record[column.key] ?? "";
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    const outcome = copyOf(value, column.setup, column.options);
    if (!outcome.ok) { await ask(outcome.message, "Warning"); setCopied(null); return; }
    setCopied(outcome.copied);
  };
  const pasteCell = async () => {
    const column = columns[cursor.col];
    if (!copied || !column) return;
    const positions = selectedPositions();
    const fromIndex = shownRows[positions[0] ?? cursor.row];
    const record = records[fromIndex];
    if (!record) return;
    const status = toText(column.setup.status_against_fld);
    const disabled = status !== "" && toText(column.setup.enable_for) !== "" && getPermission(permissionSource(record), "E", status, column.setup.enable_for.trim(), false, false).toUpperCase().includes("D");
    const outcome = pasteValue(copied, { caption: column.caption, setup: column.setup, options: column.options }, { editable: isEditable(fromIndex, column), disabled }, { parse: (text) => tools.typedDate(text, ""), write: (_text, date) => formatDesktopDate(date) });
    if (!outcome.ok) { await ask(outcome.message, "Invalid Paste Selection"); return; }
    let value = outcome.value;
    if (isNumberColumn(column)) {
      const number = commitCell(column, value);
      if (!number.ok) { await ask(number.message, "Invalid Paste Selection"); return; }
      value = number.value;
    }
    const key = column.options ? (column.options.find((option) => option.text === value)?.value ?? copied.addonId) : "";
    // Every selected row takes the value, except one its row rules close for this column.
    let pasted = 0;
    const changed = new Map<number, Record<string, string>>();
    for (const position of positions) {
      const index = shownRows[position];
      if (index === undefined || !isEditable(index, column)) continue;
      changed.set(index, { ...records[index], [column.key]: value, ...(column.options ? { [`${column.key}__key`]: key } : {}) });
      pasted += 1;
    }
    setRecords((rows) => rows.map((row, at) => changed.get(at) ?? row));
    for (const [index, next] of changed) settleEdited(index, next);
    setMessage(pastedMessage(value, pasted, column.caption));
  };

  // ---- Selected_RowDelete: the Delete key, in the entries that allow it
  const deleteSelected = async (scope: "row" | "selection") => {
    if (!def?.canDelete || shownRows.length === 0) return;
    if ((await ask("Do you Want to delete selected rows?", "Confirmation", ["Yes", "No"], "No")) !== "Yes") return;
    const positions = scope === "row" ? [cursor.row] : selectedPositions();
    if (def.entryId === 75 && positions.length !== liveRows.length) { await ask("Please Select All Rows", "Entry Validation"); return; }
    const indexes = positions.map((position) => shownRows[position]).filter((index) => index !== undefined);
    setDeleted((current) => new Set([...current, ...indexes]));
    setEdited((current) => new Set([...current, ...indexes]));
    setSelectionEnd(null);
    setCursor((current) => ({ row: Math.max(0, Math.min(current.row, shownRows.length - indexes.length - 1)), col: current.col }));
  };

  /** F3 and Enter in the search box: the next cell holding what was searched. */
  const findNext = () => {
    const positions = shownRows.map((_, position) => position);
    const hit = findNextCell(positions, cursor.row, columns, (position, column) => shownAt(position, column), find);
    if (hit) moveTo(hit.row, columns.indexOf(hit.column));
  };

  /** Opens the combo list of the cell at the cursor (F4, Alt+↓, the chevron, a letter). */
  const openCombo = (letter = "") => {
    setComboStart(letter);
    startEdit();
  };

  const gridKeys = async (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || shownRows.length === 0) return;
    const page = Math.max(1, Math.floor(viewHeight / ROW_HEIGHT) - 1);
    const column = columns[cursor.col];
    const ctrl = event.ctrlKey || event.metaKey;
    const comboHere = Boolean(column?.options) && editableAt(cursor.row, column);
    // Shift+↑ / Shift+↓ select rows, for Excel's Sum / Count / Average of a number column.
    if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const end = Math.max(0, Math.min(shownRows.length - 1, (selectionEnd ?? cursor.row) + (event.key === "ArrowDown" ? 1 : -1)));
      setSelectionEnd(end === cursor.row ? null : end);
      reveal(end, cursor.col);
      return;
    }
    // Ctrl+Shift+← / →: the current column moves one place; the cursor goes with it (as the master).
    if (ctrl && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && column) {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      if (columns[cursor.col + step] && cursor.col + step >= frozen && cursor.col >= frozen) { layout.shiftColumn(column.key, step); setCursor({ row: cursor.row, col: cursor.col + step }); }
      return;
    }
    if (ctrl && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("se-find")?.focus(); return; }
    if (ctrl && event.key.toLowerCase() === "z") { event.preventDefault(); if (column) restoreCell(cursor.row, column); return; }
    if (ctrl && event.key.toLowerCase() === "c") { event.preventDefault(); await copyCell(); return; }
    if (ctrl && event.key.toLowerCase() === "v") { event.preventDefault(); await pasteCell(); return; }
    if (ctrl && event.key.toLowerCase() === "a") {
      // Ctrl+A: the grid as shown, headings first, to the clipboard for Excel.
      event.preventDefault();
      await navigator.clipboard?.writeText(gridText(columns.map((candidate) => candidate.caption), shownRows.map((index) => columns.map((candidate) => shownValue(candidate, records[index][candidate.key] ?? ""))))).catch(() => undefined);
      setMessage(`${shownRows.length} rows copied`);
      return;
    }
    if (event.key === "F3") { event.preventDefault(); findNext(); return; }
    if (event.key === "F5") { event.preventDefault(); document.getElementById("mp-save")?.focus(); return; }
    if ((event.key === "F4" || (event.altKey && event.key === "ArrowDown")) && comboHere) { event.preventDefault(); openCombo(); return; }
    if (event.key === "Delete" && def?.canDelete) { event.preventDefault(); await deleteSelected("selection"); return; }
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
    // Space ticks or unticks a tick box.
    if (event.key === " " && column?.boolean && !ctrl && !event.altKey) { event.preventDefault(); toggleTick(shownRows[cursor.row], column); return; }
    if (event.key.length === 1 && !ctrl && !event.altKey && column) {
      event.preventDefault();
      if (!findMode.current && editableAt(cursor.row, column)) {
        if (column.options) { openCombo(event.key); return; }
        // The first key goes through KeyPressEdit too: refused, replaced (a date's space) or typed.
        const record = records[shownRows[cursor.row]];
        const key = fitCase(column.setup, event.key, 0);
        const outcome = keyPress(keyContext(column, record, ""), key);
        if (outcome.message) { await ask(outcome.message, "Typed Character not allowed"); return; }
        if (outcome.replaceWith !== undefined) {
          const index = shownRows[cursor.row];
          const next = { ...record, [column.key]: outcome.replaceWith };
          setRecords((rows) => rows.map((row, at) => (at === index ? next : row)));
          settleEdited(index, next);
          return;
        }
        if (!outcome.refused && mayType(column, "", key)) startEdit(key);
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
      // Enter on a closed cell (reached by a click) goes on to the next open one and opens it.
      Enter: () => {
        if (editableAt(cursor.row, column)) { startEdit(); return; }
        const next = nextEntry(cursor.row, cursor.col);
        if (next) { editOnArrive.current = true; findMode.current = false; moveTo(next.row, next.col); }
      },
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
    return totalsOf(selectedPositions().map((position) => records[shownRows[position]]?.[column.key] ?? ""), column.decimals);
  })();
  const inSelection = (position: number) => selectionEnd !== null && position >= Math.min(cursor.row, selectionEnd) && position <= Math.max(cursor.row, selectionEnd);

  /** Print, Preview, Excel, PDF and CSV of the grid as shown (features/grid/useGridOutput). */
  const buildTable = () => exportTableFrom(
    {
      company: who.company,
      title: def?.caption || title,
      titleRight: def?.firstCombo && first ? `${def.firstCombo.label}: ${first.text}` : "",
      footerCenter: shownRows.length === liveRows.length ? `${liveRows.length} records` : `${shownRows.length} of ${liveRows.length} records (filtered)${sort ? ", sorted" : ""}`,
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
    totalRows: liveRows.length,
    unsaved,
    userName: who.user,
    width: columns.reduce((sum, column) => sum + widthOf(column), 0),
    ask,
    onPreviewClose: () => gridFocus.current?.focus({ preventScroll: true }),
  });

  // ---- Quit_Click / Cancel_Click / Refresh_Click / Save_Click
  const leave = async () => {
    if (await confirmLeave(ask)) onClose();
  };

  const clearGrid = useCallback(() => {
    setGrid(null);
    setRecords([]);
    setEdited(new Set());
    setDeleted(new Set());
    setEditing(false);
    setFind("");
    setSort(null);
    clearFilters();
    setTyped("");
    setSelectionEnd(null);
    setCopied(null);
    setMenu(null);
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
    const changedRows = [...edited].sort((a, b) => a - b);
    // Func_BlankFieldValidation, as the master's: a compulsory column on screen and open on the row may not be blank.
    const blank = blankCompulsory(changedRows.map((index) => ({ rowNumber: index + 1, deleted: deleted.has(index), valueOf: (key: string) => records[index][key] })), setupColumns, (rowNumber, column) => isEditable(rowNumber - 1, column));
    if (blank !== "") { await ask(blank, BLANK_COMPULSORY_TITLE); return; }
    if ((await ask("Save Entry To Data ?", "Entry Add Save", ["Yes", "No", "Cancel"])) !== "Yes") return;
    let editPassword: string | undefined;
    if (def.rights.editPassword) {
      const password = await messageBox.prompt("Enter Password", "Edit Password", { password: true });
      if (password === null) return;
      editPassword = password;
    }
    setBusy("Saving");
    try {
      const rows = changedRows.map((index) => ({ values: records[index], deleted: deleted.has(index) }));
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
  const cursorColumn = columns[cursor.col];
  const lefts = columnLefts(columns, widthOf, ROW_MARKER_WIDTH);
  const alignOf = (column: EntryColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");
  // The header's lines: the lists, then the dates and text boxes, three to a line; the first combo's line comes last.
  const byThree = <T,>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / 3) }, (_, at) => items.slice(at * 3, at * 3 + 3));
  const headLines = [...byThree(def?.controls.filter((control) => control.type === "LB") ?? []), ...byThree(def?.controls.filter((control) => control.type !== "LB") ?? [])];
  const lastLine = headLines.length + 1;
  const headLocked = Boolean(grid) || Boolean(busy);
  return (
    <div ref={screenRef} className={`mp-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.caption || title}>
      {/*
        The header in three lines that line up like a grid: the lists, then the dates and text boxes,
        then the first combo with Show / Quit. Every label and every field starts at the same place in
        its column (three columns of label + field), whatever the entry's setup shows.
      */}
      <div className="mp-combos se-head" ref={headRef} role="group" aria-label={`${def?.caption || title} selection`}>
        {headLines.map((line, row) => line.map((control, at) => (
          <Fragment key={control.name}>
            <span className="se-label" style={{ gridRow: row + 1, gridColumn: at * 2 + 1 }} title={control.tooltip || undefined}>{control.label}</span>
            <span className="se-field" style={{ gridRow: row + 1, gridColumn: at * 2 + 2 }} title={control.tooltip || undefined}>
              {control.type === "LB" ? (
                <SearchCombo
                  ariaLabel={control.label}
                  options={control.options}
                  value={control.options.find((option) => option.text === controls[control.name]) ?? null}
                  disabled={headLocked}
                  onChoose={(option) => setControls((currentControls) => ({ ...currentControls, [control.name]: option.text }))}
                />
              ) : control.type === "DT" ? (
                <DateField
                  ariaLabel={control.label}
                  value={controls[control.name] ?? ""}
                  tools={tools}
                  disabled={headLocked}
                  onChange={(value) => setControls((currentControls) => ({ ...currentControls, [control.name]: value }))}
                />
              ) : (
                <input
                  className="mp-control"
                  aria-label={control.label}
                  value={controls[control.name] ?? ""}
                  disabled={headLocked}
                  onChange={(event) => { const value = event.target.value; setControls((currentControls) => ({ ...currentControls, [control.name]: value })); }}
                />
              )}
            </span>
          </Fragment>
        )))}
        {def?.firstCombo && (
          <>
            <span className="se-label" style={{ gridRow: lastLine, gridColumn: 1 }}>{def.firstCombo.label}</span>
            {/* Leaving the first combo fills the grid: Enter (or a choice) does it here. */}
            <span className="se-field se-first" style={{ gridRow: lastLine, gridColumn: "2 / 4" }}>
              <SearchCombo
                ariaLabel={def.firstCombo.label}
                options={def.firstCombo.options}
                value={first}
                reselect
                disabled={headLocked}
                focus={!locked && !grid}
                onChoose={(option) => { setFirst(option); void loadGrid(option); }}
              />
            </span>
          </>
        )}
        <span className="se-actions" style={{ gridRow: lastLine, gridColumn: def?.firstCombo ? "4 / 7" : "1 / 7" }}>
          {!grid && <button type="button" data-hotkey="h" aria-keyshortcuts="Alt+H" className="mp-btn mp-btn-blue" onClick={() => void loadGrid(first)} disabled={Boolean(busy) || locked || (Boolean(def?.firstCombo) && !first)}><Icon name="list" /><HotkeyLabel text="Show" hotkey="h" /></button>}
          {!grid && <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red" onClick={() => void leave()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>}
          {busy && <span className="mp-busy">{busy}…</span>}
          {grid?.balance && <span className="mp-balance">{grid.balance}</span>}
          {grid?.finalAmount && <span className="mp-balance">{grid.finalAmount}</span>}
        </span>
        <span className="mp-heading se-title" style={{ gridRow: 1, gridColumn: 7 }}>{def?.caption || title}{def && def.rights.restricted && !def.rights.edit ? " · Rights: view only" : ""}</span>
      </div>

      {grid ? (
        <div className="mp-update">
          <div className="mp-scroll" ref={scroller} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
            <div
              ref={gridFocus}
              tabIndex={0}
              role="grid"
              aria-label={def?.caption || title}
              aria-rowcount={shownRows.length}
              className="mp-grid"
              style={{ height: (shownRows.length + 1) * ROW_HEIGHT }}
              onKeyDown={(event) => void gridKeys(event)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (editing) return;
                // The menu acts on the cell clicked: the cursor goes there first, unless it is inside the selection.
                const cell = cellAt(event);
                const col = cell ? columns.findIndex((column) => column.key === cell.key) : -1;
                if (cell && col >= 0 && !inSelection(cell.row) && (cell.row !== cursor.row || col !== cursor.col)) { setSelectionEnd(null); moveTo(cell.row, col); }
                setMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <div className="mp-row mp-head" style={{ top: 0 }}>
                <div className="mp-cell mp-rownum" aria-hidden="true" />
                {columns.map((column, index) => {
                  const fixed = frozenCell(index, frozen, lefts);
                  const ruled = rowRuled(column.setup, column.editable);
                  return (
                    <div key={column.key} className={`mp-cell ${fixed.className} ${filters[column.key] ? "mp-filtered" : ""} ${column.editable ? "" : "mp-head-readonly"} ${ruled ? "mp-head-rowruled" : ""} ${column.addon ? "mp-head-addon" : ""}`} style={{ width: widthOf(column), textAlign: alignOf(column), ...fixed.style }} title={`${column.caption}${column.editable ? (ruled ? " (editable on some rows only; grey cells are closed)" : "") : " (read-only)"}${column.tooltip ? ` · ${tooltipText(column.tooltip)}` : ""} · click to sort · ▾ to filter`}>
                      <button type="button" className="mp-head-label" onClick={() => setSort((currentSort) => (currentSort?.key === column.key && currentSort.dir === "asc" ? { key: column.key, dir: "desc" } : currentSort?.key === column.key ? null : { key: column.key, dir: "asc" }))}>
                        {column.caption}{sort?.key === column.key && <i>{sort.dir === "asc" ? " ▲" : " ▼"}</i>}
                      </button>
                      <FilterButton caption={column.caption} onOpen={() => columnFilters.open(column.key, valuesOf(column))} />
                      {layout.resizeHandle(column)}
                      <FilterPopup state={columnFilters} columnKey={column.key} caption={column.caption} kind={kindOf(column)} values={columnFilters.openFilter === column.key ? valuesOf(column) : []} area={scroller} />
                    </div>
                  );
                })}
              </div>
              {shownRows.slice(startIndex, endIndex).map((index, offset) => {
                const position = startIndex + offset;
                const record = records[index];
                return (
                  <div key={index} className={`mp-row ${position % 2 ? "mp-alt" : ""} ${position === cursor.row ? "mp-current-row" : ""} ${edited.has(index) ? "mp-edited" : ""} ${inSelection(position) ? "mp-selected" : ""}`} style={{ top: (position + 1) * ROW_HEIGHT }}>
                    <div className="mp-cell mp-rownum" aria-hidden="true">{position === cursor.row ? "▶" : edited.has(index) ? "✎" : ""}</div>
                    {columns.map((column, col) => {
                      const here = position === cursor.row && col === cursor.col;
                      const open = isEditable(index, column);
                      const fixed = frozenCell(col, frozen, lefts);
                      return (
                        <div
                          key={column.key}
                          role="gridcell"
                          data-cell={`${position}:${column.key}`}
                          tabIndex={-1}
                          aria-selected={here}
                          aria-readonly={!open}
                          className={`mp-cell ${fixed.className} ${here ? "mp-current" : ""} ${open ? "" : column.editable ? "mp-readonly mp-row-closed" : "mp-readonly"} ${open && column.options ? "mp-combo-cell" : ""}`}
                          style={{ width: widthOf(column), textAlign: alignOf(column), ...fixed.style }}
                          onMouseDown={(event) => {
                            if (editing && here) return;
                            event.preventDefault();
                            // Shift+click extends a row selection; dragging down or up with the button held does too.
                            if (event.shiftKey && !editing) { gridFocus.current?.focus({ preventScroll: true }); setSelectionEnd(position === cursor.row ? null : position); return; }
                            // A right-click inside the selection keeps it, for Copy / Paste / Delete on the menu.
                            if (event.button !== 0 && inSelection(position)) return;
                            if (event.button === 0) dragSelect.current = true;
                            const go = () => { gridFocus.current?.focus({ preventScroll: true }); if (position !== cursor.row) { setTyped(""); findMode.current = true; } setSelectionEnd(null); moveTo(position, col); };
                            // A click on a tick box ticks it, as C1FlexGrid's check box column does.
                            const tick = () => { if (column.boolean && event.button === 0 && open) toggleTick(index, column); };
                            if (editing) void commit().then((ok) => { if (ok) { go(); tick(); } }); else { go(); tick(); }
                          }}
                          onDoubleClick={() => startEdit()}
                          onMouseEnter={(event) => { if (dragSelect.current && event.buttons === 1 && !editing && position !== (selectionEnd ?? cursor.row)) setSelectionEnd(position === cursor.row ? null : position); }}
                        >
                          {here && editing && column.options ? (
                            <GridCombo
                              options={column.options}
                              current={editText}
                              startWith={comboStart}
                              place={comboAt}
                              onPick={(text, step) => void finishCombo(text, step)}
                              onCancel={() => { setEditing(false); setComboStart(""); gridFocus.current?.focus({ preventScroll: true }); }}
                            />
                          ) : here && editing ? (
                            <span className="mp-editor-wrap">
                              <input
                                ref={(element) => element?.focus({ preventScroll: true })}
                                className="mp-editor"
                                style={{ textAlign: column.align === "R" ? "right" : "left" }}
                                inputMode={["N", "C", "I"].includes(column.fieldType) ? "decimal" : undefined}
                                value={editText}
                                onChange={(event) => { if (mayType(column, editText, event.target.value)) setEditText(event.target.value); }}
                                onKeyDown={(event) => void editorKeys(event)}
                              />
                              {tools.buttons(editorKindOf(column.fieldType), editText, setEditText, numberRules(column.setup))}
                            </span>
                          ) : (
                            <>
                              {column.boolean ? <span className={`se-tick${(record[column.key] ?? "").trim().toLowerCase() === "true" ? " se-ticked" : ""}`} role="checkbox" aria-checked={(record[column.key] ?? "").trim().toLowerCase() === "true"} aria-label={column.caption} /> : <FoundText text={shownValue(column, record[column.key] ?? "")} typed={here ? typed : ""} />}
                              {open && column.options ? (
                                <span className="mp-combo-arrow" role="presentation" title="Show the list (Alt+↓ or F4)"
                                  onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); if (editing) return; setSelectionEnd(null); setCursor({ row: position, col }); Promise.resolve().then(() => openCombo()); }}>
                                  <svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
                                </span>
                              ) : null}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {menu && cursorColumn && (
            <GridMenu at={menu} onClose={() => { setMenu(null); keepGridFocus(gridFocus); }} items={[
              { label: "Copy (Ctrl+C)", onClick: () => void copyCell() },
              { label: "Paste (Ctrl+V)", disabled: !copied, onClick: () => void pasteCell() },
              ...columnMenuItems(layout, cursorColumn.key, () => setColumnChooser(true)),
              { label: "Restore Cell Value (Ctrl+Z)", onClick: () => restoreCell(cursor.row, cursorColumn) },
              { label: "Delete Row", disabled: !def?.canDelete, title: def?.canDelete ? undefined : "This entry does not delete rows", onClick: () => void deleteSelected("row") },
              { label: "Delete Selection (Del)", disabled: !def?.canDelete, title: def?.canDelete ? undefined : "This entry does not delete rows", onClick: () => void deleteSelected("selection") },
            ]} />
          )}
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
          search={{ id: "se-find", value: find, onChange: (value) => { setFind(value); setCursor({ row: 0, col: cursor.col }); scroller.current?.scrollTo({ top: 0 }); }, onEnter: findNext }}
          clearFilters={filtering ? () => { clearFilters(); setFind(""); setSort(null); } : null}
          count={`${shownRows.length === liveRows.length ? `${liveRows.length} records` : `${shownRows.length} of ${liveRows.length}`}${edited.size - deleted.size > 0 ? ` · ${edited.size - deleted.size} changed` : ""}${deleted.size ? ` · ${deleted.size} to delete` : ""}`}
        />
      )}

      <div className="mp-status" role="status">
        <span>{def?.statusHead}</span>
        {current && cursorColumn && <span>Row {cursor.row + 1} · {cursorColumn.caption}</span>}
        <span className="mp-message">{typed ? `Find in ${cursorColumn?.caption ?? ""}: ${typed}  (Enter to edit · Backspace · Esc)` : message || (current && cursorColumn ? tooltipText(cursorColumn.setup.field_tooltips || cursorColumn.tooltip) : "")}</span>
        {totals && <span className="mp-sel-totals" title={`Selected rows of ${cursorColumn?.caption ?? ""}`}>{totals}</span>}
        {editing && cursorColumn && <span>{tools.hint(editorKindOf(cursorColumn.fieldType))}</span>}
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
