"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Matched } from "../ui/Matched";

/**
 * The drop-down of a combo cell (combo_value L, Q or X) in the Update grid.
 *
 * The cell becomes a search box and the list opens under it. The value the cell holds stays in
 * sight the whole time: it heads the list ("Now: ...") and carries a tick, while the entry the
 * arrows are on is highlighted separately. Typing filters the list (entries that start with the
 * text first, then those that contain it). Enter takes the highlighted entry and moves on, Tab /
 * Shift+Tab take it and move right / left, a click takes it and stays, Esc leaves the value as it was.
 */
export type GridComboPlace = { left: number; top: number; width: number; rows: number };

const ROW = 22;

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={up ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} /></svg>
);
const Check = () => <svg className="ui-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>;
const SearchIcon = () => <svg className="ui-search" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>;

export function GridCombo({ options, current, startWith = "", place, onPick, onCancel }: {
  options: readonly { text: string; value: string }[];
  /** The value the cell holds now. */
  current: string;
  /** A letter typed on the cell that opened the list: the search starts with it. */
  startWith?: string;
  place: GridComboPlace | null;
  /** step: 1 / -1 to go on to the next / previous field, 0 to stay. */
  onPick: (text: string, step: 0 | 1 | -1) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(startWith);
  const matches = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (needle === "") return options;
    const starts = options.filter((option) => option.text.trim().toUpperCase().startsWith(needle));
    const contains = options.filter((option) => !option.text.trim().toUpperCase().startsWith(needle) && option.text.toUpperCase().includes(needle));
    return [...starts, ...contains];
  }, [options, query]);
  const [active, setActive] = useState(() => (startWith ? 0 : Math.max(0, options.findIndex((option) => option.text === current))));
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  /** The search box takes the keyboard as soon as the list opens. */
  const focusOnMount = useCallback((element: HTMLInputElement | null) => { element?.focus(); }, []);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);

  const pick = (step: 0 | 1 | -1) => onPick(matches[active]?.text ?? current, step);
  const move = (to: number) => setActive(Math.min(matches.length - 1, Math.max(0, to)));

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
        placeholder={current || "(blank)"}
        onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown": event.preventDefault(); move(active + 1); return;
            case "ArrowUp": event.preventDefault(); move(active - 1); return;
            case "PageDown": event.preventDefault(); move(active + 10); return;
            case "PageUp": event.preventDefault(); move(active - 10); return;
            case "Enter": event.preventDefault(); event.stopPropagation(); pick(1); return;
            case "Tab": event.preventDefault(); event.stopPropagation(); pick(event.shiftKey ? -1 : 1); return;
            case "Escape": event.preventDefault(); event.stopPropagation(); onCancel(); return;
          }
          if ((event.key === "Home" || event.key === "End") && query === "") { event.preventDefault(); move(event.key === "Home" ? 0 : matches.length - 1); }
        }}
      />
      <Chevron up />
      {place && createPortal(
        <div className="mp-grid-combo" style={{ left: place.left, top: place.top, width: place.width }} role="presentation" onMouseDown={(event) => event.preventDefault()}>
          <div className="mp-grid-combo-now" title={current}>
            <span>Now: <b>{current || "(blank)"}</b></span>
            <span className="mp-grid-combo-count">{matches.length === options.length ? `${options.length}` : `${matches.length} of ${options.length}`}</span>
          </div>
          <ul ref={list} id={listId} role="listbox" aria-label="Choices" style={{ maxHeight: ROW * Math.max(2, place.rows) }}>
            {matches.map((option, index) => {
              const isCurrent = option.text === current;
              return (
                <li
                  key={`${option.value}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  className={`${index === active ? "mp-grid-combo-active" : ""} ${isCurrent ? "mp-grid-combo-current" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseUp={() => onPick(option.text, 0)}
                >
                  <span className="mp-grid-combo-tick">{isCurrent ? <Check /> : null}</span>
                  <span className="mp-grid-combo-text"><Matched text={option.text} query={query} /></span>
                </li>
              );
            })}
            {matches.length === 0 && <li className="mp-grid-combo-none" role="presentation">Nothing matches “{query}”</li>}
          </ul>
          <div className="mp-grid-combo-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> take <kbd>Esc</kbd> keep · type to search</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
