"use client";

import { GROUP_PREFIX, withGroups } from "../../lib/report/growth";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ExportRowStyle } from "../../lib/export/table";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";
import { ArrangeColumns } from "../grid/ArrangeColumns";
import { FilterButton, FilterPopup, useColumnFilters } from "../grid/ColumnFilter";
import { filterHolds, sortedDistinct, statsOf } from "../grid/filter";
import type { ColumnStats } from "../grid/filter";
import { exportTableFrom } from "../grid/exportTable";
import { FoundText } from "../grid/FoundText";
import { useZoom } from "./zoom";
import { GridRibbon, RibbonAction, RibbonOutputButton } from "../grid/GridRibbon";
import { columnMenuItems, GridMenu } from "../grid/GridMenu";
import type { GridMenuItem, GridMenuPlace } from "../grid/GridMenu";
import { closingSubtotal, headingLevelOf, resolveLevelColours, rowLook, DARK_GRAND_TOTAL_COLOUR, DARK_LEVEL_COLOURS, NO_SCREEN_COLOUR } from "../grid/levelStyle";
import { useModernDark } from "../ui/modernTheme";
import type { RowKind, RowLook } from "../grid/levelStyle";
import { LogViewer } from "../grid/LogViewer";
import type { LogTable } from "../grid/LogViewer";
import { selectionTotals } from "../grid/totals";
import { useColumnLayout } from "../grid/useColumnLayout";
import { useGridOutput } from "../grid/useGridOutput";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import { ReportChart } from "./ReportChart";
import { applyGroupBy, removeGroups } from "../../lib/report/groupBy";
import type { GroupSpec } from "../../lib/report/groupBy";
import { BudgetPanel } from "./BudgetPanel";
import { GrowthPanel } from "./GrowthPanel";
import { GroupByPanel } from "./GroupByPanel";
import { PivotPanel } from "./PivotPanel";
import { applyPivot } from "../../lib/report/pivot";
import type { PivotSpec } from "../../lib/report/pivot";
import { computeSumif, pivotHintProblem, resolvePivotHint } from "../../lib/report/pivotHint";
import type { PivotHint, SumifHint } from "../../lib/report/pivotHint";
import { FormulaColumns } from "./FormulaColumns";
import { cellValue, entryIndexes, excelFormulas, withFormulaColumns, workOut } from "../../lib/report/formulaColumns";
import { listOpenReports, notifyOpenReports, openReportsVersion, registerOpenReport, subscribeOpenReports } from "../../lib/report/openReports";
import type { FormulaColumn } from "../../lib/report/formulaColumns";
import { xlsxHeadRow } from "../../lib/export/xlsx";
import { ReportCompare } from "./ReportCompare";
import type { CompareResult } from "./ReportCompare";

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
 * - Filters: a report with no group heading rows has the ▾ column filters of the other grids (the
 *   Register with no group keeps its month subtotals). With a column filter or the search box in
 *   use, the subtotals, the final total (and the day book's "Total Entries") are worked out again
 *   from the rows shown; a subtotal whose group has no row left is not drawn.
 * - Chart (web only): summary cards and a donut of an amount column by group (ReportChart).
 * - Log (btn_Log_Click): the edit log of the voucher of the current row.
 * - Excel, PDF, Print and Preview keep the headings', subtotals' and total's colours.
 */

const NO_GROUPS: readonly GroupSpec[] = [];
const ROW = 22;
const MARK = 16;
const TREE = 20;
const BORDER_OUT = 3;
const BORDER_IN = 1;
const TREE_KEYS = "F6 : Close / F4 : Open Tree";
const GRID_KEYS = "F6 : Summarize F4 : Unsummarize";

type Point = { row: number; col: number };

const NO_FORMULAS: readonly FormulaColumn[] = [];

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

/** A spreadsheet's column letters: 0 is A, 25 is Z, 26 is AA. */
export function columnLetters(index: number): string {
  let letters = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) letters = String.fromCharCode(65 + (n % 26)) + letters;
  return letters;
}

const NO_ROWS: ReadonlySet<number> = new Set();

