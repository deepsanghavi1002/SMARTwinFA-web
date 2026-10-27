import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toInt, toText } from "../master-program/legacy";
import { properHeading } from "../master-program/heading";
import { fixed } from "./calc";
import { againstNames, bookContext, entryPreview, loadBook } from "./invoice";
import { tdsAutoJournal, tdsBook } from "./values";
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

export async function entryAll(loader: Loader, entryName: string, firstCombo: EntryOption, series: string, withProducts = true): Promise<HelpList> {
  const base = await entryPreview(loader, entryName, firstCombo, series);
  const columns = base.columns.filter((column) => column.key.toLowerCase() !== "tick");
  // A voucher's list row is one ledger row: everything here is read and kept by that row's led_key (the Outstanding mode takes the place of With product).
  const voucher = entryName.trim().toUpperCase().startsWith("V");
  const idOf = (row: Readonly<Record<string, string>>) => (voucher ? toInt(row.led_key_raw) : toInt(row.unique_key));
  const keys = base.rows.map(idOf).filter((key) => key > 0);
  if (keys.length === 0) return { ...base, columns };
  // A stock register's entries (Job Stock In / Out, Production Slip ...) are process rows: their unique key is process_key, and their product, slab and
  // addon rows hang on process_id. Reading them through ledger.unique_key would pick up another entry that happens to hold the same number.
  const book = await bookContext(loader, entryName, firstCombo);
  const stock = !entryName.trim().toUpperCase().startsWith("V") && !book.values.bookActual && book.values.type > 0 && book.values.agBook === 0;
  const own = voucher
    ? { table: "ledger", key: "led_key", pk: "led_key", link: "led_id", aon: "aona_ledid", rec: "L" }
    : stock
    ? { table: "process", key: "process_key", pk: "process_key", link: "process_id", aon: "aona_processid", rec: "P" }
    : { table: "ledger", key: "unique_key", pk: "led_key", link: "led_id", aon: "aona_ledid", rec: "L" };

  // "All fields" alone stops here: the product lines (and their units, addons and item-wise text) are what make the read long.
  const lines = !withProducts || voucher ? [] : (await loader.readTable(
    `SELECT l.${own.key} AS uk, p.il_key, p.il_serial, BTRIM(pm.prod_short) AS short, BTRIM(pm.prod_desc) AS descr, p.quantity::numeric AS qty, qu.uom_short AS qty_uom, p.rate::numeric AS rate, ru.uom_short AS rate_uom, p.il_value::numeric AS value
       FROM |sys.db|${own.table} l JOIN |sys.db|prod_ledger p ON p.${own.link} = l.${own.pk} AND p.il_pos <> 'D'
       JOIN |sys.db|product_master pm ON pm.prod_key = p.prod_id
       LEFT JOIN |sys.db|prod_uom qu ON qu.uom_key = p.uomentry_id LEFT JOIN |sys.db|prod_uom ru ON ru.uom_key = p.rateuom_id
       WHERE l.${own.key} = ANY($1::int[]) ORDER BY l.${own.key}, ${stock ? "p.stock_nat, " : ""}p.il_serial`, [keys])) ?? [];
  const itemSlabRows = !withProducts || voucher ? [] : (await loader.readTable(
    `SELECT e.il_id, e.slab_id, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amount
       FROM |sys.db|ledger_ext e JOIN |sys.db|prod_ledger p ON p.il_key = e.il_id JOIN |sys.db|${own.table} l ON l.${own.pk} = p.${own.link}
       WHERE l.${own.key} = ANY($1::int[])`, [keys])) ?? [];
  const entrySlabRows = (await loader.readTable(
    `SELECT l.${own.key} AS uk, e.slab_id, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amount
       FROM |sys.db|ledger_ext e JOIN |sys.db|${own.table} l ON l.${own.pk} = e.${own.link}
       WHERE l.${own.key} = ANY($1::int[])`, [keys])) ?? [];
  // Item-wise slab rows summed per entry in the database, when the lines themselves are not wanted.
  const itemSlabSums = withProducts || voucher ? [] : (await loader.readTable(
    `SELECT l.${own.key} AS uk, e.slab_id, SUM(e.slab_amt::numeric) AS amount
       FROM |sys.db|${own.table} l JOIN |sys.db|prod_ledger p ON p.${own.link} = l.${own.pk} AND p.il_pos <> 'D'
       JOIN |sys.db|ledger_ext e ON e.il_id = p.il_key
       WHERE l.${own.key} = ANY($1::int[]) GROUP BY l.${own.key}, e.slab_id`, [keys])) ?? [];
  const addonRows = (await loader.readTable(
    `SELECT l.${own.key} AS uk, a.* FROM |sys.db|addon_aentry a JOIN |sys.db|${own.table} l ON l.${own.pk} = a.${own.aon}
       WHERE a.aona_recid = '${own.rec}' AND l.${own.key} = ANY($1::int[])`, [keys])) ?? [];
  // The entry's own head fields, shown with their labels beside the narration: credit days (TDS amount on a TDS book), what the entry is against,
  // the CN / DN nature, the contra / expense account and the reverse entry.
  const heads: Row[] = (stock
    ? await loader.readTable(`SELECT process_key AS uk, stk_remark AS narration, supply_type, sub_supply_type, eway_doc_type, trp_mode, eway_veh_type, distance_km, eway_billno, eway_billdate, eway_valid FROM |sys.db|process WHERE process_key = ANY($1::int[])`, [keys])
    : await loader.readTable(`SELECT ${own.key} AS uk, narration, credit_days, ag_bkcode, "TYPE" AS nature, post_bkcode, rev_charge, doc_type, chln_date, supply_type, sub_supply_type, eway_doc_type, trp_mode, eway_veh_type, distance_km, eway_billno, eway_billdate, eway_valid FROM |sys.db|ledger WHERE ${own.key} = ANY($1::int[])`, [keys])) ?? [];
  // The E-Way Bill tab's boxes: the lists save the position of the chosen item; the figures and the bill number as typed.
  const ewayControls = (await loadBook(loader, entryName, firstCombo)).controls;
  const ewayLabel = (name: string, fallback: string) => (ewayControls.find((control) => control.name === name)?.label ?? fallback).replace(/^\*\s*/, "");
  const ewayList = (name: string, column: string) => (row: Row) => {
    if (!hasEway(row)) return "";
    return ewayControls.find((control) => control.name === name)?.options[toInt(field(row, column))]?.text ?? "";
  };
  const hasEway = (row: Row) => text(row, "eway_billno") !== "" || text(row, "distance_km") !== "";
  const ewayDate = (row: Row) => (hasEway(row) ? toText(displayValue(field(row, "eway_billdate"))).trim() : "");
  const headNames = await againstNames(
    loader,
    [...new Set(heads.flatMap((row) => [toInt(field(row, "ag_bkcode")), toInt(field(row, "post_bkcode"))]).filter((code) => code > 0))],
    [...new Set(heads.map((row) => toInt(field(row, "nature"))).filter((kind) => kind > 0))],
  );
  const headByEntry = new Map<number, Row>(heads.map((row) => [toInt(field(row, "uk")), row]));
  const hasHead = (read: (row: Row) => string) => heads.some((row) => read(row) !== "");
  const creditText = (row: Row) => { const days = toDecimal(field(row, "credit_days")); return days === 0 ? "" : String(days); };
  type HeadField = { key: string; caption: string; width: number; align: string; read: (row: Row) => string };
  const headAll: HeadField[] = [
    { key: "head_narration", caption: "Narration", width: 220, align: "L", read: (row) => text(row, "narration") },
    { key: "head_credit_days", caption: tdsAutoJournal(loader.session.setup) && tdsBook(book.values.bookKey, book.values.bookActual) ? "TDS Amount" : "Credit Days", width: 90, align: "R", read: creditText },
    { key: "head_against", caption: "Against Book", width: 140, align: "L", read: (row) => headNames.accounts.get(toInt(field(row, "ag_bkcode"))) ?? "" },
    { key: "head_nature", caption: "CN / DN Nature", width: 130, align: "L", read: (row) => headNames.kinds.get(toInt(field(row, "nature"))) ?? "" },
    { key: "head_contra", caption: "Contra / Exp. Name", width: 160, align: "L", read: (row) => headNames.accounts.get(toInt(field(row, "post_bkcode"))) ?? "" },
    { key: "head_doc_type", caption: "Doc. Type", width: 110, align: "L", read: (row) => (voucher ? ({ R: "Regular", D: "Doc.Refund", N: "No Interest Calc" } as Record<string, string>)[text(row, "doc_type").toUpperCase()] ?? "" : "") },
    { key: "head_chq_date", caption: "Chq. Date", width: 90, align: "L", read: (row) => { const date = voucher ? parseDesktopDate(field(row, "chln_date")) : null; return date && date.getFullYear() > 1950 ? formatDesktopDate(date) : ""; } },
    { key: "head_rev", caption: "Reverse Entry", width: 90, align: "L", read: (row) => (text(row, "rev_charge") === "" ? "" : text(row, "rev_charge")) },
    { key: "eway_supply", caption: ewayLabel("cmb_supplytype", "Supply Type"), width: 100, align: "L", read: ewayList("cmb_supplytype", "supply_type") },
    { key: "eway_sub_supply", caption: ewayLabel("cmb_subsupplytype", "Sub Supply Type"), width: 120, align: "L", read: ewayList("cmb_subsupplytype", "sub_supply_type") },
    { key: "eway_doc_type", caption: ewayLabel("cmb_documenttype", "Document Type"), width: 110, align: "L", read: ewayList("cmb_documenttype", "eway_doc_type") },
    { key: "eway_mode", caption: ewayLabel("cmb_transportmode", "Transportation Mode"), width: 110, align: "L", read: ewayList("cmb_transportmode", "trp_mode") },
    { key: "eway_vehicle", caption: ewayLabel("cmb_vehicletype", "Vehicle Type"), width: 100, align: "L", read: ewayList("cmb_vehicletype", "eway_veh_type") },
    { key: "eway_distance", caption: ewayLabel("tbx_distancekm", "Distance KM"), width: 90, align: "R", read: (row) => text(row, "distance_km") },
    { key: "eway_billno", caption: ewayLabel("tbx_ewaybillno", "EWAY Bill Number"), width: 130, align: "L", read: (row) => text(row, "eway_billno") },
    { key: "eway_date", caption: "E-Way Date", width: 100, align: "L", read: ewayDate },
    { key: "eway_valid", caption: "E-Way Valid Upto", width: 100, align: "L", read: (row) => (hasEway(row) ? text(row, "eway_valid") : "") },
  ];
  const headFields = headAll.filter((item) => item.key === "head_narration" || (!base.columns.some((column) => (item.key === "head_against" && column.key === "against_book") || (item.key === "head_nature" && column.key === "against_nature")) && hasHead(item.read)));
  // The TDS auto journal an entry passed (a JV pair made with it: imp_ledkey is the entry's ledger row): the account debited and credited, and the amount.
  const jvByEntry = new Map<number, string>();
  if (!stock && !voucher) {
    const jvRows = (await loader.readTable(
      `SELECT l.unique_key AS uk, jv.full_docno, jv.ac_dbcode, jv.amount::numeric AS amount, ac.name
         FROM |sys.db|ledger jv JOIN |sys.db|ledger l ON l.led_key = jv.imp_ledkey LEFT JOIN |sys.db|account ac ON ac.code = jv.code
        WHERE jv.book = 19 AND jv.doc_series = 'JV' AND jv.doc_pos = 'A' AND l.unique_key = ANY($1::int[]) ORDER BY l.unique_key, jv.led_key`, [keys])) ?? [];
    const byEntry = new Map<number, Row[]>();
    for (const row of jvRows) byEntry.set(toInt(field(row, "uk")), [...(byEntry.get(toInt(field(row, "uk"))) ?? []), row]);
    for (const [entry, list] of byEntry) {
      const side = (code: number) => list.filter((row) => toInt(field(row, "ac_dbcode")) === code).map((row) => `${text(row, "name")} ${money(toDecimal(field(row, "amount")))}`).join(", ");
      jvByEntry.set(entry, `${text(list[0], "full_docno")}  |  Dr: ${side(1)}  |  Cr: ${side(2)}`);
    }
  }
  const slabNames = (await loader.readTable(`SELECT slab_key, BTRIM(slab_desc) AS slab_desc, BTRIM(slab_short) AS slab_short, slab_order FROM |sys.db|slab_master`)) ?? [];
  const accountAddons = (await loader.readTable(`SELECT fiel_key, fiel_save, fiel_type, fiel_name, fiel_entrypos FROM |sys.db|addon_fld WHERE fiel_relate = 'A' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
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
  for (const row of itemSlabSums) addAmount(toInt(field(row, "uk")), toInt(field(row, "slab_id")), toDecimal(field(row, "amount")));
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
  // A voucher's header addons (Bank Name ...) are held on its first row only: every row of the voucher shows them.
  const firstAddon = new Map<number, Row>();
  if (voucher) {
    const group = (await loader.readTable(
      `SELECT l.led_key AS uk, l.unique_key AS grp, l.led_div FROM |sys.db|ledger l WHERE l.doc_pos <> 'D' AND l.unique_key IN (SELECT unique_key FROM |sys.db|ledger WHERE led_key = ANY($1::int[])) ORDER BY l.unique_key, l.led_div, l.led_key`, [keys])) ?? [];
    const seen = new Set<number>();
    for (const row of group) {
      const grp = toInt(field(row, "grp"));
      if (seen.has(grp)) continue;
      seen.add(grp);
      const first = addonByEntry.get(toInt(field(row, "uk")));
      if (first) firstAddon.set(grp, first);
    }
  }
  const groupOf = new Map<number, number>();
  if (voucher) for (const row of (await loader.readTable(`SELECT led_key, unique_key FROM |sys.db|ledger WHERE led_key = ANY($1::int[])`, [keys])) ?? []) groupOf.set(toInt(field(row, "led_key")), toInt(field(row, "unique_key")));
  const valueOf = (row: Row | undefined, item: Row): string => {
    const save = text(item, "fiel_save");
    if (!row || !SAFE_NAME.test(save)) return "";
    const value = text(item, "fiel_type").toUpperCase() === "I" ? field(row, `input_${save}`) : field(row, `txt_${save}`);
    return value === undefined || value === null ? "" : toText(displayValue(value)).trim();
  };
  const addonColumns = accountAddons.filter((item) => [...addonByEntry.values(), ...firstAddon.values()].some((row) => valueOf(row, item) !== ""));

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

  // Voucher: each row's set-offs (the Outstanding window): bill number, date, amount, pending and the set-off, one bill to a line.
  const setoffsByRow = new Map<number, string[]>();
  if (voucher && withProducts) {
    const bills = (await loader.readTable(
      `SELECT s.out_ledid AS uk, s.out_setoff::numeric AS setoff, bl.full_docno, bl.doc_date, b.out_entryamt::numeric AS amount, (b.out_entryamt::numeric - b.out_setoff::numeric - b.out_ly_setoff::numeric) AS pending
         FROM |sys.db|outclear s JOIN |sys.db|outclear b ON b.out_key = s.out_ag_outid LEFT JOIN |sys.db|ledger bl ON bl.led_key = b.out_ledid
        WHERE s.out_ledid = ANY($1::int[]) AND COALESCE(s.out_ag_outid, 0) > 0 AND s.out_setoff::numeric > 0 ORDER BY s.out_ledid, s.out_key`, [keys])) ?? [];
    for (const row of bills) {
      const list = setoffsByRow.get(toInt(field(row, "uk"))) ?? [];
      list.push(`${text(row, "full_docno")}, ${toText(displayValue(field(row, "doc_date"))).trim()}, ${money(toDecimal(field(row, "amount")))}, ${money(toDecimal(field(row, "pending")))}, ${money(toDecimal(field(row, "setoff")))}`);
      setoffsByRow.set(toInt(field(row, "uk")), list);
    }
  }
  const slabKey = (slab: number) => `slab_${slab}`;
  const addonKey = (item: Row) => `addon_${toInt(field(item, "fiel_key"))}`;
  const outColumns = [
    ...columns,
    ...slabColumns.map((slab) => ({ key: slabKey(slab), caption: properHeading(slabInfo.get(slab)?.desc ?? `Slab ${slab}`), width: 90, align: "R", format: "N2" })),
    ...addonColumns.map((item) => ({ key: addonKey(item), caption: properHeading(text(item, "fiel_name")), width: 120, align: "L", format: "" })),
    ...headFields.map((item) => ({ key: item.key, caption: item.caption, width: item.width, align: item.align, format: "" })),
    ...(jvByEntry.size > 0 ? [{ key: "tds_jv", caption: "TDS JV (A/c Debit, Credit, Amount)", width: 420, align: "L", format: "" }] : []),
    ...(withProducts && voucher ? [{ key: "outstanding_all", caption: "Outstanding (doc no, date, amount, pending, setoff amt)", width: 700, align: "L", format: "" }] : []),
    ...(withProducts && !voucher ? [{ key: "products_all", caption: "Products (product, qty, rate, value, discount, tax, addons)", width: 1100, align: "L", format: "" }] : []),
  ];
  const rows = base.rows.map((row) => {
    const entry = idOf(row);
    const out: Record<string, string> = { ...row };
    const per = slabAmounts.get(entry);
    for (const slab of slabColumns) out[slabKey(slab)] = per?.has(slab) ? money(per.get(slab) ?? 0) : "";
    for (const item of addonColumns) out[addonKey(item)] = valueOf(addonByEntry.get(entry), item) || (voucher && text(item, "fiel_entrypos") === "L" ? valueOf(firstAddon.get(groupOf.get(entry) ?? 0), item) : "");
    for (const item of headFields) out[item.key] = headByEntry.has(entry) ? item.read(headByEntry.get(entry)!) : "";
    if (jvByEntry.size > 0) out.tds_jv = jvByEntry.get(entry) ?? "";
    if (withProducts && voucher) out.outstanding_all = (setoffsByRow.get(entry) ?? []).join("   ‖   ");
    if (withProducts && !voucher) out.products_all = (linesByEntry.get(entry) ?? []).join("   ‖   ");
    return out;
  });
  return { ...base, columns: outColumns, rows, total: `Total Records : ${rows.length} · ${withProducts ? (voucher ? "with outstanding" : "with product") : "all fields"}` };
}
