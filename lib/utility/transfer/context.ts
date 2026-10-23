import type { RepostContext } from "../repost/context";
import { rows, run } from "../repost/context";

/** What the Transfer Balance screen asks for (its check boxes; the desktop's bl_Do_* of Cls_Transferbal). */
export type TransferOptions = Readonly<{
  account: boolean;
  product: boolean;
  addonOpening: boolean;
  outclear: boolean;
  lyAddon: boolean;
  lyAccount: boolean;
  lyProduct: boolean;
  pendReco: boolean;
  pendOrder: boolean;
  osOnAccountClear: boolean;
  ignoreAccountManual: boolean;
  ignoreProductManual: boolean;
}>;

/**
 * Utility > Transfer Balance (Utility_Transferbal, SP_TRANSFER_DATA of SMART_SETUP). The procedure builds every statement as text with the current
 * company's database (@var_database_name) and last year's (@var_from_database_name) in front of each table; here the same statements run in PostgreSQL
 * against the two schemas, in the procedure's order, inside one transaction. `sch` is this year's schema, `o` last year's.
 */
export type TransferContext = RepostContext & Readonly<{
  /** Last year's schema (@var_from_database_name). */
  o: string;
  /** This year's first day, the day before it, and last year's first and last day, as 'YYYY-MM-DD'. */
  t1: string;
  t1m1: string;
  ly1: string;
  ly2: string;
  /** Year_ID of last year (the first YEAR_ID of its AC_BALANCE, as the procedure reads it). */
  lyYearId: string;
  opt: TransferOptions;
}>;

const known = new WeakMap<object, Map<string, Set<string>>>();

/** The columns of a table (empty when it has none, or is not there). */
export async function columnsOf(ctx: TransferContext, schema: string, table: string): Promise<Set<string>> {
  let byTable = known.get(ctx);
  if (!byTable) known.set(ctx, byTable = new Map());
  const key = `${schema}.${table}`;
  const kept = byTable.get(key);
  if (kept) return kept;
  const found = await rows<{ column_name: string }>(ctx, `Columns of ${key}`, "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2", [schema, table]);
  const set = new Set(found.map((row) => row.column_name));
  byTable.set(key, set);
  return set;
}

const bare = (name: string) => name.replace(/"/g, "");

/** `column` taken straight from `alias`, one pair for each name. */
export const same = (alias: string, columns: readonly string[]): [string, string][] => columns.map((column) => [column, `${alias}.${column}`]);

/**
 * INSERT target (columns) SELECT expressions <from/where>. A column that this database does not have (in the target, or in the source table it is
 * copied from) is left out, except the trf_ keys that tie the new row to last year's, which must be there.
 */
export async function insertRows(ctx: TransferContext, step: string, table: string, pairs: ReadonlyArray<readonly [string, string]>, fromWhere: string, source?: { alias: string; table: string }): Promise<number> {
  const target = await columnsOf(ctx, ctx.sch, table);
  const origin = source ? await columnsOf(ctx, ctx.o, source.table) : null;
  const used = pairs.filter(([column, expr]) => {
    if (column.startsWith("trf_")) return true;
    if (!target.has(bare(column))) return false;
    const match = source ? new RegExp(`^${source.alias}\\.("?\\w+"?)$`).exec(expr) : null;
    return !(match && origin && !origin.has(bare(match[1])));
  });
  return run(ctx, step, `INSERT INTO ${ctx.sch}.${table} (${used.map(([column]) => column).join(", ")}) SELECT ${used.map(([, expr]) => expr).join(", ")} ${fromWhere}`);
}

/** The keys of the addon fields of master type that carry a text (the 'M' fields), in the order of the screen. */
export async function addonMasterFields(ctx: TransferContext, relate: "A" | "P"): Promise<{ key: number; save: string }[]> {
  const found = await rows<{ fiel_key: number; fiel_save: string }>(ctx, `Addon master fields (${relate})`,
    `SELECT fiel_key, btrim(fiel_save) AS fiel_save FROM ${ctx.sch}.addon_fld WHERE fiel_pos = 'A' AND fiel_relate = $1 AND fiel_masterpos = 'Y' AND fiel_type = 'M' AND coalesce(fiel_stkmdl, '') = '' ORDER BY fiel_serial`, [relate]);
  return found.map((row) => ({ key: Number(row.fiel_key), save: String(row.fiel_save) }));
}

/** key_/txt_ column lists of the addon fields of an entry (ADDON_FLD of the line/party entry): input fields have one column, the others a key and a text. */
export async function addonEntryColumns(ctx: TransferContext, entryPos: "L" | "P", relate: "A" | "P"): Promise<string[]> {
  const found = await rows<{ fiel_type: string; fiel_save: string }>(ctx, `Addon entry fields (${entryPos})`,
    `SELECT fiel_type, btrim(fiel_save) AS fiel_save FROM ${ctx.sch}.addon_fld WHERE fiel_entrypos = $1 AND fiel_pos = 'A' AND fiel_relate = $2`, [entryPos, relate]);
  const names: string[] = [];
  for (const row of found) {
    if (row.fiel_type === "I") names.push(`input_${row.fiel_save}`);
    else names.push(`key_${row.fiel_save}`, `txt_${row.fiel_save}`);
  }
  return names;
}

export const q = (ctx: TransferContext, step: string, sql: string) => run(ctx, step, sql);

/** An amount the way the procedure writes it into a statement. */
export const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/** The time of the day the procedure stamps (CONVERT(VARCHAR(8), GETDATE(), 108)). */
export const NOW_DATE = "current_date";
export const NOW_TIME = "to_char(now(), 'HH24:MI:SS')";
