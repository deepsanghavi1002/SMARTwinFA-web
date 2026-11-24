"use client";

/* The dialog takes Esc and Ctrl+P for itself, as the other windows of the program do. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */

import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { HtmlPreview } from "../grid/HtmlPreview";
import { useDraggable } from "../grid/useDraggable";

/**
 * The invoice's Print button: first the format (Standard, or Special, which is kept for later), then - for Standard - the bill in the
 * report's print preview window (features/grid/HtmlPreview: its bar, pages, zoom and Print) with the bill in its own format. Esc closes the choice; the preview's own
 * Close returns to it.
 */
export function InvoicePrint({ load, formats, docNo = "", onClose }: { load: (format: string) => Promise<string>; /** The print formats of the company besides Standard (the built-in ones and those it made in the Print Format Designer). */ formats?: () => Promise<{ id: string; name: string }[]>; /** The invoice number, added at the end of the exported file's name. */ docNo?: string; onClose: () => void }) {
  const [stage, setStage] = useState<"choose" | "loading" | "preview">("choose");
  const [html, setHtml] = useState("");
  const [title, setTitle] = useState("Standard bill");
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { void formats?.().then(setOthers).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  /** The windows move by their title bar (drag it, or focus it and use the arrow keys), as the helps do. */
  const drag = useDraggable();
  useEffect(() => { box.current?.querySelector<HTMLElement>("[data-first]")?.focus(); }, [stage]);
  const standard = async (format = "standard", name = "Standard bill") => {
    setStage("loading");
    setError("");
    try {
      setHtml(await load(format)); setTitle(name);
      setStage("preview");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The bill could not be read");
      setStage("choose");
    }
  };
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && stage !== "preview") { event.preventDefault(); event.stopPropagation(); onClose(); }
  };

  return (
    <div className="ent-print-back" role="dialog" aria-modal="true" aria-label="Print" ref={box} onKeyDown={keys}>
      {stage !== "preview" ? (
        <div className="ent-print-choose" style={drag.style}>
          <div className="ent-print-title mp-drag-handle" {...drag.handle} onDoubleClick={drag.reset} title="Drag to move · double-click to put back"><Icon name="print" />Print format</div>
          <button type="button" data-first className="ent-print-option" disabled={stage === "loading"} onClick={() => void standard("standard")}>
            <b>Standard</b><span>The bill, shown as a preview first, with a Print button.</span>
          </button>
          {others.map((other) => (
            <button key={other.id} type="button" className="ent-print-option" disabled={stage === "loading"} onClick={() => void standard(other.id, other.name)}>
              <b>{other.name}</b><span>Shown as a preview first, with a Print button.</span>
            </button>
          ))}
          {stage === "loading" && <div className="ent-print-note">Reading the bill…</div>}
          {error && <div className="ent-print-note ent-print-error">{error}</div>}
          <div className="ent-print-actions"><button type="button" className="mp-btn mp-btn-red" onClick={onClose}>Cancel</button></div>
        </div>
      ) : (
        <HtmlPreview html={html} title={title} fileName={`${title} ${docNo}`} onClose={() => setStage("choose")} />
      )}
    </div>
  );
}
