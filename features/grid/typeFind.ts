"use client";

import { useRef } from "react";

/**
 * Type to find, for every grid of the program (master, small entry, entry, report, help lists): the letters typed search the current
 * column from the row the cursor is on, down and round again from the top. Text ignores separators ( / - . , and spaces), a number
 * keeps its decimal point, a date is read as shown. A row starting with the typed text is preferred to one holding it inside.
 */

export type FindKind = "text" | "number" | "date";

/**
 * A cell's text as the type-to-find reads it: any case, and for text the separators ( / - . , and spaces) left out, so
 * "rpiw2627145" finds "RPIW/26-27/145". A number keeps its "." (an exact amount with decimals), losing only commas and spaces;
 * a date is read as digits, day month year with no separators: "02/Apr/2026" is "02042026", so "0204" and "02/ap" both find it.
 */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DATE_SHOWN = /^\s*(\d{1,2})[/\-. ]([A-Za-z]{3,}|\d{1,2})[/\-. ](\d{2,4})/;
const dateForm = (text: string): string => {
  const parts = DATE_SHOWN.exec(text);
  if (!parts) return text.toUpperCase().replace(/[/\-.,\s]/g, "");
  const month = /^\d+$/.test(parts[2]) ? parts[2] : String(MONTHS.indexOf(parts[2].slice(0, 3).toUpperCase()) + 1);
  return `${parts[1].padStart(2, "0")}${month.padStart(2, "0")}${parts[3]}`;
};
export const findForm = (text: string, kind: FindKind): string => {
  const upper = text.toUpperCase();
  return kind === "date" ? dateForm(text) : kind === "number" ? upper.replace(/[,\s]/g, "") : upper.replace(/[/\-.,\s]/g, "");
};

/** What is typed, in the same form: a date's month name becomes its number once the letters say one month (ap = 04); letters that fit several (a) wait. */
export const findNeedle = (search: string, kind: FindKind): string => {
  if (kind !== "date") return findForm(search, kind);
  const upper = search.toUpperCase().replace(/[/\-.,\s]/g, "");
  const letters = /[A-Z]+/.exec(upper);
  if (!letters) return upper;
  const fits = MONTHS.map((name, at) => ({ name, at })).filter(({ name }) => name.startsWith(letters[0].slice(0, 3)));
  if (letters[0].length > 3 || fits.length === 0) return "?";
  const before = upper.slice(0, letters.index);
  return fits.length === 1 ? `${before}${String(fits[0].at + 1).padStart(2, "0")}${upper.slice(letters.index + letters[0].length)}` : before;
};

/**
 * Type to find over a column's prepared forms (findForm of each shown cell): the first row, from the cursor's row on and round again from the top, starting with what is typed, else (a text
 * or number, not a date) the first row holding it anywhere. `anywhere` says the second kind applied; `empty` is a typed text that is
 * only separators (nothing to look for yet).
 */
export function findTypedIn(forms: readonly string[], search: string, kind: FindKind, from = 0, raws?: readonly string[]): { at: number; anywhere: boolean; empty: boolean } {
  const needle = findNeedle(search, kind);
  if (needle === "") return { at: -1, anywhere: false, empty: true };
  // From the row the cursor is on (that row first, so a longer text stays on it), down, then round from the top.
  const first = Math.max(0, Math.min(from, forms.length));
  const look = (holds: (form: string) => boolean) => {
    for (let step = 0; step < forms.length; step += 1) {
      const at = (first + step) % forms.length;
      if (holds(forms[at])) return at;
    }
    return -1;
  };
  // A text is first looked for as typed, spaces and signs included ("a v" is A V S Sales Agency, not Avenue); only when no row starts so are they ignored.
  if (kind === "text" && raws) {
    const literal = search.toUpperCase().trimStart();
    for (let step = 0; step < raws.length && literal.trim() !== ""; step += 1) {
      const at = (first + step) % raws.length;
      if (raws[at].startsWith(literal)) return { at, anywhere: false, empty: false };
    }
  }
  const start = look((form) => form.startsWith(needle));
  if (start >= 0 || kind === "date") return { at: start, anywhere: false, empty: false };
  return { at: look((form) => form.includes(needle)), anywhere: true, empty: false };
}

/** The kind of find a field type reads as: D a date, N and C a number, anything else text. */
export const findKindOfType = (fieldType: string): FindKind => (fieldType === "D" ? "date" : fieldType === "N" || fieldType === "C" ? "number" : "text");

/** The first position of `count` (from `from`, then round) whose text matches what is typed; the forms are made on the spot. */
export function findPosition(count: number, textAt: (position: number) => string, search: string, kind: FindKind, from = 0): { at: number; anywhere: boolean; empty: boolean } {
  const texts = Array.from({ length: count }, (_unused, position) => textAt(position));
  return findTypedIn(texts.map((text) => findForm(text, kind)), search, kind, from, texts.map((text) => text.toUpperCase().trimStart()));
}

/**
 * The same find over a big grid, keeping each column's prepared forms between keys: they are made on the first key and reused
 * until the rows or the values change (`rows` and `values` are the identities the grid's own lists have).
 */
export function useTypeFind() {
  const cache = useRef<{ rows: unknown; values: unknown; byColumn: Map<string, { forms: string[]; raws: string[] }> }>({ rows: null, values: null, byColumn: new Map() });
  return (columnKey: string, kind: FindKind, rows: unknown, values: unknown, count: number, textAt: (position: number) => string, search: string, from: number) => {
    const held = cache.current;
    if (held.rows !== rows || held.values !== values) { held.rows = rows; held.values = values; held.byColumn = new Map(); }
    const id = `${columnKey}|${kind}`;
    let prepared = held.byColumn.get(id);
    if (!prepared) {
      const texts = Array.from({ length: count }, (_unused, position) => textAt(position));
      prepared = { forms: texts.map((text) => findForm(text, kind)), raws: texts.map((text) => text.toUpperCase().trimStart()) };
      held.byColumn.set(id, prepared);
    }
    return findTypedIn(prepared.forms, search, kind, from, prepared.raws);
  };
}

/**
 * The letters typed so far for a find in a list: they start again after a pause (1.2 s), but a text that ends with a space is a name waiting
 * for its next word ("a " then "v" for "A V S Sales Agency"), so it is kept longer (6 s). A space typed first is not taken.
 */
export function typedBuffer(held: { text: string; at: number }, now: number, key: string): string {
  const wait = held.text.endsWith(" ") ? 6000 : 1200;
  const kept = now - held.at > wait ? "" : held.text;
  return kept === "" && key === " " ? "" : kept + key.toUpperCase();
}
