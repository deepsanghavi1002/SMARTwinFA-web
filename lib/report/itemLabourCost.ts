import type { Loader } from "../master-program/load";
import { toText } from "../master-program/legacy";
import { ResultTable } from "./call";
import type { ResultRow } from "./call";
import type { ReportPlan } from "./generate";
import { ReportRefusal } from "./refusal";
import { num, runReportSql } from "./run";

/**
 * 316: ITEM LABOUR COST (SP_FRT_RPT_RPI_ITEM_LABOUR_COST; SPECIAL > Extra Report (RP1) > Item Labour Cost).
 * For each product ticked (else every finish good that has a BOM voucher): its labour cost by department, and its material cost.
 *  - Labour: Moulding (the PMP components of the product's latest BOM, exploded down its sub-assemblies) and Blow Moulding (the Preforms group), from the
 *    components' per hour output, cavity and shift rate; Printing and Assembly (the Cost Process rows of the product); Filling (the "Insulated - Filling"
 *    components); Packing (the product's own per hour packing). With the Department Rate's efficiency the shift output, the rate per piece and the cost
 *    (rate x quantity) follow. A company that has no Cost Process / Department Rate tables (or the man power / packing fields) has no rows for those steps.
 *  - FG Material Cost: the finish goods' BOM vouchers costed as the Finish Product Costing does (a semi finished material replaced by the raw materials of its
 *    latest BOM; the rate of the voucher, else the latest purchase rate, else the opening rate), with no date limit.
 * Detail: every row, by SMART_PROD_DESC. Otherwise: a row for each Description with the six departments across and their TOTAL.
 * The procedure's set-based work tables are here a few reads (the BOM vouchers once) and the same steps in memory.
 */
const r0 = (value: number) => Math.sign(value) * Math.round(Math.abs(value) + 1e-9);
const r2 = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * 100) / 100;
const r4 = (value: number) => Math.sign(value) * Math.round((Math.abs(value) + 1e-9) * 10000) / 10000;
const norm = (value: unknown) => toText(value).trim().toLowerCase();
const text = (value: unknown) => (value === null || value === undefined ? null : toText(value));
const byText = (a: string, b: string) => { const x = a.toUpperCase(); const y = b.toUpperCase(); return x === y ? 0 : x < y ? -1 : 1; };
const DEPARTMENTS = ["Moulding", "Blow Moulding", "Printing", "Filling", "Assembly", "Packing"] as const;
const HOURS: Record<string, number> = { moulding: 8, "blow moulding": 8, printing: 11, filling: 11, assembly: 9, packing: 9 };
const MAX_ROWS = 1_000_000;

type Line = { doc: string; prodId: number; nat: string; pos: string; qty: number; rate: number; date: number };
type Product = { desc: string; pos: string };
type Attr = { cat: string | null; type: string | null; group: string | null; unitKey: string; perhr: number; fipersec: number; cavity: string; manpower: number; packperhr: number };
type Component = { prodId: number; desc: string; qty: number; perhr: number; fipersec: number; cavity: string; unit: string; shiftRate: number; cat: string | null; group: string | null; manpower: number };
type Cost = { doc: string; desc: string; type: string | null; qty: number; cost: number | null; added: boolean };

