"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import type { StartupSelection } from "../startup/StartupGate";
import { applyPermission, formatDesktopDate, formatDesktopTime, getPermission, parseDesktopDate, runFormula, toDecimal, toInt, toText } from "../../lib/master-program/legacy";
import type { AddRow, CloudPush, ComboOption, GroupLoad, GroupState, ProgramDefinition, UpdateColumn, UpdateRecord } from "../../lib/master-program/types";
import { masterCall } from "./api";
import { carryString, dateOutsideYear, duplicateAgainstUpdate, duplicateInGrid, gstStateMismatch, keyPress, styleCase, validate } from "./rules";

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
type DialogButton = "OK" | "Yes" | "No" | "Cancel";
type Dialog = { title: string; message: string; buttons: DialogButton[]; input?: boolean; resolve: (answer: DialogButton, text?: string) => void };
type HelpState = Awaited<ReturnType<typeof fetchHelp>>;

const ROW_HEIGHT = 22;
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

async function fetchHelp(selection: StartupSelection, programName: string, group: GroupState) {
  const body = await masterCall<{ help: { columns: { key: string; caption: string; width: number; align: string; format: string }[]; rows: Record<string, string>[]; frozen: number; total: string } | null }>(selection, programName, "help", {}, group);
  return body.help;
}

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
  const [firstTyped, setFirstTyped] = useState("");
  const [secondOptions, setSecondOptions] = useState<readonly ComboOption[] | null>(null);
  const [second, setSecond] = useState<ComboOption | null>(null);
  const [grids, setGrids] = useState<Grids | null>(null);
  const [tab, setTab] = useState<"add" | "update" | "image">("update");
  const [busy, setBusy] = useState("Loading");
  const [rowStatus, setRowStatus] = useState("");
  const [message, setMessage] = useState("");
  const [hotKeys, setHotKeys] = useState("");
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  // Add grid (c1dg_MasterGrid)
  const [addRows, setAddRows] = useState<AddState[]>([]);
  const [addCursor, setAddCursor] = useState(0);
  const [addEditing, setAddEditing] = useState(false);
  const [addText, setAddText] = useState("");
  const [restore, setRestore] = useState<{ row: number } | null>(null);

  // Update grid (c1dg_UpdateGrid + c1_Update_Backup)
  const [records, setRecords] = useState<UpdateRecord[]>([]);
  const [backup, setBackup] = useState<UpdateRecord[]>([]);
  const [edited, setEdited] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [cellEditable, setCellEditable] = useState<Record<string, boolean>>({});
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [cursor, setCursor] = useState<Cell>({ row: 0, key: "" });
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [dataAtBegin, setDataAtBegin] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState<{ value: string; addonId: string } | null>(null);
  const [find, setFind] = useState("");
  const [typed, setTyped] = useState("");
  const [help, setHelp] = useState<HelpState>(null);
  const [helpRow, setHelpRow] = useState<number | null>(null);
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

  const group: GroupState | null = useMemo(() => (first ? { firstCombo: first, secondCombo: second } : null), [first, second]);
  /** Focuses an editor when it mounts, which is what C1FlexGrid does when editing starts. */
  const focusOnMount = useCallback((element: HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null) => { element?.focus(); }, []);
  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) return Promise.reject(new Error("No company is open"));
    return masterCall<T>(selection, programName, action, { menuShortName, ...payload }, group ?? undefined);
  }, [selection, programName, menuShortName, group]);

  /** CustomMessageBoxForm, as a promise. */
  const ask = useCallback((text: string, heading: string, buttons: DialogButton[] = ["OK"]) => new Promise<DialogButton>((resolve) => {
    setDialog({ title: heading, message: text, buttons, resolve: (answer) => { setDialog(null); resolve(answer); } });
  }), []);
  const askPassword = useCallback((heading: string) => new Promise<string | null>((resolve) => {
    setDialog({ title: heading, message: "Enter Password", buttons: ["OK", "Cancel"], input: true, resolve: (answer, text) => { setDialog(null); resolve(answer === "OK" ? text ?? "" : null); } });
  }), []);

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
      setAddRows(load.addRows.map((row) => ({ ...row, recFound: false, compulsory: row.setup.value_compulsory })));
      setRecords(load.records.map((record) => ({ ...record })));
      setBackup(load.backup.map((record) => ({ ...record })));
      setEdited(new Set());
      setDeleted(new Set());
      setCellEditable({});
      setHiddenColumns([]);
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
  }, [selection, def, programName, menuShortName, ask, zoomAccode]);

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

  // ---- BtnCancelAddUpdate_Click
  const cancelAll = async () => {
    if ((await ask("Are You Sure Want To Cancel ? ", "Master Cancel", ["Yes", "No"])) !== "Yes") return;
    setGrids(null);
    setRecords([]);
    setBackup([]);
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

  const columns = useMemo(() => (grids?.columns ?? []).filter((column) => column.visible && !hiddenColumns.includes(column.key)), [grids, hiddenColumns]);
  const columnByKey = useMemo(() => new Map((grids?.columns ?? []).map((column) => [column.key, column])), [grids]);
  const columnByField = useCallback((name: string) => (grids?.columns ?? []).find((column) => column.key.toLowerCase() === lower(name)), [grids]);
  const liveRows = useMemo(() => records.map((_, index) => index).filter((index) => !deleted.has(index)), [records, deleted]);
  const programId = def?.programId ?? 0;
  const licence = def?.licence ?? 0;
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
    return () => observe.disconnect();
  }, [grids, tab]);

  const isEditable = (row: number, column: UpdateColumn | undefined) => {
    if (!column) return false;
    const override = cellEditable[`${row}:${column.key}`];
    return override ?? column.editable;
  };

  const permissionSource = (record: UpdateRecord) => ({
    firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: def?.firstCombo?.bound ?? true },
    fieldValue: (name: string) => (keyOf(record, name) ? cellOf(record, name) : undefined),
  });

  const markEdited = (row: number) => setEdited((current) => (current.has(row) ? current : new Set(current).add(row)));
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
      cancel = answer.toUpperCase().includes("E");
      if (column.setup.rec_found_forquery) {
        setCellEditable((current) => ({ ...current, [`${row}:${column.key}`]: false }));
        cancel = true;
      }
    }
    if (column.setup.force_inputtype === "P") setCell(row, column.key, cellOf(backup[row], column.key));
    if (programId === 34) setCellEditable((current) => ({ ...current, [`${row}:${column.key}`]: true }));
    return !cancel;
  };

  const startEdit = async (initial?: string) => {
    const column = columnByKey.get(cursor.key);
    if (!column || !records[cursor.row] || !isEditable(cursor.row, column)) return;
    if (!(await beforeEdit(cursor.row, column))) return;
    const value = cellOf(records[cursor.row], column.key);
    setEditText(initial !== undefined ? initial : value);
    setEditing(true);
  };

  /** C1dg_UpdateGrid_ValidateEdit then AfterEdit. Returns false when the edit is refused. */
  const commitEdit = async (): Promise<boolean> => {
    const column = columnByKey.get(cursor.key);
    const row = cursor.row;
    if (!column || !grids || !meta) { setEditing(false); return true; }
    let text = editText;
    const record = records[row];
    const outcome = validate({
      setup: column.setup, masterGrid: false, programId, licence, coGstReq: meta.coGstReq, label: column.caption,
      fieldValue: (name) => cellOf(record, name),
      previousInput: (() => { const index = grids.columns.indexOf(column); return index > 0 ? cellOf(record, grids.columns[index - 1].key) : ""; })(),
      captionOf: (name) => columnByField(name)?.caption ?? name,
      columnValues: (name) => records.map((candidate) => cellOf(candidate, name)),
      rowIndex: row + 1,
    }, text);
    if (!outcome.ok) { await ask(outcome.message ?? "", outcome.title ?? "Validation"); return false; }

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
      if (duplicateInGrid(withText, help?.rows ?? null, row, text, column.setup)) { await ask("Duplicate Master Found...", "Warning"); return false; }
    }

    // ---- C1dg_UpdateGrid_AfterEdit
    let changed = text !== dataAtBegin;
    if (column.options && (column.comboKind === "Q" || column.comboKind === "X")) {
      const option = column.options.find((candidate) => candidate.text === text);
      if (option && option.value !== "" && text.toLowerCase() !== "(blank)" && toInt(option.value) > 0) setBackupCell(row, column.key, option.value);
      else if (text === "(blank)") setBackupCell(row, column.key, "");
    }
    text = styleCase(column.setup, text, licence);
    let next: UpdateRecord = { ...record, [column.key]: text };
    if (changed) markEdited(row);
    setEditing(false);

    if (column.setup.serverQueries.includes("onchange_repl_value_query") && text !== dataAtBegin) {
      const values = await call<{ values: Record<string, string> }>("onchange", { masterGrid: false, row: { ...eventRow(row, column.setup.field_name, text), values: Object.fromEntries(Object.entries(next).map(([key, value]) => [key.toLowerCase(), value])) } });
      for (const [name, value] of Object.entries(values.values)) {
        const key = keyOf(next, name);
        if (key) next = { ...next, [key]: value };
      }
    }
    if (toText(column.setup.formula_for_table) === "uom_formula") {
      const result = await call<{ value: string | null }>("uom-formula", { masterGrid: false, coreEntry: grids.coreEntry, row: { ...eventRow(row, column.setup.field_name, text), values: Object.fromEntries(Object.entries(next).map(([key, value]) => [key.toLowerCase(), value])) } });
      const index = grids.columns.indexOf(column);
      if (result.value !== null && grids.columns[index + 1]) next = { ...next, [grids.columns[index + 1].key]: result.value };
    }
    if (programId === 26 || programId === 28) {
      const disRate = toDecimal(cellOf(next, "pr_rate")) - toDecimal(cellOf(next, "pr_disamt"));
      if (keyOf(next, "pr_disrate")) next = { ...next, [keyOf(next, "pr_disrate")!]: String(disRate) };
      if (keyOf(next, "pr_netrate")) next = { ...next, [keyOf(next, "pr_netrate")!]: String(disRate - toDecimal(cellOf(next, "pr_slabperc"))) };
    }
    if (programId === 36 && keyOf(next, "pr_netrate")) next = { ...next, [keyOf(next, "pr_netrate")!]: String(toDecimal(cellOf(next, "pr_prate")) - toDecimal(cellOf(next, "pr_slabperc"))) };
    changed = changed || JSON.stringify(next) !== JSON.stringify(record);
    setRecords((current) => current.map((candidate, index) => (index === row ? next : candidate)));
    if (changed) markEdited(row);
    return true;
  };

  /** C1dg_UpdateGrid_BeforeRowColChange + AfterRowColChange for a move to (row, key). */
  const moveTo = async (row: number, key: string) => {
    if (!grids || !meta || busy) return;
    if (editing && !(await commitEdit())) return;
    const oldRow = cursor.row;
    const oldColumn = columnByKey.get(cursor.key);
    const newColumn = columnByKey.get(key);
    if (!newColumn || row < 0 || row >= records.length) return;
    const oldRecord = records[oldRow];

    if (oldColumn && oldRecord && (oldRow !== row || oldColumn.key !== key)) {
      if (cellOf(oldRecord, oldColumn.key) !== "" && toText(oldColumn.setup.duplichk_fldname1) !== "" && duplicateInGrid(records, help?.rows ?? null, oldRow, cellOf(oldRecord, oldColumn.key), oldColumn.setup)) {
        await ask("Duplicate Master Found...", "Warning");
        return;
      }
      if (oldColumn.setup.field_type === "D" && first?.text === "(blank)" && cellOf(oldRecord, oldColumn.key).trim() !== "" && dateOutsideYear(cellOf(oldRecord, oldColumn.key), yearStartText, yearEndText)) {
        await ask("Date should be allowed only Within Accounting year...", "Date Validation");
        setCell(oldRow, oldColumn.key, yearStartText);
        return;
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
        if (target && target.key !== key) key = target.key;
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
      if (column.statusDisplay !== "") setMessage(column.statusDisplay);
      // NewRowColDisplay: position the help grid on this value.
      if (help && toText(column.setup.duplichk_fldname1) !== "" && cellOf(record, column.key) !== "") {
        const f1 = column.setup.duplichk_fldname1.toLowerCase();
        const found = help.rows.findIndex((helpRecord) => (cellOf(helpRecord, f1) ?? "").toUpperCase() === cellOf(record, column.key).toUpperCase());
        setHelpRow(found >= 0 ? found : null);
      }
    }
    // keep the cursor in view
    const element = scroller.current;
    if (element) {
      const top = row * ROW_HEIGHT;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + ROW_HEIGHT * 2 > element.scrollTop + element.clientHeight) element.scrollTop = top - element.clientHeight + ROW_HEIGHT * 2;
    }
  };

  const neighbourColumn = (key: string, step: number) => {
    const index = columns.findIndex((column) => column.key === key);
    const next = columns[Math.min(columns.length - 1, Math.max(0, index + step))];
    return next?.key ?? key;
  };
  const neighbourRow = (row: number, step: number) => {
    const position = liveRows.indexOf(row);
    const next = liveRows[Math.min(liveRows.length - 1, Math.max(0, position + step))];
    return next ?? row;
  };

  // ---- Selected_RowDelete / MnuDeleteRow_Click / MnuDeleteSelection_Click / Delete key
  const deleteSelected = async (fromMenu: "row" | "selection" | "key") => {
    if (!grids) return;
    if (fromMenu !== "selection" && DELETE_BLOCKED_PROGRAMS.includes(programId)) return;
    if ((await ask("Are you sure to delete?", "Confirmation", ["Yes", "No"])) !== "Yes") return;
    if (def && !def.rights.delete) { await ask("Master Delete Rights Not Available For User", "Rights Validation"); return; }
    if ((await ask("Are you Confirm to delete record??", "Confirmation", ["Yes", "No"])) !== "Yes") return;
    const from = Math.min(cursor.row, selectionEnd ?? cursor.row);
    const to = Math.max(cursor.row, selectionEnd ?? cursor.row);
    const marked = new Set(deleted);
    for (let row = from; row <= to; row += 1) {
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
    const from = Math.min(cursor.row, selectionEnd ?? cursor.row);
    const to = Math.max(cursor.row, selectionEnd ?? cursor.row);
    const column = columnByKey.get(cursor.key);
    if (!column) return;
    let problem = "";
    if (!isEditable(from, column)) problem = `Column. : ${column.caption} is readonly`;
    else if (toText(column.setup.status_against_fld) !== "" && toText(column.setup.enable_for) !== "" && getPermission(permissionSource(records[from]), "E", column.setup.status_against_fld.trim(), column.setup.enable_for.trim(), false, false).toUpperCase().includes("D")) problem = `Column. : ${column.caption} is disabled`;
    else if (["L", "Q"].includes(column.setup.combo_value.toUpperCase())) problem = `Column ${column.caption} isn't allow for Paste, as it is drop down column`;
    else if (column.setup.field_type === "D") problem = `Value = ${copied.value} isn't valid date for Column ${column.caption}`;
    if (problem !== "") { await ask(problem, "Invalid Paste Selection"); return; }
    for (let row = from; row <= to; row += 1) {
      if (deleted.has(row)) continue;
      setCell(row, column.key, copied.value);
      if (column.setup.combo_value.toUpperCase() === "X") setBackupCell(row, column.key, copied.addonId);
      markEdited(row);
    }
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
  const printUpdate = async () => {
    if (liveRows.length === 0) { await ask("Can't open print priview as update grid is blank", "Print failed!!"); return; }
    if (printsMasterSheet) { printMasterSheet(); return; }
    const now = new Date();
    let line = `Book : ${first?.text ?? ""}`;
    line += licence === 14 ? `    | Run Date : ${formatDesktopDate(now)} Time : ${formatDesktopTime(now)}  User : ${meta?.userName ?? ""}` : `    | Run Date : ${formatDesktopDate(now)}    `;
    const right = (column: UpdateColumn) => column.align === "R" || column.format.startsWith("#") || column.format === "N2";
    printHtml(`Book : ${first?.text ?? ""}`, `<h1>${escapeHtml(meta?.companyName ?? "")}</h1><p>${escapeHtml(line)}</p><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.caption)}</th>`).join("")}</tr></thead><tbody>${liveRows.map((row) => `<tr>${columns.map((column) => `<td${right(column) ? ' class="r"' : ""}>${escapeHtml(formatCell(cellOf(records[row], column.key), column.format))}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
  };

  const exportCsv = () => {
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = [columns.map((column) => quote(column.caption)).join(","), ...liveRows.map((row) => columns.map((column) => quote(formatCell(cellOf(records[row], column.key), column.format))).join(","))];
    const blob = new Blob([String.fromCharCode(0xfeff) + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${programName}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  /** C1dg_UpdateGrid_KeyUp + KeyPress + KeyPressEdit, for the grid when no editor is open. */
  const gridKeys = async (event: ReactKeyboardEvent) => {
    if (!grids || editing || dialog) return;
    const column = columnByKey.get(cursor.key);
    const ctrl = event.ctrlKey || event.metaKey;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); if (event.shiftKey) setSelectionEnd(neighbourRow(selectionEnd ?? cursor.row, 1)); else await moveTo(neighbourRow(cursor.row, 1), cursor.key); return;
      case "ArrowUp": event.preventDefault(); if (event.shiftKey) setSelectionEnd(neighbourRow(selectionEnd ?? cursor.row, -1)); else await moveTo(neighbourRow(cursor.row, -1), cursor.key); return;
      case "ArrowRight": case "Tab": event.preventDefault(); await moveTo(cursor.row, neighbourColumn(cursor.key, event.shiftKey ? -1 : 1)); return;
      case "ArrowLeft": event.preventDefault(); await moveTo(cursor.row, neighbourColumn(cursor.key, -1)); return;
      case "PageDown": event.preventDefault(); await moveTo(neighbourRow(cursor.row, Math.floor(viewport / ROW_HEIGHT)), cursor.key); return;
      case "PageUp": event.preventDefault(); await moveTo(neighbourRow(cursor.row, -Math.floor(viewport / ROW_HEIGHT)), cursor.key); return;
      case "Enter":
        event.preventDefault();
        if (column && isEditable(cursor.row, column) && programId !== 38 && grids.columns.length > 10) await startEdit();
        else await moveTo(cursor.row, neighbourColumn(cursor.key, 1));
        return;
      case "F2": event.preventDefault(); await startEdit(); return;
      case "F3": event.preventDefault(); findNext(); return;
      case "F4": event.preventDefault(); restoreToAdd(); return;
      case "F5": event.preventDefault(); document.getElementById("mp-save")?.focus(); return;
      case "Delete": event.preventDefault(); await deleteSelected("key"); return;
    }
    if (ctrl && event.key.toLowerCase() === "f") { event.preventDefault(); document.getElementById("mp-find")?.focus(); return; }
    if (ctrl && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const text = [grids.columns.map((candidate) => candidate.caption).join("\t"), ...records.map((record) => grids.columns.map((candidate) => cellOf(record, candidate.key)).join("\t"))].join("\n");
      await navigator.clipboard?.writeText(text).catch(() => undefined);
      return;
    }
    if (ctrl && event.key.toLowerCase() === "c") { event.preventDefault(); await navigator.clipboard?.writeText(cellOf(records[cursor.row], cursor.key)).catch(() => undefined); await copyCell(); return; }
    if (ctrl && event.key.toLowerCase() === "v") { event.preventDefault(); await pasteCell(); return; }
    if (event.key.length === 1 && !ctrl && !event.altKey) {
      event.preventDefault();
      if (column && isEditable(cursor.row, column)) {
        const outcome = keyPress({ setup: column.setup, masterGrid: false, programId, licence, cellValue: cellOf(records[cursor.row], column.key), editorText: "", yearStart: yearStartText }, event.key);
        if (outcome.message) { await ask(outcome.message, "Typed Character not allowed"); return; }
        if (outcome.replaceWith !== undefined) { setCell(cursor.row, column.key, outcome.replaceWith); markEdited(cursor.row); return; }
        if (!outcome.refused) await startEdit(event.key);
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
    for (let step = 1; step <= records.length; step += 1) {
      const row = (cursor.row + step) % records.length;
      if (deleted.has(row)) continue;
      const hit = columns.find((column) => cellOf(records[row], column.key).toUpperCase().includes(needle));
      if (hit) { void moveTo(row, hit.key); return; }
    }
  };

  /** The open editor's own keys (KeyPressEdit). */
  const editorKeys = async (event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    const column = columnByKey.get(cursor.key);
    if (!column) return;
    if (event.key === "Escape") { event.preventDefault(); setEditing(false); gridFocus.current?.focus(); return; }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (await commitEdit()) {
        gridFocus.current?.focus();
        if (event.key === "Tab" || grids?.columns.length) await moveTo(cursor.row, neighbourColumn(cursor.key, event.shiftKey ? -1 : 1));
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const original = cellOf(backup[cursor.row], column.key);
      const date = column.setup.field_type === "D" ? parseDesktopDate(original) : null;
      setEditText(date ? formatDesktopDate(date) : original);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.currentTarget instanceof HTMLInputElement) {
      const outcome = keyPress({ setup: column.setup, masterGrid: false, programId, licence, cellValue: cellOf(records[cursor.row], column.key), editorText: editText, yearStart: yearStartText }, event.key);
      if (outcome.refused) event.preventDefault();
      if (outcome.message) await ask(outcome.message, "Typed Character not allowed");
      if (outcome.replaceWith !== undefined) setEditText(outcome.replaceWith);
    }
  };

  // ======================================================================================
  // Add grid

  const addValue = (name: string) => addRows.find((row) => row.fieldName.toLowerCase() === lower(name))?.fieldInput;
  const addEventRow = (index: number, text: string) => ({
    values: Object.fromEntries(addRows.map((row, at) => [row.fieldName.toLowerCase(), at === index ? text : row.fieldInput])),
    backup: Object.fromEntries(addRows.map((row) => [row.fieldName.toLowerCase(), row.fieldComboValue])),
    fieldName: addRows[index]?.fieldName ?? "",
    editorText: text,
  });
  const setAdd = (index: number, patch: Partial<AddState>) => setAddRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  /** C1dg_MasterGrid_BeforeRowColChange for a move to row `index`. */
  const addMoveTo = async (index: number) => {
    if (!grids || !meta || index < 0 || index >= addRows.length) return;
    if (addEditing && !(await addCommit())) return;
    const old = addRows[addCursor];
    const row = addRows[index];
    setRowStatus(`${index + 1}/${addRows.length}`);
    if (row.statusDisplay !== "") setMessage(row.statusDisplay);
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
        if (target > 0 && target !== index) { index = target; }
      }
      if (old.setup.duplicate_chk && old.fieldInput !== "" && !old.setup.serverQueries.includes("duplicate_query") && !meta.productCode) {
        const field = toText(old.setup.duplichk_fldname1) || old.fieldName;
        if (duplicateAgainstUpdate(records, field, old.fieldInput, restore ? restore.row : null)) {
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
    if (toText(row.setup.status_against_fld) !== "") {
      const source = { firstCombo: { text: first?.text ?? "", value: first?.value ?? "", bound: def?.firstCombo?.bound ?? true }, fieldValue: (name: string) => addValue(name) };
      if (toText(row.setup.enable_for) !== "") {
        const effect = applyPermission(getPermission(source, "E", row.setup.status_against_fld, row.setup.enable_for.trim(), true, false));
        if (effect.editable !== undefined) setAdd(index, { editable: row.recFound ? false : effect.editable });
      } else if (toText(row.setup.disable_for) !== "") {
        const effect = applyPermission(getPermission(source, "E", row.setup.status_against_fld, row.setup.disable_for.trim(), true, true));
        if (effect.editable !== undefined) setAdd(index, { editable: effect.editable });
      }
    }
    setAddCursor(index);
  };

  const addStartEdit = async (initial?: string) => {
    const row = addRows[addCursor];
    if (!row || !row.editable || !row.visible || !grids) return;
    if (row.setup.force_inputtype === "P") setAdd(addCursor, { fieldInput: row.fieldComboValue });
    if (toText(row.setup.formula_for_table) === "uom_entry" || toText(row.setup.defa_formula) !== "") {
      const value = (await call<{ value: string | null }>("add-before-edit", { masterGrid: true, coreEntry: grids.coreEntry, row: addEventRow(addCursor, row.fieldInput) })).value;
      if (value !== null) { setAdd(addCursor, { fieldInput: value }); setAddText(initial ?? value); setAddEditing(true); return; }
    }
    setAddText(initial !== undefined ? initial : row.fieldInput);
    setAddEditing(true);
  };

  /** C1dg_MasterGrid_ValidateEdit + AfterEdit. */
  const addCommit = async (): Promise<boolean> => {
    const index = addCursor;
    const row = addRows[index];
    if (!row || !grids || !meta) { setAddEditing(false); return true; }
    let text = addText;
    if (row.comboKind === "L" && row.setup.value_compulsory && text.trim() === "" && row.options?.length) text = row.options[0].text;
    const outcome = validate({
      setup: { ...row.setup, value_compulsory: row.compulsory }, masterGrid: true, programId, licence, coGstReq: meta.coGstReq, label: row.headLabel,
      fieldValue: (name) => addValue(name) ?? "", previousInput: addRows[index - 1]?.fieldInput ?? "",
      captionOf: (name) => columnByField(name)?.caption ?? name, columnValues: (name) => records.map((record) => cellOf(record, name)),
    }, text);
    if (!outcome.ok) { await ask(outcome.message ?? "", outcome.title ?? "Validation"); return false; }
    if (row.setup.field_validation.toLowerCase() === "sys.checkgststateid" && text.length > 0 && programId === 14 && meta.coGstReq) {
      const short = (await call<{ short: string }>("state-short", { stateName: addRows[index - 1]?.fieldInput ?? "" })).short;
      const gst = gstStateMismatch(text, short);
      if (gst.mismatch) { await ask("Gstin And State Not Match", row.setup.head_label); setAddText(gst.corrected); return false; }
    }
    if (row.setup.duplicate_chk) {
      if (row.setup.serverQueries.includes("duplicate_query")) {
        const result = await call<{ message: string }>("duplicate-query", { masterGrid: true, row: addEventRow(index, text) });
        if (result.message !== "") { await ask(result.message, "Warning"); return false; }
      } else if (duplicateAgainstUpdate(records, toText(row.setup.duplichk_fldname1) || row.fieldName, text, restore ? restore.row : null)) {
        await ask("Duplicate value Found...", "Warning");
        if (restore) { setAdd(index, { fieldInput: "" }); setAddEditing(false); await cancelAdd(true); }
        return false;
      }
    }
    if (text !== "" && toText(row.setup.duplichk_fldname1) !== "" && help && help.rows.length > 0) {
      const f1 = row.setup.duplichk_fldname1.toLowerCase();
      const combo = toText(row.setup.dupliadd_combofld).toLowerCase();
      const hit = help.rows.findIndex((helpRecord, at) => {
        if (cellOf(helpRecord, f1).toUpperCase() !== text.toUpperCase()) return false;
        if (restore && restore.row === at) return false;
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
    if (row.setup.field_type === "D") {
      if (text === "") text = "";
      else { const date = parseDesktopDate(text); if (date) text = programId === 52 ? `${formatDesktopDate(date)} ${date.toTimeString().slice(0, 8)}` : formatDesktopDate(date); }
    }
    let nextRows = addRows.map((candidate, at) => (at === index ? { ...candidate, fieldInput: text, fieldComboValue } : candidate));
    setAddEditing(false);
    if (row.setup.serverQueries.includes("onchange_repl_value_query")) {
      const values = await call<{ values: Record<string, string> }>("onchange", { masterGrid: true, row: { ...addEventRow(index, text), values: Object.fromEntries(nextRows.map((candidate) => [candidate.fieldName.toLowerCase(), candidate.fieldInput])) } });
      nextRows = nextRows.map((candidate) => (candidate.fieldName.toLowerCase() in values.values ? { ...candidate, fieldInput: values.values[candidate.fieldName.toLowerCase()] } : candidate));
    }
    if (toText(row.setup.formula_for_table) === "uom_formula" && nextRows[index + 1]) {
      const value = (await call<{ value: string | null }>("uom-formula", { masterGrid: true, coreEntry: grids.coreEntry, row: { ...addEventRow(index, text), values: Object.fromEntries(nextRows.map((candidate) => [candidate.fieldName.toLowerCase(), candidate.fieldInput])) } })).value;
      if (value !== null) nextRows = nextRows.map((candidate, at) => (at === index + 1 ? { ...candidate, fieldInput: value } : candidate));
    }
    setAddRows(nextRows);
    if (row.setup.field_add_order === grids.lastAddRow) document.getElementById("mp-save")?.focus();
    return true;
  };

  // ---- BlankOutGrid("IF") / Btn_Master_AddCancel_Click
  const blankAdd = () => setAddRows((current) => current.map((row) => {
    if (!row.setup.add_grid_visible) return row;
    let next = { ...row };
    if (!["Q", "X", "L"].includes(row.comboKind)) next.fieldInput = "";
    if ((row.comboKind === "Q" || row.comboKind === "X") && row.defaultText !== "" && (next.fieldInput === "" || next.fieldComboValue === "")) next = { ...next, fieldInput: row.defaultText, fieldComboValue: row.defaultValue };
    if (row.comboKind === "L" && next.fieldInput === "") next.fieldInput = row.setup.combo_list.slice(0, Math.max(0, row.setup.combo_list.indexOf("|")));
    return next;
  }));
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
        rows: addRows.map((row) => ({ fieldName: row.fieldName, fieldInput: row.fieldInput, fieldComboValue: row.fieldComboValue, visible: row.visible, editable: row.editable })),
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
      await loadGroup(group.firstCombo, group.secondCombo);
      setTab(grids.updateTabVisible ? "update" : "add");
      return;
    }
  };

  const addKeys = async (event: ReactKeyboardEvent) => {
    if (dialog || !grids) return;
    const row = addRows[addCursor];
    const nextVisible = (from: number, step: number) => {
      for (let at = from + step; at >= 0 && at < addRows.length; at += step) if (addRows[at].visible) return at;
      return from;
    };
    if (addEditing) {
      if (event.key === "Escape") { event.preventDefault(); setAddEditing(false); addFocus.current?.focus(); return; }
      if (event.key === "Enter" || event.key === "Tab" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.target instanceof HTMLSelectElement && (event.key === "ArrowDown" || event.key === "ArrowUp")) return;
        event.preventDefault();
        if (await addCommit()) { addFocus.current?.focus(); await addMoveTo(nextVisible(addCursor, event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1)); }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && row && event.target instanceof HTMLInputElement) {
        const outcome = keyPress({ setup: row.setup, masterGrid: true, programId, licence, cellValue: row.fieldInput, editorText: addText, yearStart: yearStartText }, event.key);
        if (outcome.refused) event.preventDefault();
        if (outcome.message) await ask(outcome.message, "Character Not Allowed");
        if (outcome.replaceWith !== undefined) setAddText(outcome.replaceWith);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown": case "Enter": event.preventDefault(); if (event.key === "Enter" && row?.editable) await addStartEdit(); else await addMoveTo(nextVisible(addCursor, 1)); return;
      case "ArrowUp": event.preventDefault(); await addMoveTo(nextVisible(addCursor, -1)); return;
      case "F2": event.preventDefault(); await addStartEdit(); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && row?.editable) {
      event.preventDefault();
      const outcome = keyPress({ setup: row.setup, masterGrid: true, programId, licence, cellValue: row.fieldInput, editorText: "", yearStart: yearStartText }, event.key);
      if (outcome.message) { await ask(outcome.message, "Character Not Allowed"); return; }
      if (outcome.replaceWith !== undefined) { setAdd(addCursor, { fieldInput: outcome.replaceWith }); return; }
      if (!outcome.refused) await addStartEdit(event.key);
    }
  };

  // Master_ProgramGrid_KeyUp / Cmb_Master_GroupFld_KeyPress: Escape asks to leave.
  const leave = async () => {
    if ((await ask("Returning To Main Menu ? ", "Confirmation", ["Yes", "No"])) === "Yes") onClose();
  };

  // Master_ProgramGrid_KeyUp: Escape anywhere outside an editor or message asks to leave.
  const escapeState = useRef({ editing, addEditing, dialog: dialog !== null, leave, licence, close: onClose });
  useEffect(() => { escapeState.current = { editing, addEditing, dialog: dialog !== null, leave, licence, close: onClose }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = escapeState.current;
      if (event.key === "Escape" && !state.editing && !state.addEditing && !state.dialog) void state.leave();
      if (event.key === "Pause" && PAUSE_EXIT_LICENCES.includes(state.licence)) state.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ======================================================================================

  if (!selection) return null;
  if (fatal) return <div className="mp-screen"><div className="mp-fatal">{fatal}</div></div>;

  const firstCombo = def?.firstCombo;
  const visibleRows = liveRows;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const endIndex = Math.min(visibleRows.length, startIndex + Math.ceil(viewport / ROW_HEIGHT) + 10);
  const frozenCount = grids ? Math.min(grids.frozen, columns.length) : 0;
  const frozenLeft: number[] = [];
  columns.reduce((left, column, index) => { frozenLeft[index] = left; return left + Math.max(40, column.width || 90); }, 48);
  const cursorColumn = columnByKey.get(cursor.key);

  return (
    <div className={`mp-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.heading || title}>
      <div className="mp-title">
        <strong>{def?.heading || title}</strong>
        <span className="mp-rights">{def && def.rights.restricted ? `Rights: ${def.rights.add ? "Add " : ""}${def.rights.edit ? "Edit " : ""}${def.rights.delete ? "Delete" : ""}` : ""}</span>
        <button type="button" className="mp-close" onClick={() => void leave()} aria-label="Close master">×</button>
      </div>

      <div className="mp-combos">
        {firstCombo && (
          <label className="mp-combo">
            <span>{firstCombo.label}</span>
            {firstCombo.editable ? (
              <>
                <input
                  list="mp-first-options"
                  // The chosen group shows as the placeholder so the list is not filtered down to it.
                  value={firstTyped}
                  placeholder={first?.text ?? "Type or pick…"}
                  disabled={Boolean(grids) || Boolean(busy)}
                  onChange={(event) => {
                    const text = event.target.value;
                    setFirstTyped(text);
                    // Picking from the list (not typing) chooses the group at once, as Leave would.
                    const picked = !(event.nativeEvent instanceof InputEvent) || event.nativeEvent.inputType === "insertReplacementText";
                    const option = picked ? firstCombo.options.find((candidate) => candidate.text === text) : undefined;
                    if (option) { setFirstTyped(""); chooseFirst(option); }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (firstTyped.trim() === "" && first) { chooseFirst(first); return; }
                    const option = firstCombo.options.find((candidate) => candidate.text.toUpperCase() === firstTyped.trim().toUpperCase());
                    if (option) { setFirstTyped(""); chooseFirst(option); }
                  }}
                  onBlur={() => {
                    const option = firstCombo.options.find((candidate) => candidate.text.toUpperCase() === firstTyped.trim().toUpperCase());
                    if (option && option.value !== first?.value) { setFirstTyped(""); chooseFirst(option); }
                  }}
                />
                <datalist id="mp-first-options">{firstCombo.options.map((option, index) => <option key={`${option.value}-${index}`} value={option.text} />)}</datalist>
              </>
            ) : (
              <select
                value={first ? String(firstCombo.options.indexOf(firstCombo.options.find((option) => option.value === first.value && option.text === first.text) ?? firstCombo.options[0])) : ""}
                disabled={Boolean(grids) || Boolean(busy)}
                onChange={(event) => { const option = firstCombo.options[Number(event.target.value)]; if (option) chooseFirst(option); }}
              >
                {!first && <option value="">Select…</option>}
                {firstCombo.options.map((option, index) => <option key={`${option.value}-${index}`} value={index}>{option.text}</option>)}
              </select>
            )}
          </label>
        )}
        {secondOptions && (
          <label className="mp-combo">
            <span>Select</span>
            <select value={second ? String(secondOptions.indexOf(second)) : ""} disabled={Boolean(grids) || Boolean(busy)} onChange={(event) => { const option = secondOptions[Number(event.target.value)]; setSecond(option ?? null); if (option && first) void loadGroup(first, option); }}>
              <option value="">Select…</option>
              {secondOptions.map((option, index) => <option key={`${option.value}-${index}`} value={index}>{option.text}</option>)}
            </select>
          </label>
        )}
        {first && !grids && !secondOptions && <button type="button" onClick={() => void loadGroup(first, second)} disabled={Boolean(busy)}>Show</button>}
        {grids && <button type="button" onClick={() => void cancelAll()}>Cancel</button>}
        {busy && <span className="mp-busy">{busy}…</span>}
      </div>

      {grids && (
        <div className="mp-tabs" role="tablist">
          {grids.addTabVisible && <button type="button" role="tab" aria-selected={tab === "add"} className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}>New (Add){restore ? " – View" : ""}</button>}
          {imageTab && <button type="button" role="tab" aria-selected={tab === "image"} className={tab === "image" ? "active" : ""} onClick={() => setTab("image")}>Image</button>}
          {grids.updateTabVisible && <button type="button" role="tab" aria-selected={tab === "update"} className={tab === "update" ? "active" : ""} onClick={() => { setTab("update"); setHotKeys(grids.addTabVisible ? "Press F4 Key For Update Grid Vertical Display" : ""); }}>Update / Delete</button>}
        </div>
      )}

      {grids && tab === "add" && (
        <div className="mp-add" ref={addFocus} role="grid" aria-label="New (Add)" tabIndex={0} onKeyDown={(event) => void addKeys(event)}>
          <table className="mp-add-grid">
            <thead><tr><th className="mp-add-head">Heading</th><th>Input</th></tr></thead>
            <tbody>
              {addRows.map((row, index) => row.visible && (
                <tr key={`${row.fieldName}-${index}`} className={index === addCursor ? "mp-current" : ""}>
                  <td role="gridcell" onClick={() => void addMoveTo(index)} onDoubleClick={() => void addStartEdit()} className={`mp-add-head ${row.setup.program_top_id === 48 || row.setup.program_top_id === 49 ? "mp-yellow" : ""}`}>{row.headLabel}</td>
                  <td role="gridcell" aria-readonly={!row.editable} onClick={() => void addMoveTo(index)} onDoubleClick={() => void addStartEdit()} className={`${row.editable ? "" : "mp-readonly"} ${row.styleName}`}>
                    {addEditing && index === addCursor ? (
                      row.options ? (
                        <select ref={focusOnMount} className="mp-editor" value={addText} onChange={(event) => setAddText(event.target.value)} onKeyDown={(event) => void addKeys(event)}>
                          {!row.options.some((option) => option.text === addText) && <option value={addText}>{addText}</option>}
                          {row.options.map((option, at) => <option key={`${option.value}-${at}`} value={option.text}>{option.text}</option>)}
                        </select>
                      ) : (
                        <input ref={focusOnMount} className="mp-editor" type={row.setup.force_inputtype === "P" ? "password" : "text"} value={addText} onChange={(event) => setAddText(event.target.value)} onKeyDown={(event) => void addKeys(event)} />
                      )
                    ) : row.setup.force_inputtype === "P" && row.fieldInput !== "" ? "*********" : row.fieldInput}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mp-actions">
            <button type="button" id="mp-save" onClick={() => void saveAdd()} disabled={Boolean(busy) || (def ? !def.rights.add : true)}>Save</button>
            <button type="button" onClick={() => void cancelAdd()}>Cancel</button>
            {printsMasterSheet && <button type="button" onClick={printMasterSheet}>Print</button>}
            <button type="button" onClick={() => void leave()}>Quit</button>
          </div>
        </div>
      )}

      {grids && tab === "update" && (
        <div className="mp-update">
          <div className="mp-toolbar">
            <input id="mp-find" className="mp-find" placeholder="Find (Ctrl+F, F3 next)" value={find} onChange={(event) => setFind(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "F3") { event.preventDefault(); findNext(); } }} />
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
            <span>{liveRows.length} records{edited.size ? ` · ${edited.size} changed` : ""}{deleted.size ? ` · ${deleted.size} marked for delete` : ""}</span>
            <span className="mp-spacer" />
            <button type="button" id="mp-save" onClick={() => void saveUpdate()} disabled={Boolean(busy) || edited.size === 0}>Save</button>
            <button type="button" onClick={() => first && void loadGroup(first, second)} disabled={Boolean(busy)}>Refresh</button>
            <button type="button" onClick={() => void printUpdate()}>Print</button>
            <button type="button" onClick={exportCsv}>Export</button>
            {meta?.logFileSpecial && <button type="button" onClick={() => void showLog()} disabled={Boolean(busy) || !grids.pkvKey}>Log</button>}
            <button type="button" onClick={() => void leave()}>Quit</button>
          </div>
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
              onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}
            >
              <div className="mp-row mp-head" style={{ top: 0 }}>
                <div className="mp-cell mp-rownum">#</div>
                {columns.map((column, index) => (
                  <div key={column.key} className={`mp-cell ${index < frozenCount ? "mp-frozen" : ""} ${column.setup.program_top_id === 48 || column.setup.program_top_id === 49 ? "mp-yellow" : ""}`} style={{ width: Math.max(40, column.width || 90), textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left", ...(index < frozenCount ? { left: frozenLeft[index] } : {}) }} title={column.caption}>{column.caption}</div>
                ))}
              </div>
              {visibleRows.slice(startIndex, endIndex).map((row, offset) => {
                const record = records[row];
                const position = startIndex + offset;
                const inSelection = selectionEnd !== null && row >= Math.min(cursor.row, selectionEnd) && row <= Math.max(cursor.row, selectionEnd);
                return (
                  <div key={row} className={`mp-row ${row === cursor.row ? "mp-current-row" : ""} ${edited.has(row) ? "mp-edited" : ""} ${inSelection ? "mp-selected" : ""}`} style={{ top: (position + 1) * ROW_HEIGHT }}>
                    <div className="mp-cell mp-rownum">{position + 1}</div>
                    {columns.map((column, index) => {
                      const current = row === cursor.row && column.key === cursor.key;
                      const editable = isEditable(row, column);
                      return (
                        <div
                          key={column.key}
                          role="gridcell"
                          tabIndex={-1}
                          aria-selected={current}
                          aria-readonly={!editable}
                          className={`mp-cell ${index < frozenCount ? "mp-frozen" : ""} ${current ? "mp-current" : ""} ${editable ? "" : "mp-readonly"}`}
                          style={{ width: Math.max(40, column.width || 90), textAlign: column.align === "R" || column.format.startsWith("#") || column.format === "N2" ? "right" : column.align === "C" ? "center" : "left", ...(index < frozenCount ? { left: frozenLeft[index] } : {}) }}
                          onMouseDown={(event) => { if (event.shiftKey) { setSelectionEnd(row); return; } void moveTo(row, column.key); }}
                          onDoubleClick={() => void startEdit()}
                        >
                          {current && editing ? (
                            column.options ? (
                              <select ref={focusOnMount} className="mp-editor" value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => void editorKeys(event)} onBlur={() => void commitEdit()}>
                                {!column.options.some((option) => option.text === editText) && <option value={editText}>{editText}</option>}
                                {column.options.map((option, at) => <option key={`${option.value}-${at}`} value={option.text}>{option.text}</option>)}
                              </select>
                            ) : (
                              <input ref={focusOnMount} className="mp-editor" type={column.setup.force_inputtype === "P" ? "password" : "text"} value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => void editorKeys(event)} />
                            )
                          ) : formatCell(cellOf(record, column.key), column.format)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {help && help.columns.length > 0 && helpRow !== null && cursorColumn && toText(cursorColumn.setup.help_query) !== "" && (
            <div className="mp-help">
              <div className="mp-help-title">{help.total}<button type="button" onClick={() => setHelpRow(null)} aria-label="Close help">×</button></div>
              <table>
                <thead><tr>{help.columns.map((column) => <th key={column.key} style={{ width: column.width || 90 }}>{column.caption}</th>)}</tr></thead>
                <tbody>
                  {help.rows.slice(Math.max(0, helpRow - 3), helpRow + 12).map((helpRecord, index) => (
                    <tr key={index} className={Math.max(0, helpRow - 3) + index === helpRow ? "mp-current-row" : ""}>
                      {help.columns.map((column) => <td key={column.key} style={{ textAlign: column.align === "R" ? "right" : "left" }}>{formatCell(helpRecord[column.key] ?? "", column.format)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {menu && (
            <div className="mp-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)}>
              <button type="button" onClick={() => { setMenu(null); void copyCell(); }}>Copy</button>
              <button type="button" disabled={!copied} onClick={() => { setMenu(null); void pasteCell(); }}>Paste</button>
              <button type="button" onClick={() => { setMenu(null); if (cursor.key) setHiddenColumns((current) => [...current, cursor.key]); }}>Hide Column</button>
              <button type="button" disabled={hiddenColumns.length === 0} onClick={() => { setMenu(null); setHiddenColumns((current) => current.slice(0, -1)); }}>Visible Column</button>
              <button type="button" onClick={() => { setMenu(null); setCell(cursor.row, cursor.key, cellOf(backup[cursor.row], cursor.key)); }}>Restore Cell Value</button>
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

      <div className="mp-status">
        <span>{rowStatus}</span>
        <span className="mp-message">{message}</span>
        <span>{hotKeys}</span>
        {warnings.length > 0 && <span className="mp-warn" title={warnings.join("\n")}>{warnings.length} setup query warning{warnings.length === 1 ? "" : "s"}</span>}
      </div>

      {dialog && (
        <div className="mp-dialog-backdrop" role="presentation">
          <div className="mp-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
            <strong>{dialog.title}</strong>
            <pre>{dialog.message}</pre>
            {dialog.input && <input id="mp-dialog-input" type="password" ref={focusOnMount} onKeyDown={(event) => { if (event.key === "Enter") dialog.resolve("OK", event.currentTarget.value); }} />}
            <div className="mp-dialog-buttons">
              {dialog.buttons.map((button, index) => (
                <button key={button} type="button" ref={!dialog.input && index === 0 ? focusOnMount : undefined} onClick={() => dialog.resolve(button, (document.getElementById("mp-dialog-input") as HTMLInputElement | null)?.value)}>{button}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
