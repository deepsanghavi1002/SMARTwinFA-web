import { Loader } from "../master-program/load";
import { toInt, toText } from "../master-program/legacy";
import { bookContext, controlEvents, entryProperties } from "./invoice";
import { replaceEntryTokens } from "./values";
import type { EntryOption } from "./types";

/**
 * The LINK registers (LINK ORDER SALE, LINK ORDER PURCHASE, LINK JOB OUT-IN ...): a new entry made from a source stock entry that is still pending.
 * Comman_Entry (licence 21) switches bl_Link_Entry on for a register whose name starts with LINK, shows the pending list (the setup's
 * xFIRST_COMBO / LF query into c1dg_LinkEntry, one row for each source entry), then, after F5, the source's lines (xxFIRST_COMBO / LF, one row for
 * each line), and after the second F5 Restore_Entry brings the chosen lines in as a new entry. The Save links them (PROD_LINK) and takes the
 * quantity off the source line (ag_qty / ag_fact).
 */

const field = Loader.field;

export type LinkColumn = Readonly<{ key: string; caption: string; align: "L" | "R" }>;
export type LinkList = Readonly<{ columns: readonly LinkColumn[]; rows: readonly Readonly<Record<string, string>>[]; total: string; /** The company allows several source entries in one new entry (yn_para MULTICHLN). */ multi: boolean }>;

/** bl_Link_Entry: licence 21 and a register named LINK ... */
export const isLinkRegister = (loader: Loader, option: Pick<EntryOption, "text">) => loader.session.licence === 21 && option.text.trim().toUpperCase().startsWith("LINK");

const CAPTION: Record<string, string> = { process_key: "Key", doc_no: "Doc No", full_docno: "Full Doc No", p_date: "Date", party_name: "Party", p_amount: "Amount", tot_qty: "Qty", entry_no: "Entry No", stock: "Stock" };
const RIGHT = new Set(["p_amount", "tot_qty", "stock"]);
const HIDDEN = new Set(["process_key", "tick"]);

const caption = (name: string) => CAPTION[name.toLowerCase()] ?? name.replace(/_/g, " ").replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
const shown = (value: unknown): string => {
  if (value instanceof Date) return value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "/");
  if (value === null || value === undefined) return "";
  const text = toText(value).trim();
  const number = Number(text);
  return text !== "" && Number.isFinite(number) && /^-?\d+\.\d+$/.test(text) ? number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : text;
};

/** The setup's c1dg_LinkEntry query of the register (`level`: the source entries, or their lines), with the PG dialect the web needs. */
async function linkQuery(loader: Loader, entryName: string, option: EntryOption, level: "entries" | "lines", where: string): Promise<{ sql: string; values: Awaited<ReturnType<typeof bookContext>>["values"] }> {
  const book = await bookContext(loader, entryName, option);
  const entryId = toInt(field(await entryProperties(loader, entryName), "entry_key"));
  const name = level === "entries" ? "xfirst_combo" : "xxfirst_combo";
  const event = (await controlEvents(loader, entryId)).find((candidate) => toText(field(candidate, "fill_control_name")).toLowerCase().trim() === "c1dg_linkentry"
    && toText(field(candidate, "control_name")).toLowerCase().trim() === name && toText(field(candidate, "control_event")).toUpperCase().trim() === "LF");
  if (!event) throw new Error("The setup has no pending list for this register");
  const raw = toText(field(event, "fill_control_query")).trim();
  const quoted = raw.replace(/as\s+'(\w+)'/gi, 'as "$1"');
  const sql = replaceEntryTokens((/^select\b/i.test(quoted) ? "" : "Select ") + quoted, book.values).replace(/\|sys\.query\.@pkval_1\|/gi, where).replace(/\|sys\.year_id\|/gi, `'${loader.session.yearId}'`);
  return { sql, values: book.values };
}

async function listOf(loader: Loader, sql: string, level: "entries" | "lines"): Promise<LinkList> {
  const multi = toText(loader.session.setup.yn_para).toUpperCase().includes("MULTICHLN,");
  const rows = (await loader.readTable(sql)) ?? [];
  const names = rows.length > 0 ? Object.keys(rows[0]) : [];
  const columns = names.filter((key) => !HIDDEN.has(key.toLowerCase())).map((key): LinkColumn => ({ key, caption: level === "lines" && key.toLowerCase() === "party_name" ? "Product" : caption(key), align: RIGHT.has(key.toLowerCase()) ? "R" : "L" }));
  const keyName = names.find((key) => key.toLowerCase() === "process_key") ?? "process_key";
  return { columns, rows: rows.map((row) => ({ ...Object.fromEntries(columns.map((column) => [column.key, shown(row[column.key])])), _key: String(toInt(row[keyName])) })), total: `${rows.length} pending`, multi };
}

/** The pending source entries of the register (the first list). */
export async function linkEntries(loader: Loader, entryName: string, option: EntryOption): Promise<LinkList> {
  const { sql } = await linkQuery(loader, entryName, option, "entries", "");
  return listOf(loader, sql, "entries");
}

/** The lines of the ticked source entries (the second list, licence 21). */
export async function linkLines(loader: Loader, entryName: string, option: EntryOption, processKeys: readonly number[]): Promise<LinkList> {
  const keys = processKeys.map((key) => Math.trunc(key)).filter((key) => key > 0);
  if (keys.length === 0) throw new Error("Tick an entry first");
  const { sql } = await linkQuery(loader, entryName, option, "lines", `pled.process_id in (${keys.join(",")})`);
  return listOf(loader, sql, "lines");
}

