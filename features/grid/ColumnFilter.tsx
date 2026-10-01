"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { emptyCondition, FILTER_OPS, FILTER_TITLE, filterFromDraft, NO_VALUE_OPS } from "./filter";
import type { ColumnFilter, Condition, FilterDraft, FilterKind } from "./filter";

/**
 * The column filters of a grid: the state (`useColumnFilters`), the ▾ button in a heading
 * (`FilterButton`) and the list that opens under it (`FilterPopup`). The screen supplies each
 * column's distinct values (after the other columns' filters) and applies `filters` to its rows.
 */

export type ColumnFilters = ReturnType<typeof useColumnFilters>;

export function useColumnFilters() {
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [draft, setDraft] = useState<FilterDraft | null>(null);
  const [search, setSearch] = useState("");
  const anchor = useRef<string | null>(null);

  /** Opens a column's filter list with its current settings as an editable draft (a second click closes it). */
  const open = useCallback((key: string, allValues: readonly string[]) => {
    if (openFilter === key) { setOpenFilter(null); return; }
    anchor.current = null;
    const current = filters[key];
    setSearch("");
    setDraft({ key, chosen: current?.values ?? [...allValues], first: current?.first ?? emptyCondition(), join: current?.join ?? "and", second: current?.second ?? emptyCondition() });
    setOpenFilter(key);
  }, [openFilter, filters]);

  /** Apply: the draft becomes the column's filter. */
  const apply = useCallback((key: string, allValues: readonly string[]) => {
    if (!draft) return;
    const next = filterFromDraft(draft, allValues);
    setFilters((current) => {
      const copy = { ...current };
      if (next) copy[key] = next; else delete copy[key];
      return copy;
    });
    setOpenFilter(null);
  }, [draft]);

  const clear = useCallback((key: string) => {
    setFilters((current) => { const copy = { ...current }; delete copy[key]; return copy; });
    setOpenFilter(null);
  }, []);

  const clearAll = useCallback(() => { setFilters({}); setOpenFilter(null); }, []);

  // An open filter list closes when the click lands anywhere else.
  useEffect(() => {
    if (openFilter === null) return;
    const close = (event: MouseEvent) => { if (!(event.target as Element).closest(".mp-filter, .mp-filter-button")) setOpenFilter(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openFilter]);

  return { filters, setFilters, openFilter, setOpenFilter, draft, setDraft, search, setSearch, anchor, open, apply, clear, clearAll };
}

export function FilterButton({ caption, onOpen }: { caption: string; onOpen: () => void }) {
  return <button type="button" className="mp-filter-button" aria-label={`Filter ${caption}`} onClick={onOpen}>▾</button>;
}

/**
 * A column's filter list, opened under its heading from the heading's left edge; where the
 * grid has no room for it on the right (the last columns), it moves left until it shows whole.
 */
export function FilterPopup({ state, columnKey, caption, kind, values, area }: { state: ColumnFilters; columnKey: string; caption: string; kind: FilterKind; values: readonly string[]; area: RefObject<HTMLElement | null> }) {
  const { draft, setDraft, search, setSearch, anchor, apply, clear, setOpenFilter } = state;
  if (!draft || draft.key !== columnKey || state.openFilter !== columnKey) return null;
  const place = (element: HTMLDivElement | null) => {
    if (!element) return;
    element.style.left = "0px";
    const box = element.getBoundingClientRect();
    const areaElement = area.current;
    const areaBox = areaElement?.getBoundingClientRect();
    const right = Math.min(window.innerWidth, areaBox && areaElement ? areaBox.left + areaElement.clientWidth : window.innerWidth) - 4;
    const left = Math.max(0, areaBox?.left ?? 0) + 4;
    const shift = Math.min(Math.max(0, box.right - right), Math.max(0, box.left - left));
    element.style.left = `${-shift}px`;
  };
  const needle = search.trim().toLowerCase();
  const label = (value: string) => (value === "" ? "(blank)" : value);
  const listed = needle ? values.filter((value) => label(value).toLowerCase().includes(needle)) : values;
  const change = (update: Partial<FilterDraft>) => setDraft((current) => (current ? { ...current, ...update } : current));
  const conditionRow = (which: "first" | "second") => {
    const condition = draft[which];
    const set = (update: Partial<Condition>) => change({ [which]: { ...condition, ...update } });
    const inputType = kind === "date" ? "date" : "text";
    return (
      <div className="mp-filter-condition">
        <select aria-label={`${FILTER_TITLE[kind]} ${which === "first" ? "condition" : "second condition"}`} value={condition.op} onChange={(event) => set({ op: event.target.value })}>
          {FILTER_OPS[kind].map(([op, text]) => <option key={op} value={op}>{text}</option>)}
        </select>
        {!NO_VALUE_OPS.includes(condition.op) && (
          <input type={inputType} inputMode={kind === "number" ? "decimal" : undefined} aria-label="Value" placeholder="Value" value={condition.a} onChange={(event) => set({ a: event.target.value })} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") apply(columnKey, values); }} />
        )}
        {condition.op === "between" && (
          <input type={inputType} inputMode={kind === "number" ? "decimal" : undefined} aria-label="And value" placeholder="and" value={condition.b} onChange={(event) => set({ b: event.target.value })} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") apply(columnKey, values); }} />
        )}
      </div>
    );
  };
  return (
    <div ref={place} className="mp-filter" role="dialog" aria-label={`Filter ${caption}`}>
      <input type="search" placeholder="Search values…" aria-label={`Search ${caption} values`} value={search} ref={(element) => element?.focus({ preventScroll: true })} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") apply(columnKey, values); if (event.key === "Escape") { event.preventDefault(); setOpenFilter(null); } }} />
      <label className="mp-filter-all">
        <input type="checkbox" checked={listed.length > 0 && listed.every((value) => draft.chosen.includes(value))} onChange={(event) => change({ chosen: event.target.checked ? [...new Set([...draft.chosen, ...listed])] : draft.chosen.filter((value) => !listed.includes(value)) })} />
        <b>{needle ? "(Select all found)" : "(Select All)"}</b>
        <span className="mp-filter-tip">Shift+click: range</span>
        <span className="mp-filter-count">{listed.filter((value) => draft.chosen.includes(value)).length}/{listed.length}</span>
      </label>
      <ul>
        {listed.map((value) => (
          <li key={value || "(blank)"}>
            <button
              type="button"
              role="checkbox"
              aria-checked={draft.chosen.includes(value)}
              className="mp-filter-value"
              onClick={(event) => {
                const tick = !draft.chosen.includes(value);
                const from = anchor.current === null ? -1 : listed.indexOf(anchor.current);
                const to = listed.indexOf(value);
                // Shift+click: everything from the last clicked value to this one takes this one's new state.
                const range = event.shiftKey && from >= 0 ? listed.slice(Math.min(from, to), Math.max(from, to) + 1) : [value];
                change({ chosen: tick ? [...new Set([...draft.chosen, ...range])] : draft.chosen.filter((item) => !range.includes(item)) });
                anchor.current = value;
              }}
            >
              <span className="mp-filter-box" aria-hidden="true">{draft.chosen.includes(value) ? "✓" : ""}</span>{value === "" ? <em>(blank)</em> : value}
            </button>
          </li>
        ))}
        {listed.length === 0 && <li className="mp-filter-none">No value matches.</li>}
      </ul>
      <div className="mp-filter-conditions">
        <b className="mp-filter-kind">{kind === "number" ? "Σ " : kind === "date" ? "📅 " : "T "}{FILTER_TITLE[kind]}</b>
        {conditionRow("first")}
        {draft.first.op !== "" && (
          <>
            <div className="mp-filter-join" role="radiogroup" aria-label="Join the two conditions">
              <label><input type="radio" checked={draft.join === "and"} onChange={() => change({ join: "and" })} />And</label>
              <label><input type="radio" checked={draft.join === "or"} onChange={() => change({ join: "or" })} />Or</label>
            </div>
            {conditionRow("second")}
          </>
        )}
      </div>
      <div className="mp-filter-actions">
        <button type="button" className="mp-filter-apply" onClick={() => apply(columnKey, values)}>✔ Apply</button>
        <button type="button" onClick={() => clear(columnKey)}>✖ Clear</button>
        <button type="button" onClick={() => setOpenFilter(null)}>Cancel</button>
      </div>
    </div>
  );
}
