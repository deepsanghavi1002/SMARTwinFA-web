"use client";

import { useMemo, useRef, useState } from "react";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { FilterButton, FilterPopup, useColumnFilters } from "./ColumnFilter";
import { filterHolds, sortedDistinct } from "./filter";
import type { FilterKind } from "./filter";
import type { HelpColumn, HelpData } from "./HelpList";

/**
 * A help list's column filters and sorting, for any screen's help (HelpList): each heading has
 * the grid's ▾ filter (values, text / number / date conditions), and a click on a heading sorts
 * the list by that column, ascending, then descending, then back to the help's own order. The
 * list the help shows is `help`; the screen takes its entries from it, so the highlighted row
 * and the one Enter takes are the ones on screen.
 */
export type HelpSort = Readonly<{ key: string; descending: boolean }>;

export function helpKind(column: HelpColumn): FilterKind {
  if (column.format.toLowerCase().startsWith("dd")) return "date";
  return /^N\d?$/.test(column.format) || column.align === "R" ? "number" : "text";
}

function compare(kind: FilterKind, a: string, b: string): number {
  if (kind === "number") return (Number(a.replace(/,/g, "")) || 0) - (Number(b.replace(/,/g, "")) || 0);
  if (kind === "date") return (parseDesktopDate(a)?.getTime() ?? 0) - (parseDesktopDate(b)?.getTime() ?? 0);
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base", numeric: true });
}

type Filters = ReturnType<typeof useColumnFilters>["filters"];
type Format = (value: string, format: string) => string;

/** The rows the column filters leave, all but `skip` (so a column's list offers what the other filters leave). */
function filterRows(help: HelpData | null, filters: Filters, skip: string | null, formatCell: Format) {
  return (help?.rows ?? []).filter((row) => (help?.columns ?? []).every((column) => {
    if (column.key === skip) return true;
    const filter = filters[column.key];
    return !filter || filterHolds(helpKind(column), filter, row[column.key] ?? "", formatCell(row[column.key] ?? "", column.format));
  }));
}

export function useHelpView(help: HelpData | null, formatCell: (value: string, format: string) => string) {
  const filters = useColumnFilters();
  const [sort, setSort] = useState<HelpSort | null>(null);
  const area = useRef<HTMLElement | null>(null);

  const valuesOf = (column: HelpColumn) => sortedDistinct(filterRows(help, filters.filters, column.key, formatCell).map((row) => formatCell(row[column.key] ?? "", column.format)));

  const view = useMemo((): HelpData | null => {
    if (!help) return null;
    const active = Object.keys(filters.filters).length > 0;
    let rows = active ? filterRows(help, filters.filters, null, formatCell) : [...help.rows];
    const column = sort ? help.columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (sort && column) {
      const kind = helpKind(column);
      rows = rows.map((row, index) => ({ row, index }))
        .sort((a, b) => (compare(kind, a.row[column.key] ?? "", b.row[column.key] ?? "") || a.index - b.index) * (sort.descending ? -1 : 1))
        .map((item) => item.row);
    }
    if (!active && !sort) return help;
    return { ...help, rows, total: active ? `${help.total} · ${rows.length} after filter` : help.total };
  }, [help, filters.filters, sort, formatCell]);

  /** A heading click: ascending, descending, then the help's own order again. */
  const sortBy = (column: HelpColumn) => setSort((current) => (current?.key !== column.key ? { key: column.key, descending: false } : current.descending ? null : { key: column.key, descending: true }));
  const sortMark = (column: HelpColumn) => (sort?.key === column.key ? (sort.descending ? "▼" : "▲") : "");
  /** The ▾ button and its list, inside a heading. */
  const headingTools = (column: HelpColumn) => (
    <>
      <FilterButton caption={column.caption} skipTab onOpen={() => filters.open(column.key, valuesOf(column))} />
      <FilterPopup state={filters} columnKey={column.key} caption={column.caption} kind={helpKind(column)} values={filters.openFilter === column.key ? valuesOf(column) : []} area={area} floating />
    </>
  );
  const filteredColumn = (column: HelpColumn) => Boolean(filters.filters[column.key]);
  return { view, sortBy, sortMark, headingTools, filteredColumn, clearFilters: filters.clearAll, hasFilters: Object.keys(filters.filters).length > 0 };
}
