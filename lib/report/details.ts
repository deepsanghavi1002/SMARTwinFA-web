import type { Loader } from "../master-program/load";
import type { DetailField, DetailIdentity, DetailRequest, DetailSection, DetailValues } from "./detailTypes";
import { normalName } from "./detailTypes";

/**
 * Add Details (server): the fields a report can take as extra columns, which report column holds the account / product name, and the values of
 * the ticked fields. The company's own addon fields (addon_fld) are read, never listed here; the other columns are a fixed, reviewed list.
 * Nothing the screen sends is put into SQL: ids are looked up in the catalog built here, and names and keys travel as parameters.
 */

type Kind = "text" | "num" | "date";
type Internal = DetailField & Readonly<{ expr: string; kind: Kind }>;
type Row = Record<string, unknown>;

const text = (row: Row, name: string) => String(row[name] ?? "").trim();
const SAFE = /^[A-Za-z0-9_]+$/;
const MAX_KEYS = 20000;

/** Account master (a), its default address (ad) and schedule (bs). */
const ACCOUNT_OTHER: readonly [string, string, string, string, Kind][] = [
  // id, caption, group, expression, kind
  ["a_short", "Short name", "Account", "a.a_short", "text"],
  ["bs_desc", "Schedule", "Account", "bs.bs_desc", "text"],
  ["a_startdate", "Start date", "Account", "a.a_startdate", "date"],
  ["address_1", "Address 1", "Address", "ad.address_1", "text"],
  ["address_2", "Address 2", "Address", "ad.address_2", "text"],
  ["address_3", "Address 3", "Address", "ad.address_3", "text"],
  ["city", "City", "Address", "ad.city", "text"],
  ["pin_code", "PIN code", "Address", "ad.pin_code", "text"],
  ["add_remark", "Address remark", "Address", "ad.add_remark", "text"],
  ["tel_no", "Phone", "Contact", "ad.tel_no", "text"],
  ["mobile_no", "Mobile", "Contact", "ad.mobile_no", "text"],
  ["whatsapp_no", "WhatsApp no", "Contact", "ad.whatsapp_no", "text"],
  ["e_mail", "E-mail", "Contact", "ad.e_mail", "text"],
  ["contact", "Contact person", "Contact", "ad.contact", "text"],
  ["gst_no", "GST no", "Tax and ID", "ad.gst_no", "text"],
  ["pan_no", "PAN no", "Tax and ID", "ad.pan_no", "text"],
  ["aadhar_no", "Aadhar no", "Tax and ID", "ad.aadhar_no", "text"],
  ["credit_days", "Credit days", "Credit", "a.credit_days", "num"],
  ["limit", "Credit limit", "Credit", 'a."LIMIT"', "num"],
  ["int_perc", "Interest %", "Credit", "a.int_perc", "num"],
  ["grace_days", "Grace days", "Credit", "a.grace_days", "num"],
  ["due_days", "Due days", "Credit", "a.due_days", "num"],
  ["owners_name", "Owner name", "Owner and manager", "ad.owners_name", "text"],
  ["owner_mobile", "Owner mobile", "Owner and manager", "ad.owner_mobile", "text"],
  ["manager_name", "Manager name", "Owner and manager", "ad.manager_name", "text"],
  ["manager_mobile", "Manager mobile", "Owner and manager", "ad.manager_mobile", "text"],
];

/** Product master (p). */
const PRODUCT_OTHER: readonly [string, string, string, string, Kind][] = [
  ["prod_short", "Short name", "Product", "p.prod_short", "text"],
  ["bill_desc", "Billing description", "Product", "p.bill_desc", "text"],
  ["bar_code", "Bar code", "Product", "p.bar_code", "text"],
  ["prod_info", "Product info", "Product", "p.prod_info", "text"],
  ["prod_message", "Message", "Product", "p.prod_message", "text"],
  ["hsn_code", "HSN code", "Tax", "p.hsn_code", "text"],
  ["tax_perc", "Tax %", "Tax", "p.tax_perc", "num"],
  ["toll_perc", "Toll %", "Tax", "p.toll_perc", "num"],
  ["min_qty", "Minimum qty", "Stock levels", "p.min_qty", "num"],
  ["max_qty", "Maximum qty", "Stock levels", "p.max_qty", "num"],
  ["re_order", "Re-order level", "Stock levels", "p.re_order", "num"],
  ["lead_days", "Lead days", "Stock levels", "p.lead_days", "num"],
  ["rep_rate", "Reporting rate", "Stock levels", "p.rep_rate", "num"],
];

