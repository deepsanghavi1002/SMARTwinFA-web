"use client";

import { useState } from "react";

/**
 * The buttons the report side panels share (Growth, Compare, Budget): Copy the lines on screen as tab-separated text, and
 * Save view / Reset view, which keep a panel's own choices (what it groups by, its sort ...) per report in this browser.
 */

export function usePanelTools<T extends object>(storageKey: string) {
  const [saved] = useState<Partial<T>>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Partial<T>; } catch { return {}; }
  });
  const [note, setNote] = useState("");
  const say = (text: string) => { setNote(text); setTimeout(() => setNote(""), 3500); };
  const copy = async (lines: readonly (readonly string[])[]) => {
    try { await navigator.clipboard.writeText(lines.map((line) => line.join("\t")).join("\n")); say(`Copied ${Math.max(0, lines.length - 1).toLocaleString("en-IN")} lines`); } catch { say("The browser did not allow copying"); }
  };
  const save = (view: T) => { try { localStorage.setItem(storageKey, JSON.stringify(view)); say("View saved for this report"); } catch { say("The browser did not allow saving"); } };
  const reset = () => { try { localStorage.removeItem(storageKey); say("Saved view removed"); } catch { say("The browser did not allow it"); } };
  return { saved, note, copy, save, reset };
}

export function PanelButtons({ onCopy, onSave, onReset, note, copyDisabled }: { onCopy: () => void; onSave: () => void; onReset: () => void; note: string; copyDisabled?: boolean }) {
  return (
    <div className="rp-growth-buttons">
      <button type="button" className="mp-btn mp-btn-plain" onClick={onCopy} disabled={copyDisabled} title="Copy the lines on screen, to paste into Excel, Word or a message">Copy</button>
      <button type="button" className="mp-btn mp-btn-plain" onClick={onSave} title="Remember this panel's choices for this report">Save view</button>
      <button type="button" className="mp-btn mp-btn-plain" onClick={onReset} title="Forget the saved view of this report">Reset view</button>
      {note !== "" && <span className="rp-chart-note" role="status">{note}</span>}
    </div>
  );
}
