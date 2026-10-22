"use client";

import { useEffect, useRef, useState } from "react";
import { HelpIcon } from "../grid/HelpIcon";
import { useDraggable } from "../grid/useDraggable";

/**
 * "Entry : Document Upload" (the desktop's GridForm): up to five JPEG or PDF files kept with an entry, each with a remark. Double-click
 * (or Enter) on a Document Path picks the file; F6 blanks the path (the row is removed when the entry is saved); F7 opens the stored
 * or just-picked file. Ok keeps the rows for the entry's Save; Quit leaves everything as it was.
 */

export type DocRow = { key: number; path: string; remark: string; hasFile: boolean; /** base64 of a file picked now. */ data?: string; /** The picked file, for F7 before it is saved. */ blob?: Blob };

export const MIN_DOCUMENT_ROWS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export const blankDocRow = (): DocRow => ({ key: 0, path: "", remark: "", hasFile: false });
/** The rows the window opens with: the entry's own, padded to five. An entry keeps five documents at most: to add one when all five are used, blank a path (F6) and put the new file there. */
export const docRowsFor = (rows: readonly DocRow[]): DocRow[] => [...rows, ...Array.from({ length: Math.max(0, MIN_DOCUMENT_ROWS - rows.length) }, blankDocRow)];

const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(new Error("The file could not be read"));
  reader.readAsDataURL(file);
});

export function UploadDocuments({ initial, onOk, onQuit, fetchFile, say }: {
  initial: readonly DocRow[];
  onOk: (rows: DocRow[]) => void;
  onQuit: () => void;
  /** F7 on a stored file: the file is fetched by the screen and shown in this window (never downloaded). */
  fetchFile: (row: DocRow) => Promise<Blob | null>;
  say: (message: string) => Promise<void> | void;
}) {
  const [rows, setRows] = useState<DocRow[]>(() => docRowsFor(initial));
  const [current, setCurrent] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const pickFor = useRef(0);
  const first = useRef<HTMLButtonElement>(null);
  const drag = useDraggable();
  /** The file F7 opened: shown over the window, in the page itself. */
  const [shown, setShown] = useState<{ url: string; type: string; name: string } | null>(null);

  useEffect(() => { first.current?.focus(); }, []);

  const change = (index: number, update: Partial<DocRow>) => setRows((now) => now.map((row, at) => (at === index ? { ...row, ...update } : row)));
  const openPicker = (index: number) => { pickFor.current = index; setCurrent(index); picker.current?.click(); };
  const picked = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(jpe?g|pdf)$/i.test(file.name)) { await say("Only JPEG and PDF files can be uploaded."); return; }
    if (file.size > MAX_BYTES) { await say(`${file.name} is larger than ${MAX_BYTES / 1024 / 1024} MB.`); return; }
    change(pickFor.current, { path: file.name, data: await toBase64(file), blob: file, hasFile: true });
  };
  const view = async (index: number) => {
    const row = rows[index];
    if (!row || row.path === "") return;
    const blob = row.blob ?? (row.key > 0 && row.hasFile ? await fetchFile(row) : null);
    if (blob) setShown({ url: URL.createObjectURL(blob), type: blob.type, name: row.path });
  };

  const keys = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "F6") { event.preventDefault(); change(index, { path: "", data: undefined, blob: undefined, hasFile: false }); }
    else if (event.key === "F7") { event.preventDefault(); void view(index); }
    else if (event.key === "Enter") { event.preventDefault(); openPicker(index); }
    else if (event.key === "ArrowDown" && index < rows.length - 1) { event.preventDefault(); (event.currentTarget.closest("table")?.querySelectorAll<HTMLElement>("button.ent-doc-path")[index + 1])?.focus(); }
    else if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); (event.currentTarget.closest("table")?.querySelectorAll<HTMLElement>("button.ent-doc-path")[index - 1])?.focus(); }
  };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (shown) { URL.revokeObjectURL(shown.url); setShown(null); } else onQuit();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onQuit, shown]);

  return (
    <div className="ent-log-back" role="dialog" aria-modal="true" aria-label="Entry : Document Upload">
      <div className="ent-docs mp-help-scheme" style={drag.style}>
        <div className="mp-help-title" {...drag.handle} title="Drag to move the window">
          <span><HelpIcon name="file-text" /><b className="mp-help-name">ENTRY : DOCUMENT UPLOAD</b></span>
          <span className="mp-help-tip">double-click / Enter: choose file · F6: blank path · F7: open file</span>
        </div>
        <div className="ent-docs-scroll">
          <table className="ent-docs-table">
            <thead><tr><th style={{ width: 40 }}>Sr.</th><th>Document Path</th><th>Remark</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={index === current ? "ent-log-current" : undefined}>
                  <td style={{ textAlign: "right" }}>{index + 1}</td>
                  <td>
                    <button
                      type="button" ref={index === 0 ? first : undefined} className="ent-doc-path" title={row.path === "" ? "Double-click to choose a JPEG or PDF file" : `${row.path} — F6 blanks the path, F7 opens the file`}
                      onFocus={() => setCurrent(index)} onDoubleClick={() => openPicker(index)} onKeyDown={(event) => keys(event, index)}
                    >{row.path || " "}</button>
                  </td>
                  <td><input value={row.remark} aria-label={`Remark ${index + 1}`} maxLength={200} onFocus={() => setCurrent(index)} onChange={(event) => change(index, { remark: event.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown && (
          <div className="ent-doc-view" role="dialog" aria-label={shown.name}>
            <div className="mp-help-title"><span><HelpIcon name="file-text" /><b className="mp-help-name">{shown.name}</b></span><button type="button" aria-label="Close the document" onClick={() => { URL.revokeObjectURL(shown.url); setShown(null); }}>×</button></div>
            {shown.type.startsWith("image/") ? <img src={shown.url} alt={shown.name} /> : <iframe src={shown.url} title={shown.name} />}
          </div>
        )}
        <input ref={picker} type="file" accept=".jpeg,.jpg,.pdf,application/pdf,image/jpeg" hidden onChange={(event) => { void picked(event.target.files?.[0]); event.target.value = ""; }} />
        <div className="ent-log-foot">
          <button type="button" className="mp-btn mp-btn-green" onClick={() => onOk(rows)}>Ok</button>
          <button type="button" className="mp-btn mp-btn-red" onClick={onQuit}>Quit</button>
        </div>
      </div>
    </div>
  );
}
