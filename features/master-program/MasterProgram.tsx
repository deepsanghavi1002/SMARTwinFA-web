"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import type { StartupSelection } from "../startup/StartupGate";
import { applyPermission, formatDesktopDate, getPermission, parseDesktopDate, runFormula, toDecimal, toInt, toText } from "../../lib/master-program/legacy";
import type { AddRow, CloudPush, ComboOption, GroupLoad, GroupState, ProgramDefinition, UpdateColumn, UpdateRecord } from "../../lib/master-program/types";
import { masterCall } from "./api";
import type { ExportCell, ExportColumn, ExportTable } from "../../lib/export/table";
import { carryString, dateOutsideYear, dropPadding, duplicateAgainstUpdate, duplicateInGrid, fitCase, pairedClosed, pairedMessage, gstStateMismatch, isNumberField as isNumberSetup, keyPress, sameGroup, styleCase, typingAllowed, validate } from "./rules";
import { HelpList } from "./HelpList";
import { cleanMainValue, duplicateKey, isMainField } from "../../lib/master-program/main-field";
import { GridCombo } from "../grid/GridCombo";
import { GridMultiPick } from "./GridMultiPick";
import { keyListNames, keyListText, parseKeyList, validKeyList } from "../../lib/master-program/multi-pick";
import { ArrangeColumns } from "../grid/ArrangeColumns";
import { isMessageBoxOpen, messageBox } from "../ui/MessageBox";
import type { MessageButton } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { SearchCombo } from "../ui/SearchCombo";
import { Icon } from "../ui/Icon";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { editorKindOf, useEditorTools } from "../grid/EditorTools";
import { filterHolds, kindOfFieldType } from "../grid/filter";
import type { ColumnFilter, FilterKind } from "../grid/filter";
import { selectionTotals as totalsOf } from "../grid/totals";
import { useDraggable } from "../grid/useDraggable";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useGridOutput } from "../grid/useGridOutput";
import { GridButtons } from "../grid/GridButtons";
import { refreshQuestion } from "../grid/prompts";

/**
 * Master_ProgramGrid, the one screen every MASTER menu opens.
 *
 * The menu names a program_top program (MASTER_ACCOUNT, MASTER_PRODUCT, ...) and
 * everything else - the group combo, the Add grid's rows, the Update grid's columns, what
 * each cell accepts, what a save writes - comes from that program's setup, exactly as the
 * desktop form reads it. The grid events keep the desktop's names in comments so a
 * behaviour can be traced back to the C#.
 */

type Grids = Extract<GroupLoad, { kind: "grids" }>;
type Meta = { yearStart: string; yearEnd: string; coStateName: string; coGstReq: boolean; partyAccode: boolean; productCode: boolean; logFileSpecial: boolean; companyName: string; userName: string };
type LogTable = { columns: string[]; rows: string[][]; message: string };
type AddState = AddRow & { recFound: boolean; compulsory: boolean };
type Cell = { row: number; key: string };
type DialogButton = MessageButton;
type HelpState = Awaited<ReturnType<typeof fetchHelp>>;

const ROW_HEIGHT = 21;
/** Entries a help list shows at once, at the bottom of the grid, so it covers about half the screen. */
const HELP_ROWS = 9;
/** The row indicator column (C1FlexGrid's fixed column): a marker, not a second row number. */
const INDICATOR_WIDTH = 16;
const DELETE_BLOCKED_PROGRAMS = [4, 11, 16, 19, 24, 25, 34, 35, 27, 47];
const SECOND_RESET_PROGRAMS = [21, 22, 23, 26, 28, 29, 32, 36, 42, 49, 50, 51];
/** Master_ProgramGrid_KeyUp: the Pause key closes SMARTwinFA for these licences. */
const PAUSE_EXIT_LICENCES = [5, 9, 17, 49, 50, 52, 53, 60, 64, 65, 66, 67, 72, 76, 77, 79, 89, 90];
/** Program 39's percentage boxes (tbx_salesho ... tbx_temproute) and the column each fills. */
const SCHEME_BOXES = [
  { name: "salesho", label: "Sales HO %", column: "SCH_SALEHO" },
  { name: "salesman", label: "Salesman %", column: "SCH_SALEMAN" },
  { name: "salesrm", label: "Sales RM %", column: "SCH_SALERM" },
  { name: "orderperson", label: "Order Person %", column: "SCH_ORDER" },
  { name: "desperson", label: "Despatch Person %", column: "SCH_DESPATCH" },
  { name: "temproute", label: "Route %", column: "SCH_ROUTE" },
] as const;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

