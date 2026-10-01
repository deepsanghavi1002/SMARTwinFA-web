"use client";

import type { ReactNode } from "react";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { UNSAVED_TIP } from "./useGridOutput";
import type { GridOutput } from "./useGridOutput";

/**
 * The button bar under a grid, the same on every screen (master, small entry, entry, reports):
 * Save, Print, Preview, Excel, PDF, CSV, Refresh, Cancel, Quit, Log, Arrange Columns, then the
 * search box, Clear filters and the record count. A screen passes the buttons it has; one it
 * leaves out is not shown. The hotkeys are the master's (Alt+S, P, W, X, D, V, R, C, Q, L, O, A).
 */

export type GridButtonsSource = "master" | "small-entry" | "entry" | "report";

type Action = Readonly<{ onClick: () => void; disabled?: boolean; title?: string }>;

export function GridButtons({ source, busy = false, save, output, print, refresh, cancel, quit, log, arrange, extra, search, clearFilters, count, children }: {
  /** Which screen the bar belongs to (its buttons' ids and titles name it). */
  source: GridButtonsSource;
  busy?: boolean;
  save?: Action;
  /** Print, Preview, Excel, PDF and CSV of the grid (features/grid/useGridOutput). */
  output?: GridOutput;
  /** A Print of its own, where the screen prints something other than the grid (the master's New sheet). */
  print?: Action;
  refresh?: Action;
  cancel?: Action;
  quit?: Action;
  log?: Action;
  arrange?: Action & { hidden: number };
  /** Controls of the screen's own, before the search box (the master's scheme boxes). */
  extra?: ReactNode;
  search?: Readonly<{ id: string; value: string; onChange: (value: string) => void; onEnter?: () => void }>;
  /** Shown when the grid is filtered, searched or sorted. */
  clearFilters?: (() => void) | null;
  count?: string;
  /** Anything after the count (the master's "▼ n rows down"). */
  children?: ReactNode;
}) {
  const locked = output?.unsaved ?? false;
  const outputTitle = (title: string) => (locked ? UNSAVED_TIP : title);
  return (
    <div className="mp-buttons" data-source={source}>
      {save && <button type="button" data-hotkey="s" aria-keyshortcuts="Alt+S" className="mp-btn mp-btn-green" id="mp-save" onClick={save.onClick} disabled={busy || save.disabled} title={save.title}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>}
      {print && <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-blue" onClick={print.onClick} disabled={print.disabled} title={print.title}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>}
      {output && <>
        {!print && <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-blue" onClick={() => void output.print()} disabled={locked} title={outputTitle("Print the grid")}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>}
        <button type="button" data-hotkey="w" aria-keyshortcuts="Alt+W" className="mp-btn mp-btn-blue" onClick={() => void output.preview()} disabled={locked} title={outputTitle("See the pages before printing")}><Icon name="preview" /><HotkeyLabel text="Preview" hotkey="w" /></button>
        <button type="button" data-hotkey="x" aria-keyshortcuts="Alt+X" className="mp-btn mp-btn-excel" onClick={() => void output.excel()} disabled={locked} title={outputTitle("Save the grid as an Excel workbook (.xlsx)")}><Icon name="excel" /><HotkeyLabel text="Excel" hotkey="x" /></button>
        <button type="button" data-hotkey="d" aria-keyshortcuts="Alt+D" className="mp-btn mp-btn-pdf" onClick={() => void output.pdf()} disabled={locked} title={outputTitle("Save the grid as a PDF report")}><Icon name="pdf" /><HotkeyLabel text="PDF" hotkey="d" /></button>
        <button type="button" data-hotkey="v" aria-keyshortcuts="Alt+V" className="mp-btn mp-btn-teal" onClick={() => void output.csv()} disabled={locked} title={outputTitle("Save the grid as a CSV text file")}><Icon name="export" /><HotkeyLabel text="CSV" hotkey="v" /></button>
      </>}
      {refresh && <button type="button" data-hotkey="r" aria-keyshortcuts="Alt+R" className="mp-btn mp-btn-blue" onClick={refresh.onClick} disabled={busy || refresh.disabled} title={refresh.title}><Icon name="refresh" /><HotkeyLabel text="Refresh" hotkey="r" /></button>}
      {cancel && <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-btn mp-btn-red" onClick={cancel.onClick} disabled={cancel.disabled} title={cancel.title}><Icon name="cancel" /><HotkeyLabel text="Cancel" hotkey="c" /></button>}
      {quit && <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red" onClick={quit.onClick} disabled={quit.disabled} title={quit.title}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>}
      {log && <button type="button" data-hotkey="l" aria-keyshortcuts="Alt+L" className="mp-btn mp-btn-blue" onClick={log.onClick} disabled={busy || log.disabled} title={log.title}><Icon name="log" /><HotkeyLabel text="Log" hotkey="l" /></button>}
      {arrange && <button type="button" data-hotkey="o" aria-keyshortcuts="Alt+O" className="mp-btn mp-btn-plain" onClick={arrange.onClick} title={arrange.title ?? "Arrange columns: change their order, show or hide them"}><Icon name="columns" /><HotkeyLabel text="Arrange Columns" hotkey="o" />{arrange.hidden ? ` (${arrange.hidden} hidden)` : ""}</button>}
      {(search || count !== undefined) && <span className="mp-spacer" />}
      {extra}
      {search && <label className="mp-search"><Icon name="search" /><input id={search.id} type="search" placeholder="Search all columns (Ctrl+F)" value={search.value} onChange={(event) => search.onChange(event.target.value)} onKeyDown={(event) => { if (search.onEnter && (event.key === "Enter" || event.key === "F3")) { event.preventDefault(); search.onEnter(); } }} /></label>}
      {clearFilters && <button type="button" data-hotkey="a" aria-keyshortcuts="Alt+A" className="mp-btn mp-btn-plain" onClick={clearFilters}><Icon name="clear" /><HotkeyLabel text="Clear filters" hotkey="a" /></button>}
      {count !== undefined && <span className="mp-count">{count}</span>}
      {children}
    </div>
  );
}
