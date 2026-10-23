import { displayValue, Loader } from "../master-program/load";
import { formatDesktopDate, parseDesktopDate, toDecimal, toText } from "../master-program/legacy";
import { SYSTEM_SCHEMA } from "../master-program/session";

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
export type PartyStock = Readonly<{ title: string; /** The window caption when it is not PARTYWISE STOCK (the product-fixed views). */ caption?: string; columns: readonly StockColumn[]; rows: readonly Readonly<Record<string, string>>[] }>;

const figure = (value: unknown, digits: number) => { const n = toDecimal(value); return n === 0 ? "" : n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }); };
const dateOf = (value: unknown) => (value instanceof Date ? formatDesktopDate(value) : toText(value).trim());

/**
 * code > 0, prodKey 0: the F7 of the account help (one party, every product, oldest first).
 * prodKey > 0: the F7 of the product help (code > 0: that party's lines of that product) and of the Rate cell (code 0: that product
 * across every party, with a Party column); both newest first, by date descending, and only the LOOKBACK_DAYS before the invoice date
 * (asOf): when that reaches into the previous accounting year, its database (a schema of its own) is read for the rest.
 */
const LOOKBACK_DAYS = 180;
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export async function partyStock(loader: Loader, code: number, prodKey = 0, asOf = ""): Promise<PartyStock> {
  const { session } = loader;
  const account = code > 0 ? (await loader.readTable(`SELECT name FROM |sys.db|account WHERE code = $1`, [code]))?.[0] : undefined;
  if (code > 0 && !account) throw new Error("The account is not in the account master");
  const product = prodKey > 0 ? (await loader.readTable(`SELECT prod_desc FROM |sys.db|product_master WHERE prod_key = $1`, [prodKey]))?.[0] : undefined;
  if (prodKey > 0 && !product) throw new Error("The product is not in the product master");
  const lookback = prodKey > 0;
  const upto = lookback ? parseDesktopDate(asOf) ?? new Date() : null;
  const since = upto ? new Date(upto.getFullYear(), upto.getMonth(), upto.getDate() - LOOKBACK_DAYS) : null;
  type Source = { prefix: string; label: string };
  const sources: Source[] = [{ prefix: "|sys.db|", label: "cur" }];
  let priorSchema: string | null = null;
  if (since && since < session.tarikh1) {
    const year = session.tarikh1;
    const found = (await loader.client.query(
      `SELECT LOWER(BTRIM(c.co_dataname)) AS schema_name FROM ${SYSTEM_SCHEMA}.company c JOIN ${SYSTEM_SCHEMA}.cname n ON n.c_id = c.co_key JOIN ${SYSTEM_SCHEMA}.year_ac y ON y.year_key = n.c_yearid
       WHERE c.co_pos = 'A' AND BTRIM(c.name) = $1 AND y.year_start::date = $2::date AND LOWER(BTRIM(c.co_dataname)) <> $3 AND LOWER(BTRIM(c.co_dataname)) ~ '^[a-z_][a-z0-9_]*$'
         AND EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = LOWER(BTRIM(c.co_dataname))) ORDER BY c.co_key DESC LIMIT 1`,
      [session.companyName, iso(new Date(year.getFullYear() - 1, year.getMonth(), year.getDate())), session.companySchema])).rows[0];
    priorSchema = found ? String(found.schema_name) : null;
    if (priorSchema) sources.push({ prefix: `${priorSchema}.`, label: "prior" });
  }

  type Line = Row & { src: string };
  const lines: Line[] = [];
  const slabOrder = new Map<number, string>();
  const slabOf = new Map<string, Map<number, { amt: number; perc: number }>>();
  for (const source of sources) {
    const params: unknown[] = [];
    const filters: string[] = [];
    if (source.label === "cur") { params.push(session.yearId); filters.push(`i.year_id = $${params.length}`); }
    if (code > 0) { params.push(code); filters.push(`l.code = $${params.length}`); }
    if (prodKey > 0) { params.push(prodKey); filters.push(`i.prod_id = $${params.length}`); }
    if (since && upto) {
      params.push(iso(since)); filters.push(`i.il_date >= $${params.length}::date`);
      params.push(iso(upto)); filters.push(`i.il_date < ($${params.length}::date + 1)`);
    }
    // A line carried into this year keeps the key of the one it came from (TRF_ILKEY): it is shown once, from this year.
    if (source.label === "prior") filters.push(`NOT EXISTS (SELECT 1 FROM |sys.db|prod_ledger t WHERE t.trf_ilkey = i.il_key AND t.prod_id = i.prod_id)`);
    const part = (await loader.readTable(
      `SELECT i.il_key, i.prod_id, i.il_date, l.full_docno, pm.prod_desc, a.name AS party_name, bp.book_desc AS book_name, i.stock_nat, i.quantity::numeric - i.ag_qty::numeric AS qty, i.rate::numeric AS rate, i.il_value::numeric AS value
       FROM ${source.prefix}prod_ledger i JOIN ${source.prefix}ledger l ON l.led_key = i.led_id JOIN ${source.prefix}product_master pm ON pm.prod_key = i.prod_id LEFT JOIN ${source.prefix}account a ON a.code = l.code LEFT JOIN ${source.prefix}book_properties bp ON bp.book_key = l.book
       WHERE ${filters.length > 0 ? `${filters.join(" AND ")} AND ` : ""}coalesce(i.il_pos, '') <> 'D' AND coalesce(l.doc_pos, '') <> 'D' AND i.inventory = 'Y' AND pm.inventory = 'Y'
       ORDER BY ${prodKey > 0 ? "i.il_date DESC, i.doc_no1 DESC, i.il_key DESC" : "i.il_date, i.doc_no1, i.il_key"}`, params)) ?? [];
    const tagged = part.map((line): Line => ({ ...line, src: source.label }));
    lines.push(...tagged);
    const keys = tagged.map((line) => Number(field(line, "il_key")));
    const slabRows = keys.length === 0 ? [] : (await loader.readTable(
      `SELECT e.il_id, m.slab_key, m.slab_short, e.slab_perc::numeric AS perc, e.slab_amt::numeric AS amt
       FROM ${source.prefix}ledger_ext e JOIN ${source.prefix}slab_master m ON m.slab_key = e.slab_id
       WHERE e.il_id = ANY($1::int[]) AND m.slab_pos = 'P' ORDER BY m.slab_key`, [keys])) ?? [];
    for (const row of slabRows) {
      const line = `${source.label}:${Number(field(row, "il_id"))}`;
      const slab = Number(field(row, "slab_key"));
      slabOrder.set(slab, toText(field(row, "slab_short")).trim());
      const per = slabOf.get(line) ?? new Map<number, { amt: number; perc: number }>();
      const before = per.get(slab) ?? { amt: 0, perc: 0 };
      per.set(slab, { amt: before.amt + toDecimal(field(row, "amt")), perc: before.perc + toDecimal(field(row, "perc")) });
      slabOf.set(line, per);
    }
  }
  // Only the slabs that carry a figure in these lines are columns.
  const slabs = [...slabOrder.keys()].filter((slab) => [...slabOf.values()].some((per) => (per.get(slab)?.amt ?? 0) !== 0 || (per.get(slab)?.perc ?? 0) !== 0));

  const products = [...new Set(lines.map((line) => Number(field(line, "prod_id"))))];
  // The Rate cell's view (one product, every party): the product is in the title, so no Product column and no addon fields.
  const rateView = prodKey > 0 && code === 0;
  const addonFields = products.length === 0 || rateView ? [] : (await loader.readTable(`SELECT fiel_desc, fiel_save FROM |sys.db|addon_fld WHERE fiel_relate = 'P' AND fiel_pos <> 'D' ORDER BY fiel_key`)) ?? [];
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
    { key: "date", caption: "Date", align: "L" }, { key: "docNo", caption: "Doc No", align: "L" },
    ...(code === 0 ? [{ key: "party", caption: "Party", align: "L" } as StockColumn] : []),
    ...(rateView ? [{ key: "book", caption: "Book", align: "L" } as StockColumn] : [{ key: "product", caption: "Product", align: "L" } as StockColumn]),
    { key: "addQty", caption: "Add Qty", align: "R" }, { key: "lessQty", caption: "Less Qty", align: "R" }, { key: "rate", caption: "Rate", align: "R" }, { key: "value", caption: "Value", align: "R" },
    ...slabs.flatMap((slab): StockColumn[] => [{ key: `slab_${slab}`, caption: slabOrder.get(slab) ?? "", align: "R" }, { key: `slab_${slab}_perc`, caption: `${slabOrder.get(slab) ?? ""} %`, align: "R" }]),
    ...addons.map((addon): StockColumn => ({ key: addon.key, caption: addon.caption, align: "L" })),
  ];
  const rows = lines.map((line) => {
    const out: Record<string, string> = {
      date: dateOf(field(line, "il_date")), docNo: toText(field(line, "full_docno")).trim(), party: toText(field(line, "party_name")).trim(), book: toText(field(line, "book_name")).trim(), product: toText(field(line, "prod_desc")).trim(),
      addQty: toText(field(line, "stock_nat")) === "A" ? figure(field(line, "qty"), 3) : "", lessQty: toText(field(line, "stock_nat")) === "L" ? figure(field(line, "qty"), 3) : "",
      rate: figure(field(line, "rate"), 2), value: figure(field(line, "value"), 2),
    };
    const per = slabOf.get(`${line.src}:${Number(field(line, "il_key"))}`);
    for (const slab of slabs) { out[`slab_${slab}`] = figure(per?.get(slab)?.amt, 2); out[`slab_${slab}_perc`] = figure(per?.get(slab)?.perc, 2); }
    const data = addonData.get(Number(field(line, "prod_id")));
    for (const addon of addons) out[addon.key] = data ? addonColumn(data, addon.save) : "";
    return out;
  });
  const partyName = account ? toText(field(account, "name")).trim() : "";
  const productName = product ? toText(field(product, "prod_desc")).trim() : "";
  if (!product) return { title: partyName, columns, rows };
  return { title: partyName ? `${partyName} · ${productName}` : productName, caption: partyName ? "PARTY-PRODUCT STOCK" : "PRODUCT STOCK (ALL PARTIES)", columns, rows };
}
