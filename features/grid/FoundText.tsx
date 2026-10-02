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