export async function itemLabourCost(loader: Loader, plan: ReportPlan): Promise<ResultTable> {
  const { call } = plan;
  const db = call.database;
  const detail = call.fcText.trim().toUpperCase() === "DETAIL";
  const picked = /^\(\s*\d+(\s*,\s*\d+)*\s*\)$/.test(call.selectKey[4].trim()) ? new Set((call.selectKey[4].match(/\d+/g) ?? []).map(Number)) : null;

  const has = async (tableName: string, column?: string) => (await runReportSql(loader, `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2${column ? " AND column_name = $3" : ""} LIMIT 1`,
    column ? [loader.session.companySchema, tableName, column] : [loader.session.companySchema, tableName])).rows.length > 0;
  const hasMan = await has("addon_data", "input_manpower");
  const hasPack = await has("addon_data", "input_packperhr");

  // ---- Reads (each once) ----
  const products = new Map((await runReportSql(loader, `SELECT prod_key, prod_pos, prod_desc FROM ${db}product_master`)).rows.map((row) => [num(row.prod_key), { desc: toText(row.prod_desc), pos: toText(row.prod_pos).trim() } as Product] as const));
  const attrs = new Map<number, Attr>();
  for (const row of (await runReportSql(loader, `SELECT prod_id, txt_prodcat, txt_prodtype, txt_prodgroup, key_produnit, input_perhrstdpc, input_fipersec, input_cavity${hasMan ? ", input_manpower" : ""}${hasPack ? ", input_packperhr" : ""} FROM ${db}addon_data`)).rows) {
    const id = num(row.prod_id);
    if (attrs.has(id)) continue;
    attrs.set(id, { cat: text(row.txt_prodcat), type: text(row.txt_prodtype), group: text(row.txt_prodgroup), unitKey: toText(row.key_produnit).trim(), perhr: num(row.input_perhrstdpc), fipersec: num(row.input_fipersec),
      cavity: row.input_cavity === null || row.input_cavity === undefined ? "" : toText(row.input_cavity), manpower: num(row.input_manpower), packperhr: num(row.input_packperhr) });
  }
  const units = new Map<string, { name: string; short: string }>();
  for (const row of (await runReportSql(loader, `SELECT sub_code, sub_name, short_name FROM ${db}addon_sub`)).rows) { const key = toText(row.sub_code).trim(); if (!units.has(key)) units.set(key, { name: toText(row.sub_name), short: toText(row.short_name) }); }
  const bom: Line[] = (await runReportSql(loader, `SELECT full_docno, prod_id, stock_nat, il_pos, quantity::numeric AS qty, rate::numeric AS rate, il_date FROM ${db}prod_ledger WHERE btrim(trn_module) = 'MFG-BOM' AND il_pos <> 'D'`)).rows
    .map((row) => ({ doc: toText(row.full_docno), prodId: num(row.prod_id), nat: toText(row.stock_nat).trim(), pos: toText(row.il_pos).trim(), qty: num(row.qty), rate: num(row.rate), date: row.il_date instanceof Date ? row.il_date.getTime() : 0 }));
  const purchase = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, rate::numeric AS rate FROM ${db}prod_ledger WHERE il_pos = 'A' AND book = 13 AND led_id IS NOT NULL ORDER BY prod_id, il_date DESC`)).rows.map((row) => [num(row.prod_id), num(row.rate)] as const));
  const balances = new Map((await runReportSql(loader, `SELECT DISTINCT ON (prod_id) prod_id, open_rate::numeric AS open_rate, rep_rate::numeric AS rep_rate FROM ${db}prod_balance WHERE prec_flag = 'RP' ORDER BY prod_id`)).rows.map((row) => [num(row.prod_id), row] as const));
  const rates = new Map<string, { sp: number; wr: number; eff: number }>();
  if (await has("department_rate")) for (const row of (await runReportSql(loader, `SELECT department_name, sp_rate, wr_rate, eff_perc FROM ${db}department_rate`)).rows) { const key = norm(row.department_name); if (!rates.has(key)) rates.set(key, { sp: num(row.sp_rate), wr: num(row.wr_rate), eff: num(row.eff_perc) }); }
  const processes = (await has("cost_process")) ? (await runReportSql(loader, `SELECT fg_prod_id, prod_id, process_for, process_name, man_power, worker_man_power, production_hour FROM ${db}cost_process`)).rows : [];

  // ---- The BOM vouchers, indexed once ----
  const headersOf = new Map<number, Line[]>();        // product -> its BOM vouchers (the "A" lines)
  const linesOf = new Map<string, Line[]>();          // voucher -> its material ("L") lines
  const everyLine = new Map<string, Line[]>();        // voucher -> all lines
  for (const line of bom) {
    if (line.nat === "A") { const list = headersOf.get(line.prodId) ?? []; list.push(line); headersOf.set(line.prodId, list); }
    else if (line.nat === "L") { const list = linesOf.get(line.doc) ?? []; list.push(line); linesOf.set(line.doc, list); }
    const all = everyLine.get(line.doc) ?? []; all.push(line); everyLine.set(line.doc, all);
  }
  const newer = (a: Line, b: Line) => a.date > b.date || (a.date === b.date && byText(a.doc, b.doc) > 0);
  const latestOf = new Map<string, Line>();           // product description -> its latest BOM voucher
  const latestByProduct = new Map<number, Line>();
  for (const list of headersOf.values()) for (const line of list) {
    const key = norm(products.get(line.prodId)?.desc);
    const current = latestOf.get(key);
    if (!current || newer(line, current)) latestOf.set(key, line);
    const mine = latestByProduct.get(line.prodId);
    if (!mine || newer(line, mine)) latestByProduct.set(line.prodId, line);
  }
  const isType = (id: number, type: string) => (attrs.get(id)?.type ?? "").trim().toUpperCase() === type;

  // ================= PART 1: finish goods material cost =================
  const costs: Cost[] = [];
  const seen = new Set<string>();
  const fgDocs = new Set<string>();
  const fgProducts = new Set<number>();
  for (const list of headersOf.values()) for (const line of list) {
    const product = products.get(line.prodId);
    if (line.pos !== "A" || !product || product.pos === "D" || !isType(line.prodId, "FINISH GOODS") || (picked && !picked.has(line.prodId))) continue;
    const key = `${line.doc}|${line.prodId}|${r4(line.qty)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fgDocs.add(line.doc);
    fgProducts.add(line.prodId);
    costs.push({ doc: line.doc, desc: product.desc, type: attrs.get(line.prodId)?.type ?? null, qty: r4(line.qty), cost: 0, added: false });
  }
  for (const doc of fgDocs) for (const line of linesOf.get(doc) ?? []) {
    const product = products.get(line.prodId);
    if (line.pos !== "A" || !product || product.pos === "D") continue;
    costs.push({ doc, desc: product.desc, type: attrs.get(line.prodId)?.type ?? null, qty: r4(line.qty), cost: r2(line.rate), added: false, ...{ prodId: line.prodId } } as Cost & { prodId: number });
  }
  const notFinish = (cost: Cost) => cost.type !== null && cost.type.trim().toUpperCase() !== "FINISH GOODS";
  for (const cost of costs as (Cost & { prodId?: number })[]) {
    if (!notFinish(cost) || (cost.cost ?? 0) !== 0 || cost.prodId === undefined) continue;
    const bought = purchase.get(cost.prodId);
    const balance = balances.get(cost.prodId);
    if (bought === undefined && balance === undefined) continue;
    cost.cost = r2(bought || num(balance?.open_rate) || num(balance?.rep_rate) || (cost.cost ?? 0));
  }
  for (const cost of costs) if (notFinish(cost) && (cost.cost ?? 0) > 0 && cost.qty > 0) cost.cost = r2(cost.qty * (cost.cost ?? 0));

  // The raw materials a semi finished material's latest BOM explodes to (the procedure's recursive EXPLODE; leaves only).
  type Leaf = { qty: number; rate: number; type: string | null };
  const exploded = new Map<string, Leaf[]>();
  const leavesOf = (desc: string): Leaf[] => {
    const key = norm(desc);
    const cached = exploded.get(key);
    if (cached) return cached;
    const leaves: Leaf[] = [];
    exploded.set(key, leaves);
    const header = latestOf.get(key);
    if (!header || products.get(header.prodId)?.pos !== "A" || !isType(header.prodId, "SEMI FINISHED MATERIAL")) return leaves;
    let frontier = (linesOf.get(header.doc) ?? []).flatMap((line) => { const name = products.get(line.prodId)?.desc; return name === undefined ? [] : [{ line, desc: name.trim(), qty: line.qty, level: 1, path: `|${header.prodId === 0 ? "" : products.get(header.prodId)!.desc.trim()}|${name.trim()}|` }]; });
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        const child = latestOf.get(norm(node.desc));
        if (!child) {
          // A leaf: a material with no BOM of its own.
          if (products.get(node.line.prodId)?.pos !== "A") continue;
          const bought = purchase.get(node.line.prodId);
          const opening = balances.get(node.line.prodId) === undefined ? null : r2(num(balances.get(node.line.prodId)!.open_rate));
          const rate = (node.line.rate ?? 0) === 0 && !(bought ?? 0) ? opening ?? 0 : (node.line.rate ?? 0) === 0 ? r2(bought ?? 0) : node.line.rate;
          leaves.push({ qty: Number.isNaN(node.qty) ? NaN : r4(node.qty), rate, type: attrs.get(node.line.prodId)?.type ?? null });
          continue;
        }
        if (node.level >= 10) continue;
        for (const line of linesOf.get(child.doc) ?? []) {
          const name = products.get(line.prodId)?.desc;
          if (name === undefined || node.path.toLowerCase().includes(`|${name.trim().toLowerCase()}|`)) continue;
          next.push({ line, desc: name.trim(), qty: child.qty === 0 ? NaN : node.qty * line.qty / child.qty, level: node.level + 1, path: `${node.path}${name.trim()}|` });
        }
      }
      frontier = next;
    }
    return leaves;
  };
  const snapshot = [...costs];
  for (const cost of snapshot) {
    if ((cost.type ?? "").trim().toUpperCase() !== "SEMI FINISHED MATERIAL") continue;
    for (const leaf of leavesOf(cost.desc)) costs.push({ doc: cost.doc, desc: cost.desc.trim(), type: leaf.type, qty: cost.qty, cost: Number.isNaN(leaf.qty) ? null : r2(leaf.qty * cost.qty * leaf.rate), added: true });
  }
  const kept = costs.filter((cost) => cost.added || (cost.type ?? "").trim().toUpperCase() !== "SEMI FINISHED MATERIAL");
  const sums = new Map<string, number>();
  for (const cost of kept) sums.set(cost.doc, (sums.get(cost.doc) ?? 0) + (cost.cost ?? 0));
  const finishCosts = kept.filter((cost) => (cost.type ?? "").trim().toUpperCase() === "FINISH GOODS").map((cost) => ({ desc: cost.desc, cost: r2(sums.get(cost.doc) ?? 0) }));

  // ================= PART 2: labour cost, every product at once =================
  const selected: { key: number; desc: string; bomNo: string }[] = [];
  for (const [key, product] of products) {
    if (!(picked ? picked.has(key) : fgProducts.has(key))) continue;
    selected.push({ key, desc: product.desc, bomNo: latestByProduct.get(key)?.doc ?? "" });
  }
  const bomDocs = new Set(bom.filter((line) => line.nat === "A").map((line) => line.doc));
  const componentOf = (line: Line): Component | null => {
    const product = products.get(line.prodId);
    const attr = attrs.get(line.prodId);
    const unit = attr ? units.get(attr.unitKey) : undefined;
    if (!product || !attr || !unit) return null;
    return { prodId: line.prodId, desc: product.desc, qty: line.qty, perhr: attr.perhr, fipersec: attr.fipersec, cavity: attr.cavity, unit: unit.name, shiftRate: num(unit.short), cat: attr.cat, group: attr.group, manpower: attr.manpower };
  };
  const componentsOf = new Map<string, Component[]>();
  for (const [doc, list] of linesOf) {
    if (!bomDocs.has(doc)) continue;
    componentsOf.set(doc, list.flatMap((line) => { const component = componentOf(line); return component ? [component] : []; }));
  }

  const out: ResultRow[] = [];
  const put = (selectedDesc: string, sort: string, department: string, component: string, values: Partial<{ men: number; manCost: number; perhr: number; cavity: string; unit: string; shift: number; copart: number }>) => out.push({
    Sr_No: 0, SMART_PROD_DESC: `${selectedDesc}${sort}`, SMART_SELECTED_PRODUCT: selectedDesc, SMART_SELECTED_ADDON1: "LABOUR COST", SMART_SELECTED_ADDON2: department, Description: selectedDesc, Component: component,
    No_Of_Man_Power: r0(values.men ?? 0), Total_Manpower_Cost: r2(values.manCost ?? 0), Prod_Per_Hr: Math.trunc(values.perhr ?? 0), Mould_Cavity: values.cavity ?? "0", MC_Ton: values.unit ?? "0", Shift_Rate: r2(values.shift ?? 0),
    "Prod_Efficiency_%": 0, Prod_Per_Shift: 0, Rate_Per_PC: 0, No_of_Copart: r2(values.copart ?? 0), Total_Cost: 0 });
  const cavityText = (value: string) => (value.trim() === "" ? "0" : value);
  let total = 0;
  for (const product of selected) {
    // The product's BOM, exploded once through its components' own BOM vouchers (the procedure's recursive E).
    const explodedLines: { component: Component; fill: boolean }[] = [];
    let frontier = (componentsOf.get(product.bomNo) ?? []).map((component) => ({ component, fill: (component.cat ?? "") === "Insulated - Filling", level: 1 }));
    while (frontier.length > 0) {
      total += frontier.length;
      if (total > MAX_ROWS) throw new ReportRefusal("A bill of material of this product points back to itself, so its labour cost cannot be worked out.", "Item Labour Cost");
      const next: typeof frontier = [];
      for (const node of frontier) {
        explodedLines.push({ component: node.component, fill: node.fill });
        if (node.level >= 30) continue;
        for (const header of headersOf.get(node.component.prodId) ?? []) for (const component of componentsOf.get(header.doc) ?? []) next.push({ component, fill: node.fill, level: node.level + 1 });
      }
      frontier = next;
    }
    for (const { component } of explodedLines) if (component.desc.slice(0, 3).toUpperCase() === "PMP") put(product.desc, " P1 FG MATERIAL COSTLABOUR COSTMOULDING", "MOULDING", component.desc, { perhr: component.perhr, cavity: cavityText(component.cavity), unit: component.unit, shift: component.shiftRate, copart: component.qty });
    for (const { component } of explodedLines) if ((component.group ?? "").toLowerCase().includes("preforms")) put(product.desc, " P2 FG MATERIAL COSTLABOUR COSTBLOW MOULDING", "BLOW MOULDING", component.desc, { perhr: component.perhr, cavity: cavityText(component.cavity), unit: component.unit, shift: component.shiftRate, copart: component.qty });
    const process = (name: string, sort: string, department: string) => {
      for (const row of processes) {
        if (num(row.fg_prod_id) !== product.key || norm(row.process_for) !== norm(name)) continue;
        const rate = rates.get(norm(row.process_for));
        for (const line of everyLine.get(product.bomNo) ?? []) {
          if (line.prodId !== num(row.prod_id)) continue;
          const men = num(row.man_power) + num(row.worker_man_power);
          put(product.desc, sort, department, `${products.get(num(row.prod_id))?.desc ?? ""} - ${toText(row.process_name)}`, { men, manCost: num(row.man_power) * (rate?.sp ?? 0) + num(row.worker_man_power) * (rate?.wr ?? 0), perhr: num(row.production_hour), copart: line.qty });
        }
      }
    };
    process("Printing", " P3 FG MATERIAL COSTLABOUR COSTPRINTING", "PRINTING");
    for (const { component, fill } of explodedLines) if (fill && component.cat === "Insulated - Filling") put(product.desc, " P4 FG MATERIAL COSTLABOUR COSTFILLING", "FILLING", component.desc, { men: component.manpower, manCost: component.manpower * (rates.get("filling")?.wr ?? 0), perhr: component.fipersec, copart: component.qty });
    process("Assembly", " P5 FG MATERIAL COSTLABOUR COSTASSEMBLY", "ASSEMBLY");
    if (hasMan || hasPack) {
      const attr = attrs.get(product.key);
      put(product.desc, " P6 FG MATERIAL COSTLABOUR COSTPACKING", "PACKING", product.desc, { men: attr?.manpower ?? 0, manCost: (attr?.manpower ?? 0) * (rates.get("packing")?.wr ?? 0), perhr: attr?.packperhr ?? 0, copart: 1 });
    }
  }

  // The shift output, efficiency, rate per piece and cost, for each department that has an efficiency in the Department Rate.
  for (const row of out) {
    const department = toText(row.SMART_SELECTED_ADDON2);
    const rate = rates.get(norm(department));
    const hours = HOURS[norm(department)];
    if (!rate || hours === undefined || !(rate.eff > 0)) continue;
    const moulded = department === "MOULDING" || department === "BLOW MOULDING";
    const cavity = moulded ? (Number.isFinite(Number(toText(row.Mould_Cavity))) && toText(row.Mould_Cavity).trim() !== "" ? Number(toText(row.Mould_Cavity)) : 0) : 1;
    const shift = r2(r0(((num(row.Prod_Per_Hr) * cavity * hours) * rate.eff) / 100));
    const each = shift > 0 ? r2((moulded ? num(row.Shift_Rate) : num(row.Total_Manpower_Cost)) / shift) : 0;
    row.Prod_Per_Shift = shift;
    row["Prod_Efficiency_%"] = r2(rate.eff);
    row.Rate_Per_PC = each;
    row.Total_Cost = r2(num(row.No_of_Copart) * each);
  }
  for (const cost of finishCosts) out.push({ Sr_No: 0, SMART_PROD_DESC: `${cost.desc} P FG MATERIAL COSTFG MATERIALFG MATERIAL`, SMART_SELECTED_PRODUCT: cost.desc, SMART_SELECTED_ADDON1: "FG MATERIAL COST", SMART_SELECTED_ADDON2: "FG MATERIAL", Description: cost.desc, Component: cost.desc,
    No_Of_Man_Power: 0, Total_Manpower_Cost: 0, Prod_Per_Hr: 0, Mould_Cavity: "0", MC_Ton: "0", Shift_Rate: 0, "Prod_Efficiency_%": 0, Prod_Per_Shift: 0, Rate_Per_PC: 0, No_of_Copart: 0, Total_Cost: cost.cost });

  // ================= PART 3: output =================
  const table = new ResultTable();
  if (detail) {
    const columns = ["Sr_No", "SMART_PROD_DESC", "SMART_SELECTED_PRODUCT", "SMART_SELECTED_ADDON1", "SMART_SELECTED_ADDON2", "Description", "Component", "No_Of_Man_Power", "Total_Manpower_Cost", "Prod_Per_Hr", "Mould_Cavity", "MC_Ton", "Shift_Rate", "Prod_Efficiency_%", "Prod_Per_Shift", "Rate_Per_PC", "No_of_Copart", "Total_Cost"];
    for (const column of columns) table.addColumn(column);
    table.setKind("Sr_No", "int"); table.setKind("Prod_Per_Hr", "int");
    for (const column of ["No_Of_Man_Power", "Total_Manpower_Cost", "Shift_Rate", "Prod_Efficiency_%", "Prod_Per_Shift", "Rate_Per_PC", "No_of_Copart", "Total_Cost"]) table.setKind(column, "decimal");
    table.rows = out.map((row, index) => ({ row, index })).sort((a, b) => byText(toText(a.row.SMART_PROD_DESC), toText(b.row.SMART_PROD_DESC)) || a.index - b.index).map(({ row }) => row);
    return table;
  }
  const columns = ["Component", ...DEPARTMENTS, "TOTAL"];
  for (const column of columns) table.addColumn(column);
  for (const column of [...DEPARTMENTS, "TOTAL"]) table.setKind(column, "decimal");
  const grouped = new Map<string, ResultRow>();
  for (const row of out) {
    const key = norm(row.Description);
    let record = grouped.get(key);
    if (!record) { record = { Component: row.Description, ...Object.fromEntries(DEPARTMENTS.map((name) => [name, null])), TOTAL: 0 }; grouped.set(key, record); }
    const department = DEPARTMENTS.find((name) => name.toLowerCase() === norm(row.SMART_SELECTED_ADDON2));
    if (department) record[department] = r2(num(record[department]) + num(row.Total_Cost));
  }
  for (const record of grouped.values()) record.TOTAL = r2(DEPARTMENTS.reduce((sum, name) => sum + num(record[name]), 0));
  table.rows = [...grouped.values()].map((row, index) => ({ row, index })).sort((a, b) => byText(toText(a.row.Component), toText(b.row.Component)) || a.index - b.index).map(({ row }) => row);
  return table;
}
