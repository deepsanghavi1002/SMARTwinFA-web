"use client";

import { useCallback, useEffect, useState } from "react";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";

/**
 * Saved views (web only): a name for the selection on screen (and the Group By of its output),
 * kept per operator, company and report. Apply puts the selection back; "Keep today's dates"
 * leaves the dates as they are now, so a view such as "Monthly party sales" can be run for any
 * period.
 */

export type SavedView = Readonly<{ name: string; payload: unknown }>;

export function SavedViews({ list, save, remove, apply, onClose }: {
  list: () => Promise<SavedView[]>;
  save: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  apply: (view: SavedView, keepDates: boolean) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [error, setError] = useState("");
  const [keepDates, setKeepDates] = useState(true);

  const reload = useCallback(async () => {
    try { setViews(await list()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setViews([]); }
  }, [list]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list once when the window opens
  useEffect(() => { void reload(); }, [reload]);

  const saveNow = async () => {
    const name = await messageBox.prompt("Name for this view", "Save View");
    if (!name || !name.trim()) return;
    try { await save(name.trim()); await reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const removeNow = async (name: string) => {
    if (!(await messageBox.confirm(`Delete the view "${name}"?`, "Delete View"))) return;
    try { await remove(name); await reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };

  return (
    <aside className="rp-chart rp-views" aria-label="Saved views">
      <div className="rp-chart-head">
        <b><Icon name="views" />Saved views</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close saved views">×</button>
      </div>
      <p className="rp-chart-note">A view keeps this selection (accounts, options, dates) and the Group By of the output you last opened. It is yours, for this company and report.</p>
      <button type="button" className="mp-btn mp-btn-green" onClick={() => void saveNow()}>Save current selection as…</button>
      <label className="rp-compare-sort"><input type="checkbox" checked={keepDates} onChange={(event) => setKeepDates(event.target.checked)} /> Keep the dates on screen when applying</label>
      {error && <p className="rp-compare-error" role="alert">{error}</p>}
      {views === null ? <p className="rp-chart-note">Loading…</p> : views.length === 0 ? <p className="rp-chart-empty">No saved views yet.</p> : (
        <ul className="rp-views-list">
          {views.map((view) => (
            <li key={view.name}>
              <button type="button" className="rp-views-name" onClick={() => apply(view, keepDates)} title="Apply this view">{view.name}</button>
              <button type="button" className="rp-views-del" onClick={() => void removeNow(view.name)} aria-label={`Delete ${view.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
