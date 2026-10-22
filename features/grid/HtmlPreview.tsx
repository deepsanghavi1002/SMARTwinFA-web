"use client";

import { useEffect, useRef, useState } from "react";
import { activeById } from "../ui/activeWindow";
import { HotkeyLabel } from "../ui/hotkeys";
import { printHtmlDocument } from "./printFrame";
import { downloadRtf } from "./richText";

/**
 * The report's print preview window (PrintPreview) for a finished HTML document, such as the invoice bill: the same window, bar, zoom,
 * page buttons, search (Ctrl+F, F3), move by the title bar, Print and Close, with the sheet drawn as the document itself (its own format)
 * instead of a report table. A4 portrait; the report's page setup (layout, orientation, font) is not offered because it would change the bill's format.
 */

const PX_PER_MM = 96 / 25.4;
const SHORT = Math.round(210 * PX_PER_MM);
const LONG = Math.round(297 * PX_PER_MM);
type Orientation = "portrait" | "landscape";
const GAP = 16;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function HtmlPreview({ html: source, title, fileName, onClose }: { html: string; title: string; /** The name of the exported file (without the extension); the title when not given. */ fileName?: string; onClose: () => void }) {
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const landscape = orientation === "landscape";
  const PAGE_WIDTH = landscape ? LONG : SHORT;
  const PAGE_HEIGHT = landscape ? SHORT : LONG;
  // The bill keeps its own format; landscape only turns the sheet and widens the bill's page block to the sheet.
  const html = landscape ? source.replace("size:A4 portrait", "size:A4 landscape").replace(".page{width:190mm", ".page{width:277mm") : source;
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [boxWidth, setBoxWidth] = useState(900);
  const [contentHeight, setContentHeight] = useState(0);
  const [current, setCurrent] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Search inside the bill: how many times the text occurs, and which one is current.
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState(0);
  const [hit, setHit] = useState(0);
  // The window can be moved by dragging its title bar (the empty part of the toolbar).
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input, select, label, a")) return;
    event.preventDefault();
    const from = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const move = (at: PointerEvent) => setOffset({ x: Math.max(-window.innerWidth + 120, Math.min(window.innerWidth - 120, at.clientX - from.x)), y: Math.max(-40, Math.min(window.innerHeight - 60, at.clientY - from.y)) });
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const pageCount = Math.max(1, Math.ceil((contentHeight || PAGE_HEIGHT) / PAGE_HEIGHT));
  const scale = zoom === "fit" ? Math.max(0.25, Math.min(3, (boxWidth - 40) / PAGE_WIDTH)) : zoom;
  const step = (PAGE_HEIGHT + GAP) * scale;
  const sheetHeight = pageCount * PAGE_HEIGHT;

  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observe = new ResizeObserver(() => setBoxWidth(element.clientWidth));
    observe.observe(element);
    return () => observe.disconnect();
  }, []);

  const goTo = (index: number) => {
    const target = Math.max(0, Math.min(pageCount - 1, index));
    if (scroller.current) scroller.current.scrollTop = target * step;
    setCurrent(target);
  };
  const print = () => printHtmlDocument(html);
  /** Export to Richtext: an .rtf file Word opens and edits, named after the bill. */
  const exportRichText = () => downloadRtf(html, fileName ?? title);
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc) setContentHeight(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight));
  };

  /** Counts the matches of the text in the bill. */
  const count = (text: string) => {
    const body = frame.current?.contentDocument?.body;
    const needle = text.trim().toLowerCase();
    if (!body || !needle) return 0;
    return body.innerText.toLowerCase().split(needle).length - 1;
  };
  /** Marks the next (or previous) match in the bill and scrolls the preview to it. */
  const showHit = (direction: 1 | -1, text = search) => {
    const win = frame.current?.contentWindow;
    const needle = text.trim();
    if (!win || !needle) return;
    const total = count(needle);
    setHits(total);
    if (!total) return;
    if (!(win as Window & { find: (text: string, caseSensitive: boolean, backwards: boolean, wrap: boolean) => boolean }).find(needle, false, direction === -1, true)) return;
    setHit((value) => ((value + direction - 1 + total) % total) + 1);
    const range = win.getSelection()?.rangeCount ? win.getSelection()!.getRangeAt(0) : null;
    if (range && scroller.current) scroller.current.scrollTop = Math.max(0, range.getBoundingClientRect().top * scale - scroller.current.clientHeight / 3);
  };
  const changeSearch = (text: string) => {
    setSearch(text);
    setHit(0);
    frame.current?.contentWindow?.getSelection()?.removeAllRanges();
    setHits(count(text));
  };

  const keys = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { handled(); onClose(); return; }
    if (ctrl && event.key.toLowerCase() === "p") { handled(); print(); return; }
    if (ctrl && event.key.toLowerCase() === "f") { handled(); activeById("pv-search")?.focus(); return; }
    if (event.key === "F3") { handled(); showHit(event.shiftKey ? -1 : 1); return; }
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
    if (event.key === "PageDown") { handled(); goTo(current + 1); return; }
    if (event.key === "PageUp") { handled(); goTo(current - 1); return; }
    if (event.key === "Home" && ctrl) { handled(); goTo(0); return; }
    if (event.key === "End" && ctrl) { handled(); goTo(pageCount - 1); return; }
    if (event.key === "+" || event.key === "=") { handled(); setZoom(ZOOMS.find((value) => value > scale + 0.01) ?? ZOOMS[ZOOMS.length - 1]); return; }
    if (event.key === "-") { handled(); setZoom([...ZOOMS].reverse().find((value) => value < scale - 0.01) ?? ZOOMS[0]); return; }
  };
  const keysRef = useRef(keys);
  useEffect(() => { keysRef.current = keys; });
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const listener = (event: KeyboardEvent) => keysRef.current(event);
    element.addEventListener("keydown", listener);
    return () => element.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className="mp-dialog-backdrop" role="presentation">
      <div ref={dialog} className="mp-dialog mp-preview" role="dialog" aria-modal="true" aria-label="Print preview" tabIndex={-1} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        <div className="mp-preview-bar" onPointerDown={startDrag} style={{ cursor: "move" }} title="Drag to move the window">
          <strong>Print Preview</strong>
          <span>{title}</span>
          <label>Zoom
            <select value={zoom === "fit" ? "fit" : String(zoom)} onChange={(event) => setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value))}>
              <option value="fit">Page width</option>
              {ZOOMS.map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
            </select>
          </label>
          <span className="mp-preview-nav" aria-label="Pages">
            <button type="button" onClick={() => goTo(0)} disabled={current === 0} title="First page (Ctrl+Home)">⏮</button>
            <button type="button" onClick={() => goTo(current - 1)} disabled={current === 0} title="Previous page (PgUp)">◀</button>
            <span>Page {current + 1} of {pageCount}</span>
            <button type="button" onClick={() => goTo(current + 1)} disabled={current >= pageCount - 1} title="Next page (PgDn)">▶</button>
            <button type="button" onClick={() => goTo(pageCount - 1)} disabled={current >= pageCount - 1} title="Last page (Ctrl+End)">⏭</button>
          </span>
          <label>Page
            <select value={orientation} onChange={(event) => { setOrientation(event.target.value as Orientation); setContentHeight(0); goTo(0); }}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <span className="mp-spacer" />
          <span className="mp-preview-search">
            <input
              id="pv-search"
              type="search"
              placeholder="Search (Ctrl+F)"
              aria-label="Search in bill"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); showHit(event.shiftKey ? -1 : 1); } }}
            />
            <span className="mp-preview-hits">{search.trim() ? (hits ? `${hit} of ${hits}` : "not found") : ""}</span>
            <button type="button" onClick={() => showHit(-1)} disabled={!hits} title="Previous match (Shift+F3)">▲</button>
            <button type="button" onClick={() => showHit(1)} disabled={!hits} title="Next match (F3 or Enter)">▼</button>
          </span>
          <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-green" onClick={print} title="Print this bill (Alt+P or Ctrl+P)">🖨 <HotkeyLabel text="Print" hotkey="p" /></button>
          <button type="button" data-hotkey="e" aria-keyshortcuts="Alt+E" className="mp-btn mp-btn-blue" onClick={exportRichText} title="Export to Richtext (Alt+E): a .rtf file that Word opens and edits">📝 <HotkeyLabel text="Export Richtext" hotkey="e" /></button>
          <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-btn mp-btn-red" onClick={onClose} title="Close (Alt+C or Esc)">✖ <HotkeyLabel text="Close" hotkey="c" /></button>
        </div>
        <div
          ref={scroller}
          className="mp-preview-pages"
          onScroll={(event) => setCurrent(Math.max(0, Math.min(pageCount - 1, Math.floor((event.currentTarget.scrollTop + event.currentTarget.clientHeight / 3) / step))))}
        >
          <div className="mp-preview-stack" style={{ width: PAGE_WIDTH * scale, height: (sheetHeight + (pageCount - 1) * GAP) * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: PAGE_WIDTH }}>
              <iframe
                ref={frame}
                title="Bill"
                srcDoc={html}
                onLoad={measure}
                scrolling="no"
                style={{ width: PAGE_WIDTH, height: sheetHeight, border: 0, background: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,.45)", display: "block" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