/** The voucher (l). */
const ENTRY_OTHER: readonly [string, string, string, string, Kind][] = [
  ["narration", "Narration", "Voucher", "l.narration", "text"],
  ["doc_remark", "Remark", "Voucher", "l.doc_remark", "text"],
  ["chln_date", "Challan date", "Voucher", "l.chln_date", "date"],
  ["credit_days", "Credit days", "Voucher", "l.credit_days", "num"],
  ["print_count", "Print count", "Voucher", "l.print_count", "num"],
  ["eway_billno", "E-way bill no", "Transport and e-way", "l.eway_billno", "text"],
  ["eway_billdate", "E-way bill date", "Transport and e-way", "l.eway_billdate", "date"],
  ["trp_lrno", "LR no", "Transport and e-way", "l.trp_lrno", "text"],
  ["trp_amount", "Transport amount", "Transport and e-way", "l.trp_amount", "num"],
  ["distance_km", "Distance (km)", "Transport and e-way", "l.distance_km", "text"],
  ["einv_irnno", "IRN", "E-invoice", "l.einv_irnno", "text"],
  ["einv_ackno", "Ack no", "E-invoice", "l.einv_ackno", "text"],
  ["einv_ackdate", "Ack date", "E-invoice", "l.einv_ackdate", "text"],
  ["port_code", "Port code", "Export", "l.port_code", "text"],
  ["shipping_billno", "Shipping bill no", "Export", "l.shipping_billno", "text"],
  ["shipping_billdate", "Shipping bill date", "Export", "l.shipping_billdate", "date"],
];

const wrap = (expr: string, kind: Kind) => (kind === "num" ? `COALESCE(round((${expr})::numeric, 2)::text, '')` : kind === "date" ? `COALESCE(to_char(${expr}, 'DD/Mon/YYYY'), '')` : `COALESCE(btrim((${expr})::text), '')`);

function others(section: DetailSection, list: readonly [string, string, string, string, Kind][]): Internal[] {
  return list.map(([id, caption, group, expr, kind]) => ({
    id: `${section}:col:${id}`, section, list: "other", caption, group, aliases: [...new Set([normalName(caption), normalName(id)])], right: kind === "num", expr: wrap(expr, kind), kind,
  }));
}

/** The whole catalog, with each field's expression: the company's addon fields (from addon_fld, where their column exists) and the fixed lists. */
async function internalCatalog(loader: Loader): Promise<Internal[]> {
  const schema = loader.session.companySchema;
  const have = new Set((await loader.readTable("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('addon_data', 'addon_aentry')", [schema]) ?? []).map((row) => `${text(row, "table_name")}.${text(row, "column_name")}`));
  const fields = await loader.readTable(`SELECT fiel_type, fiel_relate, fiel_save, fiel_name, fiel_masterpos, fiel_entrypos FROM ${schema}.addon_fld WHERE COALESCE(fiel_pos, '') <> 'D' ORDER BY fiel_serial, fiel_key`) ?? [];
  const result: Internal[] = [];
  const addon = (section: DetailSection, alias: string, table: string, row: Row) => {
    const save = text(row, "fiel_save");
    if (!SAFE.test(save)) return;
    const typed = text(row, "fiel_type").toUpperCase() === "M";
    const column = `${typed ? "txt_" : "input_"}${save.toLowerCase()}`;
    if (!have.has(`${table}.${column}`)) return;
    const caption = text(row, "fiel_name") || save;
    result.push({
      id: `${section}:addon:${column}`, section, list: "addon", caption, group: typed ? "Pick-list fields" : "Typed fields",
      aliases: [...new Set([normalName(caption), normalName(save)])], expr: wrap(`${alias}.${column}`, "text"), kind: "text",
    });
  };
  for (const row of fields) {
    const relate = text(row, "fiel_relate").toUpperCase();
    if (text(row, "fiel_masterpos").toUpperCase() === "Y" && relate === "A") addon("acc", "d", "addon_data", row);
    if (text(row, "fiel_masterpos").toUpperCase() === "Y" && relate === "P") addon("prod", "d", "addon_data", row);
    if (text(row, "fiel_entrypos").toUpperCase() === "L") addon("ent", "e", "addon_aentry", row);
  }
  return [...result.filter((field) => field.section === "acc"), ...others("acc", ACCOUNT_OTHER), ...result.filter((field) => field.section === "prod"), ...others("prod", PRODUCT_OTHER), ...result.filter((field) => field.section === "ent"), ...others("ent", ENTRY_OTHER)];
}

/** What the screen lists (no SQL in it). */
export async function detailCatalog(loader: Loader): Promise<DetailField[]> {
  return (await internalCatalog(loader)).map(({ expr: _expr, kind: _kind, ...field }) => field);
}

const strings = (value: unknown, limit: number): string[] => (Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter((item) => item !== "").slice(0, limit) : []);

/**
 * Which report column holds the account names, and which the product names: the column whose values are found in the account master (the product
 * master) the most, at least half of them. `candidates` carry a sample of each text column's distinct values.
 */
