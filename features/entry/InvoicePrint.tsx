"use client";

/* The dialog takes Esc and Ctrl+P for itself, as the other windows of the program do. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

import { useEffect, useRef, useState } from "react";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { printHtmlDocument } from "../grid/printFrame";
import { useDraggable } from "../grid/useDraggable";

/**
 * The invoice's Print button: first the format (Standard, or Special, which is kept for later), then - for Standard - the bill drawn
 * on screen exactly as it prints, with its own Print button. Esc closes (the preview goes back to the format choice).
 */
export function InvoicePrint({ load, onClose }: { load: () => Promise<string>; onClose: () => void }) {
  const [stage, setStage] = useState<"choose" | "loading" | "preview">("choose");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  /** The windows move by their title bar (drag it, or focus it and use the arrow keys), as the helps do. */
  const drag = useDraggable();
  useEffect(() => { box.current?.querySelector<HTMLElement>("[data-first]")?.focus(); }, [stage]);

  const standard = async () => {
    setStage("loading");
    setError("");
    try {
      setHtml(await load());
      setStage("preview");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The bill could not be read");
      setStage("choose");
    }
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (stage === "preview") setStage("choose"); else onClose(); }
    else if (stage === "preview" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") { event.preventDefault(); event.stopPropagation(); printHtmlDocument(html); }
  };

  return (
    <div className="ent-print-back" role="dialog" aria-modal="true" aria-label="Print" ref={box} onKeyDown={keys}>
      {stage !== "preview" ? (
        <div className="ent-print-choose" style={drag.style}>
          <div className="ent-print-title mp-drag-handle" {...drag.handle} onDoubleClick={drag.reset} title="Drag to move · double-click to put back"><Icon name="print" />Print format</div>
          <button type="button" data-first className="ent-print-option" disabled={stage === "loading"} onClick={() => void standard()}>
            <b>Standard</b><span>The bill, shown as a preview first, with a Print button.</span>
          </button>
          <button type="button" className="ent-print-option" disabled title="Kept for a later development">
            <b>Special</b><span>For future development.</span>
          </button>
          {stage === "loading" && <div className="ent-print-note">Reading the bill…</div>}
          {error && <div className="ent-print-note ent-print-error">{error}</div>}
          <div className="ent-print-actions"><button type="button" className="mp-btn mp-btn-red" onClick={onClose}>Cancel</button></div>
        </div>
      ) : (
        <div className="ent-print-preview" style={drag.style}>
          <div className="ent-print-bar mp-drag-handle" {...drag.handle} onDoubleClick={drag.reset} title="Drag to move · double-click to put back">
            <b>Standard bill · preview</b>
            <button type="button" data-first className="mp-btn mp-btn-blue" data-hotkey="p" aria-keyshortcuts="Alt+P" onClick={() => printHtmlDocument(html)}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>
            <button type="button" className="mp-btn mp-btn-blue" data-hotkey="b" onClick={() => setStage("choose")}><HotkeyLabel text="Back" hotkey="b" /></button>
            <button type="button" className="mp-btn mp-btn-red" data-hotkey="c" onClick={onClose}><HotkeyLabel text="Close" hotkey="c" /></button>
          </div>
          <iframe className="ent-print-sheet" title="Bill preview" srcDoc={html} />
        </div>
      )}
    </div>
  );
}
