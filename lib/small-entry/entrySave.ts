import { formatDesktopDate, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import type { EditedRow, EntryState } from "./types";

/**
 * Small_Entry.cs, the `int_Small_Entry_Id == n` parts of Save_Click and
 * Save_MultipleLoop_forGrid that the setup rows (entry_save_properties) do not describe:
 * rows a grid never saves, checks before saving, and entries whose save is written in code.
 *
 * Grid columns are numbered as the desktop numbers them: column 1 is the query's first
 * column (keys[0]), column 0 being the row marker.
 */

type Values = Readonly<Record<string, string>>;

/**
 * A statement for the save: plain SQL, or an INSERT whose key the save allocates (max+1).
 * `capture` names the new row's key so later statements can use it as {{name}}; `biglog`
 * puts the row in the company's <schema>_biglog (the desktop's <COMPANY>_BIGLOG).
 */
export type EntryStatement = Readonly<{
  sql: string;
  insert?: Readonly<{ table: string; fields: string[]; values: string[]; capture?: string; biglog?: boolean }>;
  /** A SELECT whose first value later statements use as @<capture> (a query_add_type S rule). */
  select?: Readonly<{ sql: string; capture: string }>;
}>;

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const number = (value: string | undefined) => Number((value ?? "").replace(/,/g, "").trim()) || 0;

/** A cell by column name, whatever case the query gave it. */
export function cellOf(values: Values, name: string): string | undefined {
  if (name in values) return values[name];
  const lower = name.toLowerCase();
  const key = Object.keys(values).find((candidate) => candidate.toLowerCase() === lower);
  return key === undefined ? undefined : values[key];
}

/** The desktop's Rows[row][n]: the n-th column of the grid (1-based). */
const column = (values: Values, keys: readonly string[], n: number) => {
  const key = keys[n - 1];
  return key === undefined ? undefined : cellOf(values, key);
};

/** A cell the desktop reads as null: missing or blank. */
const blank = (value: string | undefined) => value === undefined || value.trim() === "";

/**
 * Save_MultipleLoop_forGrid's `continue`s: a row these entries never save, whatever the
 * operator did to it (production planning with nothing planned, an allotment of nothing).
 */
export function skipRow(entryId: number, values: Values, keys: readonly string[], primaryKey: number): boolean {
  const at = (n: number) => column(values, keys, n);
  switch (entryId) {
    case 7: return blank(at(7)); // LY bank reco
    case 9: return blank(at(9)); // LY outstanding
    case 15: return blank(at(5)) && blank(at(6)); // cash / bank
    case 16: return blank(at(6)); // journal
    case 17: return blank(at(4)); // batch rename
    case 31: return number(at(9)) === 0; // challan / order close
    case 35: case 48: case 54: return number(cellOf(values, "Planing")) === 0 && primaryKey === 0; // production planning
    case 46: return number(at(3)) === 0; // payment manual allot
    case 56: return primaryKey === 0 && number(at(5)) === 0; // collection plan
    case 58: return number(at(8)) === 0; // plating in
    case 61: case 62: return blank(at(2)); // water / vehicle
    case 111: return blank(at(4));
    case 114: return toInt(at(7)) === 0; // packing in
    default: return false;
  }
}

/** sys.dt_date / sys.dt_date3: the header's Entry Date (dtp_Date) and third date (dtp_Date3). */
export function headerDate(system: string, state: EntryState, now = new Date()): string | null {
  const key = system.trim().replace(/^\||\|$/g, "").toLowerCase();
  const name = key === "sys.dt_date" ? "dtp_date" : key === "sys.dt_date3" ? "dtp_date3" : "";
  if (name === "") return null;
  const date = parseDesktopDate(state.controls[name] ?? "") ?? now;
  return quote(formatDesktopDate(date));
}

/**
 * Save_Click's checks before the save; a message stops it. Production Planing Update (54):
 * the short quantity of a job card must be exactly what was planned less what was produced.
 */
export async function checkBeforeSave(loader: Loader, entryId: number, rows: readonly EditedRow[]): Promise<string> {
  if (entryId !== 54) return "";
  const schema = loader.session.companySchema;
  for (const { values, deleted } of rows) {
    if (deleted) continue;
    const planned = number(cellOf(values, "planing"));
    const short = number(cellOf(values, "PLAN_SORT"));
    if (!(planned > 0 && short > 0)) continue;
    const jobCard = cellOf(values, "job_card_no") ?? "";
    const produced = await loader.readTable(
      `select sum(quantity) as qty from ${schema}.prod_ledger prodled left join ${schema}.addon_aentry aent on aent.aona_processid=prodled.process_id left join ${schema}.product_master prodmas on prodmas.prod_key=prodled.prod_id where prodled.il_pos='A' and trn_module='PROD-FG' and aent.input_job_card=$1 and prodmas.prod_desc=$2`,
      [jobCard, cellOf(values, "item") ?? ""],
    );
    const due = planned - number(String(produced?.[0]?.qty ?? "0"));
    if (short !== due) return `${short > due ? "Plan Short greater than equal " : "Plan Short less than equal "}${due} Not Allowed for Job Card No : ${jobCard}`;
  }
  return "";
}

/**
 * Values the desktop fills into the grid while it is edited (C1dg_SmallEntryGrid_AfterEdit),
 * given here at save time. Production Planing (35): each planned row without a job card
 * takes the next number, after the highest of the year's plans (GetNumbers: the digits of
 * job_card_no), or yyYY0001 for the year's first. A saved number is never renumbered.
 */
export async function prepareRows(loader: Loader, entryId: number, rows: readonly EditedRow[]): Promise<EditedRow[]> {
  if (entryId !== 35) return [...rows];
  const { session } = loader;
  const highest = await loader.readTable(
    `select max(nullif(regexp_replace(job_card_no, '\\D', '', 'g'), '')::numeric) as top from ${session.companySchema}.production_planing where ent_type='PP' and coalesce(job_card_no,'')<>'' and ent_date >= $1`,
    [formatDesktopDate(session.tarikh1)],
  );
  const top = Number(highest?.[0]?.top ?? 0);
  let next = top > 0 ? top + 1 : Number(`${String(session.tarikh1.getFullYear()).slice(2)}${String(session.tarikh2.getFullYear()).slice(2)}0001`);
  return rows.map((row) => {
    if (row.deleted || number(cellOf(row.values, "planing")) <= 0 || (cellOf(row.values, "job_card_no") ?? "").trim() !== "") return row;
    const key = Object.keys(row.values).find((name) => name.toLowerCase() === "job_card_no") ?? "job_card_no";
    return { ...row, values: { ...row.values, [key]: String(next++) } };
  });
}

/**
 * Entries whose save the desktop writes in Save_Click instead of the setup rows; null for
 * the rest. Similar Product (51): a ticked product is kept as a substitute of the chosen
 * one, an unticked one that was kept is removed.
 */
export function entryStatements(entryId: number, rows: readonly EditedRow[], keys: readonly string[], state: EntryState): EntryStatement[] | null {
  if (entryId !== 51) return null;
  const parent = toInt(state.firstCombo?.value);
  const statements: EntryStatement[] = [];
  for (const { values } of rows) {
    const key = toInt(column(values, keys, 1));
    const product = toInt(column(values, keys, 2));
    const tick = (column(values, keys, 4) ?? "").trim();
    if (key > 0) {
      statements.push({ sql: tick === "Yes" ? `Update prod_subsitude set SUB_PROD_ID=${product},PROD_SUB=${quote(tick)} where PROD_SUB_KEY=${key}` : `Delete from prod_subsitude where PROD_SUB_KEY=${key}` });
    } else if (tick === "Yes") {
      statements.push({ sql: "", insert: { table: "prod_subsitude", fields: ["PARENT_PROD_ID", "SUB_PROD_ID", "PROD_SUB"], values: [String(parent), String(product), quote(tick)] } });
    }
  }
  return statements;
}