export async function detailIdentity(loader: Loader, candidates: unknown): Promise<DetailIdentity> {
  const schema = loader.session.companySchema;
  const list = Array.isArray(candidates) ? candidates.slice(0, 16).map((item) => ({ key: String((item as Row)?.key ?? ""), values: strings((item as Row)?.values, 80) })).filter((item) => item.key !== "" && item.values.length > 0) : [];
  let account: { key: string; share: number } | null = null;
  let product: { key: string; share: number } | null = null;
  for (const candidate of list) {
    const names = [...new Set(candidate.values)];
    const found = async (sql: string) => Number((await loader.readTable(sql, [names]))?.[0]?.n ?? 0);
    const accounts = await found(`SELECT count(DISTINCT btrim(name)) AS n FROM ${schema}.account WHERE COALESCE(a_pos, '') <> 'D' AND btrim(name) = ANY($1::text[])`);
    const products = await found(`SELECT count(DISTINCT btrim(prod_desc)) AS n FROM ${schema}.product_master WHERE COALESCE(prod_pos, '') <> 'D' AND btrim(prod_desc) = ANY($1::text[])`);
    if (accounts / names.length >= 0.5 && (!account || accounts / names.length > account.share)) account = { key: candidate.key, share: accounts / names.length };
    if (products / names.length >= 0.5 && (!product || products / names.length > product.share)) product = { key: candidate.key, share: products / names.length };
  }
  // One column cannot be both: the better match keeps it.
  if (account && product && account.key === product.key) { if (account.share >= product.share) product = null; else account = null; }
  return { account: account?.key ?? null, product: product?.key ?? null };
}

/** The values of the ticked fields for the names / keys the screen asks about. */
export async function detailValues(loader: Loader, request: DetailRequest): Promise<DetailValues> {
  const schema = loader.session.companySchema;
  const catalog = await internalCatalog(loader);
  const wanted = new Set(strings(request?.fields, 200));
  const pick = (section: DetailSection) => catalog.filter((field) => field.section === section && wanted.has(field.id));
  const out: { acc: Record<string, Record<string, string>>; prod: Record<string, Record<string, string>>; ent: Record<string, Record<string, string>> } = { acc: {}, prod: {}, ent: {} };

  const run = async (section: DetailSection, sql: string, params: unknown[], fields: Internal[]) => {
    const rows = await loader.readTable(sql, params) ?? [];
    for (const row of rows) {
      const key = text(row, "k");
      if (key === "" || out[section][key]) continue;
      out[section][key] = Object.fromEntries(fields.map((field, at) => [field.id, text(row, `f${at}`)]));
    }
  };
  const select = (fields: Internal[]) => fields.map((field, at) => `${field.expr} AS f${at}`).join(", ");

  const accFields = pick("acc");
  const accNames = strings(request?.accountNames, MAX_KEYS);
  if (accFields.length > 0 && accNames.length > 0) {
    await run("acc",
      `SELECT btrim(a.name) AS k, ${select(accFields)} FROM ${schema}.account a
       LEFT JOIN LATERAL (SELECT * FROM ${schema}.address x WHERE x.code = a.code AND COALESCE(x.defa_add, '') = 'Y' ORDER BY x.address_id LIMIT 1) ad ON true
       LEFT JOIN ${schema}.balsheet bs ON bs.bs_key = a.bs_id
       LEFT JOIN LATERAL (SELECT * FROM ${schema}.addon_data y WHERE y.code = a.code LIMIT 1) d ON true
       WHERE COALESCE(a.a_pos, '') <> 'D' AND btrim(a.name) = ANY($1::text[]) ORDER BY a.code`, [accNames], accFields);
  }
  const prodFields = pick("prod");
  const prodNames = strings(request?.productNames, MAX_KEYS);
  if (prodFields.length > 0 && prodNames.length > 0) {
    await run("prod",
      `SELECT btrim(p.prod_desc) AS k, ${select(prodFields)} FROM ${schema}.product_master p
       LEFT JOIN LATERAL (SELECT * FROM ${schema}.addon_data y WHERE y.prod_id = p.prod_key LIMIT 1) d ON true
       WHERE COALESCE(p.prod_pos, '') <> 'D' AND btrim(p.prod_desc) = ANY($1::text[]) ORDER BY p.prod_key`, [prodNames], prodFields);
  }
  const entFields = pick("ent");
  const ledKeys = Array.isArray(request?.ledKeys) ? [...new Set(request.ledKeys.map((key) => Math.trunc(Number(key))).filter((key) => key > 0))].slice(0, MAX_KEYS * 5) : [];
  if (entFields.length > 0 && ledKeys.length > 0) {
    await run("ent",
      `SELECT l.led_key::text AS k, ${select(entFields)} FROM ${schema}.ledger l
       LEFT JOIN LATERAL (SELECT * FROM ${schema}.addon_aentry z WHERE z.aona_ledid = l.led_key LIMIT 1) e ON true
       WHERE l.led_key = ANY($1::int[])`, [ledKeys], entFields);
  }
  return out;
}
