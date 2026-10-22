import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, toDecimal, toText } from "../master-program/legacy";

/**
 * The F7 window of the account help (caption Partywise Stock): the stock lines of the party for the open year, a line to an entry
 * line, with the columns of the Partywise Stock report (SP_STD_RPT_PWISESTOCK, Detail): date, voucher, product, quantity in and out,
 * rate, and one value column (the report's purchase and sale value in one). The product-wise slab columns (each with its %) are the
 * slabs the party's lines really have in LEDGER_EXT, so without slab data the grid ends at Value. The product addon fields
 * follow, those that have a value. The party name is not a column (it is the title). Read-only.
 */

type Row = Record<string, unknown>;
const field = Loader.field;

export type StockColumn = Readonly<{ key: string; caption: string; align: "L" | "R" }>;
export type PartyStock = Readonly<{ title: string; columns: readonly StockColumn[]; rows: readonly Readonly<Record<string, string>>[] }>;

const figure = (value: unknown, digits: number) => { const n = toDecimal(value); return n === 0 ? "" : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }); };
const dateOf = (value: unknown) => (value instanceof Date ? formatDesktopDate(value) : toText(value).trim());

export async function partyStock(loader: Loader, code: number): Promise<PartyStock> {
  const { session } = loader;
  const account = (await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [code]))?.[0];
  if (!account) throw new Error("The account is not in the account master");
  const lines = (await loader.readTable(
    `SELECT i.il_key, i.prod_id, i.il_date, l.full_docno, pm.prod_desc, i.stock_nat, i.quantity::numeric - i.ag_qty::numeric AS qty, i.rate::numeric AS rate, i.il_value::numeric AS value
     FROM |sys.db|prod_ledger i JOIN |sys.db|ledger l ON l.led_key = i.led_id JOIN |sys.db|product_master pm ON pm.prod_key = i.prod_id
     WHERE l.code = $1 AND i.year_id = $2 AND coalesce(i.il_pos, '') <> 'D' AND coalesce(l.doc_pos, '') <> 'D' AND i.inventory = 'Y' AND pm.inventory = 'Y'
     ORDER BY i.il_date, i.doc_no1, i.il_key`, [code, session.yearId])) ?? [];
  const keys = lines.map((line) => Number(field(line, "il_key")));
  const slabRows = keys.length === 0 ? [] : (await loader.readTable(
    `SELECT e.il_id, m.slab_key, m.slab_short, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amt
     FROM |sys.db|ledger_ext e JOIN |sys.db|slab_master m ON m.slab_key = e.slab_id
     WHERE e.il_id = ANY($1::int[]) AND m.slab_pos = 'P' ORDER BY m.slab_key`, [keys])) ?? [];
  const slabOrder = new Map<number, string>();
  const slabOf = new Map<number, Map<number, { amt: number; perc: number }>>();
  for (const row of slabRows) {
    const line = Number(field(row, "il_id"));
    const slab = Number(field(row, "slab_key"));
    slabOrder.set(slab, toText(field(row, "slab_short")).trim());
    const per = slabOf.get(line) ?? new Map<number, { amt: number; perc: number }>();
    const before = per.get(slab) ?? { amt: 0, perc: 0 };
    per.set(slab, { amt: before.amt + toDecimal(field(row, "amt")), perc: before.perc + toDecimal(field(row, "perc")) });
    slabOf.set(line, per);
  }
  // Only the slabs that carry a figure in these lines are columns.
  const slabs = [...slabOrder.keys()].filter((slab) => [...slabOf.values()].some((per) => (per.get(slab)?.amt ?? 0) !== 0 || (per.get(slab)?.perc ?? 0) !== 0));

  const products = [...new Set(lines.map((line) => Number(field(line, "prod_id"))))];
  const addonFields = products.length === 0 ? [] : (await loader.readTable(`SELECT fiel_desc, fiel_save FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
  const addonData = new Map<number, Row>();
  if (addonFields.length > 0) for (const row of (await loader.readTable(`SELECT * FROM |sys.db|addon_data WHERE prod_id = ANY($1::int[])`, [products])) ?? []) addonData.set(Number(field(row, "prod_id")), row);
  const addonColumn = (data: Row, save: string) => {
    const name = Object.keys(data).find((column) => column.toLowerCase() === `txt_${save}` || column.toLowerCase() === `input_${save}`);
    return name ? toText(displayValue(data[name])).trim() : "";
  };
  const addons = addonFields
    .map((addon) => ({ caption: toText(field(addon, "fiel_desc")).trim(), save: toText(field(addon, "fiel_save")).trim().toLowerCase() }))
    .filter((addon) => addon.save !== "" && [...addonData.values()].some((data) => addonColumn(data, addon.save) !== ""))
    .map((addon) => ({ ...addon, key: `addon_${addon.save}` }));

  const columns: StockColumn[] = [
    { key: "date", caption: "Date", align: "L" }, { key: "docNo", caption: "Doc No", align: "L" }, { key: "product", caption: "Product", align: "L" },
    { key: "addQty", caption: "Add Qty", align: "R" }, { key: "lessQty", caption: "Less Qty", align: "R" }, { key: "rate", caption: "Rate", align: "R" }, { key: "value", caption: "Value", align: "R" },
    ...slabs.flatMap((slab): StockColumn[] => [{ key: `slab_${slab}`, caption: slabOrder.get(slab) ?? "", align: "R" }, { key: `slab_${slab}_perc`, caption: `${slabOrder.get(slab) ?? ""} %`, align: "R" }]),
    ...addons.map((addon): StockColumn => ({ key: addon.key, caption: addon.caption, align: "L" })),
  ];
  const rows = lines.map((line) => {
    const out: Record<string, string> = {
      date: dateOf(field(line, "il_date")), docNo: toText(field(line, "full_docno")).trim(), product: toText(field(line, "prod_desc")).trim(),
      addQty: toText(field(line, "stock_nat")) === "A" ? figure(field(line, "qty"), 3) : "", lessQty: toText(field(line, "stock_nat")) === "L" ? figure(field(line, "qty"), 3) : "",
      rate: figure(field(line, "rate"), 2), value: figure(field(line, "value"), 2),
    };
    const per = slabOf.get(Number(field(line, "il_key")));
    for (const slab of slabs) { out[`slab_${slab}`] = figure(per?.get(slab)?.amt, 2); out[`slab_${slab}_perc`] = figure(per?.get(slab)?.perc, 2); }
    const data = addonData.get(Number(field(line, "prod_id")));
    for (const addon of addons) out[addon.key] = data ? addonColumn(data, addon.save) : "";
    return out;
  });
  return { title: toText(field(account, "name")).trim(), columns, rows };
}
