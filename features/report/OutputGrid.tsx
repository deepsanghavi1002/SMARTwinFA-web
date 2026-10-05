"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ExportRowStyle } from "../../lib/export/table";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";
import { ArrangeColumns } from "../grid/ArrangeColumns";
import { exportTableFrom } from "../grid/exportTable";
import { FoundText } from "../grid/FoundText";
import { GridButtons } from "../grid/GridButtons";
import { columnMenuItems, GridMenu } from "../grid/GridMenu";
import type { GridMenuPlace } from "../grid/GridMenu";
import { LogViewer } from "../grid/LogViewer";
import type { LogTable } from "../grid/LogViewer";
import { selectionTotals } from "../grid/totals";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useGridOutput } from "../grid/useGridOutput";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";

/**
 * C1_OUTPUT, the report's output grid: headings, opening, entries, closing, a subtotal under each
 * group and the final total, as the desktop draws it.
 *
 * - F6 summarises to the totals, F4 shows all (in tree format: close / open every node).
 * - Selecting: click a cell; Shift+click, a drag or Shift+arrows select a block; Ctrl+click adds
 *   single cells. The number cells selected are summed in the status line, as Excel does.
 * - Create Tree (btnCreateTree_Click / CreateTree): each subtotal becomes a node that opens and
 *   closes its group (⊞ / ⊟), shown closed at the last group level (Tree.Show(groups - 1)).
 * - Create Group (ResetGroupReport / SetNameOnLabel / Btn_Generate_Click): the entries alone,
 *   grouped afresh on the fields chosen, with their own subtotals (from the server).
 * - Border On (BorderOn_Click) borders the selected cells and keeps drawing: each click borders a
 *   cell, Shift+click the cells from the current one down / up that column, Ctrl+click one more
 *   cell. Border Off (or Esc) stops drawing, and takes the border off the selected cells. Border
 *   Colour (BorderColour_Click) colours every border; 3 px outside a block, 1 px between its cells.
 * - Columns: drag a heading's right edge to size one; right-click a heading or cell to hide, show
 *   or move columns; Arrange Columns lists them all.
 * - Log (btn_Log_Click): the edit log of the voucher of the current row.
 * - Excel, PDF, Print and Preview keep the headings', subtotals' and total's colours.
 */

const ROW = 22;
const MARK = 16;
const TREE = 20;
const BORDER_OUT = 3;
const BORDER_IN = 1;
const TREE_KEYS = "F6 : Close / F4 : Open Tree";
const GRID_KEYS = "F6 : Summarize F4 : Unsummarize";

type Point = { row: number; col: number };

export type OutputStatus = { hotKeys: string; message: string; red?: boolean };

/** A colour name or #rgb as RRGGBB, as the browser reads it (report_style holds names: Pink, MistyRose ...). */
function hexColour(colour: string): string {
  if (/^#?[0-9a-f]{6}$/i.test(colour)) return colour.replace(/^#/, "").toUpperCase();
  try {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return "";
    context.fillStyle = "#000000";
    context.fillStyle = colour;
    const value = String(context.fillStyle);
    return /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1).toUpperCase() : "";
  } catch {
    return "";
  }
}

