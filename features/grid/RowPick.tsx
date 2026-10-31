"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { activeScope } from "../ui/activeWindow";

/**
 * F6 in an open editor: the other values of the same row that suit the cell (a number cell is offered the row's number
 * and currency columns, a text cell the text columns, a date cell the date columns), listed with their headings. Picking one
 * puts it in the cell. F8 takes the value of the nearest column to the left of the cell's own kind (a number cell skips a Dr / Cr text
 * column and takes the figure before it). Both are for master, small entry and any editable grid;
 * the screen runs the column's own checks on the value before it is kept.
 */

export type PickKind = "number" | "date" | "text";
/** A field type as the pick reads it: D a date; N, C (currency), I a number; anything else text. */
export const pickKindOf = (fieldType: string): PickKind => (fieldType === "D" ? "date" : fieldType === "N" || fieldType === "C" || fieldType === "I" ? "number" : "text");

export type PickChoice = Readonly<{ caption: string; value: string }>;
/** Where the list opens: the cell's box, and the highest line it may reach (the top of the grid, below the menu bar). */
export type PickPlace = Readonly<{ left: number; top: number; bottom: number; limitTop: number }>;

/** The cell's place for the list, read from its grid mark (the grid's own top is the ceiling). */
export function pickPlace(cell: Element | null | undefined, grid: Element | null | undefined): PickPlace {
  const box = cell?.getBoundingClientRect();
  const ceiling = grid?.getBoundingClientRect().top ?? 0;
  return box ? { left: box.left, top: box.top, bottom: box.bottom, limitTop: Math.max(0, ceiling) } : { left: 40, top: 120, bottom: 140, limitTop: 0 };
}

/**
 * The values of the row's other columns of the cell's own kind (blank ones and the cell's own column left out), in a round from the
 * cell: the column before it back to the first, then the last column back to the one after it.
 */
export function pickChoices<T extends { key: string; caption: string }>(columns: readonly T[], current: T, kindOf: (column: T) => PickKind, valueOf: (column: T) => string): PickChoice[] {
  const kind = kindOf(current);
  const at = columns.findIndex((column) => column.key === current.key);
  const round = at < 0 ? [...columns] : [...columns.slice(0, at).reverse(), ...columns.slice(at + 1).reverse()];
  return round
    .filter((column) => column.key !== current.key && kindOf(column) === kind)
    .map((column) => ({ caption: column.caption.replace(/^\*+\s*/, "").trim(), value: valueOf(column).trim() }))
    .filter((choice) => choice.value !== "" && !(kind === "number" && Number(choice.value.replace(/,/g, "")) === 0));
}

