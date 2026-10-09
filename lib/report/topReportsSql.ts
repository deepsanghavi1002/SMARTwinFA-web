/**
 * SP_FRT_RPT_TOP_REPORTS' SQL, apart from the database (so it can be tested on its own): which of its five reports the first combo names, and
 * each one's select. PostgreSQL; the SQL Server original is quoted where it differs. `from` and `upto` are SQL date literals.
 */
export type TopMode = "party" | "value" | "quantity";

export type TopPlan = { book: 8 | 13; mode: TopMode };

/** Customers, Suppliers: the parties by amount; Item Sold / Purchase by Value: the products by value; Item Sold / Purchase by Quantity: the products by quantity. Sale for the three of the sale. */
export function topPlan(firstText: string): TopPlan {
  const text = firstText.trim().toLowerCase();
  const sale = text === "customers" || text === "item sold by value" || text === "item sold by quantity";
  const mode: TopMode = text === "customers" || text === "suppliers" ? "party" : text === "item sold by value" || text === "item purchase by value" ? "value" : "quantity";
  return { book: sale ? 8 : 13, mode };
}

/** A master addon field (FIEL_SAVE) as a column: COALESCE(adata.txt_X,'') AS "X" for the select, adata.txt_X for the group by. */
export const addonSelect = (fields: readonly string[]): string => fields.map((name) => `COALESCE(adata.txt_${name},'') AS "${name}"`).join(",");
export const addonGroup = (fields: readonly string[]): string => fields.map((name) => `adata.txt_${name}`).join(",");

type Dates = { from: string; upto: string };

/** The parties by amount: the sale (book 8) with its credit notes taken off, the purchase (13) with its debit notes. The net amount (before tax) when the book has a first tax slab. */
export function partyQuery(db: string, plan: TopPlan, slab: number, addons: readonly string[], dates: Dates, yearId: string): string {
  const sale = plan.book === 8;
  const returnBook = sale ? 16 : 11;
  const base = slab > 0 ? "(S_LASTOT::numeric-SLAB_AMT::numeric)" : "led.amount::numeric";
  const signed = `sum(case when led.ag_book=${plan.book} and led.book=${returnBook} then ${base}*-1 else ${base} end)`;
  const withAddons = sale && addons.length > 0;
  const quantity = `coalesce((select sum(quantity::numeric-ag_qty::numeric) from ${db}PROD_LEDGER where code=led.code and il_pos='A' and book = ${plan.book} and IL_DATE between ${dates.from} AND ${dates.upto} and inventory='Y' and led_id>0),0)`;
  const books = sale ? "8,16,11" : "13,16,11";
  return `select led.code AS "code",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",ac.name AS "name",${signed} AS "amount",acbal.closing::numeric AS "clsg_bal",count(*) AS "No_Of_invoice",${quantity} AS "Quantity"${withAddons ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}LEDGER led left join ${db}ACCOUNT ac on ac.code = led.code left join ${db}AC_BALANCE acbal on acbal.code = ac.code and acbal.year_id = '${yearId.replace(/'/g, "''")}' and acbal.a_recflag = 'AC'`
    + `${withAddons ? ` left join ${db}ADDON_DATA adata on ac.code = adata.code` : ""}${slab > 0 ? ` inner join ${db}LEDGER_EXT ledext on ledext.led_id=led.led_key and ledext.il_id is null and ledext.slab_id=${Math.trunc(slab)}` : ""}`
    + ` where led.doc_pos<>'D' and ac.a_pos<>'D' and led.doc_posting = 'P' and ac.book=${sale ? 2 : 3} and led.doc_date between ${dates.from} AND ${dates.upto}`
    + ` and led.book in (${books}) and (led.ag_book=${plan.book} or coalesce(led.ag_book,0)=0) group by led.code,ac.name,acbal.closing${withAddons ? `,${addonGroup(addons)}` : ""} order by amount desc`;
}

/** The products by value (IL_VALUE), the sale less its credit notes or the purchase less its debit notes. */
export function valueQuery(db: string, plan: TopPlan, addons: readonly string[], dates: Dates): string {
  const sale = plan.book === 8;
  const signed = `sum(case when prodled.book=${sale ? 16 : 11} then il_value::numeric*-1 else il_value::numeric end)`;
  return `select prodled.prod_id AS "code",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",prodmas.prod_desc AS "name",${signed} AS "amount"${addons.length > 0 ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodled.prod_id left join ${db}ACCOUNT ac on ac.code = prodled.code${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""}`
    + ` where prodled.il_pos<>'D' and prodled.inventory='Y' and prodmas.prod_pos<>'D' and ac.a_pos<>'D' and prodled.quantity::numeric-prodled.ag_qty::numeric>0 and prodled.il_value::numeric > 0 and prodled.il_date between ${dates.from} AND ${dates.upto}`
    + ` and prodled.book in (${sale ? "8,16" : "13,11"}) and (prodled.led_id>0 or prodled.trn_module='${sale ? "CHLN-OUT" : "CHLN-IN"}') group by prodled.prod_id,prodmas.prod_desc${addons.length > 0 ? `,${addonGroup(addons)}` : ""} order by amount desc`;
}

