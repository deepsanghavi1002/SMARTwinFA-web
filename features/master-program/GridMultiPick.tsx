"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Matched } from "../ui/Matched";
import { keyListNames, keyListText, parseKeyList } from "../../lib/master-program/multi-pick";
import type { GridComboPlace } from "./GridCombo";

/**
 * The drop-down of a multi-pick cell (multiple_chkbox): the same list as GridCombo, but every
 * entry has a tick box and any number can be ticked. The cell shows the names; what it holds is
 * the keys, " 2, 12, 13,".
 *
 * Space (while the search box is empty), Ctrl+Space or Insert ticks / unticks the highlighted
 * entry, a click ticks / unticks the entry under the mouse. Enter or Tab takes the ticks and
 * moves on, Esc leaves the value as it was. A key held that the list no longer has stays
 * ticked as "#key" until it is unticked.
 */
const ROW = 22;

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} /></svg>
);
const SearchIcon = () => <svg className="ui-search" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>;

export function GridMultiPick({ options, current, startWith = "", place, onPick, onCancel }: {
  options: readonly { text: string; value: string }[];
  /** The keys the cell holds now, as stored. */
  current: string;
  /** A letter typed on the cell that opened the list: the search starts with it. */
  startWith?: string;
  place: GridComboPlace | null;
  /** The keys ticked, as stored; step: 1 / -1 to go on to the next / previous field, 0 to stay. */
  onPick: (keys: string, step: 0 | 1 | -1) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(startWith);
  const [ticked, setTicked] = useState<readonly string[]>(() => parseKeyList(current));
  /** The list plus any key held that the list does not have, so it can be seen and unticked. */
  const all = useMemo(() => {
    const known = new Set(options.map((option) => option.value.trim()));
    const missing = parseKeyList(current).filter((key) => !known.has(key)).map((key) => ({ text: `#${key}`, value: key }));
    return [...options.map((option) => ({ text: option.text.trim(), value: option.value.trim() })), ...missing];
  }, [options, current]);
  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle === "") return all;
    const starts = all.filter((option) => option.text.toUpperCase().startsWith(needle) || option.value === needle);
    const contains = all.filter((option) => !starts.includes(option) && option.text.toUpperCase().includes(needle));
    return [...starts, ...contains];
  }, [all, query]);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  /** The highlight follows the mouse only once it really moves (see GridCombo). */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const listId = useId();
  const focusOnMount = useCallback((element: HTMLInputElement | null) => { element?.focus(); }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  const toggle = (key: string | undefined) => {
    if (key === undefined) return;
    setTicked((keys) => (keys.includes(key) ? keys.filter((held) => held !== key) : [...keys, key]));
  };
  const take = (step: 0 | 1 | -1) => onPick(keyListText(ticked), step);
  const move = (to: number) => setActive(Math.min(matches.length - 1, Math.max(0, to)));
  const names = keyListNames(keyListText(ticked), options);

  return (
    <span className="mp-grid-combo-field">
      <SearchIcon />
      <input
        className="mp-editor mp-grid-combo-input"
        ref={focusOnMount}
        aria-label="Search the list"
        role="combobox"
        aria-controls={listId}
        aria-expanded="true"
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={names || "(none)"}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": event.preventDefault(); move(active + 1); return;
            case "ArrowUp": event.preventDefault(); move(active - 1); return;
            case "PageDown": event.preventDefault(); move(active + 10); return;
            case "PageUp": event.preventDefault(); move(active - 10); return;
            case "Insert": event.preventDefault(); toggle(matches[active]?.value); return;
            case " ":
              if (query === "" || event.ctrlKey) { event.preventDefault(); toggle(matches[active]?.value); }
              return;
            case "Enter": event.preventDefault(); event.stopPropagation(); take(1); return;
            case "Tab": event.preventDefault(); event.stopPropagation(); take(event.shiftKey ? -1 : 1); return;
            case "Escape": event.preventDefault(); event.stopPropagation(); onCancel(); return;
          }
          if ((event.key === "Home" || event.key === "End") && query === "") { event.preventDefault(); move(event.key === "Home" ? 0 : matches.length - 1); }
        }}
      />
      <Chevron up />
      {place && createPortal(
        <div className="mp-grid-combo" style={{ left: place.left, top: place.top, width: place.width }} role="presentation" onMouseDown={(event) => event.preventDefault()}>
          <div className="mp-grid-combo-now" title={names}>
            <span>Ticked: <b>{names || "(none)"}</b></span>
            <span className="mp-grid-combo-count">{ticked.length} of {all.length}</span>
          </div>
          <ul ref={list} id={listId} role="listbox" aria-label="Choices" aria-multiselectable="true" style={{ maxHeight: ROW * Math.max(2, place.rows) }}>
            {matches.map((option, index) => {
              const on = ticked.includes(option.value);
              return (
                <li
                  key={`${option.value}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={on}
                  className={`${index === active ? "mp-grid-combo-active" : ""} ${on ? "mp-grid-combo-current" : ""}`}
                  onMouseMove={(event) => {
                    const last = pointer.current;
                    pointer.current = { x: event.screenX, y: event.screenY };
                    if (last && (last.x !== event.screenX || last.y !== event.screenY)) setActive(index);
                  }}
                  onMouseUp={() => { setActive(index); toggle(option.value); }}
                >
                  <span className="mp-multi-box"><input type="checkbox" tabIndex={-1} readOnly checked={on} aria-hidden="true" /></span>
                  <span className="mp-grid-combo-text"><Matched text={option.text} query={query} /></span>
                  <span className="mp-multi-key">{option.value}</span>
                </li>
              );
            })}
            {matches.length === 0 && <li className="mp-grid-combo-none" role="presentation">Nothing matches “{query}”</li>}
          </ul>
          <div className="mp-grid-combo-keys mp-multi-keys">
            <span><kbd>Space</kbd> tick <kbd>Enter</kbd> take <kbd>Esc</kbd> keep</span>
            <span className="mp-multi-buttons">
              <button type="button" onClick={() => setTicked([])} disabled={ticked.length === 0}>Clear</button>
              <button type="button" onClick={() => take(0)}>OK</button>
            </span>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
