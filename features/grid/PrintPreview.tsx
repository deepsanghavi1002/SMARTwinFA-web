"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PAGE_CSS, previewPages, printDocument } from "../../lib/export/pages";
import type { PdfOptions, PrintStyle } from "../../lib/export/pdf";
import type { ExportTable } from "../../lib/export/table";
import { HotkeyLabel } from "../ui/hotkeys";
import { printHtmlDocument } from "./printFrame";

/**
 * Print preview, page by page: the report drawn as A4 sheets on screen (nothing is
 * downloaded), with page setup, zoom and page navigation, and Print sending exactly these
 * pages to the printer. The layout is the PDF's, so all three always agree.
 */

const PX_PER_PT = 96 / 72;
const GAP = 16; // px between pages
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** Font sizes offered for printing; 10 pt is the default. */
export const FONT_SIZES = [7, 8, 9, 10, 11, 12];

export function PrintPreview({ table, initialOptions, title, onClose, onOptionsChange }: { table: ExportTable; initialOptions: PdfOptions; title: string; onClose: () => void; onOptionsChange?: (options: PdfOptions) => void }) {
  const [options, setOptionsState] = useState(initialOptions);
  const setOptions = (next: PdfOptions) => { setOptionsState(next); onOptionsChange?.(next); };
  // Search inside the preview: every row that contains the text, and which of them is current.
  const [search, setSearch] = useState("");
  const [hit, setHit] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [current, setCurrent] = useState(0);
  const [boxWidth, setBoxWidth] = useState(900);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const pages = useMemo(() => previewPages(table, options), [table, options]);
  const hits = useMemo(() => pages.find(search), [pages, search]);
  const currentLine = hits.length ? hits[Math.min(hit, hits.length - 1)] : -1;
  const pageWidthPx = pages.layout.pageWidth * PX_PER_PT;
  const pageHeightPx = pages.layout.pageHeight * PX_PER_PT;
  const scale = zoom === "fit" ? Math.max(0.25, Math.min(3, (boxWidth - 40) / pageWidthPx)) : zoom;
  const step = (pageHeightPx + GAP) * scale;

  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observe = new ResizeObserver(() => setBoxWidth(element.clientWidth));
    observe.observe(element);
    return () => observe.disconnect();
  }, []);

  const goTo = (index: number) => {
    const target = Math.max(0, Math.min(pages.pageCount - 1, index));
    if (scroller.current) scroller.current.scrollTop = target * step;
    setCurrent(target);
  };

  const print = () => printHtmlDocument(printDocument(title, pages, options.orientation));

  /** Shows a search hit: its page is scrolled to, and the row is marked. */
  const showHit = (index: number) => {
    if (!hits.length) return;
    const wrapped = (index + hits.length) % hits.length;
    setHit(wrapped);
    const target = pages.pageOf(hits[wrapped]);
    if (scroller.current) {
      const withinPage = pages.offsetOf(hits[wrapped]) * PX_PER_PT * scale;
      scroller.current.scrollTop = Math.max(0, target * step + withinPage - scroller.current.clientHeight / 2);
    }
    setCurrent(target);
  };

  const keys = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { handled(); onClose(); return; }
    if (ctrl && event.key.toLowerCase() === "p") { handled(); print(); return; }
    if (ctrl && event.key.toLowerCase() === "f") { handled(); document.getElementById("pv-search")?.focus(); return; }
    if (event.key === "F3") { handled(); showHit(hit + (event.shiftKey ? -1 : 1)); return; }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    if (event.key === "PageDown") { handled(); goTo(current + 1); return; }
    if (event.key === "PageUp") { handled(); goTo(current - 1); return; }
    if (event.key === "Home" && ctrl) { handled(); goTo(0); return; }
    if (event.key === "End" && ctrl) { handled(); goTo(pages.pageCount - 1); return; }
    if (event.key === "+" || event.key === "=") { handled(); setZoom(ZOOMS.find((value) => value > scale + 0.01) ?? ZOOMS[ZOOMS.length - 1]); return; }
    if (event.key === "-") { handled(); setZoom([...ZOOMS].reverse().find((value) => value < scale - 0.01) ?? ZOOMS[0]); return; }
  };

  // The window's keys, listened to on the dialog itself (the latest handler, every render).
  const keysRef = useRef(keys);
  useEffect(() => { keysRef.current = keys; });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const listener = (event: KeyboardEvent) => keysRef.current(event);
    element.addEventListener("keydown", listener);
    return () => element.removeEventListener("keydown", listener);
  }, []);

  // Only the pages near the one being read are drawn; the others keep their place empty.
  const drawn = (index: number) => Math.abs(index - current) <= 2;

  return (
    <div className="mp-dialog-backdrop" role="presentation">
      <div ref={dialog} className="mp-dialog mp-preview" role="dialog" aria-modal="true" aria-label="Print preview" tabIndex={-1}>
        <style>{PAGE_CSS}</style>
        <div className="mp-preview-bar">
          <strong>Print Preview</strong>
          <label title="List print: all records as a table. Vertical print: each record from a new page, every field's heading beside its value">Layout
            <select value={options.style ?? "list"} onChange={(event) => { const style = event.target.value as PrintStyle; setOptions({ ...options, style, orientation: style === "record" ? "portrait" : options.orientation }); goTo(0); }}>
              <option value="list">List print</option>
              <option value="record">Vertical print</option>
            </select>
          </label>
          <label>Page
            <select value={options.orientation} onChange={(event) => { setOptions({ ...options, orientation: event.target.value as PdfOptions["orientation"] }); goTo(0); }}>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </label>
          <label>Font
            <select value={options.fontSize} onChange={(event) => { setOptions({ ...options, fontSize: Number(event.target.value) }); goTo(0); }}>
              {FONT_SIZES.map((size) => <option key={size} value={size}>{size} pt</option>)}
            </select>
          </label>
          {table.totals && options.style !== "record" && <label><input type="checkbox" checked={options.totals} onChange={(event) => setOptions({ ...options, totals: event.target.checked })} />Totals</label>}
          <label>Zoom
            <select value={zoom === "fit" ? "fit" : String(zoom)} onChange={(event) => setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}>
              <option value="fit">Page width</option>
              {ZOOMS.map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
            </select>
          </label>
          <span className="mp-preview-nav" aria-label="Pages">
            <button type="button" onClick={() => goTo(0)} disabled={current === 0} title="First page (Ctrl+Home)">⏮</button>
            <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0} title="Previous page (PgUp)">◀</button>
            <span>Page {current + 1} of {pages.pageCount}</span>
            <button type="button" onClick={() => goTo(current + 1)} disabled={current >= pages.pageCount - 1} title="Next page (PgDn)">▶</button>
            <button type="button" onClick={() => goTo(pages.pageCount - 1)} disabled={current >= pages.pageCount - 1} title="Last page (Ctrl+End)">⏭</button>
          </span>
          <span className="mp-spacer" />
          <span className="mp-preview-search">
            <input
              id="pv-search"
              type="search"
              placeholder="Search (Ctrl+F)"
              aria-label="Search in preview"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setHit(0); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); showHit(hit + (event.shiftKey ? -1 : 1)); } }}
            />
            <span className="mp-preview-hits">{search.trim() ? (hits.length ? `${Math.min(hit, hits.length - 1) + 1} of ${hits.length}` : "not found") : ""}</span>
            <button type="button" onClick={() => showHit(hit - 1)} disabled={!hits.length} title="Previous match (Shift+F3)">▲</button>
            <button type="button" onClick={() => showHit(hit + 1)} disabled={!hits.length} title="Next match (F3 or Enter)">▼</button>
          </span>
          <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-green" onClick={print} title="Print these pages (Alt+P or Ctrl+P)">🖨 <HotkeyLabel text="Print" hotkey="p" /></button>
          <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-btn mp-btn-red" onClick={onClose} title="Close (Alt+C or Esc)">✖ <HotkeyLabel text="Close" hotkey="c" /></button>
        </div>
        <div
          ref={scroller}
          className="mp-preview-pages"
          onScroll={(event) => setCurrent(Math.max(0, Math.min(pages.pageCount - 1, Math.floor((event.currentTarget.scrollTop + event.currentTarget.clientHeight / 3) / step))))}
        >
          <div className="mp-preview-stack" style={{ width: pageWidthPx * scale, height: pages.pageCount * step }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: pageWidthPx }}>
              {Array.from({ length: pages.pageCount }, (_, index) => (
                drawn(index)
                  // Built from escaped text only (see lib/export/pages.ts).
                  ? <div key={index} className="mp-preview-slot" style={{ height: pageHeightPx, marginBottom: GAP }} dangerouslySetInnerHTML={{ __html: pages.page(index, search.trim() ? { needle: search, currentLine } : undefined) }} />
                  : <div key={index} className="mp-preview-slot mp-preview-empty" style={{ height: pageHeightPx, marginBottom: GAP, width: pageWidthPx }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