export function RowPick({ choices, place, onPick, onClose }: { choices: readonly PickChoice[]; place: PickPlace; onPick: (value: string) => void; onClose: () => void }) {
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { stop(); onClose(); return; }
    if (event.key === "ArrowDown") { stop(); setActive((at) => Math.min(choices.length - 1, at + 1)); return; }
    if (event.key === "ArrowUp") { stop(); setActive((at) => Math.max(0, at - 1)); return; }
    if (event.key === "Home") { stop(); setActive(0); return; }
    if (event.key === "End") { stop(); setActive(choices.length - 1); return; }
    if (event.key === "Enter" || event.key === "Tab") { stop(); if (choices[active]) onPick(choices[active].value); return; }
    if (event.key === "F6") { stop(); onClose(); return; }
    event.stopPropagation();
  };
  // Under the cell when the list fits there, else above it; never past the grid's top or the screen's bottom (it scrolls inside).
  const wanted = Math.min(260, 30 + 22 * Math.max(1, choices.length));
  const below = window.innerHeight - place.bottom - 8;
  const above = place.top - place.limitTop - 4;
  const under = wanted <= below || below >= above;
  const style = under
    ? { left: Math.max(4, Math.min(place.left, window.innerWidth - 300)), top: place.bottom + 2, maxHeight: Math.max(80, Math.min(260, below)) }
    : { left: Math.max(4, Math.min(place.left, window.innerWidth - 300)), bottom: window.innerHeight - place.top + 2, maxHeight: Math.max(80, Math.min(260, above)) };
  return (
    <div className="mp-calc-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={box} className="mp-rowpick" role="listbox" aria-label="Values in this row" tabIndex={0} style={style} onKeyDown={keys}>
        <div className="mp-rowpick-title">Values in this row · ↑↓ Enter to use · Esc</div>
        {choices.length === 0 ? <div className="mp-rowpick-empty">No other value of this kind in the row</div> : choices.map((choice, at) => (
          <div key={`${choice.caption}-${at}`} role="option" tabIndex={-1} aria-selected={at === active} className={`mp-rowpick-item${at === active ? " mp-rowpick-active" : ""}`} onMouseEnter={() => setActive(at)} onMouseDown={(event) => { event.preventDefault(); onPick(choice.value); }}>
            <span>{choice.caption}</span><b>{choice.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The status-line hint for the two keys, added to an open editor's hint. */
export const ROW_PICK_HINT = " · F6 Row values · F8 Copy left value";

/**
 * F6 (pick from the row's values of the cell's kind) and F8 (copy the previous column) for any editable grid. The screen gives the
 * row's columns and how to read them, its own commit (the column's checks) and what happens after a value is kept; this runs
 * both keys, the list, and the rule that a refused value leaves the cursor in the same cell, editing, with the value it had.
 */
export function useRowPick<C extends { key: string; caption: string }>(options: {
  columns: readonly C[];
  kindOf: (column: C) => PickKind;
  /** The current row's value of a column, as the grid shows it. */
  valueOf: (column: C) => string;
  /** The cell of a column in the current row (its data-cell mark), where the list opens. */
  cellOf: (column: C) => Element | null;
  /** Whether the keys apply to a column (not a list or a tick box). */
  pickable: (column: C) => boolean;
  editing: boolean;
  /** The screen's own checks and keeping of a value (the same as typing it and pressing Enter); false when refused. */
  commit: (value: string) => Promise<boolean>;
  startEdit: () => unknown;
  /** A value was kept: the cursor goes on as Enter does. */
  afterFill: () => void;
  setMessage: (text: string) => void;
}) {
  const [pick, setPick] = useState<{ choices: PickChoice[]; place: PickPlace } | null>(null);
  const fill = async (value: string) => {
    setPick(null);
    const wasEditing = options.editing;
    if (!(await options.commit(value))) {
      // Refused (the message is answered): the cursor stays in this cell, editing, with the value it had.
      if (!wasEditing) await options.startEdit();
      setTimeout(() => {
        const input = activeScope().querySelector<HTMLInputElement | HTMLSelectElement>(".mp-editor");
        input?.focus();
        if (input instanceof HTMLInputElement) input.select();
      }, 0);
      return;
    }
    options.afterFill();
  };
  const open = (column: C) => {
    const choices = pickChoices(options.columns, column, options.kindOf, options.valueOf);
    setPick({ choices, place: pickPlace(options.cellOf(column), activeScope().querySelector(".mp-grid")) });
  };
  /**
   * F8: the value of the nearest column to the left of the cell's own kind that holds one (so a figure cell skips a Dr / Cr text column
   * and takes the figure before it, a zero figure is not a value).
   */
  const copyPrevious = async (column: C) => {
    const kind = options.kindOf(column);
    let value = "";
    for (let at = options.columns.findIndex((candidate) => candidate.key === column.key) - 1; at >= 0 && value === ""; at -= 1) {
      const candidate = options.columns[at];
      if (options.kindOf(candidate) !== kind) continue;
      const shown = options.valueOf(candidate).trim();
      if (shown !== "" && !(kind === "number" && Number(shown.replace(/,/g, "")) === 0)) value = shown;
    }
    if (value === "") { options.setMessage("Nothing to copy from the columns on the left"); return; }
    await fill(value);
  };
  /** F6 and F8 in an open editor: true when the key was theirs. */
  const keys = (event: { key: string; preventDefault: () => void; stopPropagation: () => void }, column: C): boolean => {
    if ((event.key !== "F6" && event.key !== "F8") || !options.pickable(column)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "F6") open(column); else void copyPrevious(column);
    return true;
  };
  const popup = pick ? <RowPick choices={pick.choices} place={pick.place} onPick={(value) => void fill(value)} onClose={() => { setPick(null); activeScope().querySelector<HTMLInputElement>(".mp-editor")?.focus(); }} /> : null;
  return { popup, keys, copyPrevious, open: pick !== null };
}
