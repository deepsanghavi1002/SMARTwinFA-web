import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import { desktopDate } from "./formula";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 230: STEEL PLANT STOCK (REPORT_RPI_STEEL_PLANT_STOCK, SP_FRT_RPT_RPI_STEEL_PLANT_STOCK; SPECIAL > Extra Report (RP1) > Steel Plant Stock).
 * The stock the Steel Plant (Meher) holds of the products, from the challans (CHLN-OUT / CHLN-IN lines marked Lot No "Yes") and the stock in the products'
 * Re-order field as its opening.
 *  - Summary: for each product the Meher opening (Re-order plus the challans from the year's start to the day before From), what went to the plant
 *    (RISHABH_TO_MEHER) and came back (MEHER_TO_RISHABH) in the period, the closing at Meher, the product's total closing stock, what is left in Rishabh and at
 *    the steel plant, and the cartons at Meher (closing / standard pack, over a pack of 1). Products with nothing in any of them are left out; by the addon
 *    groups ticked, then product code.
 *  - Ledger: the challan lines of each product with its opening (Re-order plus the earlier challans, in Location In / Out as the procedure's positions put them)
 *    and the running balance of the product (CLSG_QTY); a product with no line shows nothing.
 * The Stock Transfer option (it writes the Re-order of the next year's company) is not done: a report never writes.
 */
const r2 = (value: number) => Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
const p2 = (value: number) => String(value).padStart(2, "0");
const ids = (keys: string) => (/^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(keys.trim()) ? keys.trim() : "");

/** The quantity of a challan line in the unit the procedure picks (ag_qty taken off; share = the part of the other units still against). */
const uomCase = (basis: "rep1" | "rep2", share: boolean) => {
  const unit = `product.${basis}_uom`;
  const quantity = (column: string) => (share ? `prodled.${column}::numeric - round(prodled.ag_qty::numeric / nullif(prodled.quantity::numeric, 0) * prodled.${column}::numeric, 4)` : `prodled.${column}::numeric - prodled.ag_qty::numeric`);
  return `case when ${unit} = product.pcs_uom then prodled.trn_pcs::numeric - prodled.ag_qty::numeric when ${unit} = product.qty1_uom then ${quantity("trn_qty1")} when ${unit} = product.qty2_uom then ${quantity("trn_qty2")}`
    + ` when ${unit} = product.qty3_uom then ${quantity("trn_qty3")} when ${unit} = product.pack_uom then ${quantity("trn_pack")} when ${unit} = product.weight_uom then ${quantity("trn_weight")}`
    + ` else ${share ? "prodled.quantity::numeric - prodled.ag_qty::numeric" : "0"} end`;
};

export async function steelPlantStock(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const ledger = call.fcText.trim().toUpperCase() === "LEDGER";
  if (call.checkQuery.includes("CHK_STOCKTRF,")) throw new ReportRefusal("The Stock Transfer option (it writes the Re-order stock of the next year's company) is not available in the web version.", "Not ported yet");

  // The product and addon selections.
  const filters = [ids(call.selectKey[4]) !== "" ? ` AND product.prod_key IN ${ids(call.selectKey[4])}` : ""];
  const addons = [0, 1, 2, 3].filter((at) => ids(call.selectKey[at]) !== "");
  for (const at of addons) filters.push(` AND ${call.addon[at].trim().replace(/^(p?adata)\.txt_/i, "adata.key_")} IN ${ids(call.selectKey[at])}`);
  const where = filters.join("");
  const from = call.from;
  const upto = call.upto;
  const yearStart = call.tarikh1;
  const shifted = day(from) !== day(yearStart);
  const dayBefore = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  const challans = `btrim(prodled.trn_module) IN ('CHLN-OUT', 'CHLN-IN') AND coalesce(prodled.lot_no, '') = 'Yes' AND prodled.il_pos = 'A'`;
  const baseJoin = `FROM ${db}product_master product LEFT JOIN ${db}prod_balance prodbal ON prodbal.prod_id = product.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`;

  if (ledger) {
    const table = new ResultTable();
    for (const column of ["SORTING_COL", "ROW_DATA_TYPE", "DATE", "VOUCHER_NO", "PARTICULAR", "Location_Out", "Location_In", "CLSG_QTY", "UOM1", "DOC_NO1", "Location"]) table.addColumn(column);
    for (const column of ["Location_Out", "Location_In", "CLSG_QTY"]) table.setKind(column, "decimal");
    type Row = { sort: string; particular: string; row: ResultRow; order: number; nat: string; key: number };
    const out: Row[] = [];
    // The entry addon's Location field exists only in a company that defined it.
    const hasLocation = ((await runReportSql(loader, "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'addon_ientry' AND column_name = 'txt_location'", [loader.session.companySchema])).rows.length) > 0;
    const lines = (await runReportSql(loader, `SELECT prodled.il_key, prodled.il_date, prodled.stock_nat, product.prod_short, product.prod_desc, prodled.full_docno, prodled.doc_no1, ${hasLocation ? "coalesce(aient.txt_location, '')" : "''"} AS location, puom.uom_short,`
      + ` (${uomCase("rep2", false)}) AS quantity FROM ${db}prod_ledger prodled RIGHT JOIN ${db}product_master product ON prodled.prod_id = product.prod_key LEFT JOIN ${db}addon_data adata ON adata.prod_id = product.prod_key`
      + ` LEFT JOIN ${db}addon_ientry aient ON aient.aoni_il_id = prodled.il_key LEFT JOIN ${db}prod_uom puom ON puom.uom_key = product.rep1_uom`
      + ` WHERE product.inventory = 'Y' AND product.prod_pos <> 'D' AND ${challans} AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date${where}`, [desktopDate(from), desktopDate(upto)])).rows;
    const seen = new Set<string>();
    for (const row of lines) {
      const date = row.il_date as Date;
      const quantity = num(row.quantity);
      const nat = toText(row.stock_nat);
      const sort = `${toText(row.prod_short)}   P${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}LED`;
      const record = { SORTING_COL: sort, ROW_DATA_TYPE: "LED", DATE: `${p2(date.getDate())}/${p2(date.getMonth() + 1)}/${date.getFullYear()}`, VOUCHER_NO: row.full_docno, PARTICULAR: row.prod_desc, Location_Out: nat === "L" ? quantity : 0, Location_In: nat === "A" ? quantity : 0,
        CLSG_QTY: 0, UOM1: row.uom_short, DOC_NO1: row.doc_no1, Location: row.location };
      out.push({ sort, particular: toText(row.prod_desc).toLowerCase(), row: record, order: day(date), nat, key: num(row.il_key) });
      seen.add(toText(row.prod_desc).toLowerCase());
    }
    // Openings (Re-order plus the earlier challans) and the product headings.
    const products = (await runReportSql(loader, `SELECT product.prod_key, product.prod_short, product.prod_desc, coalesce(product.re_order, 0)::numeric AS re_order, puom.uom_short, prodbal.open_pcs::numeric AS open_pcs ${baseJoin} LEFT JOIN ${db}prod_uom puom ON puom.uom_key = product.rep1_uom`
      + ` WHERE product.prod_pos <> 'D' AND product.inventory = 'Y' AND prodbal.prec_flag = 'RP'${where}`)).rows;
    const before = new Map<number, number>();
    if (shifted) {
      for (const row of (await runReportSql(loader, `SELECT prodled.prod_id, sum(CASE WHEN btrim(prodled.trn_module) = 'CHLN-IN' AND prodled.stock_nat = 'A' THEN ${uomCase("rep1", false)} ELSE 0 END)`
        + ` - sum(CASE WHEN btrim(prodled.trn_module) = 'CHLN-OUT' AND prodled.stock_nat = 'L' THEN ${uomCase("rep1", false)} ELSE 0 END) AS moved FROM ${db}prod_ledger prodled LEFT JOIN ${db}product_master product ON product.prod_key = prodled.prod_id`
        + ` WHERE prodled.il_pos = 'A' AND btrim(prodled.trn_module) IN ('CHLN-IN', 'CHLN-OUT') AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date GROUP BY prodled.prod_id`, [desktopDate(yearStart), desktopDate(dayBefore)])).rows) before.set(num(row.prod_id), num(row.moved));
    }
    const fromText = `${p2(from.getDate())}/${MONTHS[from.getMonth()]}/${from.getFullYear()}`;
    const headed = new Set<string>();
    for (const row of products) {
      const desc = toText(row.prod_desc);
      const short = toText(row.prod_short);
      if (headed.has(`${short}|${desc}`)) continue;
      headed.add(`${short}|${desc}`);
      out.push({ sort: `${short}   H`, particular: desc.toLowerCase(), order: -2, nat: "", key: 0, row: { SORTING_COL: `${short}   H`, ROW_DATA_TYPE: "AC", DATE: "", VOUCHER_NO: "", PARTICULAR: desc, Location_Out: 0, Location_In: 0, CLSG_QTY: 0, UOM1: "", DOC_NO1: "", Location: "" } });
      if (num(row.open_pcs) === 0) continue;
      const opening = num(row.re_order) + (shifted ? before.get(num(row.prod_key)) ?? 0 : 0);
      if (opening === 0) continue;
      // The procedure's union is by position: the negative opening lands under Location_Out, the positive under Location_In.
      out.push({ sort: `${short}   O`, particular: desc.toLowerCase(), order: -1, nat: "", key: 0, row: { SORTING_COL: `${short}   O`, ROW_DATA_TYPE: "OPENINGS", DATE: fromText, VOUCHER_NO: "Opening", PARTICULAR: desc, Location_Out: opening < 0 ? opening : 0, Location_In: opening > 0 ? Math.abs(opening) : 0,
        CLSG_QTY: 0, UOM1: row.uom_short, DOC_NO1: "", Location: "" } });
    }
    // The running balance of each product (opening first, then by date, Add before Less).
    const running = new Map<string, number>();
    const stocked = [...out].filter((entry) => entry.row.ROW_DATA_TYPE !== "AC").sort((a, b) => a.order - b.order || (a.nat < b.nat ? -1 : a.nat > b.nat ? 1 : 0) || a.key - b.key);
    for (const entry of stocked) {
      const balance = r2((running.get(entry.particular) ?? 0) + num(entry.row.Location_In) - num(entry.row.Location_Out));
      running.set(entry.particular, balance);
      entry.row.CLSG_QTY = balance;
    }
    // A product with a heading only shows nothing.
    const used = new Set(out.filter((entry) => entry.row.ROW_DATA_TYPE !== "AC").map((entry) => entry.particular));
    table.rows = out.filter((entry) => entry.row.ROW_DATA_TYPE === "AC" ? used.has(entry.particular) : true).map((entry, index) => ({ entry, index }))
      .sort((a, b) => (a.entry.sort.toLowerCase() < b.entry.sort.toLowerCase() ? -1 : a.entry.sort.toLowerCase() > b.entry.sort.toLowerCase() ? 1 : 0) || a.index - b.index).map(({ entry }) => entry.row);
    return table;
  }

  // Summary.
  const aliasOf = (text: string) => /as\s+"([^"]+)"/i.exec(text)?.[1] ?? "";
  const addonSelect = addons.map((at) => `, ${call.headingAddon[at].trim()}, ${call.selectedAddon[at].trim()}`).join("");
  const addonNames = addons.flatMap((at) => [aliasOf(call.headingAddon[at]), aliasOf(call.selectedAddon[at])]).filter((name) => name !== "");
  const stock = "case when product.rep1_uom = product.pcs_uom then prodbal.clsg_pcs when product.rep1_uom = product.qty1_uom then prodbal.clsg_qty1 when product.rep1_uom = product.qty2_uom then prodbal.clsg_qty2"
    + " when product.rep1_uom = product.qty3_uom then prodbal.clsg_qty3 when product.rep1_uom = product.pack_uom then prodbal.clsg_pack when product.rep1_uom = product.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";
  const products = (await runReportSql(loader, `SELECT product.prod_short, product.prod_desc, round(coalesce(product.re_order, 0)::numeric, 2) AS meher_open, puom.uom_short, round(product.base_pack::numeric, 2) AS std_pack, (${stock})::numeric AS total_clsg${addonSelect}`
    + ` ${baseJoin} LEFT JOIN ${db}prod_uom puom ON puom.uom_key = product.rep1_uom WHERE product.inventory = 'Y' AND product.prod_pos <> 'D' AND prodbal.prec_flag = 'RP'${where}`)).rows;

  // What went to / came back from the plant, by product code: before From (added to the opening) and in the period.
  const moved = async (start: Date, end: Date) => {
    const map = new Map<string, { out: number; back: number }>();
    for (const row of (await runReportSql(loader, `SELECT product.prod_short, sum(CASE WHEN prodled.stock_nat = 'A' THEN ${uomCase("rep1", true)} ELSE 0 END) AS to_plant, sum(CASE WHEN prodled.stock_nat = 'L' THEN ${uomCase("rep1", true)} ELSE 0 END) AS from_plant`
      + ` FROM ${db}prod_ledger prodled RIGHT JOIN ${db}product_master product ON prodled.prod_id = product.prod_key LEFT JOIN ${db}addon_data adata ON prodled.prod_id = adata.prod_id`
      + ` WHERE product.inventory = 'Y' AND product.prod_pos <> 'D' AND ${challans} AND prodled.il_date >= $1::date AND prodled.il_date <= $2::date${where} GROUP BY product.prod_short`, [desktopDate(start), desktopDate(end)])).rows) {
      map.set(toText(row.prod_short), { out: r2(num(row.to_plant)), back: r2(num(row.from_plant)) });
    }
    return map;
  };
  const earlier = shifted ? await moved(yearStart, dayBefore) : new Map<string, { out: number; back: number }>();
  const period = await moved(from, upto);

  const table = new ResultTable();
  const columns = ["PROD_CODE", "PROD_DESC", "SORTING_COL", "MEHER_OPEN_QTY", "RISHABH_TO_MEHER", "MEHER_TO_RISHABH", "MEHER_CLSG_QTY", "UOM", "STD_PACK", "CTN_IN_MEHER", "TOTAL_CLSG_STK", "STOCK_IN_RISHABH", "STOCK_IN_STEEL_PLANT", ...addonNames];
  for (const column of columns) table.addColumn(column);
  for (const column of columns.filter((name) => !["PROD_CODE", "PROD_DESC", "SORTING_COL", "UOM", ...addonNames].includes(name))) table.setKind(column, "decimal");
  const rows: ResultRow[] = [];
  for (const row of products) {
    const short = toText(row.prod_short);
    const before = earlier.get(short);
    const open = r2(num(row.meher_open) + (before ? before.out - before.back : 0));
    const inPeriod = period.get(short);
    const toPlant = inPeriod?.out ?? 0;
    const fromPlant = inPeriod?.back ?? 0;
    const closing = r2(open + toPlant - fromPlant);
    const total = r2(num(row.total_clsg));
    const stdPack = row.std_pack === null ? 0 : num(row.std_pack);
    const addonValues = Object.fromEntries(addonNames.map((name) => [name, row[name.toLowerCase()] ?? row[name]]));
    const record: ResultRow = { PROD_CODE: short, PROD_DESC: row.prod_desc, SORTING_COL: short, MEHER_OPEN_QTY: open, RISHABH_TO_MEHER: toPlant, MEHER_TO_RISHABH: fromPlant, MEHER_CLSG_QTY: closing, UOM: row.uom_short, STD_PACK: row.std_pack === null ? null : stdPack,
      CTN_IN_MEHER: stdPack > 1 && closing > 0 ? r2(closing / Math.abs(stdPack)) : 0, TOTAL_CLSG_STK: total, STOCK_IN_RISHABH: r2(total - closing), STOCK_IN_STEEL_PLANT: Math.abs(closing), ...addonValues };
    if ([open, fromPlant, toPlant, total, record.STOCK_IN_RISHABH, record.STOCK_IN_STEEL_PLANT].every((value) => num(value) === 0)) continue;
    rows.push(record);
  }
  const order = addonNames.filter((name) => /^SMART_SELECTED_ADDON\d$/i.test(name));
  const low = (value: unknown) => toText(value).toLowerCase();
  table.rows = rows.map((row, index) => ({ row, index })).sort((a, b) => { for (const name of order) { const compare = low(a.row[name]).localeCompare(low(b.row[name])); if (compare !== 0) return compare; } return low(a.row.PROD_CODE).localeCompare(low(b.row.PROD_CODE)) || a.index - b.index; }).map(({ row }) => row);
  return table;
}