/** Prints a page through a hidden frame, the browser's stand-in for the C1 print preview. */
function printHtml(heading: string, body: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><html><head><title>${escapeHtml(heading)}</title><style>
    body{font-family:Calibri,Segoe UI,sans-serif;font-size:11px;margin:16px;color:#000}
    h1{font-size:14px;text-decoration:underline;color:#1f3fa8;margin:0 0 8px}
    p{margin:0 0 12px;font-weight:bold}
    table{border-collapse:collapse;width:100%}
    th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}
    th{background:#eee}
    td.r{text-align:right}
  </style></head><body>${body}</body></html>`);
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 1000);
}

const lower = (name: string) => name.split(".").pop()!.trim().toLowerCase();
const keyOf = (record: UpdateRecord, name: string) => Object.keys(record).find((candidate) => candidate.toLowerCase() === lower(name));
const cellOf = (record: UpdateRecord | undefined, name: string) => {
  if (!record) return "";
  const key = keyOf(record, name);
  return key ? record[key] : "";
};

/** A number field (not a list) opens its editor blank rather than showing a zero: 0, 0.00, 0.000 ... */
function zeroAsBlank(setup: Parameters<typeof isNumberSetup>[0], hasList: boolean, value: string): string {
  const text = value.trim();
  return isNumberSetup(setup) && !hasList && /[0-9]/.test(text) && /^-?[0-9,]*\.?[0-9]*$/.test(text) && Number(text.replace(/,/g, "")) === 0 ? "" : value;
}

async function fetchHelp(selection: StartupSelection, programName: string, group: GroupState) {
  const body = await masterCall<{ help: { columns: { key: string; caption: string; width: number; align: string; format: string }[]; rows: Record<string, string>[]; frozen: number; total: string } | null }>(selection, programName, "help", {}, group);
  return body.help;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

/** A master column's filter kind: its field type, or a number format (features/grid/filter). */
function filterKind(column: UpdateColumn): FilterKind {
  return kindOfFieldType(column.setup.field_type, column.format === "N2" || column.format.startsWith("#"));
}

/** Whether a record passes a column's filter: the stored value for numbers and dates, the shown text otherwise. */
function columnFilterHolds(column: UpdateColumn, filter: ColumnFilter, record: UpdateRecord | undefined): boolean {
  return filterHolds(filterKind(column), filter, cellOf(record, column.key), shownText(record, column));
}




/**
 * DECIMAL_POINTS: a number typed with more places than the field allows is rounded to them
 * (half away from zero, as the desktop's number styles show it) and written with exactly
 * that many places. Fields of type N and C only; anything that is not a number is left as is.
 */
export function roundToPlaces(text: string, setup: Pick<UpdateColumn["setup"], "field_type" | "decimal_points">): string {
  if (setup.field_type !== "N" && setup.field_type !== "C") return text;
  const raw = text.replace(/,/g, "").trim();
  if (raw === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw)) return text;
  const places = Math.max(0, Math.min(6, setup.decimal_points || 0));
  if (setup.field_type === "C" && places === 0) return text;
  const factor = 10 ** places;
  const value = Number(raw);
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
  return rounded.toFixed(places);
}

/** FIELD_TOOLTIPS as shown in the status row: the text without its leading "SELECT", options split by " / ". */
export function tooltipText(tooltip: string | null | undefined): string {
  const text = (tooltip ?? "").trim().replace(/^SELECT\s+/i, "");
  return text.split("|").map((part) => part.trim()).filter(Boolean).join(" / ");
}

const alignOf = (align: string | null | undefined): "left" | "right" | "center" => {
  const code = (align ?? "").trim().toUpperCase();
  return code === "R" ? "right" : code === "C" || code === "M" ? "center" : "left";
};

/** The value a filter, search or sort reads: the stored one, as the grid shows it (a multi-pick cell's names, not its keys). */
const shownText = (record: UpdateRecord | undefined, column: UpdateColumn) => cellShown(cellOf(record, column.key), column);

/** How a stored value shows in an Update-grid cell: formatted, or a multi-pick's keys as names. */
const cellShown = (value: string, column: Pick<UpdateColumn, "comboKind" | "options" | "format">) =>
  column.comboKind === "M" ? keyListNames(value, column.options) : formatCell(value, column.format).trim();

/** How a stored value shows in a cell, per Setting_GridCol's Format. */
function formatCell(value: string, format: string): string {
  if (value === "") return "";
  if (format === "N2") return toDecimal(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (format.startsWith("#,##0.")) {
    const places = format.length - 6;
    return toDecimal(value).toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places });
  }
  if (format === "#,###") return toDecimal(value) === 0 ? "" : Math.trunc(toDecimal(value)).toLocaleString("en-IN");
  if (format === "dd/MM/yyyy" || format === "dd/MMM/yyyy HH:mm:ss") {
    const date = parseDesktopDate(value);
    if (!date) return value;
    const day = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    return format === "dd/MM/yyyy" ? day : `${formatDesktopDate(date)} ${date.toTimeString().slice(0, 8)}`;
  }
  return value;
}

/**
 * zoomAccode / zoomBook are PublicVariable.Zoom_Accode and Zoom_Book: an entry or report
 * opening the account master at one account. The form then selects the book, shows the
 * account's row, and closes after the account is saved.
 */
export function MasterProgram({ programName, menuShortName, title, onClose, zoomAccode = 0, zoomBook = 0 }: { programName: string; menuShortName: string; title: string; onClose: () => void; zoomAccode?: number; zoomBook?: number }) {
  const selection = useStartupSelection();
  const [def, setDef] = useState<ProgramDefinition | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [fatal, setFatal] = useState("");
  const [first, setFirst] = useState<ComboOption | null>(null);
  const [secondOptions, setSecondOptions] = useState<readonly ComboOption[] | null>(null);
  const [second, setSecond] = useState<ComboOption | null>(null);
  const [grids, setGrids] = useState<Grids | null>(null);
  const [tab, setTab] = useState<"add" | "update" | "image">("update");
  const [busy, setBusy] = useState("Loading");
  const [rowStatus, setRowStatus] = useState("");
  const [message, setMessage] = useState("");
  const [hotKeys, setHotKeys] = useState("");
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  // Add grid (c1dg_MasterGrid)
  const [addRows, setAddRows] = useState<AddState[]>([]);
  const [addCursor, setAddCursor] = useState(0);
  const [addEditing, setAddEditing] = useState(false);
  const [addText, setAddText] = useState("");
  /** Something was typed into the New (Add) grid since it was last blanked. */
  const [addChanged, setAddChanged] = useState(false);
  const [restore, setRestore] = useState<{ row: number } | null>(null);

  // Update grid (c1dg_UpdateGrid + c1_Update_Backup)
  const [records, setRecords] = useState<UpdateRecord[]>([]);
  const [backup, setBackup] = useState<UpdateRecord[]>([]);
  /** Both grids exactly as loaded, so a row changed and changed back is no longer marked edited. */
  const [original, setOriginal] = useState<{ records: readonly UpdateRecord[]; backup: readonly UpdateRecord[] }>({ records: [], backup: [] });
  const [edited, setEdited] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [cellEditable, setCellEditable] = useState<Record<string, boolean>>({});
  /** The Update grid's columns as the operator lays them out: order, hidden ones, widths (features/grid/useColumnLayout). */
  const setupColumns = useMemo(() => (grids?.columns ?? []).filter((column) => column.visible), [grids]);
  const layout = useColumnLayout(setupColumns, grids?.frozen ?? 0);
  const { fixedKeys, columns, hiddenColumns, setHiddenColumns, columnOrder, setColumnOrder, hideColumn, placeColumn, moveColumn, shiftColumn, widthOf } = layout;
  const [dropMark, setDropMark] = useState<{ key: string; after: boolean } | null>(null);
  const dragColumn = useRef<string | null>(null);
  const [cursor, setCursor] = useState<Cell>({ row: 0, key: "" });
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  /** Where an open combo cell's list sits on screen (it opens as a list under the cell, or above it near the bottom). */
  const [comboAt, setComboAt] = useState<{ left: number; top: number; width: number; rows: number } | null>(null);
  /** A letter typed on a combo cell: its list opens searching for it. */
  const [comboStart, setComboStart] = useState("");
  /** The New (Add) grid's combo list: where it opens, and the letter that opened it. */
  const [addComboAt, setAddComboAt] = useState<{ left: number; top: number; width: number; rows: number } | null>(null);
  const [addComboStart, setAddComboStart] = useState("");
  /**
   * A move asked for right after a commit. It is worked out in the next render, from values that
   * already hold what was just committed: worked out at once, a field that the new value opens
   * (INTREST % after INTREST REQUIRED = Yes) still looked closed and was jumped over.
   */
  const addPendingMove = useRef<{ from: number; step: 1 | -1; skipClosed: boolean; edit: boolean } | null>(null);
  /** The New (Add) grid row whose editor opens as soon as the cursor has arrived there. */
  const addEditOnArrive = useRef<number | null>(null);
  /** The Update grid's "go on to the next editable field" after a commit, worked out the same way. */
  const updatePendingMove = useRef<{ row: number; key: string; step: 1 | -1 } | null>(null);
  /**
   * A move to a cell or row asked for while a field is being edited (a mouse click on another
   * field, for one). The field being edited is checked first; when it is refused its message shows
   * and the cursor stays. When it passes, the move waits for the next render, so the new field's
   * defaults and rules read the value just committed.
   */
  const updateGo = useRef<{ row: number; key: string; edit: boolean } | null>(null);
  const addGo = useRef<number | null>(null);
  /** The grid last given its starting cursor; cleared by a fresh load so the grid starts again. */
  const arrivedTab = useRef<string | null>(null);
  /** A load for a newly chosen group: the Update grid starts at the top rather than on the last row. */
  const freshLoad = useRef(false);
  /** The Update grid row to come back to after a save reloads the group. */
  const keepRow = useRef<number | null>(null);
  /** A render to run the pending moves in, for when nothing else changes. */
  const [, nudgeRender] = useReducer((count: number) => count + 1, 0);
  const setAddPendingMove = (move: NonNullable<typeof addPendingMove.current>) => { addPendingMove.current = move; nudgeRender(); };
  const setUpdatePendingMove = (move: NonNullable<typeof updatePendingMove.current>) => { updatePendingMove.current = move; nudgeRender(); };
  const [dataAtBegin, setDataAtBegin] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  /** New grid: each field's value before its first change in this entry, for Ctrl+Z (Restore Old Value). */
  const addOld = useRef(new Map<number, { fieldInput: string; fieldComboValue: string }>());
  const [copied, setCopied] = useState<{ value: string; addonId: string } | null>(null);
  const [find, setFind] = useState("");
  // Sorting, per-column filters and column widths the operator sets on the Update grid
  const [sort, setSort] = useState<SortState>(null);
  const columnFilters = useColumnFilters();
  const { filters, setFilters, openFilter, setOpenFilter } = columnFilters;
  const [columnChooser, setColumnChooser] = useState(false);
  /** A row reached by clicking or arrowing (not by finishing an edit): typing there searches first. */
  const findMode = useRef(true);
  /** The left button went down on a cell and is still held: moving over other rows selects them. */
  const dragSelect = useRef(false);
  useEffect(() => {
    const release = () => { dragSelect.current = false; };
    document.addEventListener("mouseup", release);
    return () => document.removeEventListener("mouseup", release);
  }, []);
  const helpDrag = useDraggable();
  /** The date and number editors' calendar, calculator and short date typing (features/grid). */
  const tools = useEditorTools(meta ? parseDesktopDate(meta.yearStart) ?? new Date(meta.yearStart) : null);
  const [typed, setTyped] = useState("");
  const [help, setHelp] = useState<HelpState>(null);
  const [helpRow, setHelpRow] = useState<number | null>(null);
  /** An entry picked in the New Add grid's help list with the keys or mouse, over the one found from the typing. */
  const [addHelpPick, setAddHelpPick] = useState<{ row: number; key: string } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  // Module password (Z_Frm_Password), image tab, edit-log viewer, program 39/50 boxes
  const [locked, setLocked] = useState(true);
  const [image, setImage] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [logTable, setLogTable] = useState<LogTable | null>(null);
  const [schemeBoxes, setSchemeBoxes] = useState<Record<string, string>>({});
  const zoomStarted = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const gridFocus = useRef<HTMLDivElement>(null);
  const addFocus = useRef<HTMLDivElement>(null);
  const addTable = useRef<HTMLTableElement>(null);
  /** New grid: rows from the top down to the main field (e.g. Account's name) stay in view while the rest scroll. */
  const addFrozenUpTo = addRows.findIndex((row) => row.visible && isMainField(row.setup));
  // Each frozen row sticks just below the ones above it; row heights are measured, not assumed.
  useLayoutEffect(() => {
    const table = addTable.current;
    if (!table) return;
    let top = table.tHead?.offsetHeight ?? 0;
    for (const tr of table.querySelectorAll<HTMLTableRowElement>("tbody tr.mp-add-frozen")) {
      for (const td of tr.cells) td.style.top = `${top}px`;
      top += tr.offsetHeight;
    }
    table.style.setProperty("--mp-add-frozen-h", `${top}px`);
    // Rows may have come, gone or changed height: count again (after this render, as the lint rule asks).
    void Promise.resolve().then(measureAddMore);
  });
  /**
   * New grid: how many rows are out of sight above (behind the heading and the frozen rows) and
   * below, shown as "▲ n rows up" / "▼ n rows down". Counted from the rendered rows' positions on
   * each scroll; the grid has a few dozen rows, so this costs nothing noticeable.
   */
  const [addMore, setAddMore] = useState({ up: 0, down: 0 });
  const measureAddMore = useCallback(() => {
    const table = addTable.current;
    if (!table) return;
    const box = table.getBoundingClientRect();
    const stuck = Number.parseFloat(table.style.getPropertyValue("--mp-add-frozen-h")) || (table.tHead?.offsetHeight ?? 0);
    const bottom = box.top + table.clientHeight;
    let up = 0;
    let down = 0;
    for (const tr of table.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.mp-add-frozen)")) {
      const row = tr.getBoundingClientRect();
      if (row.bottom <= box.top + stuck + 1) up += 1;
      else if (row.top >= bottom - 1) down += 1;
    }
    setAddMore((current) => (current.up === up && current.down === down ? current : { up, down }));
  }, []);
  useEffect(() => {
    window.addEventListener("resize", measureAddMore);
    return () => window.removeEventListener("resize", measureAddMore);
  }, [measureAddMore]);
  const scrollAdd = (direction: 1 | -1) => {
    const table = addTable.current;
    if (table) table.scrollBy({ top: direction * Math.max(60, table.clientHeight * 0.8), behavior: "smooth" });
  };
  const screenRef = useRef<HTMLDivElement>(null);
  useAltHotkeys(screenRef);

  const group: GroupState | null = useMemo(() => (first ? { firstCombo: first, secondCombo: second } : null), [first, second]);
  /** Focuses an editor when it mounts, which is what C1FlexGrid does when editing starts. */
  const focusOnMount = useCallback((element: HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null) => { element?.focus(); }, []);
  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) return Promise.reject(new Error("No company is open"));
    return masterCall<T>(selection, programName, action, { menuShortName, ...payload }, group ?? undefined);
  }, [selection, programName, menuShortName, group]);

  /** CustomMessageBoxForm: the program's shared message box (features/ui/MessageBox). */
  const ask = useCallback((text: string, heading: string, buttons: DialogButton[] = ["OK"], defaultButton?: DialogButton) => messageBox.ask(text, heading, buttons, { defaultButton }).then((answer) => { keepGridFocus(); return answer; }), []);
  const askPassword = useCallback((heading: string) => messageBox.prompt("Enter Password", heading, { password: true }), []);

  // ---- Master_ProgramGrid_Load
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    masterCall<{ program: ProgramDefinition; warnings: string[] } & Meta>(selection, programName, "program", { menuShortName })
      .then((body) => {
        if (cancelled) return;
        setDef(body.program);
        setMeta({ yearStart: body.yearStart, yearEnd: body.yearEnd, coStateName: body.coStateName, coGstReq: body.coGstReq, partyAccode: body.partyAccode, productCode: body.productCode, logFileSpecial: body.logFileSpecial, companyName: body.companyName, userName: body.userName });
        setWarnings(body.warnings);
        // A bound combo shows its first row once its DataSource is set, as a combo_list one does.
        if (body.program.firstCombo?.options.length) setFirst(body.program.firstCombo.options[0]);
        if (!body.program.needsModulePassword) { setLocked(false); return; }
        // Main_Menu_New asks the module password before the form opens.
        void (async () => {
          for (;;) {
            const typed = await askPassword("Password");
            if (cancelled) return;
            if (typed === null) { onClose(); return; }
            const check = await masterCall<{ ok: boolean; message: string }>(selection, programName, "module-password", { menuShortName, password: typed }).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
            if (cancelled) return;
            if (check.ok) { setLocked(false); return; }
            await ask(check.message, "Password");
          }
        })();
      })
      .catch((error: unknown) => { if (!cancelled) setFatal(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [selection, programName, menuShortName, ask, askPassword, onClose]);

  const yearStartText = meta ? formatDesktopDate(new Date(meta.yearStart)) : "";
  const yearEndText = meta ? formatDesktopDate(new Date(meta.yearEnd)) : "";

  // ---- Cmb_Master_GroupFld_Leave
  const loadGroup = useCallback(async (firstChoice: ComboOption, secondChoice: ComboOption | null) => {
    if (!selection || !def) return;
    setBusy("Loading master");
    setMessage("");
    try {
      const body = await masterCall<{ load: GroupLoad; warnings: string[] }>(selection, programName, "group", { menuShortName }, { firstCombo: firstChoice, secondCombo: secondChoice });
      setWarnings(body.warnings);
      if (body.load.kind === "second-combo") {
        setSecondOptions(body.load.options);
        setSecond(null);
        setGrids(null);
        return;
      }
      const load = body.load;
      setGrids(load);
      addOld.current.clear();
      arrivedTab.current = null;
      freshLoad.current = true;
      setAddRows(load.addRows.map((row) => ({ ...row, recFound: false, compulsory: row.setup.value_compulsory })));
      setAddChanged(false);
      setRecords(load.records.map((record) => ({ ...record })));
      setBackup(load.backup.map((record) => ({ ...record })));
      setOriginal({ records: load.records, backup: load.backup });
      // The grid draws only the rows near its scroll position; a position left over from an
      // earlier group (the grid was cancelled, or a group with no records showed the Add grid)
      // would draw rows far below the top of the fresh grid and leave it looking empty.
      setScrollTop(0);
      if (scroller.current) scroller.current.scrollTop = 0;
      setHelpRow(null);
      setEdited(new Set());
      setDeleted(new Set());
      setCellEditable({});
      setHiddenColumns([]);
      setSort(null);
      setFilters({});
      findMode.current = true;
      setTyped("");
      setOpenFilter(null);
      setFind("");
      setRestore(null);
      const firstVisible = load.columns.find((column) => column.visible && column.editable) ?? load.columns.find((column) => column.visible);
      const zoomRow = zoomAccode > 0 ? load.records.findIndex((record) => keyOf(record, "code") !== undefined && toInt(cellOf(record, "code")) === zoomAccode) : -1;
      setCursor({ row: Math.max(0, zoomRow), key: firstVisible?.key ?? "" });
      setAddCursor(Math.max(0, load.addRows.findIndex((row) => row.visible)));
      setMessage(load.message);
      setHotKeys(load.hotKeys);
      setRowStatus(load.records.length ? `1/${load.records.length}` : "");
      const showUpdate = (load.updateTabVisible && load.records.length > 0) || zoomRow >= 0;
      setTab(showUpdate ? "update" : "add");
      setHelp(await fetchHelp(selection, programName, { firstCombo: firstChoice, secondCombo: secondChoice }).catch(() => null));
    } catch (error) {
      await ask(error instanceof Error ? error.message : String(error), "Error Message");
    } finally {
      setBusy("");
    }
  }, [selection, def, programName, menuShortName, ask, zoomAccode, setFilters, setOpenFilter, setHiddenColumns]);

  const chooseFirst = (option: ComboOption) => {
    setFirst(option);
    setSecondOptions(null);
    setSecond(null);
    setGrids(null);
    void loadGroup(option, null);
  };

  // ---- Master_ProgramGrid_Activated: a zoom selects its account book and loads it
  const chooseFirstRef = useRef(chooseFirst);
  useEffect(() => { chooseFirstRef.current = chooseFirst; });
  useEffect(() => {
    if (!def || locked || !selection || zoomBook <= 0 || zoomAccode <= 0 || zoomStarted.current) return;
    zoomStarted.current = true;
    masterCall<{ option: ComboOption | null }>(selection, programName, "zoom-book", { menuShortName, book: zoomBook })
      .then((body) => {
        // cmb_Master_GroupFld.SelectedValue = code picks the combo's own row for that book.
        const option = body.option && (def.firstCombo?.options.find((candidate) => candidate.value === body.option!.value) ?? body.option);
        if (option) chooseFirstRef.current(option);
      })
      .catch(() => undefined);
  }, [def, locked, selection, programName, menuShortName, zoomBook, zoomAccode]);

  // ---- Btn_Master_EditCancel_Click: drop the Update grid's unsaved changes
  const cancelUpdate = async () => {
    if ((await ask("Are You Sure Want To Cancel ? ", "Master Edit Cancel", ["Yes", "No"])) !== "Yes") return;
    setSchemeBoxes({});
    if (first) await loadGroup(first, second);
  };

  // ---- Refresh: reload the group from the database, after asking, so a stray key cannot drop edits
  const refreshUpdate = async () => {
    if (!first) return;
    if ((await ask(refreshQuestion(edited.size + deleted.size), "Refresh", ["Yes", "No"], "No")) !== "Yes") return;
    await loadGroup(first, second);
  };

  // ---- BtnCancelAddUpdate_Click
  const cancelAll = async () => {
    // Asked only when something would be lost, and "No" is the default, so Enter keeps the work.
    const addPending = addChanged || restore !== null || (addEditing && addText !== (addRows[addCursor]?.fieldInput ?? ""));
    const updatePending = edited.size + deleted.size > 0 || (editing && editText !== cellOf(records[cursor.row], cursor.key));
    if (addPending || updatePending) {
      const where = [addPending ? "New (Add)" : "", updatePending ? "Update" : ""].filter(Boolean).join(" and ");
      if ((await ask(`There are unsaved changes in the ${where} grid.
Discard the changes?`, "Discard Changes", ["Yes", "No"], "No")) !== "Yes") return;
    }
    setEditing(false);
    setAddEditing(false);
    setAddChanged(false);
    setGrids(null);
    setRecords([]);
    setBackup([]);
    setOriginal({ records: [], backup: [] });
    setScrollTop(0);
    setHelpRow(null);
    setAddRows([]);
    setRestore(null);
    setSecond(null);
    if (!SECOND_RESET_PROGRAMS.includes(def?.programId ?? 0)) setSecondOptions(null);
    setCopied(null);
    setRowStatus("");
    setMessage("");
    setHotKeys("");
    setSchemeBoxes({});
    setImage(null);
  };

  // ======================================================================================
  // Update grid

  const columnByKey = useMemo(() => new Map((grids?.columns ?? []).map((column) => [column.key, column])), [grids]);
  const columnByField = useCallback((name: string) => (grids?.columns ?? []).find((column) => column.key.toLowerCase() === lower(name)), [grids]);
  const liveRows = useMemo(() => records.map((_, index) => index).filter((index) => !deleted.has(index)), [records, deleted]);
  /**
   * The rows the Update grid shows, in the order it shows them. Search, filters and sort
   * read the stored value (the backup), so a row does not jump or vanish while it is edited.
   */
  const shownRows = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const stored = (row: number) => backup[row] ?? records[row];
    let rows = liveRows.filter((row) => {
      for (const [key, filter] of Object.entries(filters)) {
        const column = columnByKey.get(key);
        if (column && !columnFilterHolds(column, filter, stored(row))) return false;
      }
      return needle === "" || columns.some((column) => shownText(stored(row), column).toLowerCase().includes(needle));
    });
    const column = sort ? columnByKey.get(sort.key) : undefined;
    if (sort && column) {
      const kind = column.setup.field_type;
      const compare = (a: number, b: number) => {
        const left = cellOf(stored(a), column.key);
        const right = cellOf(stored(b), column.key);
        if (kind === "D") return (parseDesktopDate(left)?.getTime() ?? 0) - (parseDesktopDate(right)?.getTime() ?? 0);
        if (kind === "N" || kind === "C" || kind === "I") return toDecimal(left) - toDecimal(right);
        return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
      };
      rows = [...rows].sort((a, b) => (sort.dir === "asc" ? compare(a, b) : compare(b, a)));
    }
    return rows;
  }, [liveRows, records, backup, filters, find, sort, columns, columnByKey]);

  /** Distinct stored values of a column, for its filter list. */
  const valuesOf = (column: UpdateColumn) => {
    const seen = new Set<string>();
    const needle = find.trim().toLowerCase();
    const others = Object.entries(filters).filter(([key]) => key !== column.key);
    for (const row of liveRows) {
      const stored = backup[row] ?? records[row];
      const kept = others.every(([key, filter]) => { const other = columnByKey.get(key); return !other || columnFilterHolds(other, filter, stored); });
      if (!kept || (needle !== "" && !columns.some((shown) => shownText(stored, shown).toLowerCase().includes(needle)))) continue;
      seen.add(shownText(stored, column));
    }
    return [...seen].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  };
  /** Opens a column's filter list (features/grid/ColumnFilter) with its distinct values. */
  const openFilterFor = (column: UpdateColumn) => columnFilters.open(column.key, valuesOf(column));
  const programId = def?.programId ?? 0;
  const licence = def?.licence ?? 0;

  /**
   * C1dg_MasterGrid_NewRowColDisplay: on the New Add grid, a field with a help list shows it
   * when the cursor reaches it (on the row holding the current value) and on every key typed
   * (on the first entry that starts with the text so far), so an existing master is seen
   * before a duplicate is typed. Where DUPLICHK_FLDNAME2 is set the entry must also belong to
   * the group chosen in the first combo.
   */
  /**
   * The group a main field's help list and duplicate check keep to (duplichk_fldname2): the value
   * of that field on the Update grid's current record, or in the New grid's row of that name;
   * a New grid without such a row keeps to the first combo, as the desktop did. null: no group.
   */
  const helpGroup = useMemo((): Readonly<{ field: string; values: readonly string[] }> | null => {
    const setup = tab === "add" ? addRows[addCursor]?.setup : grids?.columns.find((column) => column.key === cursor.key)?.setup;
    const field = toText(setup?.duplichk_fldname2);
    if (!setup || field === "") return null;
    if (tab !== "add") return { field, values: [cellOf(records[cursor.row], field)] };
    const row = addRows.find((candidate) => lower(candidate.fieldName) === lower(field));
    if (row) return { field, values: [row.fieldInput] };
    return first ? { field, values: [first.value, first.text] } : null;
  }, [tab, addRows, addCursor, grids, cursor, records, first]);
  /** An Update-grid column's help entries for a record: those of the record's group (duplichk_fldname2), else all. */
  const groupHelpRows = (setup: UpdateColumn["setup"], record: UpdateRecord | undefined) => {
    const field = toText(setup.duplichk_fldname2);
    const rows = help?.rows ?? [];
    return field === "" ? rows : rows.filter((helpRecord) => sameGroup(cellOf(helpRecord, field), cellOf(record, field)));
  };
  /** The help list as shown: only the current group's entries when the main field has one. */
  const shownHelp = useMemo(() => {
    if (!help || !helpGroup) return help;
    const rows = help.rows.filter((helpRecord) => helpGroup.values.some((value) => sameGroup(cellOf(helpRecord, helpGroup.field), value)));
    return { ...help, rows, total: `Total Help Record : ${rows.length}` };
  }, [help, helpGroup]);

  const addHelp = useMemo(() => {
    if (tab !== "add" || !shownHelp || shownHelp.columns.length === 0) return null;
    const row = addRows[addCursor];
    if (!row || !isMainField(row.setup)) return null;
    const f1 = toText(row.setup.duplichk_fldname1).toLowerCase();
    const typedText = (addEditing ? addText : row.fieldInput).trim().toUpperCase();
    if (f1 === "" || typedText === "") return { row: -1, exact: false, typed: typedText };
    const found = shownHelp.rows.findIndex((helpRecord) => (addEditing ? cellOf(helpRecord, f1).toUpperCase().startsWith(typedText) : cellOf(helpRecord, f1).toUpperCase() === typedText));
    // A restore shows the record being restored; with a group the list is filtered, so compare by value.
    const restoring = restore !== null && (helpGroup ? duplicateKey(cellOf(records[restore.row], f1)) === typedText : restore.row === found);
    const exact = found >= 0 && cellOf(shownHelp.rows[found], f1).trim().toUpperCase() === typedText && !restoring;
    return { row: found, exact, typed: typedText };
  }, [tab, shownHelp, helpGroup, addRows, addCursor, addEditing, addText, restore, records]);
  /** A pick in the New Add help list holds only while the row and the typing stay as they were. */
  const addHelpKey = `${addCursor}|${addEditing ? 1 : 0}|${addText}`;

  /** The help field a column searches: DUPLICHK_FLDNAME1, else the help list's first column. */
  const helpSearchKey = (setup: UpdateColumn["setup"]) => toText(setup.duplichk_fldname1).toLowerCase() || (help?.columns[0]?.key ?? "");

  /**
   * Update grid: as a field with a help list is typed, the list follows to the first entry
   * that starts with the text so far (the top of the list while it is blank).
   */
  const followHelp = (key: string, text: string) => {
    if (!help || help.columns.length === 0) return;
    const column = columnByKey.get(key);
    if (!column || !isMainField(column.setup)) return;
    const typedText = text.trim().toUpperCase();
    const field = helpSearchKey(column.setup);
    const found = typedText === "" ? -1 : groupHelpRows(column.setup, records[cursor.row]).findIndex((helpRecord) => cellOf(helpRecord, field).trim().toUpperCase().startsWith(typedText));
    setHelpRow((current) => (found >= 0 || typedText === "" ? found : current ?? -1));
  };

  const imageTab = Boolean(def?.imageReq) && (programId === 8 || programId === 14);

  // ---- C1dg_UpdateGrid_BeforeRowColChange, image part: product_image for the product row
  const imageProduct = programId === 8 && imageTab ? toInt(cellOf(records[cursor.row], "prod_key")) : 0;
  useEffect(() => {
    if (imageProduct <= 0) return;
    let cancelled = false;
    call<{ image: { dataUrl: string; fileName: string } | null }>("product-image", { prodKey: imageProduct })
      .then((body) => { if (!cancelled) setImage(body.image); })
      .catch(() => { if (!cancelled) setImage(null); });
    return () => { cancelled = true; };
  }, [imageProduct, call]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observe = new ResizeObserver(() => setViewport(element.clientHeight));
    observe.observe(element);
    // A grid that has just appeared starts from its own scroll position, not a remembered one.
    setScrollTop(element.scrollTop);
    return () => observe.disconnect();
  }, [grids, tab]);

  /**
   * A column open for editing that its row rules close on this row: STATUS_AGAINST_FLD with
   * ENABLE_FOR / DISABLE_FOR, read from the record the way BeforeRowColChange reads it, so the
   * cell can be shown closed before the cursor reaches it. A record_exist rule is known only
   * once the record has been checked.
   */
  /** Paired fields (value_diff_than): closed while the partner holds a value; this wins over any other rule. */
  const closedByPartner = (row: number, column: UpdateColumn) =>
    column.editable && pairedClosed(toText(column.setup.value_diff_than), cellOf(records[row], column.key), (name) => cellOf(records[row], name));
  const closedByRow = (row: number, column: UpdateColumn): boolean => {
    if (closedByPartner(row, column)) return true;
    const status = toText(column.setup.status_against_fld);
    if (!column.editable || status === "" || toText(first?.value) === "") return false;
    const record = records[row];
    if (!record) return false;
    if (status.toLowerCase() === "record_exist") {
      const exists = cellOf(record, "record_exist");
      if (exists === "") return false;
      if (column.setup.enable_for === "Y") return exists !== "Y";
      if (column.setup.disable_for === "Y") return exists === "Y";
      return false;
    }
    const setting = toText(column.setup.enable_for) !== "" ? column.setup.enable_for.trim() : toText(column.setup.disable_for) !== "" ? column.setup.disable_for.trim() : "";
    return setting !== "" && applyPermission(getPermission(permissionSource(record), "E", status, setting, false, false)).editable === false;
  };
  /** A column whose cells open or close row by row (see closedByRow). */
  const rowRuled = (column: UpdateColumn) => column.editable && (toText(column.setup.value_diff_than) !== "" || (toText(column.setup.status_against_fld) !== "" && (toText(column.setup.enable_for) !== "" || toText(column.setup.disable_for) !== "")));
  const isEditable = (row: number, column: UpdateColumn | undefined) => {
    if (!column) return false;
    if (closedByPartner(row, column)) return false;
    const override = cellEditable[`${row}:${column.key}`];
    return override ?? (column.editable && !closedByRow(row, column));
  };

  const permissionSource = (record: UpdateRecord) => ({
    firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: def?.firstCombo?.bound ?? true },
    fieldValue: (name: string) => (keyOf(record, name) ? cellOf(record, name) : undefined),
  });

  const markEdited = (row: number) => setEdited((current) => (current.has(row) ? current : new Set(current).add(row)));
  /** One value against the loaded one: numbers by amount (blank is 0, 1200 is 1200.00), dates by day. */
  const sameValue = (key: string, a: string | undefined, b: string | undefined) => {
    const left = (a ?? "").trim();
    const right = (b ?? "").trim();
    if (left === right) return true;
    const column = columnByKey.get(key);
    if (!column) return false;
    if (isNumberSetup(column.setup)) return toDecimal(left.replace(/,/g, "") || "0") === toDecimal(right.replace(/,/g, "") || "0");
    if (column.setup.field_type === "D") return parseDesktopDate(left)?.getTime() === parseDesktopDate(right)?.getTime();
    return false;
  };
  const sameRecord = (a: UpdateRecord | undefined, b: UpdateRecord | undefined) => {
    if (!a || !b) return false;
    // record_exist is the grid's own note, filled in when editing starts; it is not data.
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((key) => key.toLowerCase() !== "record_exist"));
    return [...keys].every((key) => sameValue(key, a[key], b[key]));
  };
  /**
   * The c1_Update_Backup check: after an edit, a row whose every value (and every hidden id
   * or password kept aside) is back to what was loaded is no longer marked edited, so Save
   * does not rewrite it, log it or push it to the cloud. Only that one row is compared.
   */
  const settleEdited = (row: number, nextRecord: UpdateRecord, nextBackup: UpdateRecord | undefined) => {
    const unchanged = !deleted.has(row) && sameRecord(nextRecord, original.records[row]) && sameRecord(nextBackup, original.backup[row]);
    setEdited((current) => {
      if (unchanged !== current.has(row)) return current;
      const copy = new Set(current);
      if (unchanged) copy.delete(row); else copy.add(row);
      return copy;
    });
  };
  /** Ctrl+Z / Restore Cell Value: the cell (and any id kept aside for it) as it was loaded. */
  const restoreCell = (row: number, key: string) => {
    const loaded = original.records[row];
    if (!loaded || !records[row]) return;
    const nextRecord = { ...records[row], [key]: cellOf(loaded, key) };
    const nextBackup = backup[row] && original.backup[row] ? { ...backup[row], [key]: cellOf(original.backup[row], key) } : backup[row];
    setRecords((current) => current.map((record, index) => (index === row ? nextRecord : record)));
    if (nextBackup) setBackup((current) => current.map((record, index) => (index === row ? nextBackup : record)));
    settleEdited(row, nextRecord, nextBackup);
  };
  const setCell = (row: number, key: string, value: string) => setRecords((current) => current.map((record, index) => (index === row ? { ...record, [key]: value } : record)));
  const setBackupCell = (row: number, key: string, value: string) => setBackup((current) => current.map((record, index) => (index === row ? { ...record, [key]: value } : record)));

  const eventRow = (row: number, fieldName: string, text: string) => ({
    values: Object.fromEntries(Object.entries(records[row] ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    backup: Object.fromEntries(Object.entries(backup[row] ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    fieldName,
    editorText: text,
  });

  /** C1dg_UpdateGrid_BeforeEdit */
  const beforeEdit = async (row: number, column: UpdateColumn): Promise<boolean> => {
    setDataAtBegin(cellOf(records[row], column.key));
    let record = records[row];
    if (grids?.recordExistChecks && keyOf(record, "record_exist") && cellOf(record, "record_exist") === "") {
      const result = await call<{ recordExist: "Y" | "N" }>("record-exist", { masterGrid: false, row: eventRow(row, column.setup.field_name, "") });
      const key = keyOf(record, "record_exist")!;
      record = { ...record, [key]: result.recordExist };
      setCell(row, key, result.recordExist);
      if (result.recordExist === "N") setCellEditable((current) => ({ ...current, [`${row}:${column.key}`]: true }));
    }
    let cancel = false;
    if (toText(column.setup.status_against_fld) !== "" && toText(first?.value) !== "") {
      const answer = getPermission(permissionSource(record), "E", column.setup.status_against_fld.trim(), column.setup.enable_for.trim(), false, false);
      // Func_GetPermission answers "E" (enabled) or "D" (disabled). The C# line reads
      // e.Cancel = answer.Contains("E"), which refuses exactly the fields that are enabled
      // (Schedule, and State or TDS on an "A" account) and opens the disabled ones; the edit
      // is refused only when the field is disabled for this row.
      cancel = answer.toUpperCase().includes("D");
      if (column.setup.rec_found_forquery) {
        setCellEditable((current) => ({ ...current, [`${row}:${column.key}`]: false }));
        cancel = true;
      }
    }
    if (column.setup.force_inputtype === "P") setCell(row, column.key, cellOf(backup[row], column.key));
    if (programId === 34) setCellEditable((current) => ({ ...current, [`${row}:${column.key}`]: true }));
    return !cancel;
  };

  const startEdit = async (initial?: string, at: Cell = cursor) => {
    findMode.current = false;
    setTyped("");
    const column = columnByKey.get(at.key);
    if (!column || !records[at.row] || !isEditable(at.row, column)) return;
    if (!(await beforeEdit(at.row, column))) return;
    const value = cellOf(records[at.row], column.key);
    setEditText(initial !== undefined ? initial : zeroAsBlank(column.setup, Boolean(column.options?.length), value));
    if (initial !== undefined) followHelp(column.key, initial);
    if (column.options) {
      const box = document.querySelector(`.mp-grid [data-cell="${at.row}:${CSS.escape(at.key)}"]`)?.getBoundingClientRect();
      const rows = Math.min(10, Math.max(2, column.options.length));
      const height = rows * 22 + 62;
      if (box) {
        const below = box.bottom + height < window.innerHeight - 4;
        // Wide enough for the longest choice (tick, padding and scrollbar included), never
        // narrower than the column; it starts at the column's left edge unless the screen
        // runs out on the right, and then it moves left only as far as it has to.
        // A multi-pick list also has a tick box, the key and Clear / OK, so it needs more room.
        const multi = column.comboKind === "M";
        const width = Math.min(window.innerWidth - 8, Math.max(box.width, multi ? 320 : 200, longestText(column.options.map((option) => option.text)) + (multi ? 110 : 64)));
        const left = Math.max(4, Math.min(box.left, window.innerWidth - width - 4));
        setComboAt({ left, top: below ? box.bottom + 2 : Math.max(4, box.top - height - 2), width, rows });
      } else setComboAt(null);
    }
    setEditing(true);
  };

  /** A canvas used only to measure text. */
  const measure = useRef<CanvasRenderingContext2D | null>(null);
  /** The widest of some texts as the grid's font draws them, in pixels. */
  const longestText = (texts: readonly string[]) => {
    measure.current ??= document.createElement("canvas").getContext("2d");
    const context = measure.current;
    if (!context) return Math.max(0, ...texts.map((text) => text.length)) * 7;
    const cell = document.querySelector(".mp-grid .mp-cell");
    context.font = `700 ${cell ? getComputedStyle(cell).fontSize : "11px"} ${cell ? getComputedStyle(cell).fontFamily : "sans-serif"}`;
    return Math.ceil(Math.max(0, ...texts.map((text) => context.measureText(text).width)));
  };

  /** A combo cell: an editable column whose setup gives it a list (combo_value L, Q or X). */
  const isComboCell = (row: number, column: UpdateColumn | undefined) => Boolean(column?.options && column.options.length > 0 && isEditable(row, column));
  /** Opens a combo cell's list at (row, key), moving there first. */
  const openCombo = async (row: number, key: string) => {
    if (editing && cursor.row === row && cursor.key === key) return;
    setComboStart("");
    if (await moveTo(row, key, true)) await startEdit(undefined, { row, key });
  };

  /**
   * A date as typed in a date field: short forms (2309, 23sep, 0109+5, +5) take their year
   * from the accounting year; +n / -n alone count from the date the field already had.
   */
  const typedDate = tools.typedDate;

  /** A value typed with a time (program 52's date and time) stays as typed; any other date is written dd/MMM/yyyy. */
  const dateText = (text: string, date: Date) => (/\d{1,2}:\d{2}/.test(text) ? text : formatDesktopDate(date));

  /** C1dg_UpdateGrid_ValidateEdit then AfterEdit. Returns false when the edit is refused. */
  const commitEdit = async (typedText?: string): Promise<boolean> => {
    /** The text to commit: a combo's choice arrives directly, before the render that would hold it. */
    const entered = typedText ?? editText;
    const column = columnByKey.get(cursor.key);
    const row = cursor.row;
    if (!column || !grids || !meta) { setEditing(false); return true; }
    const record = records[row];
    // Passing through a field without changing it leaves it exactly as it was (no case change, no "changed" mark).
    if (entered === cellOf(record, column.key) || (entered === "" && zeroAsBlank(column.setup, Boolean(column.options?.length), cellOf(record, column.key)) === "")) { setEditing(false); return true; }
    // The main field keeps no trailing blanks or unseen characters, so a duplicate cannot hide behind them.
    let text = column.comboKind === "M" ? keyListText(parseKeyList(entered)) : fitCase(column.setup, isMainField(column.setup) ? cleanMainValue(entered) : dropPadding(column.setup, entered), programId);
    if (column.setup.field_type === "D" && text.trim() !== "") {
      const date = typedDate(text, dataAtBegin);
      if (!date) { await ask(`"${text}" is not a date. Type it as 2309, 23sep, 23/09/2026, or 0109+5 for five days on.`, "Invalid Date"); return false; }
      text = dateText(text, date);
    }
    const outcome = validate({
      // A multi-pick value is a key list (" 1," trims to 2 characters), so no minimum length applies.
      setup: column.comboKind === "M" ? { ...column.setup, field_length_min: 0 } : column.setup, masterGrid: false, programId, licence, coGstReq: meta.coGstReq, label: column.caption,
      fieldValue: (name) => cellOf(record, name),
      previousInput: (() => { const index = grids.columns.indexOf(column); return index > 0 ? cellOf(record, grids.columns[index - 1].key) : ""; })(),
      captionOf: (name) => columnByField(name)?.caption ?? name,
      columnValues: (name) => records.map((candidate) => cellOf(candidate, name)),
      rowIndex: row + 1,
    }, text);
    if (!outcome.ok) { await ask(outcome.message ?? "", outcome.title ?? "Validation"); return false; }
    const partner = toText(column.setup.value_diff_than);
    if (partner !== "" && text.trim() !== "" && cellOf(record, partner).trim() !== "") {
      await ask(pairedMessage(column.caption, columnByField(partner)?.caption ?? partner), "Only One Allowed");
      return false;
    }

    if (column.setup.field_validation.toLowerCase() === "sys.checkstateid" && text.length > 0 && programId === 14) {
      const result = await call<{ message: string }>("check-state", { masterGrid: false, row: eventRow(row, column.setup.field_name, text), originalState: cellOf(backup[row], "state_id") });
      if (result.message !== "") { await ask(result.message, column.setup.head_label); setEditText(cellOf(backup[row], "state_id")); return false; }
    }
    if (column.setup.field_validation.toLowerCase() === "sys.checkgststateid" && text.length > 1 && programId === 14 && meta.coGstReq) {
      const short = (await call<{ short: string }>("state-short", { stateName: cellOf(record, "state_id") })).short;
      const gst = gstStateMismatch(text, short);
      if (gst.mismatch) { await ask("Gstin And State Not Match", column.setup.head_label); setEditText(gst.corrected); return false; }
    }
    if (column.setup.duplicate_chk && column.setup.serverQueries.includes("duplicate_query")) {
      const result = await call<{ message: string }>("duplicate-query", { masterGrid: false, row: eventRow(row, column.setup.field_name, text) });
      if (result.message !== "") { await ask(result.message, "Warning"); return false; }
    }
    if (text !== "" && toText(column.setup.duplichk_fldname1) !== "") {
      const withText = records.map((candidate, index) => (index === row ? { ...candidate, [column.key]: text } : candidate));
      if (duplicateInGrid(withText, row, text, column.setup)) { await ask("Duplicate Master Found...", "Warning"); return false; }
    }

    // ---- C1dg_UpdateGrid_AfterEdit
    let nextBackup = backup[row];
    if (column.options && (column.comboKind === "Q" || column.comboKind === "X")) {
      const option = column.options.find((candidate) => candidate.text === text);
      const id = option && option.value !== "" && text.toLowerCase() !== "(blank)" && toInt(option.value) > 0 ? option.value : text === "(blank)" ? "" : undefined;
      if (id !== undefined) {
        setBackupCell(row, column.key, id);
        if (nextBackup) nextBackup = { ...nextBackup, [column.key]: id };
      }
    }
    text = roundToPlaces(styleCase(column.setup, text, licence), column.setup);
    let next: UpdateRecord = { ...record, [column.key]: text };
    setEditing(false);
    // The server queries read |sys.thiscombolistid| from the backup: it must hold the id just picked,
    // not the one the state still has (blank on a first pick, so the query found nothing).
    const freshBackup = Object.fromEntries(Object.entries(nextBackup ?? {}).map(([key, value]) => [key.toLowerCase(), value]));

    if (column.setup.serverQueries.includes("onchange_repl_value_query") && text !== dataAtBegin) {
      const values = await call<{ values: Record<string, string> }>("onchange", { masterGrid: false, row: { ...eventRow(row, column.setup.field_name, text), backup: freshBackup, values: Object.fromEntries(Object.entries(next).map(([key, value]) => [key.toLowerCase(), value])) } });
      for (const [name, value] of Object.entries(values.values)) {
        const key = keyOf(next, name);
        if (key) next = { ...next, [key]: value };
      }
    }
    if (toText(column.setup.formula_for_table) === "uom_formula") {
      const result = await call<{ value: string | null }>("uom-formula", { masterGrid: false, coreEntry: grids.coreEntry, row: { ...eventRow(row, column.setup.field_name, text), backup: freshBackup, values: Object.fromEntries(Object.entries(next).map(([key, value]) => [key.toLowerCase(), value])) } });
      const index = grids.columns.indexOf(column);
      if (result.value !== null && grids.columns[index + 1]) next = { ...next, [grids.columns[index + 1].key]: result.value };
    }
    if (programId === 26 || programId === 28) {
      const disRate = toDecimal(cellOf(next, "pr_rate")) - toDecimal(cellOf(next, "pr_disamt"));
      if (keyOf(next, "pr_disrate")) next = { ...next, [keyOf(next, "pr_disrate")!]: String(disRate) };
      if (keyOf(next, "pr_netrate")) next = { ...next, [keyOf(next, "pr_netrate")!]: String(disRate - toDecimal(cellOf(next, "pr_slabperc"))) };
    }
    if (programId === 36 && keyOf(next, "pr_netrate")) next = { ...next, [keyOf(next, "pr_netrate")!]: String(toDecimal(cellOf(next, "pr_prate")) - toDecimal(cellOf(next, "pr_slabperc"))) };
    setRecords((current) => current.map((candidate, index) => (index === row ? next : candidate)));
    settleEdited(row, next, nextBackup);
    return true;
  };

  /**
   * The keyboard must never end up on the page itself (Space would scroll the whole screen and
   * the arrows would scroll without moving the cursor). If nothing holds it once a move or an
   * edit has settled, the grid takes it back.
   */
  function keepGridFocus() {
    setTimeout(() => {
      const holder = document.activeElement;
      if (isMessageBoxOpen() || (holder && holder !== document.body && holder.isConnected)) return;
      (gridFocus.current ?? addFocus.current)?.focus({ preventScroll: true });
    }, 0);
  }

  /**
   * Scrolls the grid sideways so the whole of a column is in sight: past the frozen columns on
   * the left, and not cut off on the right (a column wider than the view shows from its start).
   */
  const showWholeColumn = (element: HTMLElement, key: string) => {
    const index = columns.findIndex((candidate) => candidate.key === key);
    if (index < 0) return;
    const frozen = grids ? Math.min(grids.frozen, columns.length) : 0;
    if (index < frozen) return; // a frozen column never scrolls away
    let left = INDICATOR_WIDTH;
    for (let at = 0; at < index; at += 1) left += widthOf(columns[at]);
    const right = left + widthOf(columns[index]);
    let frozenRight = INDICATOR_WIDTH;
    for (let at = 0; at < frozen; at += 1) frozenRight += widthOf(columns[at]);
    const shownFrom = element.scrollLeft + frozenRight;
    const shownTo = element.scrollLeft + element.clientWidth;
    if (right > shownTo) element.scrollLeft = right - element.clientWidth;
    if (left < element.scrollLeft + frozenRight || left < shownFrom) element.scrollLeft = Math.max(0, left - frozenRight);
  };

  /** C1dg_UpdateGrid_BeforeRowColChange + AfterRowColChange for a move to (row, key). */
  /** `editAfter`: open the editor once the cursor gets there (used when a commit makes the move wait). */
  const moveTo = async (row: number, key: string, editAfter = false): Promise<boolean> => {
    if (!grids || !meta || busy) return false;
    if (editing) {
      if (!(await commitEdit())) return false;
      if (row !== cursor.row || key !== cursor.key) { updateGo.current = { row, key, edit: editAfter }; nudgeRender(); }
      return false;
    }
    const oldRow = cursor.row;
    const oldColumn = columnByKey.get(cursor.key);
    const newColumn = columnByKey.get(key);
    if (!newColumn || row < 0 || row >= records.length) return false;
    const oldRecord = records[oldRow];

    if (oldColumn && oldRecord && (oldRow !== row || oldColumn.key !== key)) {
      if (cellOf(oldRecord, oldColumn.key) !== "" && toText(oldColumn.setup.duplichk_fldname1) !== "" && duplicateInGrid(records, oldRow, cellOf(oldRecord, oldColumn.key), oldColumn.setup)) {
        await ask("Duplicate Master Found...", "Warning");
        return false;
      }
      if (oldColumn.setup.field_type === "D" && first?.text === "(blank)" && cellOf(oldRecord, oldColumn.key).trim() !== "" && dateOutsideYear(cellOf(oldRecord, oldColumn.key), yearStartText, yearEndText)) {
        await ask("Date should be allowed only Within Accounting year...", "Date Validation");
        setCell(oldRow, oldColumn.key, yearStartText);
        return false;
      }
      // AfterRowColChange: a typed password is kept aside and masked.
      if (oldColumn.setup.force_inputtype === "P" && cellOf(oldRecord, oldColumn.key) !== "*********") {
        setBackupCell(oldRow, oldColumn.key, cellOf(oldRecord, oldColumn.key));
        setCell(oldRow, oldColumn.key, "*********");
      }
    }

    let record = records[row];
    const permissionKey = `${row}:${newColumn.key}`;
    if (oldColumn && toText(first?.value) !== "") {
      const status = toText(newColumn.setup.status_against_fld);
      if (status.toLowerCase() === "record_exist") {
        if (isEditable(row, newColumn)) {
          let answer = "";
          if (newColumn.setup.enable_for === "Y") answer = cellOf(record, "record_exist") === "Y" ? "E" : "D";
          else if (newColumn.setup.disable_for === "Y") answer = cellOf(record, "record_exist") === "Y" ? "D" : "E";
          const effect = applyPermission(answer);
          if (effect.editable !== undefined) setCellEditable((current) => ({ ...current, [permissionKey]: effect.editable! }));
        }
      } else if (status !== "") {
        const setting = toText(newColumn.setup.enable_for) !== "" ? newColumn.setup.enable_for.trim() : toText(newColumn.setup.disable_for) !== "" ? newColumn.setup.disable_for.trim() : "";
        if (setting !== "") {
          const effect = applyPermission(getPermission(permissionSource(record), "E", status, setting, false, false));
          if (effect.editable !== undefined) setCellEditable((current) => ({ ...current, [permissionKey]: effect.editable! }));
        }
      }
      if (oldColumn.setup.field_validation.toLowerCase() === "sys.compulsionhandle" && cellOf(oldRecord, oldColumn.key) !== "") {
        const target = grids.columns.find((column) => lower(column.setup.run_compulsory_field) === lower(oldColumn.setup.field_name));
        // Only to a field that is open: a quantity of 0 keeps its UOM closed, and the cursor must not stop there.
        if (target && target.key !== key && isEditable(row, target)) key = target.key;
      }
    }

    const column = columnByKey.get(key) ?? newColumn;
    setCursor({ row, key: column.key });
    setSelectionEnd(null);
    setRowStatus(`${row + 1}/${records.length}`);
    if (isEditable(row, column)) {
      setHelpRow(null);
      if (toText(column.setup.field_carry_name) !== "" && ((licence === 30 && programId === 8) || cellOf(record, column.key).trim() === "" || column.setup.field_carry_name.includes("|"))) {
        const carried = carryString(column.setup.field_carry_name, column.setup.input_mask, (name) => (keyOf(record, name) ? cellOf(record, name) : undefined));
        if (carried.trim() !== "") {
          setBackupCell(row, column.key, carried);
          setCell(row, column.key, carried);
          record = { ...record, [column.key]: carried };
        }
      }
      if (column.setup.serverQueries.includes("defa_against_query") && toText(column.setup.defa_against_field) !== "") {
        const result = await call<{ value: string | null; recFound: boolean; ran: boolean }>("defa-against", { masterGrid: false, row: eventRow(row, column.setup.field_name, "") });
        if (result.ran) {
          if (result.value !== null) setCell(row, column.key, result.value);
          else if (backup.some((candidate) => cellOf(candidate, column.key) === cellOf(record, column.key))) setCell(row, column.key, "");
          if (result.recFound) setCellEditable((current) => ({ ...current, [permissionKey]: false }));
        }
      }
      if (toText(column.setup.run_compulsory_field) !== "" && toText(column.setup.run_compulsory_cond) !== "") {
        getPermission(permissionSource(record), "C", column.setup.run_compulsory_field, column.setup.run_compulsory_cond, false, false);
      }
      if (programId === 34) setCellEditable((current) => ({ ...current, [permissionKey]: true }));
      setMessage([tooltipText(column.setup.field_tooltips), column.statusDisplay].filter(Boolean).join("   ·   "));
      // NewRowColDisplay: the main field (DISPLAY_HELP with a HELP_QUERY) always shows its help
      // list, on the entry holding this value, else from the top.
      if (help && isMainField(column.setup)) {
        const field = helpSearchKey(column.setup);
        const value = cellOf(record, column.key).trim().toUpperCase();
        setHelpRow(value === "" ? -1 : groupHelpRows(column.setup, record).findIndex((helpRecord) => cellOf(helpRecord, field).trim().toUpperCase() === value));
      }
    }
    keepGridFocus();
    // keep the cursor in view
    const element = scroller.current;
    if (element) {
      const top = Math.max(0, shownRows.indexOf(row)) * ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + ROW_HEIGHT * 2 > element.scrollTop + element.clientHeight) element.scrollTop = top - element.clientHeight + ROW_HEIGHT * 2;
      showWholeColumn(element, column.key);
    }
    return true;
  };

  const neighbourColumn = (key: string, step: number) => {
    const index = columns.findIndex((column) => column.key === key);
    const next = columns[Math.min(columns.length - 1, Math.max(0, index + step))];
    return next?.key ?? key;
  };
  /** Where Enter goes after an edit: the next editable field, else the next row's first one. */
  const nextEditable = (row: number, key: string, step: 1 | -1): Cell | null => {
    let current = row;
    let index = columns.findIndex((column) => column.key === key) + step;
    for (let rowsTried = 0; rowsTried < 3; ) {
      if (index >= columns.length || index < 0) {
        const position = shownRows.indexOf(current) + step;
        if (position < 0 || position >= shownRows.length) return null;
        current = shownRows[position];
        index = step === 1 ? 0 : columns.length - 1;
        rowsTried += 1;
      }
      const column = columns[index];
      if (column && isEditable(current, column)) return { row: current, key: column.key };
      index += step;
    }
    return null;
  };
  const neighbourRow = (row: number, step: number) => {
    const position = shownRows.indexOf(row);
    const next = shownRows[Math.min(shownRows.length - 1, Math.max(0, position + step))];
    return next ?? row;
  };

  /**
   * The rows of the selection (cursor row to selectionEnd) in the order the grid shows them,
   * so a sorted or filtered grid never pastes into or deletes a row hidden between the two.
   */
  const selectedRows = () => {
    const a = shownRows.indexOf(cursor.row);
    const b = selectionEnd === null ? a : shownRows.indexOf(selectionEnd);
    if (a < 0) return records[cursor.row] ? [cursor.row] : [];
    return shownRows.slice(Math.min(a, b < 0 ? a : b), Math.max(a, b < 0 ? a : b) + 1);
  };

  // ---- Selected_RowDelete / MnuDeleteRow_Click / MnuDeleteSelection_Click / Delete key
  const deleteSelected = async (fromMenu: "row" | "selection" | "key") => {
    if (!grids) return;
    if (fromMenu !== "selection" && DELETE_BLOCKED_PROGRAMS.includes(programId)) return;
    if ((await ask("Are you sure to delete?", "Confirmation", ["Yes", "No"])) !== "Yes") return;
    if (def && !def.rights.delete) { await ask("Master Delete Rights Not Available For User", "Rights Validation"); return; }
    if ((await ask("Are you Confirm to delete record??", "Confirmation", ["Yes", "No"])) !== "Yes") return;
    const marked = new Set(deleted);
    for (const row of selectedRows()) {
      if (marked.has(row)) continue;
      const record = records[row];
      if (toInt(Object.values(record)[1]) <= 27 && (programId === 14 || programId === 20)) {
        if (programId === 20) { marked.add(row); markEdited(row); }
        continue;
      }
      if ([1, 49, 52].includes(programId)) { marked.add(row); markEdited(row); continue; }
      if (!keyOf(record, "record_exist")) continue;
      let exists = cellOf(record, "record_exist");
      if (exists === "") exists = (await call<{ recordExist: "Y" | "N" }>("record-exist", { masterGrid: false, row: eventRow(row, grids.columns[1]?.setup.field_name ?? "", "") })).recordExist;
      if (exists !== "Y") {
        const blocked = (await call<{ message: string }>("delete-blocked", { programId, record: Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value])), rowIndex: row + 1 })).message;
        if (blocked !== "") { await ask(blocked, "Master Validation"); continue; }
        marked.add(row);
        markEdited(row);
      } else {
        await ask(`Entry or Only Opening Found For Row No.${row + 1}, So Deletion of Master Not allowed...`, "Master Validation");
      }
      setCell(row, keyOf(record, "record_exist")!, "");
    }
    setDeleted(marked);
  };

  // ---- Licence 7: the saved master posted to Ezeone, its reply shown as the desktop shows it
  const sendToCloud = async (cloud: CloudPush) => {
    setBusy("Sending to cloud");
    const reply = await call<{ message: string }>("cloud-push", { cloud }).catch((error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }));
    setBusy("");
    await ask(reply.message, "Ezeone Save Cloud Message");
  };

  // ---- Btn_Master_EditSave_Click
  const saveUpdate = async () => {
    if (!grids || !def || !group) return;
    // A cell still open is committed first; the save then runs again once the grid holds it.
    if (editing) { if (await commitEdit()) setSaveAfterCommit(true); return; }
    const answer = await ask("Do you want to save the changes ? ", "Master Update Save", ["Yes", "No", "Cancel"]);
    if (answer === "Cancel") return;
    if (answer === "No") { await loadGroup(group.firstCombo, group.secondCombo); return; }
    const rows = programId === 34 ? records.map((_, index) => index) : [...edited].sort((a, b) => a - b);
    const payloadRecords = rows.map((row) => ({
      rowNumber: row + 1,
      values: Object.fromEntries(Object.entries(records[row]).map(([key, value]) => [key.toLowerCase(), value])),
      backup: Object.fromEntries(Object.entries(backup[row] ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
      deleted: deleted.has(row),
      editableColumns: grids.columns.filter((column) => isEditable(row, column)).map((column) => column.key.toLowerCase()),
    }));
    const firstRecord = Object.fromEntries(Object.entries(records[0] ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    let currentPasswords = passwords;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      setBusy("Saving");
      const result = await call<{ ok: boolean; message: string; needs?: string; warnings: string[]; cloud?: CloudPush }>("edit-save", { records: payloadRecords, firstRecord, passwords: currentPasswords }).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error), needs: undefined, warnings: [], cloud: undefined }));
      setBusy("");
      if (result.needs) {
        const typedPassword = await askPassword(result.message);
        if (typedPassword === null) return;
        currentPasswords = { ...currentPasswords, [result.needs]: typedPassword };
        setPasswords(currentPasswords);
        continue;
      }
      if (!result.ok) { await ask(result.message, result.message.startsWith("Fill") ? "Empty Fields Found!!" : "Warning"); return; }
      setWarnings(result.warnings);
      // The desktop sends an edited SDIPL debtor or product to Ezeone without asking.
      if (result.cloud) await sendToCloud(result.cloud);
      if (zoomAccode > 0) { onClose(); return; }
      if (SECOND_RESET_PROGRAMS.includes(programId) && programId !== 49 && programId !== 50) {
        setGrids(null);
        setSecond(null);
        setRowStatus("");
      } else {
        await loadGroup(group.firstCombo, group.secondCombo);
      }
      return;
    }
  };

  const [saveAfterCommit, setSaveAfterCommit] = useState(false);
  const saveUpdateRef = useRef(saveUpdate);
  useEffect(() => { saveUpdateRef.current = saveUpdate; });
  useEffect(() => {
    if (!saveAfterCommit || editing) return;
    setSaveAfterCommit(false);
    void saveUpdateRef.current();
  }, [saveAfterCommit, editing]);

  /** A choice taken from a combo list: commit it, then carry on as Enter / Tab would (step 0 stays). */
  const finishCombo = async (text: string, step: 0 | 1 | -1) => {
    setEditText(text);
    if (!(await commitEdit(text))) return;
    gridFocus.current?.focus({ preventScroll: true });
    if (step === 0) return;
    setComboStart("");
    setUpdatePendingMove({ row: cursor.row, key: cursor.key, step });
  };

  // ---- MnuCopy_Click / MnuPaste_Click
  const copyCell = async () => {
    const column = columnByKey.get(cursor.key);
    if (!column) return;
    const value = cellOf(records[cursor.row], column.key);
    if (column.setup.combo_value.toUpperCase() === "X") {
      const option = column.options?.find((candidate) => candidate.text === value);
      if (!option || toInt(option.value) <= 0) { await ask("Pl. First Enter This Column And Again Copy", "Warning"); setCopied(null); return; }
      setCopied({ value, addonId: option.value });
      return;
    }
    setCopied({ value, addonId: "0" });
  };
  const pasteCell = async () => {
    if (!copied || !grids) return;
    const rows = selectedRows();
    const from = rows[0] ?? cursor.row;
    const column = columnByKey.get(cursor.key);
    if (!column) return;
    let problem = "";
    if (!isEditable(from, column)) problem = `Column. : ${column.caption} is readonly`;
    else if (toText(column.setup.status_against_fld) !== "" && toText(column.setup.enable_for) !== "" && getPermission(permissionSource(records[from]), "E", column.setup.status_against_fld.trim(), column.setup.enable_for.trim(), false, false).toUpperCase().includes("D")) problem = `Column. : ${column.caption} is disabled`;
    else if (["L", "Q"].includes(column.setup.combo_value.toUpperCase())) problem = `Column ${column.caption} isn't allow for Paste, as it is drop down column`;
    // A date pastes when the copied value reads as one; it goes in written as the grid writes dates.
    let value = copied.value;
    // A multi-pick column takes only keys its list has, written the stored way.
    if (column.comboKind === "M") {
      if (validKeyList(value, column.options ?? [], "")) value = keyListText(parseKeyList(value));
      else problem = `Value = ${copied.value} isn't a list of ${column.caption} keys`;
    }
    if (column.setup.field_type === "D" && value.trim() !== "") {
      const date = typedDate(value, "");
      if (date) value = dateText(value, date);
      else problem = `Value = ${copied.value} isn't valid date for Column ${column.caption}`;
    }
    if (problem !== "") { await ask(problem, "Invalid Paste Selection"); return; }
    // Every selected row takes the value, except one marked for deletion or locked for this column.
    let pasted = 0;
    for (const row of rows) {
      if (deleted.has(row) || !isEditable(row, column)) continue;
      setCell(row, column.key, value);
      if (column.setup.combo_value.toUpperCase() === "X") setBackupCell(row, column.key, copied.addonId);
      markEdited(row);
      pasted += 1;
    }
    setMessage(`Pasted "${value}" into ${pasted} row${pasted === 1 ? "" : "s"} of ${column.caption}`);
  };

  // ---- Restore_Master (F4)
  const restoreToAdd = () => {
    if (!grids || !grids.addTabVisible) return;
    const record = records[cursor.row];
    setAddRows((current) => current.map((row) => {
      const column = columnByField(row.fieldName);
      if (!column || !column.visible) return row;
      const value = cellOf(record, column.key);
      const inputType = toText(row.setup.input_type).toUpperCase();
      let fieldInput = value;
      if (inputType === "N") fieldInput = row.setup.decimal_points !== 0 ? toDecimal(value).toFixed(2) : row.setup.field_type === "N" ? toDecimal(value).toFixed(0) : value;
      else if (inputType === "C") fieldInput = row.setup.decimal_points !== 0 ? toDecimal(value).toFixed(2) : toDecimal(value).toFixed(0);
      return { ...row, fieldInput };
    }));
    setRestore({ row: cursor.row });
    setTab("add");
  };

  // ---- Tbx_salesho_Leave ... Tbx_desperson_Leave, Tbx_temproute_Leave (programs 39 and 50)
  const applySchemeBox = (name: string, text: string) => {
    if (text === "") return;
    const box = SCHEME_BOXES.find((candidate) => candidate.name === name);
    if (!box) return;
    const changedRows = new Set<number>();
    const next = records.map((record, row) => {
      let updated = record;
      const set = (column: string, value: string) => {
        if (cellOf(record, column) === value) return;
        updated = { ...updated, [keyOf(record, column) ?? column.toLowerCase()]: value };
        changedRows.add(row);
      };
      if (programId === 50) {
        const rate = toDecimal(cellOf(record, "PL_SRATE"));
        const figure = toDecimal(text.slice(1));
        const op = text.charAt(0);
        if (rate <= 0) return record;
        const result = op === "%" ? runFormula(rate, "+", rate * (figure / 100), 2)
          : op === "/" && figure === 0 ? ""
          : "+-*/".includes(op) ? runFormula(rate, op, figure, 2) : "";
        if (result !== "") set("PL_SRATE", result);
        return updated;
      }
      if (text === "0") set(box.column, "");
      else if (Number.isFinite(Number(text)) && toDecimal(cellOf(record, "sch_disamt")) > 0) set(box.column, runFormula(toDecimal(cellOf(record, "sch_disamt")) * Number(text), "/", 100, 2));
      return updated;
    });
    setRecords(next);
    // The desktop writes into the grid without marking the rows; they are marked here so Save keeps them.
    for (const row of changedRows) markEdited(row);
  };

  // ---- btn_Master_EditLog_Click: ShowGridForm1
  const showLog = async () => {
    if (!grids || grids.pkvKey === "" || !first) return;
    const code = toDecimal(cellOf(records[cursor.row], grids.pkvKey));
    if (code <= 0) return;
    setBusy("Reading log");
    const body = await call<{ log: LogTable }>("master-log", { programId, firstComboText: first.text, code }).catch((error: unknown) => ({ log: { columns: [], rows: [], message: error instanceof Error ? error.message : String(error) } }));
    setBusy("");
    if (body.log.columns.length === 0) { if (body.log.message) await ask(body.log.message, `${first.text} Log`); return; }
    setLogTable(body.log);
  };

  /** ShowGridForm1's gridForm.Load: a value that differs from the column before it is coloured, cycling yellow, green, red. */
  const logColours = (table: LogTable) => table.rows.map((row) => {
    const colours: string[] = row.map(() => "");
    for (let at = 2; at < row.length; at += 1) {
      const current = row[at].trim();
      const previous = row[at - 1].trim();
      const numbers = current !== "" && previous !== "" && Number.isFinite(Number(current)) && Number.isFinite(Number(previous));
      const equal = numbers ? Number(current) === Number(previous) : current.toLowerCase() === previous.toLowerCase();
      if (!equal) colours[at] = colours[at - 1] === "mp-log-yellow" ? "mp-log-green" : colours[at - 1] === "mp-log-green" ? "mp-log-red" : "mp-log-yellow";
    }
    return colours;
  });

  const exportLog = (table: LogTable) => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [table.columns.map(quote).join(","), ...table.rows.map((row) => row.map(quote).join(","))];
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(13, 10))], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${first?.text ?? programName} Log.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // ---- Btn_Master_AddPrint_Click / Btn_Master_EditPrint_Click
  /** Accounts (14) and licence 35's products (48, 49) print the Add grid's print_inmaster rows as a master sheet. */
  const printsMasterSheet = programId === 14 || ((programId === 48 || programId === 49) && licence === 35);
  const printMasterSheet = () => {
    const rows = addRows.filter((row) => row.visible && row.setup.print_inmaster);
    const heading = programId === 48 ? "Product Master" : programId === 49 ? "Product Child Master" : "Account Master";
    printHtml(heading, `<h1>${escapeHtml(meta?.companyName ?? "")}</h1><p>${escapeHtml(heading)} : ${escapeHtml(first?.text ?? "")}</p><table><tbody>${rows.map((row) => `<tr><th>${escapeHtml(row.headLabel)}</th><td>${escapeHtml(row.setup.force_inputtype === "P" ? "" : row.fieldInput)}</td></tr>`).join("")}</tbody></table>`);
  };

  // ---- Excel, PDF and print preview of the Update grid, as shown (columns, filters, sort)
  const decimalsOf = (column: UpdateColumn): number => {
    if (column.format === "N2") return 2;
    const places = /^#,##0\.(0+)$/.exec(column.format);
    if (places) return places[1].length;
    if (column.format.startsWith("#")) return 0;
    return column.setup.field_type === "N" || column.setup.field_type === "C" ? Math.max(0, column.setup.decimal_points) : 0;
  };
  const buildExportTable = (): ExportTable => {
    const exportColumns: ExportColumn[] = columns.map((column) => {
      // A list column (combo_value L, Q or X) holds a choice's name, e.g. "L -- CREDITORS FOR EXPENSES".
      const kind = ["L", "Q", "X"].includes(column.setup.combo_value.trim().toUpperCase()) ? "text" : filterKind(column);
      return {
        caption: column.caption || column.key,
        kind,
        decimals: kind === "number" ? decimalsOf(column) : 0,
        align: kind === "number" ? "right" : kind === "date" ? "center" : column.align === "C" ? "center" : column.align === "R" ? "right" : "left",
        width: widthOf(column),
      };
    });
    const rows: ExportCell[][] = shownRows.map((row) => columns.map((column, index) => {
      const raw = cellOf(records[row], column.key).trim();
      if (raw === "") return null;
      if (exportColumns[index].kind === "number") { const value = toDecimal(raw.replace(/,/g, "")); return Number.isFinite(value) ? value : raw; }
      if (exportColumns[index].kind === "date") return parseDesktopDate(raw) ?? raw;
      return column.comboKind === "M" ? keyListNames(raw, column.options) : formatCell(raw, column.format);
    }));
    // Totals for amounts and quantities (not for serial numbers or codes).
    const summed = columns.map((column) => (column.setup.field_type === "N" || column.setup.field_type === "C")
      && column.format !== "#,###"
      && !/(^|_)(SR_?NO|SERIAL|KEY|CODE|ID|NO)$/i.test(lower(column.setup.field_name)));
    const totals = summed.some(Boolean) ? columns.map((_, index) => (summed[index] ? rows.reduce((sum, row) => sum + (typeof row[index] === "number" ? (row[index] as number) : 0), 0) : null)) : undefined;
    const group = [first?.text, second?.text].filter(Boolean).join(" / ");
    return {
      company: meta?.companyName ?? "",
      title: def?.heading || title,
      subtitle: [],
      titleRight: firstCombo ? `${firstCombo.label}: ${group}` : group,
      footerCenter: shownRows.length === liveRows.length ? `${liveRows.length} records` : `${shownRows.length} of ${liveRows.length} records (filtered)${sort ? ", sorted" : ""}`,
      columns: exportColumns,
      rows,
      totals,
      recordTitleColumn: Math.max(0, columns.findIndex((column) => isMainField(column.setup))),
    };
  };
  /** Print, Preview, Excel, PDF and CSV of the Update grid as shown (features/grid/useGridOutput). */
  const unsaved = editing || edited.size > 0 || deleted.size > 0;
  const output = useGridOutput({
    table: buildExportTable,
    name: `${def?.heading || title} - ${first?.text ?? ""}`,
    sheet: first?.text || "Master",
    csv: () => [columns.map((column) => column.caption), ...shownRows.map((row) => columns.map((column) => (column.comboKind === "M" ? shownText(records[row], column) : formatCell(cellOf(records[row], column.key), column.format))))],
    shownRows: shownRows.length,
    totalRows: liveRows.length,
    unsaved,
    userName: meta?.userName ?? "",
    width: columns.reduce((sum, column) => sum + widthOf(column), 0),
    ask,
    onPreviewClose: () => gridFocus.current?.focus(),
  });

  /** C1dg_UpdateGrid_KeyUp + KeyPress + KeyPressEdit, for the grid when no editor is open. */
  const gridKeys = async (event: ReactKeyboardEvent) => {
    if (!grids || editing || isMessageBoxOpen()) return;
    const column = columnByKey.get(cursor.key);
    const ctrl = event.ctrlKey || event.metaKey;
    // Ctrl+Shift+Left / Right: the current column moves one place; the cursor goes with it.
    if (ctrl && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      shiftColumn(cursor.key, event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); findMode.current = true; setTyped(""); if (event.shiftKey) setSelectionEnd(neighbourRow(selectionEnd ?? cursor.row, 1)); else await moveTo(neighbourRow(cursor.row, 1), cursor.key); return;
      case "ArrowUp": event.preventDefault(); findMode.current = true; setTyped(""); if (event.shiftKey) setSelectionEnd(neighbourRow(selectionEnd ?? cursor.row, -1)); else await moveTo(neighbourRow(cursor.row, -1), cursor.key); return;
      case "ArrowRight": event.preventDefault(); setTyped(""); await moveTo(cursor.row, neighbourColumn(cursor.key, 1)); return;
      case "Tab": {
        // Tab, like Enter, passes over read-only columns; the arrow keys still stop on them to read.
        event.preventDefault();
        setTyped("");
        const next = nextEditable(cursor.row, cursor.key, event.shiftKey ? -1 : 1);
        await moveTo(next?.row ?? cursor.row, next?.key ?? neighbourColumn(cursor.key, event.shiftKey ? -1 : 1));
        return;
      }
      case "ArrowLeft": event.preventDefault(); setTyped(""); await moveTo(cursor.row, neighbourColumn(cursor.key, -1)); return;
      case "PageDown": event.preventDefault(); findMode.current = true; setTyped(""); await moveTo(neighbourRow(cursor.row, Math.floor(viewport / ROW_HEIGHT)), cursor.key); return;
      case "PageUp": event.preventDefault(); findMode.current = true; setTyped(""); await moveTo(neighbourRow(cursor.row, -Math.floor(viewport / ROW_HEIGHT)), cursor.key); return;
      case "Enter":
        event.preventDefault();
        setTyped("");
        if (column && isEditable(cursor.row, column)) { setComboStart(""); await startEdit(); }
        else {
          const next = nextEditable(cursor.row, cursor.key, 1);
          if (next && (await moveTo(next.row, next.key))) await startEdit(undefined, next);
        }
        return;
      case "F2": event.preventDefault(); await startEdit(); return;
      case "F3": event.preventDefault(); findNext(); return;
      case "F4": event.preventDefault(); if (isComboCell(cursor.row, column)) { setComboStart(""); await startEdit(); } else restoreToAdd(); return;
      case "F5": event.preventDefault(); document.getElementById("mp-save")?.focus(); return;
      case "Delete": event.preventDefault(); await deleteSelected("key"); return;
    }
    if (event.altKey && event.key === "ArrowDown" && isComboCell(cursor.row, column)) { event.preventDefault(); setComboStart(""); await startEdit(); return; }
    if (ctrl && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("mp-find")?.focus(); return; }
    if (ctrl && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const text = [grids.columns.map((candidate) => candidate.caption).join("\t"), ...records.map((record) => grids.columns.map((candidate) => cellOf(record, candidate.key)).join("\t"))].join("\n");
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      return;
    }
    if (ctrl && event.key.toLowerCase() === "c") { event.preventDefault(); await navigator.clipboard?.writeText(cellOf(records[cursor.row], cursor.key)).catch(() => undefined); await copyCell(); return; }
    if (ctrl && event.key.toLowerCase() === "v") { event.preventDefault(); await pasteCell(); return; }
    if (ctrl && event.key.toLowerCase() === "z") { event.preventDefault(); if (column && isEditable(cursor.row, column)) restoreCell(cursor.row, column.key); return; }
    if (findMode.current && typed !== "" && (event.key === "Backspace" || event.key === "Escape")) {
      event.preventDefault();
      const search = event.key === "Escape" ? "" : typed.slice(0, -1);
      setTyped(search);
      if (search !== "" && column) {
        const found = shownRows.find((row) => shownText(records[row], column).toUpperCase().startsWith(search));
        if (found !== undefined) await moveTo(found, cursor.key);
      }
      return;
    }
    if (event.key.length === 1 && !ctrl && !event.altKey) {
      event.preventDefault();
      if (findMode.current && column) {
        // Search the current column in the order shown; a key that finds nothing is dropped.
        const search = typed + event.key.toUpperCase();
        const found = shownRows.find((row) => shownText(records[row], column).toUpperCase().startsWith(search));
        if (found !== undefined) { setTyped(search); if (found !== cursor.row) await moveTo(found, cursor.key); }
        return;
      }
      if (column && isComboCell(cursor.row, column)) {
        // A combo opens on the first choice starting with the letter typed (else on its value).
        setComboStart(event.key);
        await startEdit();
        return;
      }
      if (column && isEditable(cursor.row, column)) {
        const key = fitCase(column.setup, event.key, programId);
        const outcome = keyPress({ setup: column.setup, masterGrid: false, programId, licence, cellValue: cellOf(records[cursor.row], column.key), editorText: "", yearStart: yearStartText }, key);
        if (outcome.message) { await ask(outcome.message, "Typed Character not allowed"); return; }
        if (outcome.replaceWith !== undefined) { setCell(cursor.row, column.key, outcome.replaceWith); markEdited(cursor.row); return; }
        if (!outcome.refused) await startEdit(key);
        return;
      }
      // C1dg_UpdateGrid_KeyPress: type to find in the current column.
      let search = typed;
      if (search !== "" && !cellOf(records[cursor.row], cursor.key).startsWith(search)) search = "";
      search += event.key.toUpperCase();
      const found = records.findIndex((record, index) => !deleted.has(index) && cellOf(record, cursor.key).toUpperCase().startsWith(search));
      if (found >= 0) { setTyped(search); await moveTo(found, cursor.key); } else setTyped(search.slice(0, -1));
    }
  };

  const findNext = () => {
    const needle = find.trim().toUpperCase();
    if (needle === "" || !grids) return;
    const start = shownRows.indexOf(cursor.row);
    for (let step = 1; step <= shownRows.length; step += 1) {
      const row = shownRows[(start + step) % shownRows.length];
      const hit = columns.find((column) => cellOf(records[row], column.key).toUpperCase().includes(needle));
      if (hit) { void moveTo(row, hit.key); return; }
    }
  };

  /** The editor's text once a typed key replaces whatever is selected in it. */
  const remainingAfterKey = (input: HTMLInputElement) => {
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    return input.value.slice(0, from) + input.value.slice(to);
  };
  /** Types `text` where the caret is, for a key taken in another case than the one pressed. */
  const typeAtCaret = (input: HTMLInputElement, text: string, apply: (value: string) => void) => {
    const from = input.selectionStart ?? input.value.length;
    const to = input.selectionEnd ?? from;
    apply(input.value.slice(0, from) + text + input.value.slice(to));
    requestAnimationFrame(() => input.setSelectionRange(from + text.length, from + text.length));
  };

  /** The open editor's own keys (KeyPressEdit). */
  const editorKeys = async (event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const column = columnByKey.get(cursor.key);
    if (!column) return;
    // Esc undoes what was typed: the cell keeps the value it had before editing began.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); gridFocus.current?.focus({ preventScroll: true }); return; }
    if (tools.keys(event, editorKindOf(column.setup.field_type), editText, setEditText, column.setup.decimal_points)) return;
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (await commitEdit()) {
        gridFocus.current?.focus();
        // Editing carries on: the next editable field opens by itself, wrapping to the next row.
        setUpdatePendingMove({ row: cursor.row, key: cursor.key, step: event.shiftKey ? -1 : 1 });
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      // Ctrl+Z: the value as it was loaded (the grid's text, not an id kept aside for a combo).
      event.preventDefault();
      const loaded = cellOf(original.records[cursor.row], column.key);
      const date = column.setup.field_type === "D" ? parseDesktopDate(loaded) : null;
      setEditText(date ? formatDesktopDate(date) : loaded);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.currentTarget instanceof HTMLInputElement) {
      const key = fitCase(column.setup, event.key, programId);
      const outcome = keyPress({ setup: column.setup, masterGrid: false, programId, licence, cellValue: cellOf(records[cursor.row], column.key), editorText: editText, remainingText: remainingAfterKey(event.currentTarget), yearStart: yearStartText }, key);
      if (outcome.refused) event.preventDefault();
      else if (key !== event.key) {
        event.preventDefault();
        typeAtCaret(event.currentTarget, key, (after) => { if (!typingAllowed(column.setup, editText, after)) return; setEditText(after); followHelp(column.key, after); });
      }
      if (outcome.message) await ask(outcome.message, "Typed Character not allowed");
      if (outcome.replaceWith !== undefined) setEditText(outcome.replaceWith);
    }
  };

  // ======================================================================================
  // Add grid

  const addValue = (name: string) => addRows.find((row) => row.fieldName.toLowerCase() === lower(name))?.fieldInput;
  /** A New-grid field's duplicate group (duplichk_fldname2): that row's value, else the first combo's text. */
  const addDuplicateGroup = (setup: AddRow["setup"]) => {
    const field = toText(setup.duplichk_fldname2);
    return field === "" ? null : { field, value: addValue(field) ?? first?.text ?? "" };
  };
  /**
   * An Add-grid field its row rule closes: STATUS_AGAINST_FLD with ENABLE_FOR, else DISABLE_FOR,
   * read from the values entered so far exactly as the Update grid reads its record (closedByRow).
   * It is worked out afresh each time, so it follows the field it depends on; it used to be set
   * once when the cursor arrived, from values that did not yet hold the last choice, and it stuck.
   */
  const addClosedByRule = (row: AddState): boolean => {
    if (pairedClosed(toText(row.setup.value_diff_than), row.fieldInput, (name) => addValue(name) ?? "")) return true;
    const status = toText(row.setup.status_against_fld);
    if (status === "") return false;
    const enable = toText(row.setup.enable_for);
    const setting = enable !== "" ? enable : toText(row.setup.disable_for);
    if (setting === "") return false;
    if (enable !== "" && row.recFound) return true;
    const source = { firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: def?.firstCombo?.bound ?? true }, fieldValue: (name: string) => addValue(name) };
    return applyPermission(getPermission(source, "E", status, setting, false, false)).editable === false;
  };
  /** An Add-grid field that can be typed in now: open in the setup and not closed by its row rule. */
  const addOpen = (row: AddState | undefined): boolean => Boolean(row && row.editable && !addClosedByRule(row));
  const addEventRow = (index: number, text: string) => ({
    values: Object.fromEntries(addRows.map((row, at) => [row.fieldName.toLowerCase(), at === index ? text : row.fieldInput])),
    backup: Object.fromEntries(addRows.map((row) => [row.fieldName.toLowerCase(), row.fieldComboValue])),
    fieldName: addRows[index]?.fieldName ?? "",
    editorText: text,
  });
  const setAdd = (index: number, patch: Partial<AddState>) => setAddRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  /** C1dg_MasterGrid_BeforeRowColChange for a move to row `index`. */
  /** `committed`: the caller has just committed the open edit, so it is not committed again from the text this render holds. */
  const addMoveTo = async (index: number, committed = false) => {
    if (!grids || !meta || index < 0 || index >= addRows.length) return;
    if (addEditing && !committed) {
      if (!(await addCommit())) return;
      if (index !== addCursor) { addGo.current = index; nudgeRender(); }
      return;
    }
    setAddComboStart("");
    const old = addRows[addCursor];
    const row = addRows[index];
    setRowStatus(`${index + 1}/${addRows.length}`);
    setMessage([tooltipText(row.setup.field_tooltips), row.statusDisplay].filter(Boolean).join("   ·   "));
    if (toText(row.setup.defa_fixvalue) !== "") {
      const value = (await call<{ value: string }>("defa-fixvalue", { masterGrid: true, row: addEventRow(index, row.fieldInput) })).value;
      if (row.setup.field_type === "D") { const date = parseDesktopDate(value); if (date) setAdd(index, { fieldInput: formatDesktopDate(date) }); }
      else if (row.fieldInput.trim() === "") setAdd(index, { fieldInput: row.setup.defa_fixvalue });
    }
    const carry = row.carryName || row.setup.field_carry_name;
    if (toText(carry) !== "" && ((licence === 30 && programId === 8) || row.fieldInput.trim() === "" || carry.includes("|"))) {
      const plywood = toText(grids.levelMaster?.level9_ext).toUpperCase() === "PL";
      if (!(plywood && row.fieldName.toLowerCase().includes("desc_"))) setAdd(index, { fieldInput: carryString(carry, row.setup.input_mask, (name) => addValue(name)) });
    }
    if (row.setup.serverQueries.includes("defa_add_value_query") && (meta.partyAccode || meta.productCode) && licence !== 46) {
      const value = (await call<{ value: string | null }>("defa-add-value", { masterGrid: true, row: addEventRow(index, row.fieldInput) })).value;
      if (value !== null) setAdd(index, { fieldInput: value, ...(meta.productCode ? { editable: false } : {}) });
    }
    if (old && index !== addCursor) {
      if (old.setup.field_validation.toLowerCase() === "sys.compulsionhandle") {
        const target = addRows.findIndex((candidate) => lower(candidate.setup.run_compulsory_field) === lower(old.fieldName));
        // As the Update grid: only after a value, and only to a field that is open (a blank MIN QTY keeps
        // MIN UOM closed); jumping onto a closed field left the cursor stuck there.
        if (target > 0 && target !== index && old.fieldInput.trim() !== "" && addOpen(addRows[target])) { index = target; }
      }
      if (old.setup.duplicate_chk && old.fieldInput !== "" && !old.setup.serverQueries.includes("duplicate_query") && !meta.productCode) {
        const field = toText(old.setup.duplichk_fldname1) || old.fieldName;
        if (duplicateAgainstUpdate(records, field, old.fieldInput, restore ? restore.row : null, addDuplicateGroup(old.setup))) {
          await ask("Duplicate value Found...", "Warning");
          if (restore) { setAdd(addCursor, { fieldInput: "" }); await cancelAdd(true); }
          return;
        }
      }
    }
    if (row.setup.serverQueries.includes("defa_against_query")) {
      const result = await call<{ value: string | null; recFound: boolean; ran: boolean }>("defa-against", { masterGrid: true, row: addEventRow(index, row.fieldInput) });
      if (result.ran) {
        if (result.value !== null) setAdd(index, { fieldInput: result.value, recFound: true });
        else setAdd(index, { recFound: false, ...(row.carryName === "" && row.fieldInput === "" ? { fieldInput: "" } : {}) });
      }
      if (!result.recFound && old && old.fieldName.toUpperCase().includes("LEVEL_") && addRows[addCursor + 1]) {
        const value = (await call<{ value: string | null }>("plywood", { masterGrid: true, levelField: old.fieldName, row: addEventRow(addCursor, old.fieldInput) })).value;
        if (value !== null && (addRows[addCursor + 1].fieldInput === "" || toText(grids.levelMaster?.level9_ext).toUpperCase() !== "PL")) setAdd(addCursor + 1, { fieldInput: value });
      }
    }
    if (toText(row.setup.run_compulsory_field) !== "" && toText(row.setup.run_compulsory_cond) !== "") {
      const answer = getPermission({ firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: def?.firstCombo?.bound ?? true }, fieldValue: (name) => addValue(name) }, "C", row.setup.run_compulsory_field, row.setup.run_compulsory_cond, true, false);
      const compulsory = answer.toUpperCase().includes("C");
      const label = row.headLabel.replace(/^\* /, "");
      setAdd(index, { compulsory, headLabel: compulsory ? `* ${label}` : label });
    }
    // STATUS_AGAINST_FLD is no longer set here: addOpen works it out from the current values.
    setAddCursor(index);
    return index;
  };

  const addStartEdit = async (initial?: string) => {
    const row = addRows[addCursor];
    if (!addOpen(row) || !row.visible || !grids) return;
    if (row.setup.force_inputtype === "P") setAdd(addCursor, { fieldInput: row.fieldComboValue });
    if (toText(row.setup.formula_for_table) === "uom_entry" || toText(row.setup.defa_formula) !== "") {
      const value = (await call<{ value: string | null }>("add-before-edit", { masterGrid: true, coreEntry: grids.coreEntry, row: addEventRow(addCursor, row.fieldInput) })).value;
      if (value !== null) { setAdd(addCursor, { fieldInput: value }); setAddText(initial ?? zeroAsBlank(row.setup, Boolean(row.options?.length), value)); setAddEditing(true); return; }
    }
    setAddText(initial !== undefined ? initial : zeroAsBlank(row.setup, Boolean(row.options?.length), row.fieldInput));
    if (row.options) {
      // The same list as the Update grid's combo: under the cell (above it when there is no room below).
      const box = document.querySelector(`.mp-add-grid [data-add-cell="${addCursor}"]`)?.getBoundingClientRect();
      const rows = Math.min(10, Math.max(2, row.options.length));
      const height = rows * 22 + 62;
      if (box) {
        const below = box.bottom + height < window.innerHeight - 4;
        const multi = row.comboKind === "M";
        const width = Math.min(window.innerWidth - 8, Math.max(box.width, multi ? 320 : 200, longestText(row.options.map((option) => option.text)) + (multi ? 110 : 64)));
        const left = Math.max(4, Math.min(box.left, window.innerWidth - width - 4));
        setAddComboAt({ left, top: below ? box.bottom + 2 : Math.max(4, box.top - height - 2), width, rows });
      } else setAddComboAt(null);
    }
    setAddEditing(true);
  };
  /** A choice taken from the New (Add) grid's combo list; step 1 / -1 goes on to the next / previous open field. */
  const finishAddCombo = async (text: string, step: 0 | 1 | -1) => {
    setAddComboStart("");
    setAddText(text);
    if (!(await addCommit(text))) return;
    addFocus.current?.focus({ preventScroll: true });
    if (step !== 0) setAddPendingMove({ from: addCursor, step, skipClosed: true, edit: true });
  };

  /** C1dg_MasterGrid_ValidateEdit + AfterEdit. */
  const addCommit = async (typedText?: string): Promise<boolean> => {
    const index = addCursor;
    const row = addRows[index];
    if (!row || !grids || !meta) { setAddEditing(false); return true; }
    /** The text to commit: a combo's choice arrives directly, before the render that would hold it. */
    const entered = typedText ?? addText;
    // The main field keeps no trailing blanks or unseen characters, so a duplicate cannot hide behind them.
    let text = row.comboKind === "M" ? keyListText(parseKeyList(entered)) : fitCase(row.setup, isMainField(row.setup) ? cleanMainValue(entered) : dropPadding(row.setup, entered), programId);
    if (text === "" && zeroAsBlank(row.setup, Boolean(row.options?.length), row.fieldInput) === "") text = row.fieldInput;
    if (row.setup.field_type === "D" && text.trim() !== "") {
      const date = typedDate(text, row.fieldInput);
      if (!date) { await ask(`"${text}" is not a date. Type it as 2309, 23sep, 23/09/2026, or 0109+5 for five days on.`, "Invalid Date"); return false; }
      text = dateText(text, date);
    }
    if (row.comboKind === "L" && row.setup.value_compulsory && text.trim() === "" && row.options?.length) text = row.options[0].text;
    const outcome = validate({
      setup: { ...row.setup, value_compulsory: row.compulsory, ...(row.comboKind === "M" ? { field_length_min: 0 } : {}) }, masterGrid: true, programId, licence, coGstReq: meta.coGstReq, label: row.headLabel,
      fieldValue: (name) => addValue(name) ?? "", previousInput: addRows[index - 1]?.fieldInput ?? "",
      captionOf: (name) => columnByField(name)?.caption ?? name, columnValues: (name) => records.map((record) => cellOf(record, name)),
    }, text);
    if (!outcome.ok) { await ask(outcome.message ?? "", outcome.title ?? "Validation"); return false; }
    const partner = toText(row.setup.value_diff_than);
    if (partner !== "" && text.trim() !== "" && (addValue(partner) ?? "").trim() !== "") {
      const partnerRow = addRows.find((candidate) => lower(candidate.fieldName) === lower(partner));
      await ask(pairedMessage(row.headLabel.replace(/^\* /, ""), partnerRow?.headLabel.replace(/^\* /, "") ?? partner), "Only One Allowed");
      return false;
    }
    if (row.setup.field_validation.toLowerCase() === "sys.checkgststateid" && text.length > 0 && programId === 14 && meta.coGstReq) {
      const short = (await call<{ short: string }>("state-short", { stateName: addRows[index - 1]?.fieldInput ?? "" })).short;
      const gst = gstStateMismatch(text, short);
      if (gst.mismatch) { await ask("Gstin And State Not Match", row.setup.head_label); setAddText(gst.corrected); return false; }
    }
    if (row.setup.duplicate_chk) {
      if (row.setup.serverQueries.includes("duplicate_query")) {
        const result = await call<{ message: string }>("duplicate-query", { masterGrid: true, row: addEventRow(index, text) });
        if (result.message !== "") { await ask(result.message, "Warning"); return false; }
      } else if (duplicateAgainstUpdate(records, toText(row.setup.duplichk_fldname1) || row.fieldName, text, restore ? restore.row : null, addDuplicateGroup(row.setup))) {
        await ask("Duplicate value Found...", "Warning");
        if (restore) { setAdd(index, { fieldInput: "" }); setAddEditing(false); await cancelAdd(true); }
        return false;
      }
    }
    if (text !== "" && toText(row.setup.duplichk_fldname1) !== "" && help && help.rows.length > 0) {
      const f1 = row.setup.duplichk_fldname1.toLowerCase();
      const combo = toText(row.setup.dupliadd_combofld).toLowerCase();
      const group = addDuplicateGroup(row.setup);
      const hit = help.rows.findIndex((helpRecord, at) => {
        if (duplicateKey(cellOf(helpRecord, f1)) !== duplicateKey(text)) return false;
        if (group && !sameGroup(cellOf(helpRecord, group.field), group.value)) return false;
        // The record being restored is not its own duplicate (help rows follow the records only without a group).
        if (restore && (group ? duplicateKey(cellOf(records[restore.row], f1)) === duplicateKey(text) : restore.row === at)) return false;
        if (combo !== "") return cellOf(helpRecord, combo) === (first?.text ?? "") || cellOf(helpRecord, combo) === (first?.value ?? "");
        return true;
      });
      if (hit >= 0) { await ask("Duplicate Master Found...", "Warning"); return false; }
    }

    // ---- C1dg_MasterGrid_AfterEdit
    let fieldComboValue = row.fieldComboValue;
    if ((row.comboKind === "Q" || row.comboKind === "X") && row.options) {
      const option = row.options.find((candidate) => candidate.text === text);
      if (option && text.toLowerCase() !== "(blank)" && toInt(option.value) > 0) fieldComboValue = option.value;
    }
    const caseName = row.setup.style_case.toUpperCase();
    if (text !== "") {
      if (caseName === "P") text = styleCase(row.setup, text, licence);
      else if (caseName === "U" || caseName === "A") text = licence === 71 && row.comboKind === "N" ? styleCase({ ...row.setup, style_case: "P" }, text, licence) : caseName === "U" ? text.toUpperCase() : text;
      else if (caseName === "L") text = text.toLowerCase();
    }
    text = roundToPlaces(text, row.setup);
    if (row.setup.field_type === "D") {
      if (text === "") text = "";
      else { const date = parseDesktopDate(text); if (date) text = programId === 52 ? `${formatDesktopDate(date)} ${date.toTimeString().slice(0, 8)}` : formatDesktopDate(date); }
    }
    let nextRows = addRows.map((candidate, at) => (at === index ? { ...candidate, fieldInput: text, fieldComboValue } : candidate));
    setAddEditing(false);
    // The server queries read |sys.thiscombolistid| from the combo ids: they must include the id just
    // picked, which the state does not hold yet (so a first pick found nothing, and ENT_FRAME stayed blank).
    const freshBackup = Object.fromEntries(nextRows.map((candidate) => [candidate.fieldName.toLowerCase(), candidate.fieldComboValue]));
    if (row.setup.serverQueries.includes("onchange_repl_value_query")) {
      const values = await call<{ values: Record<string, string> }>("onchange", { masterGrid: true, row: { ...addEventRow(index, text), backup: freshBackup, values: Object.fromEntries(nextRows.map((candidate) => [candidate.fieldName.toLowerCase(), candidate.fieldInput])) } });
      nextRows = nextRows.map((candidate) => (candidate.fieldName.toLowerCase() in values.values ? { ...candidate, fieldInput: values.values[candidate.fieldName.toLowerCase()] } : candidate));
    }
    if (toText(row.setup.formula_for_table) === "uom_formula" && nextRows[index + 1]) {
      const value = (await call<{ value: string | null }>("uom-formula", { masterGrid: true, coreEntry: grids.coreEntry, row: { ...addEventRow(index, text), backup: freshBackup, values: Object.fromEntries(nextRows.map((candidate) => [candidate.fieldName.toLowerCase(), candidate.fieldInput])) } })).value;
      if (value !== null) nextRows = nextRows.map((candidate, at) => (at === index + 1 ? { ...candidate, fieldInput: value } : candidate));
    }
    if (text !== row.fieldInput) setAddChanged(true);
    for (const [at, candidate] of addRows.entries()) {
      const next = nextRows[at];
      if (!addOld.current.has(at) && (next.fieldInput !== candidate.fieldInput || next.fieldComboValue !== candidate.fieldComboValue)) addOld.current.set(at, { fieldInput: candidate.fieldInput, fieldComboValue: candidate.fieldComboValue });
    }
    setAddRows(nextRows);
    if (row.setup.field_add_order === grids.lastAddRow) document.getElementById("mp-save")?.focus();
    return true;
  };

  // ---- BlankOutGrid("IF") / Btn_Master_AddCancel_Click
  const blankAdd = () => { setAddChanged(false); addOld.current.clear(); setAddRows((current) => current.map((row) => {
    if (!row.setup.add_grid_visible) return row;
    let next = { ...row };
    if (!["Q", "X", "L"].includes(row.comboKind)) next.fieldInput = "";
    if ((row.comboKind === "Q" || row.comboKind === "X") && row.defaultText !== "" && (next.fieldInput === "" || next.fieldComboValue === "")) next = { ...next, fieldInput: row.defaultText, fieldComboValue: row.defaultValue };
    if (row.comboKind === "L" && next.fieldInput === "") next.fieldInput = row.setup.combo_list.slice(0, Math.max(0, row.setup.combo_list.indexOf("|")));
    return next;
  })); };
  const cancelAdd = async (silent = false) => {
    if (!silent && !restore && (await ask("Are You Sure Want To Cancel ? ", "Master Add Cancel", ["Yes", "No"])) !== "Yes") return;
    setRestore(null);
    blankAdd();
    setMessage("");
    setHotKeys("");
    setAddCursor(Math.max(0, addRows.findIndex((row) => row.visible)));
    if (grids?.updateTabVisible) setTab("update");
  };

  // ---- Btn_Master_AddSave_Click
  const saveAdd = async () => {
    if (!grids || !def || !group) return;
    if (addEditing && !(await addCommit())) return;
    let currentPasswords = passwords;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const answer = attempt === 0 ? await ask("Save Entry To Master Data ?", "Master Add Save", ["Yes", "No", "Cancel"]) : "Yes";
      if (answer === "Cancel") return;
      if (answer === "No") { blankAdd(); if (grids.updateTabVisible) setTab("update"); return; }
      setBusy("Saving");
      const result = await call<{ ok: boolean; message: string; needs?: string; warnings: string[]; cloud?: CloudPush }>("add-save", {
        restoreMode: restore !== null,
        rows: addRows.map((row) => ({ fieldName: row.fieldName, fieldInput: row.fieldInput, fieldComboValue: row.fieldComboValue, visible: row.visible, editable: addOpen(row) })),
        passwords: currentPasswords,
      }).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error), needs: undefined, warnings: [], cloud: undefined }));
      setBusy("");
      if (result.needs) {
        const typedPassword = await askPassword(result.message);
        if (typedPassword === null) return;
        currentPasswords = { ...currentPasswords, [result.needs]: typedPassword };
        setPasswords(currentPasswords);
        continue;
      }
      if (!result.ok) {
        if (result.message === "Master Save Not Allowed In View Mode") { await cancelAdd(true); await ask(result.message, "Master Validation"); return; }
        await ask(result.message, result.message.startsWith("Fill") ? "Empty Fields Found!!" : "Error Message");
        return;
      }
      setWarnings(result.warnings);
      if (result.cloud && (await ask("Save Master To Cloud?", "Save Cloud Message", ["Yes", "No"])) === "Yes") await sendToCloud(result.cloud);
      blankAdd();
      if (restore) keepRow.current = restore.row;
      await loadGroup(group.firstCombo, group.secondCombo);
      setTab(grids.updateTabVisible ? "update" : "add");
      return;
    }
  };

  // The pending moves above, run once the committed value is in the state they read.
  useEffect(() => {
    if (!addPendingMove.current || addEditing) return;
    const { from, step, skipClosed, edit } = addPendingMove.current;
    addPendingMove.current = null;
    let target = from;
    for (let at = from + step; at >= 0 && at < addRows.length; at += step) {
      if (addRows[at].visible && (!skipClosed || addOpen(addRows[at]))) { target = at; break; }
    }
    // Past the last open field, the Save button is next.
    if (target === from) { if (skipClosed && step === 1) document.getElementById("mp-save")?.focus(); return; }
    void addMoveTo(target).then((landed) => { if (edit && landed !== undefined) { addEditOnArrive.current = landed; nudgeRender(); } });
  });
  useEffect(() => {
    if (addEditOnArrive.current === null || addEditing || addCursor !== addEditOnArrive.current) return;
    addEditOnArrive.current = null;
    void Promise.resolve().then(() => addStartEdit());
  });
  useEffect(() => {
    if (!updatePendingMove.current || editing) return;
    const { row, key, step } = updatePendingMove.current;
    updatePendingMove.current = null;
    const next = nextEditable(row, key, step);
    if (next) void moveTo(next.row, next.key).then((moved) => { if (moved) void startEdit(undefined, next); });
  });
  useEffect(() => {
    if (updateGo.current === null || editing) return;
    const { row, key, edit } = updateGo.current;
    updateGo.current = null;
    void moveTo(row, key).then((moved) => { if (moved && edit) void startEdit(undefined, { row, key }); });
  });
  useEffect(() => {
    if (addGo.current === null || addEditing) return;
    const to = addGo.current;
    addGo.current = null;
    void addMoveTo(to);
  });
  // A grid coming into view starts on its first open field: the Update grid on the first row's first
  // editable column, the New grid on its first editable field with the editor already open.
  useEffect(() => {
    if (busy || !grids || arrivedTab.current === tab) return;
    arrivedTab.current = tab;
    if (tab === "update") {
      // Back from the New grid (Cancel, or Save of an edited row): stay on the row last worked on.
      const back = keepRow.current ?? (freshLoad.current ? null : cursor.row);
      const fresh = back === null;
      keepRow.current = null;
      freshLoad.current = false;
      const row = zoomAccode > 0 ? cursor.row : !fresh && shownRows.includes(back) ? back : shownRows[0];
      if (row === undefined) return;
      const stay = !fresh && row === cursor.row ? columns.find((candidate) => candidate.key === cursor.key && isEditable(row, candidate)) : undefined;
      const column = stay ?? columns.find((candidate) => isEditable(row, candidate)) ?? columns[0];
      if (!column) return;
      void Promise.resolve().then(() => { setCursor({ row, key: column.key }); gridFocus.current?.focus({ preventScroll: true }); });
    } else if (tab === "add") {
      const target = addRows.findIndex((row) => row.visible && addOpen(row));
      if (target < 0) return;
      addFocus.current?.focus({ preventScroll: true });
      void Promise.resolve().then(() => addMoveTo(target)).then((landed) => { if (landed !== undefined) { addEditOnArrive.current = landed; nudgeRender(); } });
    }
  });
  // The New (Add) grid's current row is always shown whole: scrolled into view as the cursor reaches it.
  useEffect(() => {
    document.querySelector(`.mp-add-grid [data-add-cell="${addCursor}"]`)?.closest("tr")?.scrollIntoView({ block: "nearest" });
  }, [addCursor]);

  // ---- New grid: Copy / Paste / Restore Old Value (the Update grid's menu, for one field at a time)
  const addCopy = async () => {
    const row = addRows[addCursor];
    if (!row) return;
    await navigator.clipboard?.writeText(row.fieldInput).catch(() => undefined);
    setCopied({ value: row.fieldInput, addonId: row.comboKind === "X" ? row.fieldComboValue : "0" });
  };
  const addPaste = async () => {
    const row = addRows[addCursor];
    if (!copied || !row || !grids) return;
    if (!addOpen(row) || !row.visible) { await ask(`Field : ${row.headLabel.replace(/^\* /, "")} is readonly`, "Invalid Paste Selection"); return; }
    if (row.comboKind === "M" ? !validKeyList(copied.value, row.options ?? [], "") : row.options && copied.value !== "" && !row.options.some((option) => option.text === copied.value)) {
      await ask(`Value = ${copied.value} isn't in the list of ${row.headLabel.replace(/^\* /, "")}`, "Invalid Paste Selection");
      return;
    }
    // The pasted value goes through the same checks as a typed one.
    setAddText(copied.value);
    if (await addCommit(copied.value)) addFocus.current?.focus({ preventScroll: true });
  };
  const addRestore = () => {
    const old = addOld.current.get(addCursor);
    if (!old || !addOpen(addRows[addCursor])) return;
    addOld.current.delete(addCursor);
    setAdd(addCursor, old);
  };

  const addKeys = async (event: ReactKeyboardEvent) => {
    if (isMessageBoxOpen() || !grids) return;
    const row = addRows[addCursor];
    const nextVisible = (from: number, step: number) => {
      for (let at = from + step; at >= 0 && at < addRows.length; at += step) if (addRows[at].visible) return at;
      return from;
    };
    // The combo list's search box handles its own keys (typing, arrows, Enter, Tab, Esc).
    if (addEditing && (event.target as Element).closest(".mp-grid-combo-field")) return;
    if (addEditing) {
      // Esc undoes what was typed: the row keeps the value it had before editing began.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAddEditing(false); addFocus.current?.focus({ preventScroll: true }); return; }
      if (row && tools.keys(event, editorKindOf(row.setup.field_type), addText, setAddText, row.setup.decimal_points)) return;
      if (event.key === "Enter" || event.key === "Tab" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.target instanceof HTMLSelectElement && (event.key === "ArrowDown" || event.key === "ArrowUp")) return;
        event.preventDefault();
        const step = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
        // Enter and Tab go on to the next open field and start editing it; the arrow keys only move.
        const onward = event.key === "Enter" || event.key === "Tab";
        if (await addCommit()) { addFocus.current?.focus(); setAddPendingMove({ from: addCursor, step, skipClosed: onward, edit: onward }); }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && row && event.target instanceof HTMLInputElement) {
        const key = fitCase(row.setup, event.key, programId);
        const outcome = keyPress({ setup: row.setup, masterGrid: true, programId, licence, cellValue: row.fieldInput, editorText: addText, remainingText: remainingAfterKey(event.target), yearStart: yearStartText }, key);
        if (outcome.refused) event.preventDefault();
        else if (key !== event.key) {
          event.preventDefault();
          typeAtCaret(event.target, key, (after) => { if (typingAllowed(row.setup, addText, after)) setAddText(after); });
        }
        if (outcome.message) await ask(outcome.message, "Character Not Allowed");
        if (outcome.replaceWith !== undefined) setAddText(outcome.replaceWith);
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const letter = event.key.toLowerCase();
      if (letter === "c") { event.preventDefault(); await addCopy(); return; }
      if (letter === "v") { event.preventDefault(); await addPaste(); return; }
      if (letter === "z") { event.preventDefault(); addRestore(); return; }
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); await addMoveTo(nextVisible(addCursor, 1)); return;
      case "Enter": event.preventDefault(); if (addOpen(row)) await addStartEdit(); else setAddPendingMove({ from: addCursor, step: 1, skipClosed: true, edit: true }); return;
      case "ArrowUp": event.preventDefault(); await addMoveTo(nextVisible(addCursor, -1)); return;
      case "F2": event.preventDefault(); await addStartEdit(); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && addOpen(row) && row?.options) {
      event.preventDefault();
      setAddComboStart(event.key);
      await addStartEdit();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && addOpen(row)) {
      event.preventDefault();
      const key = fitCase(row.setup, event.key, programId);
      const outcome = keyPress({ setup: row.setup, masterGrid: true, programId, licence, cellValue: row.fieldInput, editorText: "", yearStart: yearStartText }, key);
      if (outcome.message) { await ask(outcome.message, "Character Not Allowed"); return; }
      if (outcome.replaceWith !== undefined) { setAdd(addCursor, { fieldInput: outcome.replaceWith }); setAddChanged(true); return; }
      if (!outcome.refused) await addStartEdit(key);
    }
  };

  // Master_ProgramGrid_KeyUp / Cmb_Master_GroupFld_KeyPress: Escape asks to leave.
  const leave = async () => {
    if ((await ask("Returning To Main Menu ? ", "Confirmation", ["Yes", "No"])) === "Yes") onClose();
  };

  // Master_ProgramGrid_KeyUp: Escape anywhere outside an editor or message asks to leave.
  const escapeState = useRef({ editing, addEditing, leave, licence, close: onClose, busyElsewhere: false });
  useEffect(() => { escapeState.current = { editing, addEditing, leave, licence, close: onClose, busyElsewhere: typed !== "" || openFilter !== null || columnChooser || tools.open || output.open || logTable !== null }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = escapeState.current;
      // An Esc something else already used (closing an editor, a list, a message) is not a request to leave:
      // by the time it gets here that editor has closed, so its state alone cannot tell.
      if (event.key === "Escape" && !event.defaultPrevented && !state.editing && !state.addEditing && !isMessageBoxOpen() && !state.busyElsewhere) void state.leave();
      if (event.key === "Pause" && PAUSE_EXIT_LICENCES.includes(state.licence)) state.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ======================================================================================

  if (!selection) return null;
  if (fatal) return <div className="mp-screen"><div className="mp-fatal">{fatal}</div></div>;

  const firstCombo = def?.firstCombo;
  const visibleRows = shownRows;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const endIndex = Math.min(visibleRows.length, startIndex + Math.ceil(viewport / ROW_HEIGHT) + 10);
  const frozenCount = grids ? Math.min(grids.frozen, columns.length) : 0;
  const frozenLeft: number[] = [];
  columns.reduce((left, column, index) => { frozenLeft[index] = left; return left + widthOf(column); }, INDICATOR_WIDTH);
  const cursorColumn = columnByKey.get(cursor.key);
  const pickedRows = new Set(selectionEnd === null ? [] : selectedRows());
  /**
   * Update grid, as Excel's status bar: with two or more rows selected on a number column
   * (quantity, rate, amount; not a list or key column), the sum, count and average of the
   * selected cells that hold a value. Gone once the selection is.
   */
  const selectionTotals = (() => {
    if (tab !== "update" || editing || pickedRows.size < 2 || !cursorColumn) return null;
    const { setup } = cursorColumn;
    const list = ["L", "Q", "X"].includes(setup.combo_value.trim().toUpperCase()) || cursorColumn.comboKind === "M";
    if (list || !isNumberSetup(setup)) return null;
    return totalsOf([...pickedRows].map((row) => cellOf(records[row], cursorColumn.key)), decimalsOf(cursorColumn));
  })();
  /** The help list window: centred on one entry, with a note under the title for the New Add grid. */
  const helpWindow = (focusRow: number, onFocusRow: (row: number) => void, searchKey: string, note: { text: string; warn: boolean } | null) => {
    if (!shownHelp || shownHelp.columns.length === 0) return null;
    const backToGrid = () => {
      const editor = document.querySelector<HTMLElement>(".mp-editor");
      (editor ?? (tab === "add" ? addFocus.current : gridFocus.current))?.focus({ preventScroll: true });
    };
    return (
      <HelpList
        help={shownHelp}
        focusRow={focusRow}
        onFocusRow={onFocusRow}
        searchKey={searchKey}
        note={note}
        onClose={tab === "update" ? () => { setHelpRow(null); backToGrid(); } : undefined}
        onEscape={backToGrid}
        style={helpDrag.style}
        dragHandle={helpDrag.handle}
        onResetPosition={helpDrag.reset}
        formatCell={formatCell}
        shown={HELP_ROWS}
      />
    );
  };
  const filtering = Object.keys(filters).length > 0 || find.trim() !== "" || sort !== null;
  return (
    <div ref={screenRef} className={`mp-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.heading || title}>
      <div className="mp-combos">
        {firstCombo && (
          <div className="mp-combo">
            <span>{firstCombo.label}</span>
            {/* Type to search; Enter or a click chooses, Enter on an unchanged box loads it again. */}
            <SearchCombo
              ariaLabel={firstCombo.label}
              options={firstCombo.options}
              value={first}
              reselect
              disabled={Boolean(grids) || Boolean(busy)}
              focus={!locked && !grids && !secondOptions}
              onChoose={chooseFirst}
            />
          </div>
        )}
        {secondOptions && (
          <div className="mp-combo">
            <span>Select</span>
            <SearchCombo
              ariaLabel="Select"
              options={secondOptions}
              value={second}
              placeholder="Select…"
              disabled={Boolean(grids) || Boolean(busy)}
              focus={!locked && !grids}
              onChoose={(option) => { setSecond(option); if (first) void loadGroup(first, option); }}
            />
          </div>
        )}
        {first && !grids && !secondOptions && <button type="button" data-hotkey="h" aria-keyshortcuts="Alt+H" className="mp-btn mp-btn-blue" onClick={() => void loadGroup(first, second)} disabled={Boolean(busy)}><Icon name="list" /><HotkeyLabel text="Show" hotkey="h" /></button>}
        {/* Before a group is shown the button bar is not there yet, so this is the way out of a master opened by mistake. */}
        {!grids && <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red" onClick={() => void leave()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>}
        {grids && (
          <div className="mp-views" role="tablist" aria-label="Master view">
            {grids.addTabVisible && tab !== "add" && <button type="button" data-hotkey="n" aria-keyshortcuts="Alt+N" role="tab" aria-selected={false} className="mp-btn mp-btn-green mp-btn-big" onClick={() => setTab("add")}><Icon name="plus" /><HotkeyLabel text="New Add" hotkey="n" /></button>}
            {grids.addTabVisible && tab === "add" && <span className="mp-view-now">{restore ? "View (Restore)" : "New Add"}</span>}
            {grids.updateTabVisible && tab !== "update" && <button type="button" data-hotkey="u" aria-keyshortcuts="Alt+U" role="tab" aria-selected={false} className="mp-btn mp-btn-blue mp-btn-big" onClick={() => { setTab("update"); setHotKeys(grids.addTabVisible ? "Press F4 Key For Update Grid Vertical Display" : ""); }}><Icon name="list" /><HotkeyLabel text="Update / Delete" hotkey="u" /></button>}
            {imageTab && tab !== "image" && <button type="button" data-hotkey="i" aria-keyshortcuts="Alt+I" role="tab" aria-selected={false} className="mp-btn mp-btn-blue mp-btn-big" onClick={() => setTab("image")}><Icon name="image" /><HotkeyLabel text="Image" hotkey="i" /></button>}
            {/* With both grids it cancels both. With one (no New grid: add_screen_hidden, as Invoice Slab; or no Update grid: none, or no records) it stays open as the way back to the first combo. */}
            <button type="button" data-hotkey="b" aria-keyshortcuts="Alt+B" className="mp-btn mp-btn-red mp-btn-big" title="Alt+B" onClick={() => void cancelAll()}><Icon name="cancel" /><HotkeyLabel text={grids.addTabVisible && grids.updateTabVisible && records.length > 0 ? "Cancel Both (Add And Update)" : "Cancel & Change Group"} hotkey="b" /></button>
          </div>
        )}
        {busy && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">
          {def?.heading || title}
          {def && def.rights.restricted ? ` · Rights: ${def.rights.add ? "Add " : ""}${def.rights.edit ? "Edit " : ""}${def.rights.delete ? "Delete" : ""}` : ""}
        </span>
      </div>


      {grids && tab === "add" && (
        <div className="mp-add" ref={addFocus} role="grid" aria-label="New (Add)" tabIndex={0} onKeyDown={(event) => void addKeys(event)}>
          {addMore.up > 0 && (
            <button type="button" tabIndex={-1} className="mp-add-more mp-add-more-up" title="Scroll up" onMouseDown={(event) => event.preventDefault()} onClick={() => scrollAdd(-1)}>
              ▲ {addMore.up} {addMore.up === 1 ? "row" : "rows"} up
            </button>
          )}
          <table className="mp-add-grid" ref={addTable} onScroll={measureAddMore}>
            <thead><tr><th className="mp-add-head">Heading</th><th>Input</th></tr></thead>
            <tbody>
              {addRows.map((row, index) => row.visible && (
                <tr key={`${row.fieldName}-${index}`} onContextMenu={(event) => {
                  if (addEditing) return;
                  event.preventDefault();
                  if (index !== addCursor) void addMoveTo(index);
                  setAddMenu({ x: event.clientX, y: event.clientY });
                }} className={`${index === addCursor ? "mp-current" : ""} ${index <= addFrozenUpTo ? "mp-add-frozen" : ""} ${index === addFrozenUpTo ? "mp-add-frozen-last" : ""}`}>
                  <td role="gridcell" onClick={() => void addMoveTo(index)} onDoubleClick={() => void addStartEdit()} title={[row.editable ? "" : "Read-only", row.addon ? "Addon field" : ""].filter(Boolean).join(" · ") || undefined} className={`mp-add-head ${row.editable ? "" : "mp-head-readonly"} ${row.setup.program_top_id === 48 || row.setup.program_top_id === 49 ? "mp-yellow" : ""} ${row.addon ? "mp-head-addon" : ""}`}>{row.headLabel}</td>
                  <td role="gridcell" data-add-cell={index} aria-readonly={!addOpen(row)} title={tooltipText(row.setup.field_tooltips) || undefined} style={{ textAlign: alignOf(row.setup.add_grid_align) }} onClick={() => void addMoveTo(index)} onDoubleClick={() => void addStartEdit()} className={`${addOpen(row) ? "" : row.editable ? "mp-readonly mp-row-closed" : "mp-readonly"} ${row.styleName}`}>
                    {addEditing && index === addCursor ? (
                      row.comboKind === "M" ? (
                        <GridMultiPick
                          options={row.options ?? []}
                          current={addText}
                          startWith={addComboStart}
                          place={addComboAt}
                          onPick={(keys, step) => void finishAddCombo(keys, step)}
                          onCancel={() => { setAddComboStart(""); setAddEditing(false); addFocus.current?.focus({ preventScroll: true }); }}
                        />
                      ) : row.options ? (
                        <GridCombo
                          options={row.options}
                          current={addText}
                          startWith={addComboStart}
                          place={addComboAt}
                          onPick={(text, step) => void finishAddCombo(text, step)}
                          onCancel={() => { setAddComboStart(""); setAddEditing(false); addFocus.current?.focus({ preventScroll: true }); }}
                        />
                      ) : (
                        <span className="mp-editor-wrap" role="presentation" onClick={(event) => event.stopPropagation()}>
                          <input ref={focusOnMount} className="mp-editor" style={{ textAlign: alignOf(row.setup.add_grid_align) }} type={row.setup.force_inputtype === "P" ? "password" : "text"} inputMode={isNumberSetup(row.setup) ? "decimal" : undefined} data-own-alt-keys={isNumberSetup(row.setup) ? "c" : undefined} value={addText} onChange={(event) => { if (typingAllowed(row.setup, addText, event.target.value)) setAddText(event.target.value); }} onKeyDown={(event) => void addKeys(event)} />
                          {tools.buttons(editorKindOf(row.setup.field_type), addText, setAddText, row.setup.decimal_points)}
                        </span>
                      )
                    ) : row.setup.force_inputtype === "P" && row.fieldInput !== "" ? "*********" : row.comboKind === "M" ? keyListNames(row.fieldInput, row.options) : row.fieldInput}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {addMenu && (
            <div className="mp-menu" style={{ left: addMenu.x, top: addMenu.y }} onMouseLeave={() => setAddMenu(null)}>
              <button type="button" onClick={() => { setAddMenu(null); void addCopy(); }}>Copy (Ctrl+C)</button>
              <button type="button" disabled={!copied || !addOpen(addRows[addCursor])} onClick={() => { setAddMenu(null); void addPaste(); }}>Paste (Ctrl+V)</button>
              <button type="button" disabled={!addOld.current.has(addCursor) || !addOpen(addRows[addCursor])} onClick={() => { setAddMenu(null); addRestore(); }}>Restore Old Value (Ctrl+Z)</button>
            </div>
          )}
          {addHelp && helpWindow(addHelpPick?.key === addHelpKey ? addHelpPick.row : addHelp.row, (row) => setAddHelpPick({ row, key: addHelpKey }), toText(addRows[addCursor]?.setup.duplichk_fldname1).toLowerCase(), addHelp.typed === ""
            ? { text: "Existing entries (type to search)", warn: false }
            : addHelp.exact
              ? { text: `"${addHelp.typed}" already exists`, warn: true }
              : addHelp.row >= 0
                ? { text: `Nearest existing entry for "${addHelp.typed}"`, warn: false }
                : { text: `No existing entry starts with "${addHelp.typed}"`, warn: false })}
        </div>
      )}

      {grids && tab === "update" && (
        <div className="mp-update">
          <div
            className="mp-scroll"
            ref={scroller}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div
              ref={gridFocus}
              tabIndex={0}
              role="grid"
              aria-label="Update / Delete"
              aria-rowcount={visibleRows.length}
              className="mp-grid"
              style={{ height: (visibleRows.length + 1) * ROW_HEIGHT }}
              onKeyDown={(event) => void gridKeys(event)}
              onContextMenu={(event) => {
                event.preventDefault();
                // The menu acts on the cell clicked: the cursor goes there first.
                const cell = (event.target as Element).closest("[data-cell]")?.getAttribute("data-cell");
                if (cell) {
                  const split = cell.indexOf(":");
                  const row = Number(cell.slice(0, split));
                  const key = cell.slice(split + 1);
                  if (row !== cursor.row || key !== cursor.key) void moveTo(row, key);
                }
                setMenu({ x: event.clientX, y: event.clientY });
              }}
            >
              <div className="mp-row mp-head" style={{ top: 0 }}>
                <div className="mp-cell mp-rownum" aria-hidden="true" />
                {columns.map((column, index) => {
                  return (
                    <div
                      key={column.key}
                      draggable={openFilter === null && !fixedKeys.includes(column.key)}
                      onDragStart={(event) => { dragColumn.current = column.key; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", column.caption); }}
                      onDragOver={(event) => {
                        if (dragColumn.current === null || dragColumn.current === column.key || fixedKeys.includes(column.key)) return;
                        event.preventDefault();
                        const box = event.currentTarget.getBoundingClientRect();
                        const after = event.clientX > box.left + box.width / 2;
                        if (dropMark?.key !== column.key || dropMark.after !== after) setDropMark({ key: column.key, after });
                      }}
                      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropMark((current) => (current?.key === column.key ? null : current)); }}
                      onDrop={(event) => { event.preventDefault(); if (dragColumn.current && dropMark) moveColumn(dragColumn.current, column.key, dropMark.after); dragColumn.current = null; setDropMark(null); }}
                      onDragEnd={() => { dragColumn.current = null; setDropMark(null); }}
                      className={`mp-cell ${dropMark?.key === column.key ? (dropMark.after ? "mp-drop-after" : "mp-drop-before") : ""} ${index < frozenCount ? "mp-frozen" : ""} ${filters[column.key] ? "mp-filtered" : ""} ${column.editable ? "" : "mp-head-readonly"} ${rowRuled(column) ? "mp-head-rowruled" : ""} ${column.setup.program_top_id === 48 || column.setup.program_top_id === 49 ? "mp-yellow" : ""} ${column.addon ? "mp-head-addon" : ""}`} style={{ width: widthOf(column), textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left", ...(index < frozenCount ? { left: frozenLeft[index] } : {}) }} title={`${column.caption}${column.editable ? (rowRuled(column) ? " (editable on some rows only; grey cells are closed)" : "") : " (read-only)"}${column.addon ? " · addon field" : ""} · click to sort · ▾ to filter · drag the edge to resize`}>
                      <button type="button" className="mp-head-label" onClick={() => setSort((current) => (current?.key === column.key && current.dir === "asc" ? { key: column.key, dir: "desc" } : current?.key === column.key ? null : { key: column.key, dir: "asc" }))}>
                        {column.caption}{sort?.key === column.key && <i>{sort.dir === "asc" ? " ▲" : " ▼"}</i>}
                      </button>
                      <FilterButton caption={column.caption} onOpen={() => openFilterFor(column)} />
                      <FilterPopup state={columnFilters} columnKey={column.key} caption={column.caption} kind={filterKind(column)} values={openFilter === column.key ? valuesOf(column) : []} area={scroller} />
                      {layout.resizeHandle(column)}
                    </div>
                  );
                })}
              </div>
              {visibleRows.slice(startIndex, endIndex).map((row, offset) => {
                const record = records[row];
                const position = startIndex + offset;
                const inSelection = pickedRows.has(row);
                return (
                  <div key={row} className={`mp-row ${position % 2 ? "mp-alt" : ""} ${row === cursor.row ? "mp-current-row" : ""} ${edited.has(row) ? "mp-edited" : ""} ${inSelection ? "mp-selected" : ""}`} style={{ top: (position + 1) * ROW_HEIGHT }}>
                    <div className="mp-cell mp-rownum" aria-hidden="true">{row === cursor.row ? "▶" : edited.has(row) ? "✎" : ""}</div>
                    {columns.map((column, index) => {
                      const current = row === cursor.row && column.key === cursor.key;
                      const editable = isEditable(row, column);
                      return (
                        <div
                          key={column.key}
                          role="gridcell"
                          data-cell={`${row}:${column.key}`}
                          tabIndex={-1}
                          aria-selected={current}
                          aria-readonly={!editable}
                          className={`mp-cell ${index < frozenCount ? "mp-frozen" : ""} ${current ? "mp-current" : ""} ${editable ? "" : column.editable ? "mp-readonly mp-row-closed" : "mp-readonly"} ${editable && column.options?.length ? "mp-combo-cell" : ""}`}
                          style={{ width: widthOf(column), textAlign: column.align === "R" || column.format.startsWith("#") || column.format === "N2" ? "right" : column.align === "C" ? "center" : "left", ...(index < frozenCount ? { left: frozenLeft[index] } : {}) }}
                          onMouseDown={(event) => {
                            // While a cell is open the keyboard stays in its editor, so a refused
                            // value's message hands it straight back there; otherwise the grid has it.
                            if (editing && current) return; // a click inside the open editor just places the caret
                            // The cell itself never takes the keyboard: once it scrolled out of view it would
                            // vanish and take the keyboard with it.
                            event.preventDefault();
                            if (!editing) gridFocus.current?.focus({ preventScroll: true });
                            if (event.shiftKey) { setSelectionEnd(row); return; }
                            // A right-click inside the selection keeps it, for Copy / Paste / Delete on the menu.
                            if (event.button !== 0 && pickedRows.has(row)) return;
                            if (event.button === 0) dragSelect.current = true;
                            if (row !== cursor.row) { findMode.current = true; setTyped(""); }
                            void moveTo(row, column.key);
                          }}
                          onDoubleClick={() => void startEdit()}
                          // Dragging down (or up) with the left button held selects those rows.
                          onMouseEnter={(event) => { if (dragSelect.current && event.buttons === 1 && !editing && row !== (selectionEnd ?? cursor.row)) setSelectionEnd(row === cursor.row ? null : row); }}
                        >
                          {current && editing ? (
                            column.comboKind === "M" ? (
                              <GridMultiPick
                                options={column.options ?? []}
                                current={editText}
                                startWith={comboStart}
                                place={comboAt}
                                onPick={(keys, step) => void finishCombo(keys, step)}
                                onCancel={() => { setEditing(false); gridFocus.current?.focus({ preventScroll: true }); }}
                              />
                            ) : column.options ? (
                              <GridCombo
                                options={column.options}
                                current={editText}
                                startWith={comboStart}
                                place={comboAt}
                                onPick={(text, step) => void finishCombo(text, step)}
                                onCancel={() => { setEditing(false); gridFocus.current?.focus({ preventScroll: true }); }}
                              />
                            ) : (
                              <span className="mp-editor-wrap">
                                <input ref={focusOnMount} className="mp-editor" type={column.setup.force_inputtype === "P" ? "password" : "text"} inputMode={isNumberSetup(column.setup) ? "decimal" : undefined} data-own-alt-keys={isNumberSetup(column.setup) ? "c" : undefined} value={editText} onChange={(event) => { if (!typingAllowed(column.setup, editText, event.target.value)) return; setEditText(event.target.value); followHelp(column.key, event.target.value); }} onKeyDown={(event) => void editorKeys(event)} />
                                {tools.buttons(editorKindOf(column.setup.field_type), editText, setEditText, column.setup.decimal_points)}
                              </span>
                            )
                          ) : (
                            <>
                              {column.comboKind === "M" ? shownText(record, column) : formatCell(cellOf(record, column.key), column.format)}
                              {editable && column.options?.length ? (
                                <span className="mp-combo-arrow" role="presentation" title="Show the list (Alt+↓ or F4)"
                                  onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); void openCombo(row, column.key); }}>
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
          {help && helpRow !== null && cursorColumn && isMainField(cursorColumn.setup) && helpWindow(helpRow, setHelpRow, helpSearchKey(cursorColumn.setup), null)}
          {menu && (
            <div className="mp-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
              <button type="button" onClick={() => { setMenu(null); void copyCell(); }}>Copy</button>
              <button type="button" disabled={!copied} onClick={() => { setMenu(null); void pasteCell(); }}>Paste</button>
              <button type="button" disabled={fixedKeys.includes(cursor.key)} title={fixedKeys.includes(cursor.key) ? "A frozen column cannot be hidden" : undefined} onClick={() => { setMenu(null); hideColumn(cursor.key); }}>Hide Column</button>
              <button type="button" disabled={hiddenColumns.length === 0} onClick={() => { setMenu(null); setHiddenColumns((current) => current.slice(0, -1)); }}>Visible Column</button>
              <button type="button" disabled={fixedKeys.includes(cursor.key) || columns[fixedKeys.length]?.key === cursor.key} onClick={() => { setMenu(null); shiftColumn(cursor.key, -1); }}>Move Column Left (Ctrl+Shift+←)</button>
              <button type="button" disabled={fixedKeys.includes(cursor.key) || columns[columns.length - 1]?.key === cursor.key} onClick={() => { setMenu(null); shiftColumn(cursor.key, 1); }}>Move Column Right (Ctrl+Shift+→)</button>
              <button type="button" disabled={columnOrder.length === 0} onClick={() => { setMenu(null); setColumnOrder([]); }}>Reset Column Order</button>
              <button type="button" onClick={() => { setMenu(null); setColumnChooser(true); }}>Arrange Columns (Show / Hide / Move)…</button>
              <button type="button" disabled={hiddenColumns.length === 0} onClick={() => { setMenu(null); setHiddenColumns([]); }}>Show All Columns</button>
              <button type="button" onClick={() => { setMenu(null); restoreCell(cursor.row, cursor.key); }}>Restore Cell Value (Ctrl+Z)</button>
              <button type="button" onClick={() => { setMenu(null); void deleteSelected("row"); }}>Delete Row</button>
              <button type="button" onClick={() => { setMenu(null); void deleteSelected("selection"); }}>Delete Selection</button>
            </div>
          )}
        </div>
      )}

      {grids && tab === "image" && (
        <div className="mp-image">
          {image && imageProduct > 0 ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL read from product_image
            <><img src={image.dataUrl} alt={image.fileName || "Product image"} /><span>{image.fileName}</span></>
          ) : <span className="mp-image-empty">No image for this {programId === 8 ? "product" : "record"}</span>}
        </div>
      )}

      {logTable && (
        <div className="mp-dialog-backdrop" role="presentation">
          <div className="mp-dialog mp-log" role="dialog" aria-modal="true" aria-label={`${first?.text ?? ""} Log`}>
            <strong>{first?.text} Log</strong>
            <div className="mp-log-scroll">
              <table>
                <thead><tr>{logTable.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>
                  {(() => { const colours = logColours(logTable); return logTable.rows.map((row, index) => <tr key={index}>{row.map((value, at) => <td key={at} className={colours[index][at]}>{value}</td>)}</tr>); })()}
                </tbody>
              </table>
            </div>
            <div className="mp-dialog-buttons">
              <button type="button" onClick={() => exportLog(logTable)}>Export to EXCEL</button>
              <button type="button" ref={focusOnMount} onClick={() => setLogTable(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {grids && (
        tab === "update" ? (
          <GridButtons
            source="master"
            busy={Boolean(busy)}
            save={{ onClick: () => void saveUpdate(), disabled: edited.size === 0 }}
            output={output}
            refresh={{ onClick: () => void refreshUpdate() }}
            cancel={{ onClick: () => void cancelUpdate() }}
            quit={{ onClick: () => void leave() }}
            log={meta?.logFileSpecial ? { onClick: () => void showLog(), disabled: !grids.pkvKey } : undefined}
            arrange={{ onClick: () => setColumnChooser(true), hidden: hiddenColumns.length }}
            extra={<>
              {(programId === 39 || programId === 50) && SCHEME_BOXES.filter((box) => programId === 39 || box.name === "temproute").map((box) => (
                <input
                  key={box.name}
                  className="mp-scheme-box"
                  aria-label={programId === 50 ? "Change rate: +, -, *, / or % then a figure" : box.label}
                  placeholder={programId === 50 ? "Rate +-*/%" : box.label}
                  value={schemeBoxes[box.name] ?? ""}
                  onChange={(event) => setSchemeBoxes((current) => ({ ...current, [box.name]: event.target.value }))}
                  onBlur={(event) => applySchemeBox(box.name, event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                />
              ))}
            </>}
            search={{ id: "mp-find", value: find, onChange: setFind, onEnter: findNext }}
            clearFilters={filtering ? () => { setFilters({}); setFind(""); setSort(null); } : null}
            count={`${shownRows.length === liveRows.length ? `${liveRows.length} records` : `${shownRows.length} of ${liveRows.length}`}${edited.size ? ` · ${edited.size} changed` : ""}${deleted.size ? ` · ${deleted.size} to delete` : ""}`}
          />
        ) : tab === "add" ? (
          <GridButtons
            source="master"
            busy={Boolean(busy)}
            save={{ onClick: () => void saveAdd(), disabled: def ? !def.rights.add : true }}
            print={printsMasterSheet ? { onClick: printMasterSheet } : undefined}
            cancel={{ onClick: () => void cancelAdd() }}
            quit={{ onClick: () => void leave() }}
          >
            {/* In the button bar under the grid's right edge, not in a strip of its own, so the grid has room for one more row. */}
              {addMore.down > 0 && (
                <button type="button" tabIndex={-1} className="mp-add-more mp-add-more-down" title="Scroll down" onMouseDown={(event) => event.preventDefault()} onClick={() => scrollAdd(1)}>
                  ▼ {addMore.down} {addMore.down === 1 ? "row" : "rows"} down
                </button>
              )}
          </GridButtons>
        ) : (
          <GridButtons source="master" quit={{ onClick: () => void leave() }} />
        )
      )}

      {output.dialogs}

      {columnChooser && grids && (
        <ArrangeColumns
          items={layout.arrangeItems((column) => column.caption)}
          changed={columnOrder.length > 0}
          onMove={placeColumn}
          onToggle={layout.toggleColumn}
          onShowAll={() => setHiddenColumns([])}
          onResetOrder={() => setColumnOrder([])}
          onClose={() => { setColumnChooser(false); keepGridFocus(); }}
        />
      )}

      {tools.popups}

      <div className="mp-status">
        <span>{rowStatus}</span>
        <span className="mp-message">{typed ? `Find in ${cursorColumn?.caption ?? ""}: ${typed}  (Enter to edit · Backspace · Esc)` : message}</span>
        {selectionTotals && <span className="mp-sel-totals" title={`Selected rows of ${cursorColumn?.caption ?? ""}`}>{selectionTotals}</span>}
        <span>{(() => {
          const setup = editing ? cursorColumn?.setup : addEditing ? addRows[addCursor]?.setup : undefined;
          return (setup && tools.hint(editorKindOf(setup.field_type))) || hotKeys;
        })()}</span>
        {warnings.length > 0 && <span className="mp-warn" title={warnings.join("\n")}>{warnings.length} setup query warning{warnings.length === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}
