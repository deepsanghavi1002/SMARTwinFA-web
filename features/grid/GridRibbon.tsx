"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { UNSAVED_TIP } from "./useGridOutput";
import type { GridOutput } from "./useGridOutput";

/**
 * The button bar of an output screen as a ribbon, like Excel's, in two lines only:
 *   line 1  the tabs (Print, Export, Design, Planning ...), then Refresh, Log and Quit at the right;
 *   line 2  the buttons of the selected tab, then the screen's own info (rows, time, search) at the right.
 *
 * Each tab has its icon before its name, and the buttons of a tab each have a colour of their own
 * (the same eight colours in every tab, in order, so no two buttons of one tab look alike).
 * Every tab's buttons stay on the page (the unselected ones hidden), so an Alt hotkey of a button in
 * another tab opens that tab and presses the button. The hotkeys are the grid's (Alt+P, W, X, D, V,
 * R, L, Q ...), the same as GridButtons. The selected tab is kept for the next time.
 */

export type RibbonOutputKind = "print" | "preview" | "excel" | "pdf" | "csv";

/** One of the grid's output buttons (Print, Preview, Excel, PDF, CSV), locked while the grid has unsaved changes. */
export function RibbonOutputButton({ kind, output }: { kind: RibbonOutputKind; output: GridOutput }) {
  const locked = output.unsaved;
  const title = (text: string) => (locked ? UNSAVED_TIP : text);
  switch (kind) {
    case "print": return <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-blue" onClick={() => void output.print()} disabled={locked} title={title("Print the grid")}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>;
    case "preview": return <button type="button" data-hotkey="w" aria-keyshortcuts="Alt+W" className="mp-btn mp-btn-blue" onClick={() => void output.preview()} disabled={locked} title={title("See the pages before printing")}><Icon name="preview" /><HotkeyLabel text="Preview" hotkey="w" /></button>;
    case "excel": return <button type="button" data-hotkey="x" aria-keyshortcuts="Alt+X" className="mp-btn mp-btn-excel" onClick={() => void output.excel()} disabled={locked} title={title("Save the grid as an Excel workbook (.xlsx)")}><Icon name="excel" /><HotkeyLabel text="Excel" hotkey="x" /></button>;
    case "pdf": return <button type="button" data-hotkey="d" aria-keyshortcuts="Alt+D" className="mp-btn mp-btn-pdf" onClick={() => void output.pdf()} disabled={locked} title={title("Save the grid as a PDF report")}><Icon name="pdf" /><HotkeyLabel text="PDF" hotkey="d" /></button>;
    case "csv": return <button type="button" data-hotkey="v" aria-keyshortcuts="Alt+V" className="mp-btn mp-btn-teal" onClick={() => void output.csv()} disabled={locked} title={title("Save the grid as a CSV text file")}><Icon name="export" /><HotkeyLabel text="CSV" hotkey="v" /></button>;
  }
}

/** Refresh, Log and Quit, the buttons of the first line. */
export function RibbonAction({ kind, onClick, disabled, title }: { kind: "refresh" | "log" | "quit"; onClick: () => void; disabled?: boolean; title?: string }) {
  if (kind === "refresh") return <button type="button" data-hotkey="r" aria-keyshortcuts="Alt+R" className="mp-btn mp-btn-blue" onClick={onClick} disabled={disabled} title={title}><Icon name="refresh" /><HotkeyLabel text="Refresh" hotkey="r" /></button>;
  if (kind === "log") return <button type="button" data-hotkey="l" aria-keyshortcuts="Alt+L" className="mp-btn mp-btn-blue" onClick={onClick} disabled={disabled} title={title}><Icon name="log" /><HotkeyLabel text="Log" hotkey="l" /></button>;
  return <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red" onClick={onClick} disabled={disabled} title={title}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>;
}

/** A ribbon tab: its name, the icon shown before it (a name of features/ui/Icon) and its buttons. */
export type RibbonTab = Readonly<{ title: string; icon?: string; content: ReactNode }>;

const REMEMBER = "ribbon-tab";

function remembered(source: string, tabs: readonly RibbonTab[]): number {
  try {
    const at = tabs.findIndex((tab) => tab.title === window.localStorage.getItem(`${REMEMBER}:${source}`));
    return at >= 0 ? at : 0;
  } catch {
    return 0;
  }
}

export function GridRibbon({ source, tabs, actions, info }: {
  source: string;
  tabs: readonly RibbonTab[];
  /** The first line's right-aligned buttons (Refresh, Log, Quit). */
  actions: ReactNode;
  /** The second line's right side (rows, time, search). */
  info?: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setActive(remembered(source, tabs)); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (at: number) => {
    setActive(at);
    try { window.localStorage.setItem(`${REMEMBER}:${source}`, tabs[at].title); } catch { /* the choice is only a convenience */ }
  };

  // Alt + the letter of a button on another tab: open that tab, then press the button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !root.current) return;
      const match = /^Key([A-Z])$/.exec(event.code);
      if (!match) return;
      const letter = match[1].toLowerCase();
      const panels = [...root.current.querySelectorAll<HTMLElement>("[data-ribbon-panel]")];
      const buttonsAt = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLButtonElement>(`[data-hotkey="${letter}"]`)].filter((button) => !button.disabled);
      if (panels.some((panel, at) => at === active && buttonsAt(panel).length > 0)) return;
      const other = panels.findIndex((panel, at) => at !== active && buttonsAt(panel).length > 0);
      if (other < 0) return;
      event.preventDefault();
      event.stopPropagation();
      choose(other);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const button = buttonsAt(panels[other])[0];
        if (button) { button.focus({ preventScroll: true }); button.click(); }
      }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="mp-buttons mp-ribbon" data-source={source} ref={root}>
      <div className="mp-rline mp-rtabs" role="tablist">
        {tabs.map((tab, at) => (
          <button key={tab.title} type="button" role="tab" aria-selected={at === active} className={`mp-rtab ${at === active ? "mp-rtab-on" : ""}`} onClick={() => choose(at)}><span className="mp-rtab-icon">{tab.icon && <Icon name={tab.icon} />}</span>{tab.title}</button>
        ))}
        <span className="mp-spacer" />
        <div className="mp-ractions">{actions}</div>
      </div>
      <div className="mp-rline mp-rpanels">
        {tabs.map((tab, at) => (
          <div key={tab.title} className="mp-rpanel" role="tabpanel" data-ribbon-panel={tab.title} hidden={at !== active}>{tab.content}</div>
        ))}
        <span className="mp-spacer" />
        {info && <div className="mp-rinfo">{info}</div>}
      </div>
    </div>
  );
}
