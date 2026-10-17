"use client";

import { useEffect, useRef, useState } from "react";
import { HotkeyLabel } from "../ui/hotkeys";
import { printHtmlDocument } from "./printFrame";

/**
 * The report's print preview window (PrintPreview) for a finished HTML document, such as the invoice bill: the same window, bar, zoom,
 * page buttons, Print and Close, with the sheet drawn as the document itself (its own format) instead of a report table. A4 portrait.
 */

const PX_PER_MM = 96 / 25.4;
const PAGE_WIDTH = Math.round(210 * PX_PER_MM);
const PAGE_HEIGHT = Math.round(297 * PX_PER_MM);
const GAP = 16;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function HtmlPreview({ html, title, onClose }: { html: string; title: string; onClose: () => void }) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [boxWidth, setBoxWidth] = useState(900);
  const [contentHeight, setContentHeight] = useState(PAGE_HEIGHT);
  const [current, setCurrent] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const pageCount = Math.max(1, Math.ceil(contentHeight / PAGE_HEIGHT));
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
  const measure = () => {
    const doc = frame.current?.contentDocument;
    if (doc) setContentHeight(Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight));
  };

  const keys = (event: KeyboardEvent) => {
    const ctrl = event.ctrlKey || event.metaKey;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { handled(); onClose(); return; }
    if (ctrl && event.key.toLowerCase() === "p") { handled(); print(); return; }
    if (event.target instanceof HTMLSelectElement) return;
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
      <div ref={dialog} className="mp-dialog mp-preview" role="dialog" aria-modal="true" aria-label="Print preview" tabIndex={-1}>
        <div className="mp-preview-bar">
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
          <span className="mp-spacer" />
          <button type="button" data-hotkey="p" aria-keyshortcuts="Alt+P" className="mp-btn mp-btn-green" onClick={print} title="Print this bill (Alt+P or Ctrl+P)">🖨 <HotkeyLabel text="Print" hotkey="p" /></button>
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