export function OutputGrid({ output: base, fallbackTitle, companyName, userName, rights, busy, onRefresh, onBack, onQuit, loadLog, loadGroup, onStatus, onInfo }: {
  output: ReportOutput;
  fallbackTitle: string;
  companyName: string;
  userName: string;
  rights: Readonly<{ print: boolean; preview: boolean; export: boolean }>;
  busy: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onQuit: () => void;
  loadLog: (ledKey: number, processKey: number) => Promise<LogTable>;
  /** Create Group: the report's entries grouped on these fields (none: the final total only). */
  loadGroup: (fields: readonly string[]) => Promise<ReportOutput | null>;
  onStatus: (status: OutputStatus) => void;
  /** What the status line shows for the grid: its rows, and the selected cells' total. */
  onInfo: (rows: string, totals: string) => void;
}) {
  // ---- Create Group (C1_OUTPUT_GROUP) ----
  const [groupMode, setGroupMode] = useState(false);
  const [groupOutput, setGroupOutput] = useState<ReportOutput | null>(null);
  const [groupFields, setGroupFields] = useState<string[]>([]);
  const [groupPick, setGroupPick] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const output = groupMode && groupOutput ? groupOutput : base;

  const [collapsed, setCollapsed] = useState(false);
  const [tree, setTree] = useState(false);
  /** Closed tree nodes: indexes of subtotal rows in output.rows. */
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const [cursor, setCursor] = useState<Point>({ row: 0, col: 0 });
  const [selEnd, setSelEnd] = useState<Point | null>(null);
  /** Single cells added with Ctrl+click ("rowIndex|columnKey", rowIndex in output.rows). */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [borders, setBorders] = useState<ReadonlySet<string>>(new Set());
  const [borderColour, setBorderColour] = useState("#ff0000");
  const [drawing, setDrawing] = useState(false);
  const [logTable, setLogTable] = useState<LogTable | null>(null);
  const [menu, setMenu] = useState<(GridMenuPlace & { key: string }) | null>(null);
  const [arranging, setArranging] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(500);
  const scroller = useRef<HTMLDivElement>(null);
  const colourInput = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0) setViewHeight(element.clientHeight); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { scroller.current?.focus(); }, [output]);
  useEffect(() => { const up = () => { dragging.current = false; }; document.addEventListener("mouseup", up); return () => document.removeEventListener("mouseup", up); }, []);

  // The desktop's widths are for its 8-10 pt grid font; the web grid's text is a little wider.
  const layout = useColumnLayout(output.columns, 0, (column) => Math.max(30, Math.round(column.width * 1.2)));
  const columns = layout.columns;
  const widthOf = layout.widthOf;

  /** Where each subtotal's group starts (BelowData: the rows after the previous subtotal of its level or an outer one). */
  const groupStart = useMemo(() => {
    const starts = new Map<number, number>();
    const boundary: number[] = [];
    output.rows.forEach((row, index) => {
      if (row.kind !== "subtotal") return;
      starts.set(index, (boundary[row.level] ?? -1) + 1);
      for (let level = row.level; level < Math.max(boundary.length, row.level + 1, 8); level += 1) boundary[level] = index;
    });
    return starts;
  }, [output]);

  /** The rows shown, with their index in output.rows. */
  const shown = useMemo(() => {
    const hidden = new Set<number>();
    if (tree) for (const node of closed) { const start = groupStart.get(node) ?? node; for (let at = start; at < node; at += 1) hidden.add(at); }
    const needle = search.trim().toUpperCase();
    const list: { row: OutputRow; index: number }[] = [];
    output.rows.forEach((row, index) => {
      if (hidden.has(index)) return;
      if (!tree && collapsed && row.kind === "data") return;
      if (needle !== "" && row.kind === "data" && !Object.values(row.values).some((value) => value.toUpperCase().includes(needle))) return;
      list.push({ row, index });
    });
    return list;
  }, [output, tree, closed, groupStart, collapsed, search]);

  const at: Point = { row: Math.min(cursor.row, Math.max(0, shown.length - 1)), col: Math.min(cursor.col, Math.max(0, columns.length - 1)) };
  const box = selEnd === null ? null : { r1: Math.min(at.row, selEnd.row), r2: Math.max(at.row, selEnd.row), c1: Math.min(at.col, selEnd.col), c2: Math.max(at.col, selEnd.col) };
  const cellKey = (position: number, col: number) => { const entry = shown[position]; const column = columns[col]; return entry && column ? `${entry.index}|${column.key}` : ""; };
  const inBox = (row: number, col: number) => box !== null && row >= box.r1 && row <= box.r2 && col >= box.c1 && col <= box.c2;
  const isSelected = (row: number, col: number) => inBox(row, col) || picked.has(cellKey(row, col));

  /** Every selected cell (the block, or the current cell, and the Ctrl+clicked ones), as rowIndex|columnKey. */
  const selectedKeys = () => {
    const keys = new Set(picked);
    const area = box ?? { r1: at.row, r2: at.row, c1: at.col, c2: at.col };
    for (let row = area.r1; row <= area.r2; row += 1) for (let col = area.c1; col <= area.c2; col += 1) { const key = cellKey(row, col); if (key) keys.add(key); }
    return keys;
  };

  // The status line: rows shown, and the selected number cells' Sum / Count / Average, as Excel's.
  const totals = useMemo(() => {
    const keys = new Set(picked);
    if (box) for (let row = box.r1; row <= box.r2; row += 1) for (let col = box.c1; col <= box.c2; col += 1) { const key = cellKey(row, col); if (key) keys.add(key); }
    if (picked.size > 0) { const key = cellKey(at.row, at.col); if (key) keys.add(key); }
    if (keys.size < 2) return "";
    const byIndex = new Map(output.rows.map((row, index) => [index, row]));
    const cells: string[] = [];
    let places = 0;
    for (const key of keys) {
      const split = key.indexOf("|");
      const row = byIndex.get(Number(key.slice(0, split)));
      const column = output.columns.find((candidate) => candidate.key === key.slice(split + 1));
      if (!row || column?.kind !== "number") continue;
      cells.push(row.values[column.key] ?? "");
      places = Math.max(places, column.decimals);
    }
    return selectionTotals(cells, places) ?? "";
  }, [box?.r1, box?.r2, box?.c1, box?.c2, picked, at.row, at.col, columns, shown, output]); // eslint-disable-line react-hooks/exhaustive-deps -- box is derived from these
  const rowsText = `Rows : ${shown.length}${shown.length !== output.rows.length ? ` of ${output.rows.length}` : ""}${collapsed && !tree ? " · Summary" : ""}${tree ? " · Tree" : ""}${groupMode ? " · Group" : ""}`;
  /**
   * The bordered (coloured) cells' total: those of the current column when it is a number column
   * with borders in it, else every bordered number cell.
   */
  const borderTotals = useMemo(() => {
    if (borders.size === 0) return "";
    const byIndex = new Map(output.rows.map((row, index) => [index, row]));
    const currentKey = columns[at.col]?.key ?? "";
    const entries = [...borders].map((key) => { const split = key.indexOf("|"); return { row: byIndex.get(Number(key.slice(0, split))), column: output.columns.find((candidate) => candidate.key === key.slice(split + 1)) }; })
      .filter((entry) => entry.row && entry.column?.kind === "number");
    if (entries.length === 0) return "";
    const inCurrent = entries.filter((entry) => entry.column?.key === currentKey);
    const used = inCurrent.length > 0 ? inCurrent : entries;
    const places = Math.max(0, ...used.map((entry) => entry.column?.decimals ?? 0));
    const sum = selectionTotals(used.map((entry) => entry.row?.values[entry.column?.key ?? ""] ?? ""), places);
    return sum ? `Bordered${inCurrent.length > 0 ? ` ${columns[at.col]?.caption ?? ""}` : ""} ▸ ${sum}` : "";
  }, [borders, output, columns, at.col]);
  useEffect(() => { onInfo(rowsText, [totals, borderTotals].filter(Boolean).join("   ‖   ")); }, [rowsText, totals, borderTotals, onInfo]);

  const lefts = useMemo(() => {
    const list: number[] = [];
    columns.reduce((left, column, index) => { list[index] = left; return left + widthOf(column); }, MARK + (tree ? TREE : 0));
    return list;
  }, [columns, widthOf, tree]);
  const totalWidth = MARK + (tree ? TREE : 0) + columns.reduce((sum, column) => sum + widthOf(column), 0);

  const reveal = (point: Point) => {
    const element = scroller.current;
    if (!element) return;
    const top = (point.row + 1) * ROW;
    if (top < element.scrollTop + ROW) element.scrollTop = top - ROW;
    else if (top + ROW > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW - element.clientHeight;
    const column = columns[point.col];
    if (column) {
      const left = lefts[point.col];
      const right = left + widthOf(column);
      if (right > element.scrollLeft + element.clientWidth) element.scrollLeft = right - element.clientWidth;
      if (left < element.scrollLeft + MARK) element.scrollLeft = Math.max(0, left - MARK);
    }
    setScrollTop(element.scrollTop);
  };
  const clampPoint = (point: Point): Point => ({ row: Math.max(0, Math.min(shown.length - 1, point.row)), col: Math.max(0, Math.min(columns.length - 1, point.col)) });
  const go = (point: Point, extend: boolean) => {
    const next = clampPoint(point);
    if (extend) { setSelEnd(next); reveal(next); return; }
    setSelEnd(null);
    setPicked(new Set());
    setCursor(next);
    reveal(next);
  };

  const toggleNode = (index: number) => setClosed((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  const showLevel = (level: number) => setClosed(new Set(output.rows.flatMap((row, index) => (row.kind === "subtotal" && row.level >= level ? [index] : []))));
  const resetView = () => { setTree(false); setClosed(new Set()); setCollapsed(false); setCursor({ row: 0, col: 0 }); setSelEnd(null); setPicked(new Set()); setBorders(new Set()); setDrawing(false); };

  // ---- Buttons ----
  /** btnCreateTree_Click: the tree format on, or off again. */
  const createTree = async () => {
    if (!output.subtotals) { await messageBox.alert("Trees Formating Not Possible For This Report", "Tree Creation Failure", "warning"); return; }
    if (tree) { setTree(false); setClosed(new Set()); onStatus({ hotKeys: GRID_KEYS, message: "Tree format removed" }); return; }
    if (output.groups.length === 0) { await messageBox.alert("No groups selected\nTrees can be created only for groups", "Tree Creation Failure", "warning"); return; }
    setTree(true);
    setCollapsed(false);
    showLevel(output.groups.length - 1);
    setCursor({ row: 0, col: at.col });
    onStatus({ hotKeys: TREE_KEYS, message: "Click ⊞ / ⊟ (or Enter on a subtotal) to open or close a group" });
    scroller.current?.focus();
  };

  /** Btn_Group_Create_Click / ResetGroupReport: "Create Group ?" Yes shows the entries for grouping; No goes back to the report. */
  const createGroup = async () => {
    const yes = await messageBox.confirm("Create Group ?", "Create Group");
    if (!yes) {
      if (groupMode) exitGroup();
      return;
    }
    if (base.rows.length === 0) { await messageBox.alert("Reports are NILL so group can't be created", "Switch to groups FAILED", "error"); return; }
    setGroupBusy(true);
    try {
      const grouped = await loadGroup([]);
      if (!grouped) return;
      setGroupOutput(grouped);
      setGroupMode(true);
      setGroupFields([]);
      setGroupPick("");
      resetView();
      onStatus({ hotKeys: "", message: "Choose the fields to group on, then Generate" });
    } finally {
      setGroupBusy(false);
    }
  };
  /** Leaves Create Group: back to the report as generated (ResetGroupReport's No). */
  const exitGroup = () => {
    setGroupMode(false);
    setGroupOutput(null);
    setGroupFields([]);
    resetView();
    onStatus({ hotKeys: GRID_KEYS, message: "Back to the report" });
    scroller.current?.focus();
  };
  /** The fields a group can be made on (cmb_Fields): the text columns shown, not the amounts. */
  const groupChoices = output.columns.filter((column) => column.align !== "R" && column.align !== "C" && column.kind !== "number");
  /** SetNameOnLabel: the chosen field goes on the groups list, or off it when it is there. */
  const toggleGroupField = async () => {
    const field = groupChoices.find((column) => column.key === groupPick);
    if (!field) { await messageBox.alert(`Can't Add to groups list because,\nGroup selection was blank`, "Group can't be Added", "warning"); return; }
    setGroupFields((current) => (current.includes(field.key) ? current.filter((key) => key !== field.key) : [...current, field.key]));
  };
  /** Btn_Generate_Click: sort on the groups, closing balance within them, subtotals. */
  const generateGroups = async () => {
    if (groupFields.length === 0 && output.subtotals) await messageBox.alert("You Haven't Selected Any Groups\nThis Will Only Generate Final Total", "No Groups Selected", "info");
    setGroupBusy(true);
    try {
      const grouped = await loadGroup(groupFields);
      if (grouped) { setGroupOutput(grouped); resetView(); onStatus({ hotKeys: GRID_KEYS, message: groupFields.length ? `Grouped on ${groupFields.map((key) => output.columns.find((column) => column.key === key)?.caption ?? key).join(" >> ")}` : "Final total only" }); }
    } finally {
      setGroupBusy(false);
    }
  };

  const borderKeys = (keys: Iterable<string>, on: boolean) => setBorders((current) => {
    const next = new Set(current);
    for (const key of keys) if (on) next.add(key); else next.delete(key);
    return next;
  });
  /** BorderOn_Click: the selected cells get a border, and clicks go on drawing borders. */
  const borderOn = () => {
    borderKeys(selectedKeys(), true);
    setDrawing(true);
    onStatus({ hotKeys: "Click : Border a cell / Shift+Click : Down the column / Ctrl+Click : One more cell / Esc : Stop", message: "Drawing borders" });
    scroller.current?.focus();
  };
  /** BorderOff_Click: the selected cells lose their border, and drawing stops. */
  const borderOff = () => {
    borderKeys(selectedKeys(), false);
    setDrawing(false);
    onStatus({ hotKeys: GRID_KEYS, message: "Border removed from the selected cells" });
    scroller.current?.focus();
  };
  /** Send_Email_Click: the ledger confirmation of each party, by e-mail. */
  const email = () => void messageBox.alert(
    "e-Mail is not available in the web version yet.\nThe desktop prints each party's Ledger Confirmation (Ledger_Confirmation.rpt) to PDF and sends it through the company's mail server; neither is set up for the web yet.",
    "Not ported yet",
  );
  const showLog = async () => {
    const entry = shown[at.row];
    if (!entry || (entry.row.ledKey <= 0 && entry.row.processKey <= 0)) { onStatus({ hotKeys: "", message: "Log : put the cursor on a voucher row", red: true }); return; }
    try {
      const table = await loadLog(entry.row.ledKey, entry.row.processKey);
      if (table.columns.length === 0) { await messageBox.alert(table.message || "No log found", "Log"); return; }
      setLogTable(table);
    } catch (error) {
      await messageBox.alert(error instanceof Error ? error.message : String(error), "Log", "error");
    }
  };

  // ---- Keyboard ----
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const page = Math.max(1, Math.floor(viewHeight / ROW) - 2);
    const end = selEnd ?? at;
    const from = event.shiftKey ? end : at;
    const moves: Record<string, Point> = {
      ArrowDown: { row: from.row + 1, col: from.col }, ArrowUp: { row: from.row - 1, col: from.col },
      ArrowRight: { row: from.row, col: from.col + 1 }, ArrowLeft: { row: from.row, col: from.col - 1 },
      PageDown: { row: from.row + page, col: from.col }, PageUp: { row: from.row - page, col: from.col },
    };
    if (event.ctrlKey && event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const column = columns[at.col];
      if (column) { layout.shiftColumn(column.key, event.key === "ArrowLeft" ? -1 : 1); setCursor({ row: at.row, col: at.col + (event.key === "ArrowLeft" ? -1 : 1) }); }
      return;
    }
    if (event.key in moves) { event.preventDefault(); go(moves[event.key], event.shiftKey); setTyped(""); return; }
    switch (event.key) {
      case "Home": event.preventDefault(); go(event.ctrlKey ? { row: 0, col: 0 } : { row: from.row, col: 0 }, event.shiftKey); setTyped(""); return;
      case "End": event.preventDefault(); go(event.ctrlKey ? { row: shown.length - 1, col: columns.length - 1 } : { row: from.row, col: columns.length - 1 }, event.shiftKey); setTyped(""); return;
      case "F6":
        event.preventDefault();
        if (tree) showLevel(0); else { setCollapsed(true); setCursor({ row: 0, col: at.col }); setSelEnd(null); }
        onStatus({ hotKeys: tree ? TREE_KEYS : GRID_KEYS, message: tree ? "All groups closed" : "Summarized" });
        return;
      case "F4":
        event.preventDefault();
        if (tree) setClosed(new Set()); else { setCollapsed(false); setCursor({ row: 0, col: at.col }); setSelEnd(null); }
        onStatus({ hotKeys: tree ? TREE_KEYS : GRID_KEYS, message: tree ? "All groups open" : "Unsummarized" });
        return;
      case "Enter": {
        const entry = shown[at.row];
        if (tree && entry?.row.kind === "subtotal") { event.preventDefault(); toggleNode(entry.index); }
        return;
      }
      case "Backspace": event.preventDefault(); setTyped((text) => text.slice(0, -1)); return;
      case "Escape":
        event.preventDefault();
        if (drawing) { setDrawing(false); onStatus({ hotKeys: GRID_KEYS, message: "Border drawing stopped" }); }
        else if (typed || selEnd || picked.size > 0) { setTyped(""); setSelEnd(null); setPicked(new Set()); }
        else if (groupMode) exitGroup();
        else onBack();
        return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Type to find: the next row whose cell in the current column starts with what was typed.
      event.preventDefault();
      const text = (typed + event.key).toUpperCase();
      const column = columns[at.col];
      if (!column) return;
      const cell = (row: number) => (shown[row]?.row.values[column.key] ?? "").trimStart().toUpperCase();
      let found = -1;
      for (let step = 0; step < shown.length && found < 0; step += 1) { const row = (at.row + (typed === "" ? 1 : 0) + step) % shown.length; if (cell(row).startsWith(text)) found = row; }
      if (found >= 0) { go({ row: found, col: at.col }, false); setTyped(text); }
      else onStatus({ hotKeys: "", message: `Not found in ${column.caption} : ${text}`, red: true });
    }
  };

  // ---- Mouse ----
  const pointOf = (event: ReactMouseEvent): Point | null => {
    const cell = (event.target as Element).closest("[data-col]");
    const row = (event.target as Element).closest("[data-row]");
    if (!row) return null;
    return { row: Number(row.getAttribute("data-row")), col: cell ? Number(cell.getAttribute("data-col")) : at.col };
  };
  const mouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as Element).closest(".rp-tree-node, .mp-head")) return;
    const point = pointOf(event);
    if (!point) return;
    setTyped("");
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click: one more single cell (or out again), as Excel; drawing, it gets a border too.
      event.preventDefault();
      const key = cellKey(point.row, point.col);
      const here = cellKey(at.row, at.col);
      setPicked((current) => { const next = new Set(current); if (next.size === 0 && here) next.add(here); if (next.has(key)) next.delete(key); else next.add(key); return next; });
      if (drawing) borderKeys([key], !borders.has(key));
      return;
    }
    if (event.shiftKey) {
      event.preventDefault();
      if (drawing) {
        // Shift+click while drawing: the cells from the current one to this row, down the current column.
        const keysDown: string[] = [];
        for (let row = Math.min(at.row, point.row); row <= Math.max(at.row, point.row); row += 1) { const key = cellKey(row, at.col); if (key) keysDown.push(key); }
        borderKeys(keysDown, true);
        setSelEnd({ row: point.row, col: at.col });
        return;
      }
      setSelEnd(point);
      return;
    }
    setCursor(point);
    setSelEnd(null);
    setPicked(new Set());
    if (drawing) { const key = cellKey(point.row, point.col); borderKeys([key], !borders.has(key)); return; }
    dragging.current = true;
  };
  const mouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragging.current || event.buttons !== 1) return;
    const point = pointOf(event);
    if (point && (point.row !== at.row || point.col !== at.col || selEnd)) setSelEnd(point);
  };
  const contextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const headCell = (event.target as Element).closest("[data-head]");
    const point = pointOf(event);
    const key = headCell?.getAttribute("data-head") ?? (point ? columns[point.col]?.key : undefined);
    if (!key) return;
    event.preventDefault();
    if (point && !isSelected(point.row, point.col)) { setCursor(point); setSelEnd(null); setPicked(new Set()); }
    else if (headCell) { const col = columns.findIndex((column) => column.key === key); if (col >= 0) setCursor({ row: at.row, col }); }
    setMenu({ x: event.clientX, y: event.clientY, key });
  };

  // ---- Drawing ----
  const rowColours = (row: OutputRow): { background?: string; bold: boolean } => {
    if (row.kind === "total") return { background: output.levelColours["-1"] ?? "Pink", bold: true };
    if (row.kind === "subtotal") return { background: output.levelColours[String(row.level)] ?? "MistyRose", bold: true };
    const heading = output.headingColours[row.rowType];
    return heading ? { background: heading, bold: true } : { bold: false };
  };
  const rowStyle = (row: OutputRow): CSSProperties | undefined => {
    const colours = rowColours(row);
    return colours.background ? { background: colours.background, fontWeight: 700 } : undefined;
  };

  // ---- Output (print / export), with the grid's heading and subtotal colours ----
  const gridOutput = useGridOutput({
    table: () => {
      const fills = new Map<string, string>();
      const styleOf = (row: OutputRow): ExportRowStyle | null => {
        const colours = rowColours(row);
        if (!colours.background && !colours.bold) return null;
        const name = colours.background ?? "";
        if (name && !fills.has(name)) fills.set(name, hexColour(name));
        return { fill: name ? fills.get(name) : undefined, bold: colours.bold };
      };
      return exportTableFrom(
        { company: companyName, title: output.title || fallbackTitle, titleRight: output.dateLine, footerCenter: `${output.records} entries` },
        columns.map((column) => ({ caption: column.caption, kind: column.kind, decimals: column.decimals, align: column.align === "R" ? "right" : column.align === "C" ? "center" : "left", width: widthOf(column), summed: false })),
        shown.map(({ row }) => columns.map((column) => (row.values[column.key] ?? "").replace(/,/g, column.kind === "number" ? "" : ","))),
        shown.map(({ row }) => styleOf(row)),
      );
    },
    name: output.title || fallbackTitle,
    sheet: (output.title || fallbackTitle).slice(0, 31),
    csv: () => [columns.map((column) => column.caption), ...shown.map(({ row }) => columns.map((column) => row.values[column.key] ?? ""))],
    shownRows: shown.length,
    totalRows: output.rows.length,
    unsaved: false,
    userName,
    width: totalWidth,
    ask: (text, heading) => messageBox.alert(text, heading),
    onPreviewClose: () => scroller.current?.focus(),
  });
  const rightsCheck = async (right: "print" | "preview" | "export", run: () => void) => {
    if (!rights[right]) { await messageBox.alert(`${right === "print" ? "Print" : right === "preview" ? "Preview" : "Export"} Rights Not Available For User`, "Rights Validation", "error"); return; }
    run();
  };
  const guardedOutput = {
    ...gridOutput,
    print: () => rightsCheck("print", () => void gridOutput.print()),
    preview: () => rightsCheck("preview", () => void gridOutput.preview()),
    excel: () => rightsCheck("export", () => void gridOutput.excel()),
    pdf: () => rightsCheck("export", () => void gridOutput.pdf()),
    csv: () => rightsCheck("export", () => void gridOutput.csv()),
  };

  /**
   * C1_OUTPUT.AllowMerging = Spill: text too long for its cell runs on over the empty cells to its
   * right ("* Subtotal For : ..." over the empty particulars). The cells it covers are not drawn.
   */
  const spill = (row: OutputRow) => {
    const cells: { column: OutputColumn; col: number; width: number }[] = [];
    for (let col = 0; col < columns.length; col += 1) {
      const column = columns[col];
      const start = col;
      let width = widthOf(column);
      const value = row.values[column.key] ?? "";
      if (column.kind === "text" && value !== "" && value.length * 7 > width) {
        while (col + 1 < columns.length && (row.values[columns[col + 1].key] ?? "") === "" && value.length * 7 > width) {
          col += 1;
          width += widthOf(columns[col]);
        }
      }
      cells.push({ column, col: start, width });
    }
    return cells;
  };
  /** GetBorderMargins: a bordered cell's edges, thick on the outside of the block, thin inside. */
  const borderStyle = (position: number, col: number): CSSProperties | undefined => {
    if (!borders.has(cellKey(position, col))) return undefined;
    const has = (rowAt: number, colAt: number) => borders.has(cellKey(rowAt, colAt));
    const top = has(position - 1, col) ? 0 : BORDER_OUT;
    const left = has(position, col - 1) ? 0 : BORDER_OUT;
    const bottom = has(position + 1, col) ? BORDER_IN : BORDER_OUT;
    const right = has(position, col + 1) ? BORDER_IN : BORDER_OUT;
    // The cell is tinted with the border colour too, so the bordered cells read as coloured.
    return { background: `${borderColour}2e`, boxShadow: `inset 0 ${top}px 0 ${borderColour}, inset ${left}px 0 0 ${borderColour}, inset 0 -${bottom}px 0 ${borderColour}, inset -${right}px 0 0 ${borderColour}` };
  };
  const align = (column: OutputColumn) => (column.align === "R" ? "right" : column.align === "C" ? "center" : "left");
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 5);
  const last = Math.min(shown.length, first + Math.ceil(viewHeight / ROW) + 10);

  return (
    <div className="rp-output">
      <div className="rp-output-head">
        <b>{output.title}</b>
        <span>{output.dateLine}</span>
        <span>{output.selectionLine}</span>
      </div>
      {groupMode && (
        <div className="rp-group-bar" role="group" aria-label="Create Group">
          <b>Group On</b>
          <select aria-label="Field to group on" value={groupPick} onChange={(event) => setGroupPick(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void toggleGroupField(); } }}>
            <option value="">— choose a field —</option>
            {groupChoices.map((column) => <option key={column.key} value={column.key}>{column.caption}</option>)}
          </select>
          <button type="button" className="mp-btn mp-btn-plain" onClick={() => void toggleGroupField()} title="Put the field on the groups list, or take it off">{groupFields.includes(groupPick) ? "Remove" : "Add"}</button>
          <span className="rp-group-list" title="Groups, outermost first">{groupFields.map((key) => `${output.columns.find((column) => column.key === key)?.caption ?? key}>>`).join("") || "No groups yet"}</span>
          <button type="button" className="mp-btn mp-btn-green" onClick={() => void generateGroups()} disabled={groupBusy}>{groupBusy ? "Generating…" : "Generate"}</button>
          <button type="button" className="mp-btn mp-btn-red" onClick={exitGroup} disabled={groupBusy} title="Leave Create Group and go back to the report"><Icon name="quit" />Exit Group</button>
        </div>
      )}
      <div className="mp-update">
        <div
          className={`mp-scroll rp-out-scroll ${drawing ? "rp-drawing" : ""}`}
          ref={scroller}
          tabIndex={0}
          role="grid"
          aria-label={output.title}
          onKeyDown={keys}
          onMouseDown={mouseDown}
          onMouseMove={mouseMove}
          onContextMenu={contextMenu}
          onFocus={() => onStatus({ hotKeys: tree ? TREE_KEYS : GRID_KEYS, message: drawing ? "Drawing borders · Esc stops" : "Shift+Click or drag: a block · Ctrl+Click: more cells · type to find · right-click: columns" })}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="mp-grid" style={{ height: (shown.length + 1) * ROW, minWidth: totalWidth + 20 }}>
            <div className="mp-row mp-head" style={{ top: 0 }}>
              <div className="mp-cell mp-rownum rp-count" title="Entries">{output.records}</div>
              {tree && <div className="mp-cell rp-tree" aria-hidden="true" />}
              {columns.map((column, col) => (
                <div key={column.key} data-head={column.key} className={`mp-cell ${col === at.col ? "rp-head-on" : ""}`} style={{ width: widthOf(column), textAlign: align(column) }} title={`${column.caption} · right-click to hide · drag the right edge to size`}>
                  <span className="mp-head-label">{column.caption}</span>
                  {layout.resizeHandle(column)}
                </div>
              ))}
            </div>
            {shown.slice(first, last).map(({ row, index: source }, offset) => {
              const position = first + offset;
              const current = position === at.row;
              const style = rowStyle(row);
              return (
                <div key={source} className={`mp-row ${position % 2 ? "mp-alt" : ""} ${current ? "mp-current-row" : ""} rp-${row.kind}`} style={{ top: (position + 1) * ROW }} data-row={position}>
                  <div className="mp-cell mp-rownum" aria-hidden="true">{current ? "▶" : ""}</div>
                  {tree && (
                    <div className="mp-cell rp-tree">
                      {row.kind === "subtotal" && <button type="button" tabIndex={-1} className="rp-tree-node" aria-label={closed.has(source) ? "Open group" : "Close group"} title={closed.has(source) ? "Open group" : "Close group"} onClick={() => toggleNode(source)}>{closed.has(source) ? "⊞" : "⊟"}</button>}
                    </div>
                  )}
                  {spill(row).map(({ column, col, width }) => {
                    const here = current && col === at.col;
                    const text = row.values[column.key] ?? "";
                    const selected = isSelected(position, col);
                    return (
                      <div
                        key={column.key}
                        data-col={col}
                        className={`mp-cell ${here ? "rp-cell-on" : ""} ${selected ? "rp-cell-sel" : ""}`}
                        style={{ width, textAlign: align(column), ...(current || selected ? {} : style), ...borderStyle(position, col) }}
                        title={text}
                      >
                        {here && typed ? <FoundText text={text} typed={typed} /> : text}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <GridButtons
        source="report"
        busy={busy || groupBusy}
        output={guardedOutput as unknown as typeof gridOutput}
        refresh={{ onClick: () => { setGroupMode(false); setGroupOutput(null); onRefresh(); }, title: "Generate the report again" }}
        beforeQuit={(
          <>
            <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-btn mp-btn-plain" onClick={() => void createTree()} title={tree ? "Remove the tree format" : "Show the groups as a tree that opens and closes"}><Icon name="tree" /><HotkeyLabel text={tree ? "Remove Tree" : "Create Tree"} hotkey="c" /></button>
            <button type="button" data-hotkey="g" aria-keyshortcuts="Alt+G" className={`mp-btn mp-btn-plain ${groupMode ? "rp-btn-on" : ""}`} onClick={() => void createGroup()} disabled={groupBusy} title="Group the entries on fields of your choice"><Icon name="columns" /><HotkeyLabel text="Create Group" hotkey="g" /></button>
            <button type="button" data-hotkey="o" aria-keyshortcuts="Alt+O" className={`mp-btn mp-btn-plain ${drawing ? "rp-btn-on" : ""}`} onClick={borderOn} title="Border the selected cells, then click cells to border them (Esc stops)"><Icon name="border" /><HotkeyLabel text="Border On" hotkey="o" /></button>
            <button type="button" data-hotkey="b" aria-keyshortcuts="Alt+B" className="mp-btn mp-btn-plain" onClick={borderOff} title="Remove Border from the selected cells, and stop drawing"><Icon name="borderOff" /><HotkeyLabel text="Border Off" hotkey="b" /></button>
            <button type="button" data-hotkey="e" aria-keyshortcuts="Alt+E" className="mp-btn mp-btn-plain rp-colour-btn" onClick={() => colourInput.current?.click()} title="Border Colour"><span className="rp-colour-swatch" style={{ background: borderColour }} aria-hidden="true" /><HotkeyLabel text="Border Colour" hotkey="e" /></button>
            <input ref={colourInput} type="color" className="rp-colour-input" tabIndex={-1} aria-label="Border colour" value={borderColour} onChange={(event) => setBorderColour(event.target.value)} />
            <button type="button" data-hotkey="m" aria-keyshortcuts="Alt+M" className="mp-btn mp-btn-blue" onClick={email} title="e-Mail the ledger confirmation"><Icon name="mail" /><HotkeyLabel text="eMail" hotkey="m" /></button>
            <button type="button" data-hotkey="l" aria-keyshortcuts="Alt+L" className="mp-btn mp-btn-blue" onClick={() => void showLog()} disabled={busy} title="The edit log of the voucher of the current row"><Icon name="log" /><HotkeyLabel text="Log" hotkey="l" /></button>
          </>
        )}
        quit={{ onClick: onQuit }}
        arrange={{ onClick: () => setArranging(true), hidden: layout.hiddenColumns.length }}
        search={{ id: "rp-search", value: search, onChange: (value) => { setSearch(value); setCursor({ row: 0, col: at.col }); setSelEnd(null); } }}
        clearFilters={search ? () => setSearch("") : null}
      />
      {gridOutput.dialogs}
      {menu && <GridMenu at={menu} items={columnMenuItems(layout, menu.key, () => setArranging(true))} onClose={() => { setMenu(null); scroller.current?.focus(); }} />}
      {arranging && (
        <ArrangeColumns
          items={layout.arrangeItems((column) => column.caption)}
          changed={layout.columnOrder.length > 0}
          onMove={layout.placeColumn}
          onToggle={layout.toggleColumn}
          onShowAll={() => layout.setHiddenColumns([])}
          onResetOrder={() => layout.setColumnOrder([])}
          onClose={() => { setArranging(false); scroller.current?.focus(); }}
        />
      )}
      {logTable && <LogViewer table={logTable} title={`${output.title || fallbackTitle} Log`} onClose={() => { setLogTable(null); scroller.current?.focus(); }} />}
    </div>
  );
}
