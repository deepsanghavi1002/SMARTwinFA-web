"use client";

import { useEffect, useRef, useState } from "react";
import type { ExportCell } from "../../lib/export/table";
import { formatDesktopDate } from "../../lib/master-program/legacy";
import { notifyOpenReports, registerOpenReport } from "../../lib/report/openReports";
import type { Value } from "../../lib/report/sheetFormula";

/**
 * Makes a data grid (a master, a small entry) a source for the report columns' VLOOKUP: its window's names, its columns as shown and the cells
 * of its rows are offered to the Add Column lookup of every report, as another open report's are. The rows are only built when a formula
 * looks the grid up (`rows` is read then), so listing the open windows costs nothing.
 */
export function useLookupSource(source: { titles: readonly string[]; captions: readonly string[]; rows: () => readonly (readonly ExportCell[])[] }, changed: unknown): void {
  const latest = useRef(source);
  useEffect(() => { latest.current = source; });
  const [snapshot] = useState(() => () => {
    const now = latest.current;
    return {
      titles: now.titles.filter((text) => text.trim() !== ""),
      columns: now.captions.map((caption, at) => ({ key: `COL${at}`, caption })),
      get rows(): readonly (readonly Value[])[] {
        return now.rows().map((row) => row.map((cell): Value => (cell instanceof Date ? formatDesktopDate(cell) : cell)));
      },
    };
  });
  // Registered while the grid has columns to offer.
  const offered = source.captions.length > 0;
  useEffect(() => (offered ? registerOpenReport(snapshot) : undefined), [offered, snapshot]);
  // The reports that look this grid up work their formulas out again when it changes.
  useEffect(() => { if (offered) notifyOpenReports(); }, [changed, offered]);
}
