import type { ReactNode } from "react";

/**
 * Type to find (C1dg_UpdateGrid_KeyPress): the cell the search landed on, with the letters typed so
 * far marked where they match, at the start of its text, so the operator sees what was found.
 * Any other cell, or a text that does not start with them, shows as it is.
 */
export function FoundText({ text, typed }: { text: string; typed: string }) {
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
