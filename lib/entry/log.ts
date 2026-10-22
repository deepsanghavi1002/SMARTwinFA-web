import { Loader } from "../master-program/load";
import { toInt, toText } from "../master-program/legacy";
import { bookContext } from "./invoice";
import type { EntryOption } from "./types";

/**
 * The Log button (ShowGridForm / read_logdata / write_logdata): the special log rows of an entry
 * (<company>_biglog.log_entry, written when setup.logfile is S) laid side by side. The first
 * column is the Add, each Edit after it has its own column, so a changed figure is easy to see.
 * Sections are the entry's top and bottom, its items, slab, outstanding set-offs and addon.
 */

type Row = Record<string, unknown>;
const field = Loader.field;

export type LogVersion = Readonly<{ mode: string; user: string; machine: string; savedate: string; savetime: string }>;
export type LogRow = Readonly<{
  /** "head": a group heading; "field": one field of one item / slab row / the entry. */
  kind: "head" | "field";
  /** The group the field belongs to: ITEM120406 (the section and the key of the row it is on). */
  group: string;
  /** The section as the window shows it: TOP, ITEM, SLAB, ADDON ... (no row key). */
  section: string;
  name: string;
  cells: readonly string[];
}>;
/** docNo: the entry's own number (ledger.doc_no), for the name of an exported file. */
export type EntryLog = Readonly<{ versions: LogVersion[]; rows: LogRow[]; docNo: string }>;

const SECTIONS: readonly { column: string; label: (style: string) => string }[] = [
  { column: "lentry_top_bottom", label: () => "TOP" },
  { column: "lentry_items", label: (style) => (style === "I" ? "ITEM" : "VOUCHER DETAILS") },
  { column: "lentry_slab", label: () => "SLAB" },
  { column: "lentry_outstand", label: () => "OUTSTANDING" },
  { column: "lentry_addon", label: () => "ADDON" },
];

/** The log's JSON text: an array of objects (the desktop's own text was not always valid JSON, so a bad piece is skipped). */
function objects(text: string): Record<string, unknown>[] {
  if (text.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
  } catch {
    return [];
  }
}

export async function entryLog(loader: Loader, entryName: string, firstCombo: EntryOption, uniqueKey: number): Promise<EntryLog> {
  const { session } = loader;
  const book = await bookContext(loader, entryName, firstCombo);
  const style = "I";
  const led = (await loader.readTable(`SELECT led_key, doc_no FROM |sys.db|ledger WHERE unique_key = $1 AND book = $2`, [uniqueKey, book.values.bookKey]))?.[0];
  const ledKey = toInt(field(led, "led_key"));
  if (ledKey <= 0) throw new Error("The entry was not found");
  const result = await loader.client.query(
    `SELECT l.*, to_char(l.lentry_savedate, 'DD/Mon/YYYY') AS saved_on FROM ${session.companySchema}_biglog.log_entry l WHERE l.lentry_ledid = $1 ORDER BY CASE l.lentry_mode WHEN 'A' THEN 0 ELSE 1 END, l.lentry_key`,
    [ledKey],
  );
  const users = new Map<number, string>(((await loader.readTable(`SELECT user_no, BTRIM(login_name) AS login_name FROM smart_system.user_master`)) ?? []).map((user) => [toInt(field(user, "user_no")), toText(field(user, "login_name"))]));
  const versions: LogVersion[] = result.rows.map((row: Row) => ({
    mode: toText(row.lentry_mode).trim(),
    user: users.get(toInt(row.lentry_user)) ?? String(row.lentry_user ?? ""),
    machine: toText(row.lentry_machine_name).trim(),
    savedate: toText(row.saved_on).trim(),
    savetime: toText(row.lentry_savetime).trim(),
  }));

  const rows: LogRow[] = [];
  const at = new Map<string, number>();
  const put = (kind: "head" | "field", group: string, section: string, name: string, version: number, value: string) => {
    const key = `${kind}|${group}|${name}`;
    let index = at.get(key);
    if (index === undefined) {
      index = rows.length;
      at.set(key, index);
      rows.push({ kind, group, section, name, cells: versions.map(() => "") });
    }
    const cells = [...rows[index].cells];
    cells[version] = value;
    rows[index] = { ...rows[index], cells };
  };
  result.rows.forEach((row: Row, version: number) => {
    for (const section of SECTIONS) {
      const label = section.label(style);
      const list = objects(toText(row[section.column]));
      if (list.length === 0) continue;
      put("head", label, label, "Group Head: ", version, `${label}  --------------------------------------------------`);
      for (const item of list) {
        // The key of the row (!*Il_key, !Slab_key ...) names the row the other fields belong to.
        const keyField = Object.keys(item).find((name) => name.startsWith("!"));
        const group = `${label}${keyField ? toText(item[keyField]) : ""}`;
        for (const [name, value] of Object.entries(item)) {
          if (name.startsWith("!")) continue;
          put("field", group, label, name, version, toText(value));
        }
      }
    }
  });
  return { versions, rows, docNo: toText(field(led, "doc_no")).trim() };
}
