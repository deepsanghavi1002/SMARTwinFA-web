/**
 * The party's address box (lbx_Address) is a list of text lines, several "Label : value" pairs to a line and the
 * label padded to a column ("Closing   : 4119793.00 Dr.   Tel. No.:"). This splits them into label / value pairs so
 * the screen can lay them out and wrap them; a line starting with ":" continues the label above it (the next address line).
 */
export type AddressField = Readonly<{ label: string; value: string }>;

const PAIR = /([A-Za-z][A-Za-z0-9_.+ ]{0,22}?)\s*:\s*(.*?)(?=\s{2,}[A-Za-z][A-Za-z0-9_.+ ]{0,22}?\s*:|\s*$)/g;

export function addressFields(lines: readonly string[]): AddressField[] {
  const out: { label: string; value: string }[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    let rest = line;
    // A continuation: no label, just ": text".
    const continuation = /^\s+:\s*(.*?)(?=\s{2,}[A-Za-z][A-Za-z0-9_.+ ]{0,22}?\s*:|\s*$)/.exec(line);
    if (continuation && out.length > 0) {
      const last = out[out.length - 1];
      const part = continuation[1].trim().replace(/[,\s]+$/, "");
      last.value = `${last.value}${last.value && part ? ", " : ""}${part}`;
      rest = line.slice(continuation[0].length);
    }
    for (const match of rest.matchAll(PAIR)) {
      out.push({ label: match[1].trim().replace(/_/g, " "), value: match[2].trim().replace(/\s{2,}/g, " ") });
    }
    if (!continuation && out.length === 0) out.push({ label: "", value: line.trim() });
  }
  return out.filter((field) => field.value !== "");
}
