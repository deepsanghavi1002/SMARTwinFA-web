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

function fieldsOf(group: string, row: Row | undefined, skip: readonly string[] = []): DetailRow[] {
  if (!row) return [];
  return Object.entries(row)
    .filter(([column]) => !skip.includes(column.toLowerCase()))
    .map(([column, value]) => ({ group, name: caption(column), value: toText(displayValue(value)).trim() }));
}

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
    const rows = [
      ...fieldsOf("ACCOUNT", account),
      ...addresses.flatMap((address, index) => fieldsOf(addresses.length > 1 ? `ADDRESS ${index + 1}` : "ADDRESS", address, ["code"])),
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
