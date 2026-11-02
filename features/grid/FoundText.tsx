import type { ReactNode } from "react";
import { findForm, findNeedle } from "./typeFind";
import type { FindKind } from "./typeFind";

/**
 * Type to find (C1dg_UpdateGrid_KeyPress): the cell the search landed on, with the letters typed so
 * far marked where they match, at the start of its text, so the operator sees what was found.
 * Any other cell, or a text that does not start with them, shows as it is.
 */
export function FoundText({ text, typed, kind }: { text: string; typed: string; kind?: FindKind }) {
  if (kind === "date") return <DateFound text={text} typed={typed} />;
  if (kind) return <LooseFound text={text} typed={typed} kind={kind} />;
  const needle = typed.trim();
  const lead = text.length - text.trimStart().length;
  if (needle === "" || !text.slice(lead).toUpperCase().startsWith(needle.toUpperCase())) return <>{text}</>;
  return <>{text.slice(0, lead)}<mark className="mp-found">{text.slice(lead, lead + needle.length)}</mark>{text.slice(lead + needle.length)}</>;
}

/** The top search box's text marked wherever it occurs in a cell (any column), whatever the case. */
export function MarkedText({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toUpperCase();
  if (needle === "") return <>{text}</>;
  const upper = text.toUpperCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = upper.indexOf(needle); at >= 0; at = upper.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="mp-found">{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  if (from === 0) return <>{text}</>;
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

/** Type to find that ignores separators: the characters of the cell that match what was typed are marked, at the start or where they occur. */
function LooseFound({ text, typed, kind }: { text: string; typed: string; kind: FindKind }) {
  // As typed first (spaces included): the start of the text; else the letters and digits wherever they run.
  const literal = typed.toUpperCase().trimStart();
  const lead = text.length - text.trimStart().length;
  if (kind === "text" && literal.trim() !== "" && text.slice(lead).toUpperCase().startsWith(literal)) return <>{text.slice(0, lead)}<mark className="mp-found">{text.slice(lead, lead + literal.length)}</mark>{text.slice(lead + literal.length)}</>;
  const needle = findForm(typed, kind);
  if (needle === "") return <>{text}</>;
  const kept: number[] = [];
  let form = "";
  for (let at = 0; at < text.length; at += 1) {
    const piece = findForm(text[at], kind);
    if (piece !== "") { kept.push(at); form += piece; }
  }
  const from = form.startsWith(needle) ? 0 : form.indexOf(needle);
  if (from < 0) return <>{text}</>;
  const first = kept[from];
  const last = kept[from + needle.length - 1] + 1;
  return <>{text.slice(0, first)}<mark className="mp-found">{text.slice(first, last)}</mark>{text.slice(last)}</>;
}

/** A date found by its digits: the day, the month or the year part the typed digits reach is marked. */
function DateFound({ text, typed }: { text: string; typed: string }) {
  const needle = findNeedle(typed, "date");
  const parts = /^(\s*)(\d{1,2})([/\-. ])([A-Za-z]{3,}|\d{1,2})([/\-. ])(\d{2,4})/.exec(text);
  if (needle === "" || !parts || !findForm(text, "date").startsWith(needle)) return <>{text}</>;
  const reach = needle.length <= 2 ? parts[1].length + parts[2].length : needle.length <= 4 ? parts[1].length + parts[2].length + parts[3].length + parts[4].length : parts[0].length;
  return <>{text.slice(0, parts[1].length)}<mark className="mp-found">{text.slice(parts[1].length, reach)}</mark>{text.slice(reach)}</>;
}
