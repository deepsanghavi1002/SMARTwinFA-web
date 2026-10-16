import { displayValue, Loader } from "../master-program/load";
import { toDecimal, toInt, toText } from "../master-program/legacy";
import { properHeading } from "../master-program/heading";
import { fixed } from "./calc";
import { entryPreview } from "./invoice";
import type { EntryOption, HelpList } from "./types";

/**
 * The Find / Edit list with every field of each entry ("All fields"): the list's own columns, then one column per slab row (its amount for
 * the whole entry; an item-wise row is the sum of the product rows), one per account addon, and a last wide column that holds each product
 * line in full - product, quantity, rate, value, its discount and tax, and its own addons.
 *
 * It is only read when asked for. Each table is read once for all the entries (never one query per entry), and what is composed per entry is
 * done here: 5,246 sale bills with their lines came back in about 0.3 s this way, where a subquery per bill took 86 s.
 */

type Row = Record<string, unknown>;
const field = Loader.field;
const text = (row: Row | undefined, name: string) => toText(field(row, name)).trim();
const money = (value: number) => fixed(value, 2);
const SAFE_NAME = /^[A-Za-z0-9_]+$/;

export async function entryAll(loader: Loader, entryName: string, firstCombo: EntryOption, series: string): Promise<HelpList> {
  const base = await entryPreview(loader, entryName, firstCombo, series);
  const columns = base.columns.filter((column) => column.key.toLowerCase() !== "tick");
  const keys = base.rows.map((row) => toInt(row.unique_key)).filter((key) => key > 0);
  if (keys.length === 0) return { ...base, columns };

  const lines = (await loader.readTable(
    `SELECT l.unique_key AS uk, p.il_key, p.il_serial, BTRIM(pm.prod_short) AS short, BTRIM(pm.prod_desc) AS descr, p.quantity::numeric AS qty, qu.uom_short AS qty_uom, p.rate::numeric AS rate, ru.uom_short AS rate_uom, p.il_value::numeric AS value
       FROM |sys.db|ledger l JOIN |sys.db|prod_ledger p ON p.led_id = l.led_key AND p.il_pos <> 'D'
       JOIN |sys.db|product_master pm ON pm.prod_key = p.prod_id
       LEFT JOIN |sys.db|prod_uom qu ON qu.uom_key = p.uomentry_id LEFT JOIN |sys.db|prod_uom ru ON ru.uom_key = p.rateuom_id
       WHERE l.unique_key = ANY($1::int[]) ORDER BY l.unique_key, p.il_serial`, [keys])) ?? [];
  const itemSlabRows = (await loader.readTable(
    `SELECT e.il_id, e.slab_id, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amount
       FROM |sys.db|ledger_ext e JOIN |sys.db|prod_ledger p ON p.il_key = e.il_id JOIN |sys.db|ledger l ON l.led_key = p.led_id
       WHERE l.unique_key = ANY($1::int[])`, [keys])) ?? [];
  const entrySlabRows = (await loader.readTable(
    `SELECT l.unique_key AS uk, e.slab_id, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amount
       FROM |sys.db|ledger_ext e JOIN |sys.db|ledger l ON l.led_key = e.led_id
       WHERE l.unique_key = ANY($1::int[])`, [keys])) ?? [];
  const addonRows = (await loader.readTable(
    `SELECT l.unique_key AS uk, a.* FROM |sys.db|addon_aentry a JOIN |sys.db|ledger l ON l.led_key = a.aona_ledid
       WHERE a.aona_recid = 'L' AND l.unique_key = ANY($1::int[])`, [keys])) ?? [];
  const slabNames = (await loader.readTable(`SELECT slab_key, BTRIM(slab_desc) AS slab_desc, BTRIM(slab_short) AS slab_short, slab_order FROM |sys.db|slab_master`)) ?? [];
  const accountAddons = (await loader.readTable(`SELECT fiel_key, fiel_save, fiel_type, fiel_name FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
  const productAddons = (await loader.readTable(`SELECT fiel_save, fiel_type, fiel_name FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
  const lineKeys = lines.map((row) => toInt(field(row, "il_key")));
  const productAddonRows = lineKeys.length > 0 ? (await loader.readTable(`SELECT * FROM |sys.db|addon_ientry WHERE aoni_il_id = ANY($1::int[])`, [lineKeys])) ?? [] : [];

  const slabInfo = new Map<number, { desc: string; short: string; order: number }>();
  for (const row of slabNames) slabInfo.set(toInt(field(row, "slab_key")), { desc: text(row, "slab_desc"), short: text(row, "slab_short"), order: toInt(field(row, "slab_order")) });

  // Slab amounts per entry, by slab row: the entry's own row, plus an item-wise row's amounts summed over the entry's product lines.
  const lineEntry = new Map<number, number>();
  for (const row of lines) lineEntry.set(toInt(field(row, "il_key")), toInt(field(row, "uk")));
  const slabAmounts = new Map<number, Map<number, number>>();
  const slabUsed = new Set<number>();
  const addAmount = (entry: number, slab: number, amount: number) => {
    const per = slabAmounts.get(entry) ?? new Map<number, number>();
    per.set(slab, (per.get(slab) ?? 0) + amount);
    slabAmounts.set(entry, per);
    slabUsed.add(slab);
  };
  for (const row of entrySlabRows) addAmount(toInt(field(row, "uk")), toInt(field(row, "slab_id")), toDecimal(field(row, "amount")));
  const itemSlab = new Map<number, string[]>();
  for (const row of itemSlabRows) {
    const il = toInt(field(row, "il_id"));
    const slab = toInt(field(row, "slab_id"));
    const amount = toDecimal(field(row, "amount"));
    const entry = lineEntry.get(il);
    if (entry !== undefined) addAmount(entry, slab, amount);
    if (amount === 0) continue;
    const perc = toDecimal(field(row, "perc"));
    const name = slabInfo.get(slab)?.short || slabInfo.get(slab)?.desc || `Slab ${slab}`;
    const list = itemSlab.get(il) ?? [];
    list.push(`${name}${perc !== 0 ? ` ${perc}%` : ""} ${money(amount)}`);
    itemSlab.set(il, list);
  }
  const slabColumns = [...slabUsed].sort((a, b) => (slabInfo.get(a)?.order ?? 0) - (slabInfo.get(b)?.order ?? 0));

  // Account addons: only the ones some entry holds a value for.
  const addonByEntry = new Map<number, Row>();
  for (const row of addonRows) addonByEntry.set(toInt(field(row, "uk")), row);
  const valueOf = (row: Row | undefined, item: Row): string => {
    const save = text(item, "fiel_save");
    if (!row || !SAFE_NAME.test(save)) return "";
    const value = text(item, "fiel_type").toUpperCase() === "I" ? field(row, `input_${save}`) : field(row, `txt_${save}`);
    return value === undefined || value === null ? "" : toText(displayValue(value)).trim();
  };
  const addonColumns = accountAddons.filter((item) => [...addonByEntry.values()].some((row) => valueOf(row, item) !== ""));

  // Product addons per line (addon_ientry), read the same way.
  const productAddonByLine = new Map<number, Row>();
  for (const row of productAddonRows) productAddonByLine.set(toInt(field(row, "aoni_il_id")), row);

  const linesByEntry = new Map<number, string[]>();
  for (const row of lines) {
    const il = toInt(field(row, "il_key"));
    const short = text(row, "short");
    const descr = text(row, "descr");
    const rateUom = text(row, "rate_uom");
    const parts = [
      `${toInt(field(row, "il_serial")) || ""}. ${short}${descr !== "" && descr !== short ? ` - ${descr}` : ""}`,
      `${toDecimal(field(row, "qty"))} ${text(row, "qty_uom")} x ${money(toDecimal(field(row, "rate")))}${rateUom !== "" ? `/${rateUom}` : ""} = ${money(toDecimal(field(row, "value")))}`,
    ];
    const slabs = itemSlab.get(il);
    if (slabs) parts.push(slabs.join(", "));
    const own = productAddonByLine.get(il);
    if (own) {
      const shown = productAddons.map((item) => {
        const value = valueOf(own, item);
        return value === "" ? "" : `${properHeading(text(item, "fiel_name"))}: ${value}`;
      }).filter(Boolean);
      if (shown.length > 0) parts.push(shown.join(", "));
    }
    const entry = toInt(field(row, "uk"));
    const list = linesByEntry.get(entry) ?? [];
    list.push(parts.join("  |  "));
    linesByEntry.set(entry, list);
  }

  const slabKey = (slab: number) => `slab_${slab}`;
  const addonKey = (item: Row) => `addon_${toInt(field(item, "fiel_key"))}`;
  const outColumns = [
    ...columns,
    ...slabColumns.map((slab) => ({ key: slabKey(slab), caption: properHeading(slabInfo.get(slab)?.desc ?? `Slab ${slab}`), width: 90, align: "R", format: "N2" })),
    ...addonColumns.map((item) => ({ key: addonKey(item), caption: properHeading(text(item, "fiel_name")), width: 120, align: "L", format: "" })),
    { key: "products_all", caption: "Products (product, qty, rate, value, discount, tax, addons)", width: 1100, align: "L", format: "" },
  ];
  const rows = base.rows.map((row) => {
    const entry = toInt(row.unique_key);
    const out: Record<string, string> = { ...row };
    const per = slabAmounts.get(entry);
    for (const slab of slabColumns) out[slabKey(slab)] = per?.has(slab) ? money(per.get(slab) ?? 0) : "";
    for (const item of addonColumns) out[addonKey(item)] = valueOf(addonByEntry.get(entry), item);
    out.products_all = (linesByEntry.get(entry) ?? []).join("   ‖   ");
    return out;
  });
  return { ...base, columns: outColumns, rows, total: `Total Records : ${rows.length} · all fields` };
}
