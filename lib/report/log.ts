import { toInt, toText } from "../master-program/legacy";
import { Loader } from "../master-program/load";

/**
 * Report_Combine.btn_Log_Click for a voucher row (SMART_LED_KEY, else SMART_PROCESS_KEY):
 * ShowGridForm1 with read_logdata over <company>_BIGLOG.LOG_ENTRY, once for each part of the
 * entry: LENTRY_TOP_BOTTOM (TOP), LENTRY_ITEMS (ITEM), LENTRY_SLAB (SLAB), LENTRY_OUTSTAND
 * (OUTSTANDING) and LENTRY_ADDON (ADDON).
 *
 * Each record's JSON is an array of objects. A property whose name starts with "!" names the
 * position the following properties belong to; in an Edit record a "!*" property starts the next
 * edit column. Each part starts with a "Group Head: " row. The Add record fills Add_Value, each
 * edit its own Edit_Value_n, a delete the Delete column. As in the master's log, a voucher saved
 * before logging began still shows its edits (no Add_Value column).
 */

export type EntryLogTable = Readonly<{ columns: readonly string[]; rows: readonly (readonly string[])[]; message: string }>;

const field = Loader.field;
const identifier = /^[a-z_][a-z0-9_]*$/;
const PARTS = [["lentry_top_bottom", "TOP"], ["lentry_items", "ITEM"], ["lentry_slab", "SLAB"], ["lentry_outstand", "OUTSTANDING"], ["lentry_addon", "ADDON"]] as const;

export async function readEntryLog(loader: Loader, ledKey: number, processKey: number): Promise<EntryLogTable> {
  const schema = `${loader.session.companySchema}_biglog`;
  const empty = (message: string): EntryLogTable => ({ columns: [], rows: [], message });
  if (ledKey <= 0 && processKey <= 0) return empty("This row is not a voucher, so it has no log");
  if (!identifier.test(schema)) return empty("The log database name is not valid");
  const exists = await loader.readTable("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'log_entry'", [schema]);
  if (!exists) return empty(`No entry log: ${schema}.log_entry does not exist`);

  const where = ledKey > 0 ? "lentry_ledid = $1" : "lentry_processid = $1";
  const key = ledKey > 0 ? ledKey : processKey;
  const counts = await loader.readTable(
    `SELECT COUNT(*) FILTER (WHERE lentry_mode = 'A') AS added, COUNT(*) FILTER (WHERE lentry_mode = 'E') AS edited, COUNT(*) FILTER (WHERE lentry_mode = 'D') AS deleted FROM ${schema}.log_entry WHERE ${where}`,
    [key],
  );
  const added = toInt(field(counts?.[0], "added"));
  const edited = toInt(field(counts?.[0], "edited"));
  const deleted = toInt(field(counts?.[0], "deleted"));
  if (added + edited + deleted === 0) return empty("No log has been saved for this voucher yet");

  // order by LENTRY_MODE: the Add, then any Delete, then the edits in save order.
  const records = await loader.readTable(
    `SELECT lentry_mode, ${PARTS.map(([column]) => `${column}::text AS ${column}`).join(", ")} FROM ${schema}.log_entry WHERE ${where} ORDER BY lentry_mode, lentry_key`,
    [key],
  ) ?? [];

  const columns = ["FieldName", ...(added > 0 ? ["Add_Value"] : []), ...Array.from({ length: edited }, (_, index) => `Edit_Value_${index + 1}`), ...(deleted > 0 ? ["Delete"] : [])];
  const table = new Map<string, string[]>();
  const parse = (text: string): Record<string, unknown>[] => {
    try {
      const value = JSON.parse(text) as unknown;
      return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
    } catch {
      return [];
    }
  };
  /** write_logdata: A fills Add_Value, E the current edit column, D the Delete column. */
  const write = (mode: string, name: string, value: string, sort: string, editCount: number) => {
    const at = mode === "A" ? columns.indexOf("Add_Value") : mode === "E" ? columns.indexOf(`Edit_Value_${editCount}`) : mode === "D" ? columns.indexOf("Delete") : -1;
    if (at < 0) return;
    let row = table.get(sort);
    if (!row) { row = Array<string>(columns.length).fill(""); row[0] = name; table.set(sort, row); }
    row[at] = value;
  };

  for (const [column, part] of PARTS) {
    let editCount = 0;
    let position = "";
    let lastHead = "";
    for (const record of records) {
      const mode = toText(field(record, "lentry_mode"));
      for (const item of parse(toText(field(record, column)))) {
        for (const [name, raw] of Object.entries(item)) {
          const value = raw === null || raw === undefined ? "" : String(raw);
          if (part !== lastHead) { write(mode, "Group Head: ", `${part}  --------------------------------------------------`, `${part}${value}`, editCount); lastHead = part; }
          if (name.startsWith("!*") && mode === "E") { editCount += 1; write(mode, "Group Head: ", `${part}  --------------------------------------------------`, `${part}${value}`, editCount); }
          if (name.startsWith("!")) { position = value; continue; }
          write(mode, name, value, `${part}${position}${name}`, editCount);
        }
      }
    }
  }
  return { columns, rows: [...table.values()], message: "" };
}
