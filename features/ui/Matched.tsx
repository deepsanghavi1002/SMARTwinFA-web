/** A choice's text with the part matching the search marked (for any searchable list). */
export function Matched({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  const at = needle === "" ? -1 : text.toUpperCase().indexOf(needle.toUpperCase());
  if (at < 0) return <>{text || " "}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + needle.length)}</mark>{text.slice(at + needle.length)}</>;
}
