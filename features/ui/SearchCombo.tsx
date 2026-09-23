"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Matched } from "./Matched";

/**
 * A combo box you can type into to search, for any screen.
 *
 * Typing filters the list (entries that start with the text first, then those that contain
 * it) and highlights the first match. Up / Down / PageUp / PageDown move, Enter or a click
 * chooses, Esc closes the list and puts the chosen text back, Alt+Down or F4 opens it.
 * Leaving the box with text that exactly names an entry chooses that entry.
 */
export type ComboItem = { text: string; value: string };

const LIMIT = 300;

export function SearchCombo<T extends ComboItem>({
  options,
  value,
  onChoose,
  disabled,
  placeholder = "Type to search…",
  ariaLabel,
  reselect,
}: {
  options: readonly T[];
  value: T | null;
  onChoose: (option: T) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  /** Enter on an unchanged box chooses the current entry again (to reload it). */
  reselect?: boolean;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const matches = useMemo(() => {
    const needle = (query ?? "").trim().toUpperCase();
    if (needle === "") return options.slice(0, LIMIT);
    const starts: T[] = [];
    const contains: T[] = [];
    for (const option of options) {
      const text = option.text.toUpperCase();
      if (text.startsWith(needle)) starts.push(option);
      else if (text.includes(needle)) contains.push(option);
    }
    return [...starts, ...contains].slice(0, LIMIT);
  }, [options, query]);

  // Keep the highlighted entry in view.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openAt = (options: readonly T[]) => {
    const at = value ? options.findIndex((option) => option.value === value.value && option.text === value.text) : -1;
    setActive(Math.max(0, at));
    setOpen(true);
  };
  const choose = (option: T | undefined) => {
    setQuery(null);
    setOpen(false);
    if (option) onChoose(option);
  };
  const exact = (text: string) => options.find((option) => option.text.trim().toUpperCase() === text.trim().toUpperCase());

  return (
    <span className="search-combo">
      <input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && matches[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        value={query ?? value?.text ?? ""}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onBlur={() => {
          if (query !== null && query.trim() !== "") {
            const option = exact(query);
            if (option && (option.value !== value?.value || option.text !== value?.text)) { choose(option); return; }
          }
          setQuery(null);
          setOpen(false);
        }}
        onKeyDown={(event) => {
          const page = 10;
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              if (!open || event.altKey) { openAt(matches); return; }
              setActive((at) => Math.min(matches.length - 1, at + 1));
              return;
            case "ArrowUp":
              event.preventDefault();
              if (open) setActive((at) => Math.max(0, at - 1));
              return;
            case "PageDown": if (open) { event.preventDefault(); setActive((at) => Math.min(matches.length - 1, at + page)); } return;
            case "PageUp": if (open) { event.preventDefault(); setActive((at) => Math.max(0, at - page)); } return;
            case "F4": event.preventDefault(); if (open) setOpen(false); else openAt(matches); return;
            case "Enter": {
              event.preventDefault();
              if (open && matches[active]) { choose(matches[active]); return; }
              if (query !== null && query.trim() !== "") { choose(exact(query)); return; }
              if (reselect && value) choose(value);
              return;
            }
            case "Escape":
              // Only swallow Esc when it had something to close; otherwise the screen gets it.
              if (open || query !== null) { event.preventDefault(); event.stopPropagation(); setQuery(null); setOpen(false); }
              return;
          }
        }}
      />
      <button type="button" className={`search-combo-arrow ${open ? "search-combo-arrow-open" : ""}`} tabIndex={-1} disabled={disabled} aria-label={`Show ${ariaLabel} list`}
        onMouseDown={(event) => {
          event.preventDefault();
          const input = event.currentTarget.previousElementSibling as HTMLInputElement | null;
          input?.focus();
          if (open) setOpen(false); else openAt(matches);
        }}><svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg></button>
      {open && (
        <ul ref={list} id={`${id}-list`} className="search-combo-list" role="listbox" aria-label={ariaLabel}>
          {matches.map((option, index) => (
            <li
              key={`${option.value}-${index}`}
              id={`${id}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === active}
              className={index === active ? "search-combo-active" : undefined}
              onMouseDown={(event) => { event.preventDefault(); choose(option); }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="search-combo-tick">{value && option.value === value.value && option.text === value.text ? <svg className="ui-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg> : null}</span>
              <Matched text={option.text} query={query ?? ""} />
            </li>
          ))}
          {matches.length === 0 && <li className="search-combo-none" role="presentation">Nothing matches “{query}”</li>}
        </ul>
      )}
    </span>
  );
}