/** The products' closing stock in the report's unit (REP1_UOM picks which of the balance's quantities). */
export const CLOSING_STOCK = "case when prodmas.rep1_uom=prodmas.pcs_uom then prodbal.clsg_pcs when prodmas.rep1_uom=prodmas.qty1_uom then prodbal.clsg_qty1 when prodmas.rep1_uom=prodmas.qty2_uom then prodbal.clsg_qty2 when prodmas.rep1_uom=prodmas.qty3_uom then prodbal.clsg_qty3 when prodmas.rep1_uom=prodmas.pack_uom then prodbal.clsg_pack when prodmas.rep1_uom=prodmas.weight_uom then prodbal.clsg_weight else prodbal.clsg_pcs end";

/** The products by quantity (licence 2 counts the first quantity column), with the closing stock. */
export function quantityQuery(db: string, plan: TopPlan, licence: number, addons: readonly string[], dates: Dates): string {
  const sale = plan.book === 8;
  const returnBook = sale ? 16 : 11;
  const signed = licence === 2
    ? `sum(case when prodled.book=${returnBook} then trn_qty1::numeric*-1 else trn_qty1::numeric end)`
    : `sum(case when prodled.book=${returnBook} then prodled.quantity::numeric*-1 else prodled.quantity::numeric-prodled.ag_qty::numeric end)`;
  const groupUnits = "prodmas.rep1_uom,prodmas.pcs_uom,prodmas.qty1_uom,prodmas.qty2_uom,prodmas.qty3_uom,prodmas.pack_uom,prodmas.weight_uom,prodbal.clsg_pcs,prodbal.clsg_qty1,prodbal.clsg_qty2,prodbal.clsg_qty3,prodbal.clsg_pack,prodbal.clsg_weight";
  return `select prodled.prod_id AS "prod_id",ROW_NUMBER() OVER (ORDER BY ${signed} DESC) AS "Row_No",prodmas.prod_desc AS "name",${signed} AS "Quantity",(${CLOSING_STOCK})::numeric AS "Clsg_Stock"${addons.length > 0 ? `,${addonSelect(addons)}` : ""}`
    + ` from ${db}PROD_LEDGER prodled left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodled.prod_id left join ${db}ACCOUNT ac on ac.code = prodled.code left join ${db}PROD_BALANCE prodbal on prodbal.prod_id = prodmas.prod_key${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""}`
    + ` where prodled.il_pos<>'D' and prodled.inventory='Y' and prodbal.prec_flag='RP' and prodmas.prod_pos<>'D' and ac.a_pos<>'D' and prodled.quantity::numeric-prodled.ag_qty::numeric>0 and prodled.il_date between ${dates.from} AND ${dates.upto}`
    + ` and prodled.book in (${sale ? "8,16" : "13,11"}) and (prodled.led_id>0 or prodled.trn_module='${sale ? "CHLN-OUT" : "CHLN-IN"}') group by prodled.prod_id,prodmas.prod_desc,${groupUnits}${addons.length > 0 ? `,${addonGroup(addons)}` : ""} order by "Quantity" desc`;
}

/** Licence 51 lists what has no sale or purchase too, after those that have, with 0 for Row_No and the figures. */
export function absentQuery(db: string, plan: TopPlan, addons: readonly string[]): string {
  const addonColumns = addons.length > 0 ? `,${addonSelect(addons)}` : "";
  if (plan.mode === "party") {
    return `select ac.code AS "code",0 AS "Row_No",ac.name AS "name",0 AS "amount",acbal.closing::numeric AS "clsg_bal",0 AS "No_Of_invoice",0 AS "Quantity"${plan.book === 8 ? addonColumns : ""}`
      + ` from ${db}ACCOUNT ac left join ${db}AC_BALANCE acbal on acbal.code = ac.code${plan.book === 8 && addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.code = ac.code` : ""} where ac.a_pos<>'D' and ac.book=${plan.book === 8 ? 2 : 3}`;
  }
  const base = plan.mode === "value"
    ? `select prodmas.prod_key AS "code",0 AS "Row_No",prodmas.prod_desc AS "name",0 AS "amount"${addonColumns}`
    : `select prodbal.prod_id AS "prod_id",0 AS "Row_No",prodmas.prod_desc AS "name",0 AS "Quantity",(${CLOSING_STOCK})::numeric AS "Clsg_Stock"${addonColumns}`;
  const from = plan.mode === "value"
    ? ` from ${db}PRODUCT_MASTER prodmas left join ${db}PROD_BALANCE prodbal on prodbal.prod_id = prodmas.prod_key${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""} where prodmas.prod_pos<>'D' and prodbal.prec_flag='RP'`
    : ` from ${db}PROD_BALANCE prodbal left join ${db}PRODUCT_MASTER prodmas on prodmas.prod_key = prodbal.prod_id${addons.length > 0 ? ` left join ${db}ADDON_DATA adata on adata.prod_id = prodmas.prod_key` : ""} where prodbal.prec_flag='RP' and prodmas.prod_pos<>'D' and prodmas.inventory = 'Y' and prodbal.clsg_pcs::numeric>0`;
  return base + from;
}
