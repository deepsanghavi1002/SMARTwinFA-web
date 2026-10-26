import { displayValue, Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";

/**
 * The F1 window of the account and product helps: the whole master record of the highlighted row, one field to a row
 * (field name, value) like the Log window. An account shows its master row, its addresses and its addon fields; a product
 * its master row and its addon fields. Read-only.
 */

type Row = Record<string, unknown>;
const field = Loader.field;

export type DetailRow = Readonly<{ group: string; name: string; value: string }>;
export type MasterDetails = Readonly<{ title: string; rows: readonly DetailRow[] }>;

/** credit_days -> "Credit Days". */
function caption(column: string): string {
  return column.replace(/_/g, " ").trim().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

/** The caption of a line that shows a name for an id. */
const NAMED_LABEL: Readonly<Record<string, string>> = { bs_id: "Schedule", address_id: "Address Id", state_id: "State", comb_code: "Combine Account", type_deduct: "Type Deduct", nature_pay: "Nature Pay" };

/** A column whose value is shown as a name (null: nothing to show for it, the line is left out). */
type Resolve = (value: unknown) => string | null;

/**
 * One line per column. Keys never show (address_key, imp_ / trf_ keys, the master's own code), nor an id that has no name to give; a column in `resolve`
 * shows its name instead of the number (the schedule, the state, the address kind ...).
 */
function fieldsOf(group: string, row: Row | undefined, skip: readonly string[] = [], resolve: Readonly<Record<string, Resolve>> = {}): DetailRow[] {
  if (!row) return [];
  return Object.entries(row).flatMap(([column, value]) => {
    const lower = column.toLowerCase();
    if (skip.includes(lower)) return [];
    const resolver = resolve[lower];
    if (resolver) {
      const named = resolver(value);
      return named === null ? [] : [{ group, name: NAMED_LABEL[lower] ?? caption(column.replace(/_id$/i, "")), value: named }];
    }
    if (/key$/.test(lower) || /^(imp|trf)_/.test(lower) || /_(id|code)$/.test(lower)) return [];
    return [{ group, name: caption(column), value: toText(displayValue(value)).trim() }];
  });
}

/** idopt_master's names of one flag (ST states, AS address kinds, TD deductee types ...) by key. */
async function idoptNames(loader: Loader, flag: string): Promise<Map<number, string>> {
  const rows = (await loader.readTable(`SELECT idopt_key, opt_desc FROM |sys.db|idopt_master WHERE idopt_flag = $1 AND idopt_pos <> 'D'`, [flag])) ?? [];
  return new Map(rows.map((row) => [Number(field(row, "idopt_key")), toText(field(row, "opt_desc")).trim()]));
}
const byNumber = (names: ReadonlyMap<number, string>): Resolve => (value) => {
  const key = Number(toText(displayValue(value)));
  return Number.isFinite(key) && key > 0 ? names.get(key) ?? null : "";
};

/** The addon values of an account / product (addon_data, one column per addon: txt_<save> for a list, input_<save> for typed text). */
async function addonRows(loader: Loader, relate: "A" | "P", where: "code" | "prod_id", key: number): Promise<DetailRow[]> {
  const data = (await loader.readTable(`SELECT * FROM |sys.db|addon_data WHERE ${where} = $1 LIMIT 1`, [key]))?.[0];
  if (!data) return [];
  const addons = (await loader.readTable(`SELECT fiel_desc, fiel_save FROM |sys.db|addon_fld WHERE fiel_relate = $1 AND fiel_pos <> 'D' ORDER BY fiel_key`, [relate])) ?? [];
  const lower = new Map(Object.keys(data).map((column) => [column.toLowerCase(), column]));
  return addons.flatMap((addon) => {
    const save = toText(field(addon, "fiel_save")).trim().toLowerCase();
    const column = lower.get(`txt_${save}`) ?? lower.get(`input_${save}`);
    if (!save || !column) return [];
    return [{ group: "ADDON", name: toText(field(addon, "fiel_desc")).trim() || caption(save), value: toText(displayValue(data[column])).trim() }];
  });
}

export async function masterDetails(loader: Loader, kind: "account" | "product", key: number): Promise<MasterDetails> {
  if (kind === "account") {
    const account = (await loader.readTable(`SELECT * FROM |sys.db|account WHERE code = $1`, [key]))?.[0];
    if (!account) throw new Error("The account is not in the account master");
    const addresses = (await loader.readTable(`SELECT * FROM |sys.db|address WHERE code = $1 AND a_pos <> 'D' ORDER BY address_id`, [key])) ?? [];
    // Every id shows as its name; the book shows both its number and its name (4 / Cash Book).
    const books = new Map(((await loader.readTable(`SELECT book_key, book_desc FROM |sys.db|book_properties WHERE BTRIM(stkm_pos) = 'A'`)) ?? []).map((row) => [Number(field(row, "book_key")), toText(field(row, "book_desc")).trim()]));
    const schedules = new Map(((await loader.readTable(`SELECT bs_key, bs_desc FROM |sys.db|balsheet`)) ?? []).map((row) => [Number(field(row, "bs_key")), toText(field(row, "bs_desc")).trim()]));
    const accounts = new Map<number, string>();
    const combined = Number(field(account, "comb_code"));
    if (combined > 0) accounts.set(combined, toText(field((await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [combined]))?.[0], "name")).trim());
    // One read after the other: the loader keeps a savepoint per read, so reads cannot overlap.
    const states = await idoptNames(loader, "ST");
    const kinds = await idoptNames(loader, "AS");
    const deductees = await idoptNames(loader, "TD");
    const natures = await idoptNames(loader, "NP");
    const accountNames: Record<string, Resolve> = {
      book: (value) => { const book = Number(toText(displayValue(value))); return book > 0 ? `${book} / ${books.get(book) ?? ""}`.replace(/ \/ $/, "") : ""; },
      bs_id: byNumber(schedules),
      comb_code: byNumber(accounts),
      type_deduct: byNumber(deductees),
      nature_pay: byNumber(natures),
    };
    const addressNames: Record<string, Resolve> = { address_id: byNumber(kinds), state_id: byNumber(states) };
    const rows = [
      ...fieldsOf("ACCOUNT", account, ["code"], accountNames),
      ...addresses.flatMap((address, index) => fieldsOf(addresses.length > 1 ? `ADDRESS ${index + 1}` : "ADDRESS", address, ["code"], addressNames)),
      ...await addonRows(loader, "A", "code", key),
    ];
    return { title: toText(field(account, "name")).trim(), rows };
  }
  const product = (await loader.readTable(`SELECT * FROM |sys.db|product_master WHERE prod_key = $1`, [key]))?.[0];
  if (!product) throw new Error("The product is not in the product master");
  return {
    title: toText(field(product, "prod_desc")).trim() || toText(field(product, "prod_short")).trim(),
    rows: [...fieldsOf("PRODUCT", product), ...await addonRows(loader, "P", "prod_id", key)],
  };
}