export function OutputGrid({ output: base, fallbackTitle, companyName, userName, rights, busy, onRefresh, onQuit, loadLog, loadZoom, loadGroup, loadCompare, comparePeriod, yearStart, yearEnd, onStatus, onInfo, initialGroupBy, onGroupBy, initialPivot, initialSumif }: {
  output: ReportOutput;
  fallbackTitle: string;
  companyName: string;
  userName: string;
  rights: Readonly<{ print: boolean; preview: boolean; export: boolean }>;
  busy: boolean;
  onRefresh: () => void;
  onQuit: () => void;
  loadLog: (ledKey: number, processKey: number, master?: { id: number; code: number; first: string; small?: boolean }) => Promise<LogTable>;
  /** Enter on a voucher row: the entry program that opens it (or why it cannot). */
  loadZoom: (request: { ledKey: number; processKey: number; acCode: number; name: string }) => Promise<{ entryName?: string; ledKey?: number; reportName?: string; acCode?: number; message?: string }>;
  /** Create Group: the report's entries grouped on these fields (none: the final total only). */
  loadGroup: (fields: readonly string[]) => Promise<ReportOutput | null>;
  /** Compare periods: the report for other dates of the year, and the dates this one is for. */
  loadCompare: (from: string, upto: string, lastYear?: boolean) => Promise<CompareResult>;
  comparePeriod: Readonly<{ from: string; upto: string }>;
  yearStart: string;
  yearEnd: string;
  onStatus: (status: OutputStatus) => void;
  /** What the status line shows for the grid: its rows, and the selected cells' total. */
  onInfo: (rows: string, totals: string) => void;
  /** Group By to start with (a saved view), and told whenever it changes (to save it with a view). */
  initialGroupBy?: readonly GroupSpec[];
  /** A pivot asked for in words (Ask AI): set up on the first output that has the columns it names. */
  initialPivot?: PivotHint;
  /** A SUMIF asked for in words (Ask AI): worked out once on the first output and shown as a message. */
  initialSumif?: SumifHint;
  onGroupBy?: (specs: readonly GroupSpec[]) => void;
}) {
  // ---- Create Group (C1_OUTPUT_GROUP) ----
  const [groupMode, setGroupMode] = useState(false);
  const [groupOutput, setGroupOutput] = useState<ReportOutput | null>(null);
  const [groupFields, setGroupFields] = useState<string[]>([]);
  const [groupPick, setGroupPick] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  /** Group By: the levels the rows on screen are regrouped by (none: the report as it is). */
  // (kept with the report it was set for, so a report generated again starts ungrouped)
  const [grouping, setGrouping] = useState<{ forBase: ReportOutput; specs: readonly GroupSpec[] }>({ forBase: base, specs: initialGroupBy ?? [] });
  const groupSpecs = grouping.forBase === base ? grouping.specs : NO_GROUPS;
  const setGroupSpecs = (specs: readonly GroupSpec[]) => { setGrouping({ forBase: base, specs }); onGroupBy?.(specs); };
  const served = groupMode && groupOutput ? groupOutput : base;
  /** Remove Group: the group headings and subtotal lines taken off (kept with the report it was set for). */
  const [ungroup, setUngroup] = useState<{ forBase: ReportOutput; forServed: ReportOutput } | null>(null);
  const ungrouped = ungroup !== null && ungroup.forBase === base && ungroup.forServed === served;
  /** Pivot: the rows on screen as a cross table (kept with the report it was set for). */
  const [pivoting, setPivoting] = useState<{ forBase: ReportOutput; spec: PivotSpec } | null>(null);
  const pivotSpec = pivoting !== null && pivoting.forBase === base ? pivoting.spec : null;
  /** Add Column: the columns added with a formula (kept with the report they were added to). */
  const [formulaCols, setFormulaCols] = useState<{ forBase: ReportOutput; list: readonly FormulaColumn[] }>({ forBase: base, list: [] });
  const formulaSpecs = formulaCols.forBase === base ? formulaCols.list : NO_FORMULAS;
  const [formulaOpen, setFormulaOpen] = useState(false);
  // VLOOKUP reads the other open reports: the columns are worked out again when one opens, closes or changes.
  const openReports = useSyncExternalStore(subscribeOpenReports, openReportsVersion, () => 0);
  /** The report with its added columns, before any pivot: the pivot takes its fields and values from these, the added columns among them. */
  const withAdded = useMemo(() => withFormulaColumns(served, formulaSpecs), [served, formulaSpecs, openReports]); // eslint-disable-line react-hooks/exhaustive-deps
  const shaped = useMemo(() => (pivotSpec ? applyPivot(withAdded, pivotSpec) : ungrouped ? removeGroups(served) : applyGroupBy(served, groupSpecs)), [served, withAdded, groupSpecs, ungrouped, pivotSpec]);
  // A pivot already has the added columns worked in (they are its fields and values); otherwise they follow the grouping, as before.
  const output = useMemo(() => (pivotSpec ? shaped : withFormulaColumns(shaped, formulaSpecs)), [shaped, formulaSpecs, openReports, pivotSpec]); // eslint-disable-line react-hooks/exhaustive-deps

  const [collapsed, setCollapsed] = useState(false);
  const [tree, setTree] = useState(false);
  /** Freeze: the columns up to this one (by key) stay in sight while the grid scrolls sideways. */
  const [frozenKey, setFrozenKey] = useState<string | null>(null);
  /** Closed tree nodes: indexes of subtotal rows in output.rows. */
  const [closed, setClosed] = useState<ReadonlySet<number>>(new Set());
  const [cursor, setCursor] = useState<Point>({ row: 0, col: 0 });
  const [selEnd, setSelEnd] = useState<Point | null>(null);
  /** Whether the current selection includes the column header when copied (e.g. clicked column header or copied with header). */
  const [headerSelected, setHeaderSelected] = useState(false);
  /** Single cells added with Ctrl+click ("rowIndex|columnKey", rowIndex in output.rows). */
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [borders, setBorders] = useState<ReadonlySet<string>>(new Set());
  const [borderColour] = useState("#ff0000");
  const [drawing, setDrawing] = useState(false);
  const [logTable, setLogTable] = useState<LogTable | null>(null);
  const [menu, setMenu] = useState<(GridMenuPlace & { key: string }) | null>(null);
  const [arranging, setArranging] = useState(false);
  /** The side panel: the chart, or the comparison with another period. */
  /** The growth panel's pick of parties that are report groups (area, zone ...): their heading is on a row of its own, so the rows under it are the ones let through. */
  const [groupGate, setGroupGate] = useState<ReadonlySet<unknown> | null>(null);
  const [panel, setPanel] = useState<"chart" | "compare" | "budget" | "groupby" | "growth" | "pivot" | null>(null);
  /** The side panel (Growth, Budget, Compare, Chart ...) shrunk to a strip so the grid has the room; opening another panel shows it again. */
  const [panelMin, setPanelMin] = useState(false);
  /** The side panel over the whole grid area (Growth, Budget, Compare, Chart, Group By, Pivot), as a maximized window. */
  const [panelMax, setPanelMax] = useState(false);
  const [panelShown, setPanelShown] = useState(panel);
  if (panelShown !== panel) { setPanelShown(panel); setPanelMin(false); setPanelMax(false); }
  const charting = panel === "chart";
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(500);
  const scroller = useRef<HTMLDivElement>(null);
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
  // This report, as the other windows' VLOOKUP sees it: its names, its columns as shown, and the cells of its entry rows.
  const lookupSource = useRef({ output, columns, fallbackTitle });
  useEffect(() => { lookupSource.current = { output, columns, fallbackTitle }; });
  const [ownSnapshot] = useState(() => () => {
    const { output: current, columns: shown, fallbackTitle: name } = lookupSource.current;
    const entries = entryIndexes(current);
    return {
      titles: [name, current.title].filter((text) => text.trim() !== ""),
      columns: shown.map((column) => ({ key: column.key, caption: column.caption })),
      rows: entries.map((index) => shown.map((column) => cellValue(current.rows[index].values[column.key], column))),
    };
  });
  useEffect(() => registerOpenReport(ownSnapshot), [ownSnapshot]);
  // The other windows work their formulas out again when this report changes (its added columns do not count: they follow this report).
  // (From what the report is made of, not from `shaped`: with a pivot that changes whenever another report opens, which would notify again and again.)
  useEffect(() => { notifyOpenReports(); }, [served, groupSpecs, ungrouped, pivotSpec]);

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

  // ---- Column filters (a report with no group heading rows) and the search box ----
  // Subtotals without headings (the Register's month totals) keep the filters: each is worked out again from the rows shown.
  const filterable = !output.rows.some((row) => row.kind === "data" && (row.rowType === "GAP" || (row.rowType !== "FT" && output.headingColours[row.rowType] !== undefined)));
  const columnFilters = useColumnFilters();
  const { filters } = columnFilters;
  const clearAllFilters = columnFilters.clearAll;
  useEffect(() => { clearAllFilters(); }, [output, clearAllFilters]);
  const activeFilters = filterable ? Object.keys(filters).length : 0;
  /** Rows hidden with Delete (their index in output.rows), and the sets before each Delete, which Ctrl+Z brings back one step at a time. */
  const [hiding, setHiding] = useState<{ forOutput: ReportOutput; rows: ReadonlySet<number> }>({ forOutput: output, rows: new Set() });
  // A new output (a refresh, another run) brings every hidden row back.
  const deleted = hiding.forOutput === output ? hiding.rows : NO_ROWS;
  const setDeleted = (rows: ReadonlySet<number>) => setHiding({ forOutput: output, rows });
  const needle = search.trim().toUpperCase();
  /** The rows a filter or the search can leave out: the entries, not the total or the day book's "Total Entries" line. */
  const filteredKind = (row: OutputRow) => row.kind === "data" && row.rowType !== "COUNT" && row.rowType !== "FT";
  /** Whether a row passes the search and every column filter but `except` (the one whose list is being opened). */
  const rowIndex = useMemo(() => new Map(output.rows.map((row, index) => [row, index])), [output]);
  /** A cell's colour as the grid draws it: its border colour when one was drawn on it, else the report's own cell colour ("" none). */
  const colourOf = (row: OutputRow, key: string) => (borders.has(`${rowIndex.get(row) ?? -1}|${key}`) ? borderColour : (row.cellColours?.[key] ?? ""));
  /** The average and ranks of a figure column's entries (for Above / Below Average and Top / Bottom N), worked out once for each output. */
  const statsByColumn = useMemo(() => {
    const map = new Map<string, ColumnStats>();
    const needed = Object.entries(filters).filter(([, filter]) => ["aboveAvg", "belowAvg", "top", "bottom"].some((op) => filter.first?.op === op || filter.second?.op === op)).map(([key]) => key);
    for (const key of needed) {
      map.set(key, statsOf(output.rows.filter((row) => row.kind === "data" && row.rowType !== "COUNT" && row.rowType !== "FT").flatMap((row) => { const text = (row.values[key] ?? "").replace(/,/g, "").trim(); const figure = Number(text); return text !== "" && Number.isFinite(figure) ? [figure] : []; })));
    }
    return map;
  }, [output, filters]);
  const statsFor = (column: OutputColumn): ColumnStats | undefined => statsByColumn.get(column.key);
  const passes = (row: OutputRow, except?: string) => {
    if (!filteredKind(row)) return true;
    if (groupGate !== null && !groupGate.has(row)) return false;
    if (deleted.size > 0 && deleted.has(rowIndex.get(row) ?? -1)) return false;
    if (needle !== "" && !Object.values(row.values).some((value) => value.toUpperCase().includes(needle))) return false;
    if (activeFilters === 0) return true;
    return Object.entries(filters).every(([key, columnFilter]) => {
      if (key === except) return true;
      const column = output.columns.find((candidate) => candidate.key === key);
      const value = row.values[key] ?? "";
      return !column || filterHolds(column.kind, columnFilter, value.replace(/,/g, ""), value, { colour: columnFilter.colours ? colourOf(row, key) : undefined, stats: statsFor(column) });
    });
  };
  /** The colours the column's cells have, among the rows the other filters let through (nothing when the column has just one). */
  const coloursOf = (column: OutputColumn): string[] => {
    const seen = new Set<string>();
    for (const row of output.rows) if (filteredKind(row) && passes(row, column.key)) seen.add(colourOf(row, column.key));
    return seen.size > 1 || (seen.size === 1 && !seen.has("")) ? [...seen].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))) : [];
  };
  const valuesOf = (column: OutputColumn) => sortedDistinct(output.rows.filter((row) => filteredKind(row) && passes(row, column.key)).map((row) => row.values[column.key] ?? ""));

  /**
   * The rows shown, with their index in output.rows. With a filter or a search in use the final
   * total holds the shown entries' sums (the columns the total sums), each subtotal the sums of the
   * shown entries of its group (a group with none left is not drawn), and "Total Entries" their count.
   */
  const shown = useMemo(() => {
    const hidden = new Set<number>();
    if (tree) for (const node of closed) { const start = groupStart.get(node) ?? node; for (let at = start; at < node; at += 1) hidden.add(at); }
    const narrowed = needle !== "" || activeFilters > 0 || deleted.size > 0;
    const list: { row: OutputRow; index: number }[] = [];
    const sums = new Map<string, number>();
    /** Per subtotal level, the shown entries' sums and count since that level's last subtotal. */
    const groupSums: { sums: Map<string, number>; count: number }[] = [];
    const groupAt = (level: number) => (groupSums[level] ??= { sums: new Map(), count: 0 });
    let deepest = -1;
    for (const row of output.rows) if (row.kind === "subtotal" && row.level > deepest) deepest = row.level;
    const summed = (row: OutputRow, totals: Map<string, number>) => {
      const values = { ...row.values };
      for (const column of output.columns) {
        if (column.kind !== "number" || (row.values[column.key] ?? "") === "") continue;
        values[column.key] = (totals.get(column.key) ?? 0).toLocaleString("en-IN", { minimumFractionDigits: column.decimals, maximumFractionDigits: column.decimals });
      }
      return { ...row, values };
    };
    // A report with subtotals: the final total's caption goes in the column the subtotals' captions are in (the one most of them start in).
    const captionAt = new Map<string, number>();
    for (const row of output.rows) {
      if (row.kind !== "subtotal") continue;
      const column = output.columns.find((candidate) => candidate.kind !== "number" && (row.values[candidate.key] ?? "") !== "");
      if (column) captionAt.set(column.key, (captionAt.get(column.key) ?? 0) + 1);
    }
    const captionKey = [...captionAt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const toCaptionColumn = (row: OutputRow): OutputRow => {
      if (captionKey === undefined || !(row.kind === "total" || (row.kind === "data" && row.rowType === "FT")) || (row.values[captionKey] ?? "") !== "") return row;
      const from = output.columns.find((candidate) => candidate.kind !== "number" && (row.values[candidate.key] ?? "") !== "");
      if (!from) return row;
      return { ...row, values: { ...row.values, [captionKey]: row.values[from.key] ?? "", [from.key]: "" } };
    };
    let entries = 0;
    output.rows.forEach((row, index) => {
      if (hidden.has(index)) return;
      if (!passes(row)) return;
      if (narrowed && filteredKind(row)) {
        for (const column of output.columns) {
          if (column.kind !== "number") continue;
          const amount = Number((row.values[column.key] ?? "").replace(/,/g, "")) || 0;
          sums.set(column.key, (sums.get(column.key) ?? 0) + amount);
          for (let level = 0; level <= deepest; level += 1) groupAt(level).sums.set(column.key, (groupAt(level).sums.get(column.key) ?? 0) + amount);
        }
        for (let level = 0; level <= deepest; level += 1) groupAt(level).count += 1;
        if (row.rowType === "LED") entries += 1;
      }
      let drawn = row;
      if (narrowed && row.kind === "subtotal") {
        const group = groupAt(row.level);
        groupSums[row.level] = { sums: new Map(), count: 0 };
        if (group.count === 0) return;
        drawn = summed(row, group.sums);
      } else if (narrowed && row.kind === "total") {
        drawn = summed(row, sums);
      } else if (narrowed && row.rowType === "COUNT") {
        drawn = { ...row, values: Object.fromEntries(Object.entries(row.values).map(([key, value]) => [key, value.startsWith("Total Entries") ? `Total Entries : ${entries}` : value])) };
      }
      if (!tree && collapsed && row.kind === "data") return;
      list.push({ row: toCaptionColumn(drawn), index });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passes reads the filters and the search
  }, [output, tree, closed, groupStart, collapsed, needle, filters, activeFilters, groupGate, deleted, borders]);
  /** The column the chart filtered the grid on (its picked slice), which the chart itself does not apply. */
  const [openList, setOpenList] = useState<{ key: string; values: string[]; colours: string[] } | null>(null);
  const [chartFilter, setChartFilter] = useState<string | null>(null);
  /** The rows the filters and the search let through, whatever the tree or F6 hides (what the chart counts). */
  const passingIndexes = useMemo(() => new Set(output.rows.flatMap((row, index) => (passes(row) ? [index] : []))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passes reads the filters and the search
    [output, needle, filters, activeFilters, groupGate, deleted]);
  /** The same without the chart's own pick, so its donut stays whole and another slice can be picked. */
  const donutIndexes = useMemo(() => new Set(output.rows.flatMap((row, index) => (passes(row, chartFilter ?? undefined) ? [index] : []))),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passes reads the filters and the search
    [output, needle, filters, activeFilters, chartFilter, groupGate, deleted]);
  /** A slice picked in the chart: the grid's column filtered to its value (null clears it). */
  const filterTo = (columnKey: string, value: string | null) => {
    setChartFilter(value === null ? null : columnKey);
    columnFilters.setFilters((current) => {
      const next = { ...current };
      if (value === null) delete next[columnKey]; else next[columnKey] = { values: [value] };
      return next;
    });
  };
  /** Several values picked in the growth panel (the parties that are new, up or down): the grid's column filtered to them (null clears it). */
  const filterToMany = (columnKey: string, values: string[] | null) => {
    // A pair of columns (salesman then area): the rows whose texts, put together as the growth panel does, are among the picked pairs.
    if (columnKey.includes("")) {
      setChartFilter(null);
      if (values === null) { setGroupGate(null); return; }
      const keys = columnKey.split("");
      const wanted = new Set(values);
      const grouped = withGroups(output).output.rows;
      const text = (value: unknown) => { const trimmed = String(value ?? "").trim(); return trimmed === "" ? "(blank)" : trimmed; };
      setGroupGate(new Set(output.rows.filter((_, index) => wanted.has(keys.map((key) => text(grouped[index]?.values[key])).join(" › ")))));
      return;
    }
    if (columnKey.startsWith(GROUP_PREFIX)) {
      if (values === null) { setGroupGate(null); return; }
      const wanted = new Set(values);
      const grouped = withGroups(output).output.rows;
      setGroupGate(new Set(output.rows.filter((_, index) => wanted.has(String(grouped[index]?.values[columnKey] ?? "")))));
      return;
    }
    setChartFilter(values === null ? null : columnKey);
    // The growth panel names a party trimmed; the cells may hold it padded ("Mumbai   "): the filter is given the cells' own texts.
    const wanted = values === null ? null : new Set(values.map((value) => value.trim()));
    const raw = wanted === null ? null : [...new Set(output.rows.filter((row) => row.kind === "data").map((row) => row.values[columnKey] ?? "").filter((text) => wanted.has(text.trim())))];
    columnFilters.setFilters((current) => {
      const next = { ...current };
      if (raw === null) delete next[columnKey]; else next[columnKey] = { values: raw.length > 0 ? raw : [...(values ?? [])] };
      return next;
    });
  };
  /** A row as drawn (a recalculated total), else as the report gave it. */
  const rowByIndex = useMemo(() => {
    const map = new Map(output.rows.map((row, index) => [index, row]));
    for (const entry of shown) map.set(entry.index, entry.row);
    return map;
  }, [output, shown]);

  const at: Point = { row: Math.min(cursor.row, Math.max(0, shown.length - 1)), col: Math.min(cursor.col, Math.max(0, columns.length - 1)) };
  const box = selEnd === null ? null : { r1: Math.min(at.row, selEnd.row), r2: Math.max(at.row, selEnd.row), c1: Math.min(at.col, selEnd.col), c2: Math.max(at.col, selEnd.col) };
  const cellKey = (position: number, col: number) => { const entry = shown[position]; const column = columns[col]; return entry && column ? `${entry.index}|${column.key}` : ""; };
  const inBox = (row: number, col: number) => box !== null && row >= box.r1 && row <= box.r2 && col >= box.c1 && col <= box.c2;
  const isSelected = (row: number, col: number) => inBox(row, col) || picked.has(cellKey(row, col));
  const isColSelected = (col: number) => {
    if (shown.length === 0) return false;
    if (box !== null && box.r1 === 0 && box.r2 === shown.length - 1 && col >= box.c1 && col <= box.c2) return true;
    if (picked.size >= shown.length && Array.from({ length: shown.length }, (_, r) => cellKey(r, col)).every((k) => picked.has(k))) return true;
    return false;
  };

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
    const byIndex = rowByIndex;
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
  }, [box?.r1, box?.r2, box?.c1, box?.c2, picked, at.row, at.col, columns, shown, output, rowByIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- box is derived from these
  const rowsText = `Rows : ${shown.length === 0 ? 0 : `${at.row + 1}-${shown.length}`}${shown.length !== output.rows.length ? ` of ${output.rows.length}` : ""}${collapsed && !tree ? " · Summary" : ""}${tree ? " · Tree" : ""}${groupMode ? " · Group" : ""}`;
  /**
   * The bordered (coloured) cells' total: those of the current column when it is a number column
   * with borders in it, else every bordered number cell.
   */
  const atCol = at.col;
  const borderTotals = useMemo(() => {
    if (borders.size === 0) return "";
    const byIndex = rowByIndex;
    const currentKey = columns[atCol]?.key ?? "";
    const entries = [...borders].map((key) => { const split = key.indexOf("|"); return { row: byIndex.get(Number(key.slice(0, split))), column: output.columns.find((candidate) => candidate.key === key.slice(split + 1)) }; })
      .filter((entry) => entry.row && entry.column?.kind === "number");
    if (entries.length === 0) return "";
    const inCurrent = entries.filter((entry) => entry.column?.key === currentKey);
    const used = inCurrent.length > 0 ? inCurrent : entries;
    const places = Math.max(0, ...used.map((entry) => entry.column?.decimals ?? 0));
    const sum = selectionTotals(used.map((entry) => entry.row?.values[entry.column?.key ?? ""] ?? ""), places);
    return sum ? `Bordered${inCurrent.length > 0 ? ` ${columns[atCol]?.caption ?? ""}` : ""} ▸ ${sum}` : "";
  }, [borders, output, columns, atCol, rowByIndex]);
  useEffect(() => { onInfo(rowsText, [totals, borderTotals].filter(Boolean).join("   ‖   ")); }, [rowsText, totals, borderTotals, onInfo]);

  const lefts = useMemo(() => {
    const list: number[] = [];
    columns.reduce((left, column, index) => { list[index] = left; return left + widthOf(column); }, MARK + (tree ? TREE : 0));
    return list;
  }, [columns, widthOf, tree]);
  const totalWidth = MARK + (tree ? TREE : 0) + columns.reduce((sum, column) => sum + widthOf(column), 0);
  const frozenAt = frozenKey === null ? -1 : columns.findIndex((column) => column.key === frozenKey);
  const frozenCount = frozenAt + 1;

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
      const clear = frozenCount > 0 ? lefts[frozenCount - 1] + widthOf(columns[frozenCount - 1]) : MARK;
      if (point.col >= frozenCount && left < element.scrollLeft + clear) element.scrollLeft = Math.max(0, left - clear);
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
  const resetView = () => { setTree(false); setClosed(new Set()); setCollapsed(false); setCursor({ row: 0, col: 0 }); setSelEnd(null); setPicked(new Set()); setBorders(new Set()); setDrawing(false); setHeaderSelected(false); };
  // A pivot named in words is worked out once, on the first run that has the columns it names, and shown at once.
  const sumifDone = useRef(false);
  useEffect(() => {
    if (!initialSumif || sumifDone.current || withAdded.columns.length === 0) return;
    sumifDone.current = true;
    const result = computeSumif(withAdded, initialSumif);
    void messageBox.alert(result.text, "SUMIF", result.ok ? "info" : "warning");
  }, [withAdded]); // eslint-disable-line react-hooks/exhaustive-deps
  const pivotHinted = useRef(false);
  useEffect(() => {
    if (!initialPivot || pivotHinted.current || withAdded.columns.length === 0) return;
    pivotHinted.current = true;
    const spec = resolvePivotHint(withAdded, initialPivot);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once, when the first output with the named columns arrives (not an event of this grid)
    if (spec) { setPivoting({ forBase: base, spec }); resetView(); }
    const problem = pivotHintProblem(withAdded, initialPivot);
    if (problem !== "") void messageBox.alert(problem, "Pivot", "warning");
  }, [withAdded]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** Remove Group / Restore Group: the report without its group headings and subtotal lines, and back. */
  const toggleUngroup = () => {
    setUngroup(ungrouped ? null : { forBase: base, forServed: served });
    setTree(false);
    setClosed(new Set());
    resetView();
    onStatus({ hotKeys: GRID_KEYS, message: ungrouped ? "Groups restored" : "Groups removed: use the ▾ filters on the headings" });
    scroller.current?.focus();
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
  const openZoom = useZoom();
  const zoomEntry = async (request: { ledKey: number; processKey: number; acCode: number; name: string }) => {
    if (!openZoom) return;
    try {
      const target = await loadZoom(request);
      if ((!target.entryName || !target.ledKey) && (!target.reportName || !target.acCode)) {
        if (request.name !== "") await messageBox.alert(target.message || "No Record Found......", "Warning", "warning");
        else onStatus({ hotKeys: "", message: target.message || "This row has no voucher to open", red: true });
        return;
      }
      openZoom(target);
    } catch (error) {
      await messageBox.alert(error instanceof Error ? error.message : String(error), "Zoom", "error");
    }
  };
  const showLog = async () => {
    const entry = shown[at.row];
    if (!entry || (entry.row.ledKey <= 0 && entry.row.processKey <= 0 && !entry.row.masterLog)) { onStatus({ hotKeys: "", message: "Log : put the cursor on a voucher row", red: true }); return; }
    try {
      const table = await loadLog(entry.row.ledKey, entry.row.processKey, entry.row.masterLog);
      if (table.columns.length === 0) { await messageBox.alert(table.message || "No log found", "Log"); return; }
      setLogTable(table);
    } catch (error) {
      await messageBox.alert(error instanceof Error ? error.message : String(error), "Log", "error");
    }
  };

  /** Select an entire column (or range of columns with extend, or toggle with toggle). */
  const selectColumn = (col: number, extend = false, toggle = false) => {
    if (shown.length === 0) return;
    setTyped("");
    setHeaderSelected(true);
    if (toggle) {
      const colCells = Array.from({ length: shown.length }, (_, r) => cellKey(r, col)).filter(Boolean);
      const allSelected = colCells.length > 0 && colCells.every((key) => picked.has(key));
      setPicked((current) => {
        const next = new Set(current);
        if (next.size === 0 && cellKey(at.row, at.col)) next.add(cellKey(at.row, at.col));
        for (const key of colCells) {
          if (allSelected) next.delete(key);
          else next.add(key);
        }
        return next;
      });
      const caption = columns[col]?.caption ?? "";
      onStatus({ hotKeys: "Ctrl+C : Copy selected", message: `${allSelected ? "Deselected" : "Selected"} column : ${caption}` });
      return;
    }
    if (extend) {
      const startCol = at.col;
      setCursor({ row: 0, col: startCol });
      setSelEnd({ row: shown.length - 1, col });
      setPicked(new Set());
      const c1 = Math.min(startCol, col);
      const c2 = Math.max(startCol, col);
      const count = c2 - c1 + 1;
      onStatus({ hotKeys: "Ctrl+C : Copy columns / Ctrl+V into Excel, Word, Notepad", message: `Selected ${count} column${count === 1 ? "" : "s"} (${shown.length} rows)` });
      return;
    }
    setCursor({ row: 0, col });
    setSelEnd({ row: shown.length - 1, col });
    setPicked(new Set());
    const caption = columns[col]?.caption ?? "";
    onStatus({ hotKeys: "Ctrl+C : Copy column / Ctrl+V into Excel, Word, Notepad", message: `Selected column : ${caption} (${shown.length} rows)` });
  };

  /** Ctrl+A: select all rows and columns in the report. */
  const selectAll = () => {
    if (shown.length === 0 || columns.length === 0) return;
    setTyped("");
    setHeaderSelected(true);
    setCursor({ row: 0, col: 0 });
    setSelEnd({ row: shown.length - 1, col: columns.length - 1 });
    setPicked(new Set());
    onStatus({ hotKeys: "Ctrl+C : Copy all / Ctrl+V into Excel, Word, Notepad", message: `Selected entire report (${shown.length} rows × ${columns.length} columns)` });
  };

  /** Ctrl+C: the cell at the cursor, or the block / column / Ctrl+clicked cells selected, as text for the clipboard (for Excel, Word, Notepad). */
  const copySelection = async (withHeader?: boolean) => {
    const isCol = box !== null && box.r1 === 0 && box.r2 === shown.length - 1;
    const includeHeader = withHeader !== undefined ? withHeader : (headerSelected || isCol);
    const textAt = (row: number, col: number) => { const entry = shown[row]; const column = columns[col]; return entry && column ? (rowByIndex.get(entry.index)?.values[column.key] ?? "").trim() : ""; };
    let text: string;
    if (picked.size > 0) {
      const wanted = selectedKeys();
      const lines: string[] = [];
      if (includeHeader) {
        const headerCells = columns.flatMap((column, col) => (shown.some((_, r) => wanted.has(cellKey(r, col))) ? [column.caption] : []));
        if (headerCells.length > 0) lines.push(headerCells.join("\t"));
      }
      for (let row = 0; row < shown.length; row += 1) { const cells = columns.flatMap((column, col) => (wanted.has(cellKey(row, col)) ? [textAt(row, col)] : [])); if (cells.length > 0) lines.push(cells.join("\t")); }
      text = lines.join("\n");
    } else if (box) {
      const headerLine = includeHeader ? columns.slice(box.c1, box.c2 + 1).map((c) => c.caption).join("\t") : "";
      const bodyLines = Array.from({ length: box.r2 - box.r1 + 1 }, (_, i) => Array.from({ length: box.c2 - box.c1 + 1 }, (_, j) => textAt(box.r1 + i, box.c1 + j)).join("\t"));
      text = (headerLine ? [headerLine, ...bodyLines] : bodyLines).join("\n");
    } else {
      text = includeHeader ? `${columns[at.col]?.caption ?? ""}\n${textAt(at.row, at.col)}` : textAt(at.row, at.col);
    }
    try {
      await navigator.clipboard.writeText(text);
      const count = box ? box.r2 - box.r1 + 1 : picked.size > 0 ? picked.size : 1;
      const colName = isCol && box && box.c1 === box.c2 ? ` "${columns[box.c1]?.caption}"` : "";
      onStatus({
        hotKeys: "Paste with Ctrl+V into Excel, Word, or Notepad",
        message: isCol
          ? `Copied ${count} rows of${colName}${includeHeader ? " (with heading)" : ""} to clipboard`
          : box || picked.size > 0
          ? `Selected cells copied (${count} items)`
          : `Copied : ${text}`,
      });
    } catch {
      onStatus({ hotKeys: "", message: "The browser did not allow copying", red: true });
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
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c") { event.preventDefault(); void copySelection(); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === " " || event.code === "Space")) {
      event.preventDefault();
      selectColumn(at.col, event.shiftKey, false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (deleted.size > 0) { setDeleted(new Set()); onStatus({ hotKeys: GRID_KEYS, message: "All hidden rows brought back" }); }
      return;
    }
    if (event.key === "Delete" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Hide the selected rows (the entries, not the headings, subtotals or total); the totals and the output follow the rows left.
      event.preventDefault();
      const hide = new Set<number>();
      for (const key of selectedKeys()) { const index = Number(key.slice(0, key.indexOf("|"))); const row = output.rows[index]; if (row && filteredKind(row)) hide.add(index); }
      if (hide.size === 0) return;
      setDeleted(new Set([...deleted, ...hide]));
      setSelEnd(null); setPicked(new Set());
      onStatus({ hotKeys: GRID_KEYS, message: `${hide.size} row${hide.size === 1 ? "" : "s"} hidden (Ctrl+Z brings them back)` });
      return;
    }
    if (event.key in moves) { event.preventDefault(); go(moves[event.key], event.shiftKey); setTyped(""); setHeaderSelected(false); return; }
    switch (event.key) {
      case "Home": event.preventDefault(); go(event.ctrlKey ? { row: 0, col: 0 } : { row: from.row, col: 0 }, event.shiftKey); setTyped(""); setHeaderSelected(false); return;
      case "End": event.preventDefault(); go(event.ctrlKey ? { row: shown.length - 1, col: columns.length - 1 } : { row: from.row, col: columns.length - 1 }, event.shiftKey); setTyped(""); setHeaderSelected(false); return;
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
        if (tree && entry?.row.kind === "subtotal") { event.preventDefault(); toggleNode(entry.index); return; }
        // Zoom: the voucher of the row opens in its own screen, an account row (Trial Balance, Sales with Expense) in its Ledger, a Profit and Loss
        // cell with an account's name in that account's Ledger.
        if (entry && entry.row.kind === "data") {
          if (entry.row.ledKey > 0 || entry.row.processKey > 0 || (entry.row.acCode ?? 0) > 0) { event.preventDefault(); void zoomEntry({ ledKey: entry.row.ledKey, processKey: entry.row.processKey, acCode: entry.row.acCode ?? 0, name: "" }); }
          else if (output.reportKey === 22) {
            event.preventDefault();
            const cell = (entry.row.values[columns[at.col]?.key ?? ""] ?? "").trim();
            if (cell === "" || /^-?[\d,]*\.?\d+$/.test(cell)) void messageBox.alert("Please Click On Alphabet Column......", "Warning", "warning");
            else void zoomEntry({ ledKey: 0, processKey: 0, acCode: 0, name: cell });
          }
        }
        return;
      }
      case "Backspace": event.preventDefault(); setTyped((text) => text.slice(0, -1)); return;
      case "Escape":
        // What Esc can still undo here goes first; a bare Esc is left to the screen, which asks to quit.
        if (drawing) { event.preventDefault(); setDrawing(false); onStatus({ hotKeys: GRID_KEYS, message: "Border drawing stopped" }); }
        else if (typed || selEnd || picked.size > 0 || headerSelected) { event.preventDefault(); setTyped(""); setSelEnd(null); setPicked(new Set()); setHeaderSelected(false); }
        else if (groupMode) { event.preventDefault(); exitGroup(); }
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
    setHeaderSelected(false);
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
    if (point && !isSelected(point.row, point.col)) { setCursor(point); setSelEnd(null); setPicked(new Set()); setHeaderSelected(false); }
    else if (headCell) { const col = columns.findIndex((column) => column.key === key); if (col >= 0) setCursor({ row: at.row, col }); }
    setMenu({ x: event.clientX, y: event.clientY, key });
  };

  const reportMenuItems = (key: string): GridMenuItem[] => {
    const colIndex = columns.findIndex((c) => c.key === key);
    const column = columns[colIndex];
    const caption = column ? column.caption : key;
    const items: GridMenuItem[] = [];
    if (colIndex >= 0) {
      items.push(
        {
          label: `Copy Column "${caption}" (Ctrl+C)`,
          title: "Copy the entire column with heading to paste in Excel, Word, or Notepad",
          onClick: () => {
            selectColumn(colIndex, false, false);
            void copySelection(true);
          },
        },
        {
          label: `Copy Column "${caption}" (Values Only)`,
          title: "Copy the column data values only without the column heading",
          onClick: () => {
            selectColumn(colIndex, false, false);
            void copySelection(false);
          },
        },
        {
          label: `Select Column "${caption}" (Ctrl+Space)`,
          title: "Select all rows of this column",
          onClick: () => {
            selectColumn(colIndex, false, false);
          },
        },
      );
    }
    if (box || picked.size > 0) {
      items.push({
        label: "Copy Selection (Ctrl+C)",
        title: "Copy selected cells to clipboard",
        onClick: () => void copySelection(),
      });
    }
    if (colIndex >= 0) items.push({ label: `Freeze Columns up to "${caption}"`, title: "These columns stay in sight while you scroll sideways", disabled: frozenKey === key, onClick: () => setFrozenKey(key) });
    if (frozenKey !== null) items.push({ label: "Unfreeze Columns", onClick: () => setFrozenKey(null) });
    items.push(...columnMenuItems(layout, key, () => setArranging(true)));
    return items;
  };

  // ---- Drawing ----
  // Four level colours (features/grid/levelStyle): a heading and its subtotal share a colour.
  const levelColours = useMemo(() => resolveLevelColours(NO_SCREEN_COLOUR), []);
  const tickOrder = useMemo(() => Object.keys(output.headingCaptions), [output]);
  const isHeading = (row: OutputRow) => row.kind === "data" && row.rowType !== "FT" && output.headingColours[row.rowType] !== undefined;
  const kindOf = (row: OutputRow): RowKind => (row.kind === "total" || (row.kind === "data" && row.rowType === "FT") ? "total" : row.kind === "subtotal" ? "subtotal" : isHeading(row) ? "heading" : "detail");
  const headingLevel = (row: OutputRow) => headingLevelOf(row.rowType, output.headingLevels, tickOrder);
  const lookOf = (row: OutputRow): RowLook => rowLook(kindOf(row), row.kind === "subtotal" ? row.level : headingLevel(row), levelColours);
  const rowColours = (row: OutputRow): { background?: string; bold: boolean } => { const look = lookOf(row); return { background: look.background, bold: look.bold }; };
  /** Modern dark: the level fills are dark tints on screen; print and export (rowColours) keep the light ones. */
  const dark = useModernDark();
  const screenLook = (row: OutputRow): RowLook => (dark ? rowLook(kindOf(row), row.kind === "subtotal" ? row.level : headingLevel(row), DARK_LEVEL_COLOURS, DARK_GRAND_TOTAL_COLOUR) : lookOf(row));
  const rowStyle = (row: OutputRow): CSSProperties | undefined => {
    // The blank line before a main group stays plain, whatever the alternate colour would be.
    if (row.rowType === "GAP") return { background: "var(--mx-surface, #ffffff)" };
    const look = screenLook(row);
    if (!look.background) return undefined;
    return { background: look.background, color: look.color, fontWeight: 700, borderTop: look.borderTop, borderBottom: look.borderBottom };
  };
  /** Fold a heading: it closes with its subtotal, so a click there turns the tree on and shuts that group. */
  const foldOf = (row: OutputRow, source: number) => {
    if (!output.subtotals || !isHeading(row)) return -1;
    return closingSubtotal(output.rows, source, headingLevel(row), groupStart);
  };
  const toggleHeading = (node: number) => { if (!tree) { setTree(true); setCollapsed(false); } toggleNode(node); };

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
      const table = exportTableFrom(
        { company: companyName, title: output.title || fallbackTitle, titleRight: output.dateLine, footerCenter: `${output.records} entries` },
        columns.map((column) => ({ caption: column.caption, kind: column.kind, decimals: column.decimals, align: column.align === "R" ? "right" : column.align === "C" ? "center" : "left", width: widthOf(column), summed: false })),
        shown.map(({ row }) => columns.map((column) => (row.values[column.key] ?? "").replace(/,/g, column.kind === "number" ? "" : ","))),
        shown.map(({ row }) => styleOf(row)),
      );
      if (formulaSpecs.length === 0) return table;
      // The added columns go to Excel as real formulas (the cell keeps its value beside it).
      const entries = new Set(entryIndexes(output));
      const formulas = excelFormulas({
        rows: shown.map(({ row, index }) => ({ kind: row.kind, level: row.level, entry: entries.has(index) })),
        columns: columns.map((column) => ({ key: column.key, caption: column.caption })),
        worked: workOut(shaped, formulaSpecs).worked,
        headRow: xlsxHeadRow(table),
      });
      return { ...table, formulas };
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
  const ribbonOutput = guardedOutput as unknown as typeof gridOutput;

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
      // Any non-number column spills (the day book's "Total Entries : n" sits in the date column). A subtotal's or the total's label
      // always runs over every empty text column that follows, so all of them end in the same place (right side), whatever the length.
      const always = row.kind === "subtotal" || row.kind === "total";
      if (column.kind !== "number" && value !== "" && (always || value.length * 7 > width)) {
        // A group heading's text also runs over the empty number cells to its right when it is longer than the text cells before them.
        const heading = isHeading(row);
        while (col + 1 < columns.length && (columns[col + 1].kind !== "number" || heading) && (row.values[columns[col + 1].key] ?? "") === "" && (always || value.length * 7 > width)) {
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
        {groupSpecs.length > 0 && <span>Group By : {output.groups.join(" › ")}</span>}
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
      {/* Modern view: the active cell's reference and what it holds, as a spreadsheet's formula bar (hidden in Legacy). */}
      <div className="rp-cellbar" aria-hidden="true">
        <span className="rp-cellref">{columnLetters(at.col)}{shown.length === 0 ? "" : at.row + 1}</span>
        <span className="rp-cellfx">fx</span>
        <span className="rp-cellval">{shown[at.row] ? shown[at.row].row.values[columns[at.col]?.key ?? ""] ?? "" : ""}</span>
      </div>
      <div className="rp-out-body">
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
          onFocus={() => onStatus({ hotKeys: tree ? TREE_KEYS : GRID_KEYS, message: drawing ? "Drawing borders · Esc stops" : "Click header or Ctrl+Space: select column · Ctrl+C: copy for Excel/Word/Notepad · Shift+Click / drag: a block · right-click: options" })}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div className="mp-grid" style={{ height: (shown.length + 1) * ROW, minWidth: totalWidth + 20 }}>
            <div className="mp-row mp-head" style={{ top: 0 }}>
              <div className="mp-cell mp-rownum rp-count" aria-hidden="true" />
              {tree && <div className={`mp-cell rp-tree ${frozenCount > 0 ? "mp-frozen" : ""}`} style={frozenCount > 0 ? { left: MARK } : undefined} aria-hidden="true" />}
              {columns.map((column, col) => (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a press on a column heading selects the column for the mouse; the grid's keys select it from the keyboard
                <div
                  key={column.key}
                  data-head={column.key}
                  className={`mp-cell ${col === at.col ? "rp-head-on" : ""} ${isColSelected(col) ? "rp-head-sel" : ""} ${filterable && filters[column.key] ? "mp-filtered" : ""} ${col < frozenCount ? "mp-frozen" : ""} ${col === frozenAt ? "rp-frozen-edge" : ""}`}
                  style={{ width: widthOf(column), textAlign: align(column), ...(col < frozenCount ? { left: lefts[col] } : {}) }}
                  data-tip={`${column.caption} · click to select column · ${filterable ? "▾ to filter · " : ""}right-click for options · drag right edge to size`}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    if ((event.target as Element).closest(".mp-resize, button, input, select, label, .mp-filter, .mp-filter-popup")) return;
                    event.preventDefault();
                    selectColumn(col, event.shiftKey, event.ctrlKey || event.metaKey);
                    scroller.current?.focus();
                  }}
                >
                  <span className="mp-head-label">{column.caption}</span>
                  {filterable && <FilterButton caption={column.caption} onOpen={() => {
                    if (columnFilters.openFilter === column.key) { columnFilters.setOpenFilter(null); return; }
                    // The list is worked out once, when the filter opens (each draw of the grid used to work it out again).
                    const list = { key: column.key, values: valuesOf(column), colours: coloursOf(column) };
                    setOpenList(list);
                    columnFilters.open(column.key, list.values, list.colours);
                  }} skipTab />}
                  {layout.resizeHandle(column)}
                  {filterable && <FilterPopup state={columnFilters} columnKey={column.key} caption={column.caption} kind={column.kind} values={columnFilters.openFilter === column.key && openList?.key === column.key ? openList.values : []} colours={columnFilters.openFilter === column.key && openList?.key === column.key ? openList.colours : undefined} withStats area={scroller} />}
                </div>
              ))}
            </div>
            {shown.slice(first, last).map(({ row, index: source }, offset) => {
              const position = first + offset;
              const current = position === at.row;
              const style = rowStyle(row);
              const look = lookOf(row);
              const node = foldOf(row, source);
              const spilled = spill(row);
              const labelAt = spilled.findIndex(({ column }) => column.kind !== "number" && (row.values[column.key] ?? "") !== "");
              return (
                <div key={source} className={`mp-row ${position % 2 && row.rowType !== "GAP" ? "mp-alt" : ""} ${current ? "mp-current-row" : ""} rp-${row.kind}`} style={{ top: (position + 1) * ROW }} data-row={position}>
                  <div className="mp-cell mp-rownum" aria-hidden="true">{current ? "▶" : ""}</div>
                  {tree && (
                    <div className={`mp-cell rp-tree ${frozenCount > 0 ? "mp-frozen" : ""}`} style={frozenCount > 0 ? { left: MARK } : undefined}>
                      {row.kind === "subtotal" && <button type="button" tabIndex={-1} className="rp-tree-node" aria-label={closed.has(source) ? "Open group" : "Close group"} data-tip={closed.has(source) ? "Open group" : "Close group"} onClick={() => toggleNode(source)}>{closed.has(source) ? "⊞" : "⊟"}</button>}
                    </div>
                  )}
                  {spilled.map(({ column, col, width }, drawn) => {
                    const here = current && col === at.col;
                    const label = drawn === labelAt;
                    // The oldest Days / longest CDays on a party's subtotal line show only once Create Tree is on or F6 has summarized.
                    const text = row.treeOnly?.includes(column.key) && !tree && !collapsed ? "" : row.values[column.key] ?? "";
                    const selected = isSelected(position, col);
                    return (
                      <div
                        key={column.key}
                        data-col={col}
                        className={`mp-cell ${here ? "rp-cell-on" : ""} ${selected ? "rp-cell-sel" : ""} ${col < frozenCount ? "mp-frozen" : ""} ${col === frozenAt ? "rp-frozen-edge" : ""}`}
                        style={{ width, ...(col < frozenCount ? { left: lefts[col] } : {}), textAlign: label && (row.kind !== "data" || look.captionRight) ? "left" : align(column), ...(label && look.indent > 0 ? { paddingLeft: look.indent + 6 } : {}), ...(current || selected ? {} : style), ...(here || selected || !row.cellColours?.[column.key] ? {} : { background: row.cellColours[column.key] }), ...borderStyle(position, col) }}
                        data-tip={text}
                      >
                        {label && kindOf(row) === "heading" && output.subtotals && (
                          node >= 0
                            ? <button type="button" tabIndex={-1} className="rp-fold" aria-label={tree && closed.has(node) ? "Open group" : "Close group"} data-tip={tree && closed.has(node) ? "Open group" : "Close group"} onClick={() => toggleHeading(node)}>{tree && closed.has(node) ? "▸" : "▾"}</button>
                            : <span className="rp-fold rp-fold-none" aria-hidden="true" />
                        )}
                        {here && typed ? <FoundText text={text} typed={typed} /> : text}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* Phones: the final total stays at the foot of the report while the rows scroll (a copy pulled over the real total row by its
              negative margin, so the two meet at the end of the list). Hidden at other widths: app/responsive.css. */}
          {(() => {
            const last = shown[shown.length - 1]?.row;
            if (!last || kindOf(last) !== "total") return null;
            return (
              <div className="mp-row rp-total rp-total-pinned" aria-hidden="true" style={{ marginTop: -ROW }}>
                <div className="mp-cell mp-rownum" />
                {spill(last).map(({ column, col, width }) => (
                  <div key={column.key} className={`mp-cell ${col < frozenCount ? "mp-frozen" : ""} ${col === frozenAt ? "rp-frozen-edge" : ""}`} style={{ width, ...(col < frozenCount ? { left: lefts[col] } : {}), textAlign: align(column), ...rowStyle(last) }}>{last.values[column.key] ?? ""}</div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
      <div className={`rp-panel-host${(charting || panel !== null) ? " rp-panel-on" : ""}${panelMin ? " rp-panel-min" : ""}${panelMax && !panelMin ? " rp-panel-max" : ""}`}>
      {(charting || panel !== null) && !panelMin && <button type="button" className="rp-panel-maxbtn" aria-label={panelMax ? "Restore the panel size" : "Maximize the panel"} title={panelMax ? "Restore: the grid is shown beside the panel again" : "Maximize: the panel takes the whole grid area"} onClick={() => setPanelMax((value) => !value)}>{panelMax ? "❐ Restore" : "⤢ Maximize"}</button>}
      {(charting || panel !== null) && <button type="button" className="rp-panel-toggle" aria-label={panelMin ? "Show the side panel" : "Minimize the side panel"} title={panelMin ? "Show the side panel" : "Minimize the side panel (the grid gets the room)"} onClick={() => setPanelMin((value) => !value)}>{panelMin ? "◀" : "▶"}</button>}
      {charting && <ReportChart key={`${output.title}|${output.rows.length}|${groupMode}`} output={output} shownIndexes={passingIndexes} donutIndexes={donutIndexes} canFilter={filterable} onFilter={(columnKey, value) => { filterTo(columnKey, value); if (value !== null) setPanelMax(false); }} onClose={() => { if (chartFilter) filterTo(chartFilter, null); setPanel(null); scroller.current?.focus(); }} />}
      {panel === "groupby" && <GroupByPanel key={`${base.title}|${groupMode}`} output={served} specs={groupSpecs} onApply={(specs) => { setGroupSpecs(specs); resetView(); setPanelMax(false); }} onClose={() => { setPanel(null); scroller.current?.focus(); }} />}
      {panel === "pivot" && <PivotPanel key={`${base.title}|${groupMode}`} output={withAdded} spec={pivotSpec} onApply={(spec) => { setPivoting(spec ? { forBase: base, spec } : null); resetView(); setPanelMax(false); }} onClose={() => { setPanel(null); scroller.current?.focus(); }} />}
      {panel === "growth" && <GrowthPanel key={`${output.title}|${output.rows.length}|${groupMode}`} output={output} period={comparePeriod} yearStart={yearStart} yearEnd={yearEnd} load={loadCompare} onPick={filterable ? (columnKey, party) => { filterToMany(columnKey, [party]); setPanelMax(false); } : undefined} onPickMany={filterable ? (columnKey, values) => { filterToMany(columnKey, values); if (values !== null) setPanelMax(false); } : undefined} onClose={() => { if (chartFilter) filterTo(chartFilter, null); setGroupGate(null); setPanel(null); scroller.current?.focus(); }} />}
      {panel === "budget" && <BudgetPanel budgets={output.budgets} period={output.dateLine} onClose={() => { setPanel(null); scroller.current?.focus(); }} />}
      {panel === "compare" && <ReportCompare key={`${output.title}|${output.rows.length}|${groupMode}`} output={output} period={comparePeriod} yearStart={yearStart} yearEnd={yearEnd} load={async (from, upto, lastYear) => { const result = await loadCompare(from, upto, lastYear); return result.output && groupSpecs.length > 0 ? { ...result, output: applyGroupBy(result.output, groupSpecs) } : result; }} onClose={() => { setPanel(null); scroller.current?.focus(); }} />}
      </div>
      </div>
      <GridRibbon
        source="report"
        actions={(
          <>
            <RibbonAction kind="refresh" disabled={busy || groupBusy} onClick={() => { setGroupMode(false); setGroupOutput(null); onRefresh(); }} title="Generate the report again" />
            <RibbonAction kind="log" disabled={busy} onClick={() => void showLog()} title="The edit log of the voucher of the current row" />
            <RibbonAction kind="quit" onClick={onQuit} />
          </>
        )}
        tabs={[
          { title: "Print", icon: "print", content: (
            <>
              <RibbonOutputButton kind="print" output={ribbonOutput} />
              <RibbonOutputButton kind="preview" output={ribbonOutput} />
              <button type="button" data-hotkey="y" aria-keyshortcuts="Alt+Y" className={`mp-btn mp-btn-plain ${panel === "groupby" || groupSpecs.length > 0 ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "groupby" ? null : "groupby"))} title="Regroup the rows on screen by a column or a period"><Icon name="groupby" /><HotkeyLabel text="Group By" hotkey="y" /></button>
              <button type="button" data-hotkey="i" aria-keyshortcuts="Alt+I" className={`mp-btn mp-btn-plain ${panel === "pivot" || pivotSpec !== null ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "pivot" ? null : "pivot"))} title="Turn the rows on screen into a pivot table (rows, columns and totals)"><Icon name="groupby" /><HotkeyLabel text="Pivot" hotkey="i" /></button>
            </>
          ) },
          { title: "Export", icon: "export", content: (
            <>
              <RibbonOutputButton kind="excel" output={ribbonOutput} />
              <RibbonOutputButton kind="pdf" output={ribbonOutput} />
              <RibbonOutputButton kind="csv" output={ribbonOutput} />
              <button type="button" data-hotkey="m" aria-keyshortcuts="Alt+M" className="mp-btn mp-btn-blue" onClick={email} title="e-Mail the ledger confirmation"><Icon name="mail" /><HotkeyLabel text="eMail" hotkey="m" /></button>
            </>
          ) },
          { title: "Design", icon: "tree", content: (
            <>
              <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-btn mp-btn-plain" onClick={() => void createTree()} disabled={!tree && (output.groups.length === 0 || !output.subtotals)} title={tree ? "Remove the tree format" : "Show the groups as a tree that opens and closes"}><Icon name="tree" /><HotkeyLabel text={tree ? "Remove Tree" : "Create Tree"} hotkey="c" /></button>
              <button type="button" data-hotkey="j" aria-keyshortcuts="Alt+J" className={`mp-btn mp-btn-plain ${ungrouped ? "rp-btn-on" : ""}`} onClick={toggleUngroup} disabled={!ungrouped && output.groups.length === 0 && !output.rows.some((row) => row.kind === "subtotal")} title={ungrouped ? "Bring the group headings and subtotals back" : "Take off all group headings and subtotal lines, to filter the rows with the ▾ buttons"}><Icon name="clear" /><HotkeyLabel text={ungrouped ? "Restore Group" : "Remove Group"} hotkey="j" /></button>
              <button type="button" data-hotkey="g" aria-keyshortcuts="Alt+G" className={`mp-btn mp-btn-plain ${groupMode ? "rp-btn-on" : ""}`} onClick={() => void createGroup()} disabled={groupBusy} title="Group the entries on fields of your choice"><Icon name="columns" /><HotkeyLabel text="Create Group" hotkey="g" /></button>
              <button type="button" data-hotkey="o" aria-keyshortcuts="Alt+O" className={`mp-btn mp-btn-plain ${drawing ? "rp-btn-on" : ""}`} onClick={borderOn} title="Border the selected cells, then click cells to border them (Esc stops)"><Icon name="border" /><HotkeyLabel text="Border On" hotkey="o" /></button>
              <button type="button" data-hotkey="b" aria-keyshortcuts="Alt+B" className="mp-btn mp-btn-plain" onClick={borderOff} title="Remove Border from the selected cells, and stop drawing"><Icon name="borderOff" /><HotkeyLabel text="Border Off" hotkey="b" /></button>
              <button type="button" data-hotkey="l" aria-keyshortcuts="Alt+L" className={`mp-btn mp-btn-plain ${formulaSpecs.length > 0 ? "rp-btn-on" : ""}`} onClick={() => setFormulaOpen(true)} title="Add a column with a spreadsheet-style formula (=QTY*RATE, =SUM(QTY*RATE)); Excel gets it as a real formula"><Icon name="plus" /><HotkeyLabel text="Add Column" hotkey="l" /></button>
              <button type="button" className={`mp-btn mp-btn-plain ${frozenCount > 0 ? "rp-btn-on" : ""}`} onClick={() => setFrozenKey(frozenCount > 0 ? null : columns[at.col]?.key ?? null)} title={frozenCount > 0 ? "Unfreeze the columns" : "Freeze the columns up to the one the cursor is on: they stay in sight while you scroll sideways"}><Icon name="columns" />{frozenCount > 0 ? "Unfreeze" : "Freeze"}</button>
              <button type="button" data-hotkey="o" aria-keyshortcuts="Alt+O" className="mp-btn mp-btn-plain" onClick={() => setArranging(true)} title="Arrange columns: change their order, show or hide them"><Icon name="columns" /><HotkeyLabel text="Arrange Columns" hotkey="o" />{layout.hiddenColumns.length ? ` (${layout.hiddenColumns.length} hidden)` : ""}</button>
            </>
          ) },
          { title: "Planning", icon: "growth", content: (
            <>
              <button type="button" data-hotkey="n" aria-keyshortcuts="Alt+N" className={`mp-btn mp-btn-plain ${panel === "growth" ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "growth" ? null : "growth"))} title="Top parties (A/B/C), who is up or down, who to follow up"><Icon name="growth" /><HotkeyLabel text="Growth" hotkey="n" /></button>
              <button type="button" data-hotkey="u" aria-keyshortcuts="Alt+U" className={`mp-btn mp-btn-plain ${panel === "budget" ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "budget" ? null : "budget"))} title="Budget against actual for the accounts in this report"><Icon name="budget" /><HotkeyLabel text="Budget" hotkey="u" /></button>
              <button type="button" data-hotkey="k" aria-keyshortcuts="Alt+K" className={`mp-btn mp-btn-plain ${panel === "compare" ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "compare" ? null : "compare"))} title="Compare with another period of the year"><Icon name="compare" /><HotkeyLabel text="Compare" hotkey="k" /></button>
              <button type="button" data-hotkey="h" aria-keyshortcuts="Alt+H" className={`mp-btn mp-btn-plain ${charting ? "rp-btn-on" : ""}`} onClick={() => setPanel((open) => (open === "chart" ? null : "chart"))} title="Summary cards and a donut chart of the amounts, by group"><Icon name="chart" /><HotkeyLabel text="Chart" hotkey="h" /></button>
            </>
          ) },
        ]}
        info={(
          <>
            <span className="rp-run-info"><span>{rowsText}</span><span>Time : {output.elapsed.replace(" Minutes ", " Min ").replace(" Seconds", " Sec")}</span></span>
            {(search || activeFilters > 0 || groupGate !== null) && <button type="button" data-hotkey="a" aria-keyshortcuts="Alt+A" className="mp-btn mp-btn-plain" title="Clear the search and every column filter" onClick={() => { setSearch(""); clearAllFilters(); setChartFilter(null); setGroupGate(null); }}><Icon name="clear" /><HotkeyLabel text="Clear" hotkey="a" /></button>}
            <label className="mp-search"><Icon name="search" /><input id="rp-search" type="search" placeholder="Search all columns (Ctrl+F)" value={search} onChange={(event) => { setSearch(event.target.value); setCursor({ row: 0, col: at.col }); setSelEnd(null); }} /></label>
          </>
        )}
      />
      {gridOutput.dialogs}
      {menu && <GridMenu at={menu} items={reportMenuItems(menu.key)} onClose={() => { setMenu(null); scroller.current?.focus(); }} />}
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
      {formulaOpen && <FormulaColumns others={() => listOpenReports(ownSnapshot)} output={pivotSpec ? served : shaped} shown={(pivotSpec ? served.columns.filter((column) => column.visible) : columns).map((column) => ({ key: column.key, caption: column.caption }))} specs={formulaSpecs} onChange={(list) => setFormulaCols({ forBase: base, list })} onClose={() => { setFormulaOpen(false); scroller.current?.focus(); }} />}
      {logTable && <LogViewer table={logTable} title={`${output.title || fallbackTitle} Log`} onClose={() => { setLogTable(null); scroller.current?.focus(); }} />}
    </div>
  );
}
