import type { SysContext } from "./load";

/**
 * Small_Entry.cs, the `int_Small_Entry_Id == n` changes the desktop makes to a grid query
 * before it runs it (after fill_control_query, before ReplaceSysValueinQuery): date ranges,
 * Add / Update filters, |sys.ent_date| / |sys.plan_date| and the sort order. One place for
 * every entry, so an entry's grid fills the same as the desktop's without its own code.
 *
 * Dates go in as 'dd/MMM/yyyy', as the desktop writes them; PostgreSQL reads that form.
 * Entries 19, 69 and 79 rebuild their query in C# and 107 needs the chosen account; those
 * are reported, not guessed.
 */

export type GridSqlInput = Readonly<{
  context: SysContext;
  /** A header date as the desktop's dtp_Date / dtp_Date2 hold it (dd/MMM/yyyy), shown or not. */
  date: (name: "dtp_date" | "dtp_date2" | "dtp_date3") => string;
}>;

export type GridSqlResult = Readonly<{ sql: string; warnings: string[] }>;

/** Entries whose grid query the desktop builds in code; the web cannot fill them yet. */
const REBUILT_IN_CODE: Readonly<Record<number, string>> = {
  19: "Outstanding Allocation builds two grids from the query in code",
  69: "Product Colour Allocate builds a BOM tree query in code",
  79: "Store Despatch builds its query from the job card in code",
  107: "Challan Transfer Less needs the account chosen on the desktop form",
};

export function entryGridSql(source: string, input: GridSqlInput): GridSqlResult {
  const { context } = input;
  const { entryId, session } = context;
  const warnings: string[] = [];
  let sql = source;
  const option = (n: 1 | 2 | 3) => (context.state.controls[`cmb_smallentry${n}`] ?? "").trim();
  const from = `'${input.date("dtp_date")}'`;
  const upto = `'${input.date("dtp_date2")}'`;
  const between = (column: string) => ` ${column} between ${from} and ${upto}`;
  const swap = (token: string, value: string) => { sql = sql.split(token).join(value); };

  if (REBUILT_IN_CODE[entryId]) warnings.push(`${REBUILT_IN_CODE[entryId]}; not ported to the web yet`);

  switch (entryId) {
    case 4: // Sales Tax Form: Add lists bills without a form number, Update those with one.
      if (option(2) === "Add") swap("  order by a.DOC_DATE,a.FULL_DOCNO", " and (a.FORM_NUMBER is null or a.FORM_NUMBER = '') order by a.DOC_DATE,a.FULL_DOCNO");
      else if (option(2) === "Update") swap("  order by a.DOC_DATE,a.FULL_DOCNO", " and a.FORM_NUMBER is not null and a.FORM_NUMBER <> '' order by a.DOC_DATE,a.FULL_DOCNO");
      break;
    case 9:
      if (option(2) === "Update" && sql.includes("ledger")) sql += " order by a.doc_DATE";
      break;
    case 11: // Godown Opening, licence 14 lists the product description.
      if (session.licence === 14) swap("prodmast.prod_short", "prodmast.prod_desc");
      break;
    case 18:
      if (option(2) === "Add") swap(" order by a.p_DATE,a.DOC_NO2", " and (left(entry_no1,1)='N' or entry_no1 is null or entry_no1 = '') order by a.p_DATE,a.DOC_NO2");
      break;
    case 20:
      sql += ` and${between("g.post_date")} order by a.prod_id`;
      break;
    case 22:
      sql += ` and${between("g.doc_date")} order by g.doc_no,a.il_serial`;
      break;
    case 23:
      if (option(2) === "Add") swap(" order by a.p_DATE,a.doc_no2", " and (left(entry_no2,1)='N' or entry_no2 is null or entry_no2 = '') order by a.p_DATE,a.doc_no2");
      break;
    case 28:
      if (!session.companySchema.toUpperCase().includes("SHAH_TRADING_INV")) {
        sql += option(2) !== "Update" ? ` and left(a.p_docseries,2)='${option(2).slice(0, 2).replace(/'/g, "''")}' order by b.name,a.p_DATE,a.DOC_NO2` : " order by b.name,a.p_DATE,a.DOC_NO2";
      }
      break;
    case 32:
    case 43: // Entry Approved: Add lists the entries not approved yet, Update the approved ones.
      swap("|sys.yes_no|", context.entryNat === "A" ? " (left(a.ent_approve,1)='N' or a.ent_approve is null or a.ent_approve = '')" : " left(a.ent_approve,1)='Y'");
      break;
    case 33: // Party Allot Stock Split: orders up to Date Upto.
      sql += ` and g.p_date<=${from} order by b.name,g.p_date,g.doc_no2`;
      break;
    case 39: // Sale Order Allocate: orders up to Date Upto, by product.
      sql += ` and g.p_date<=${from} order by c.prod_Desc`;
      break;
    case 35:
    case 40:
    case 48:
    case 54: // Production Planing (and its checking / short / stock value): the plan of the Entry Date.
      swap("|sys.ent_date|", ` and prodplan.ent_date=${from}`);
      swap("|sys.plan_date|", from);
      break;
    case 38: // Payment Allotment, Overdue: past the party's credit days (SQL Server datediff(d, a, b) is b - a here).
      if (option(3) === "Overdue") swap(" order by name,doc_Date", " and (|sys.last_savedate|::date - c.chln_date::date + 1) > b.credit_days order by name,doc_Date");
      break;
    case 50:
    case 59:
      swap("|sys.ent_date|", ` and prodled.il_date=${from} and prodled.il_prodcd='${(context.state.firstCombo?.text ?? "").replace(/'/g, "''")}'`);
      break;
    case 61:
    case 62:
      swap("|sys.ent_date|", ` and entry_date=${from}`);
      break;
    case 63:
      swap(" order by b.led_id,b.il_serial", ` and${between("doc_date")} order by d.txt_PLATING`);
      break;
    case 109:
      sql += option(2) === "Add" ? " and prodled.etd_date is null and (prodled.ent_close is null or prodled.ent_close='NO')" : " and prodled.etd_date is not null and (prodled.ent_close is null or prodled.ent_close='NO')";
      sql += ` and${between("prodled.il_date")} order by prodled.il_date`;
      break;
    case 110:
      if (option(1) === "Update") swap("(prodled.ent_close is null or prodled.ent_close='NO') |sys.ent_date| order by prodled.il_date,brand_name", `ent_close='YES' and  prodled.desp_date=${from} order by prodled.il_date,brand_name`);
      else if (option(1) === "Add") swap("|sys.ent_date|", "");
      break;
    case 111:
      if (option(1) === "Update") swap("|sys.ent_date|", ` prodled.il_date=${from}`);
      else if (option(1) === "Add") swap(" where |sys.ent_date|", " where 1=0");
      break;
    case 112:
      if (option(1) === "Update") swap("|sys.ent_date|", `${between("plan_date")} and coalesce(ent_approve,'')='Yes'`);
      else if (option(1) === "Add") swap("|sys.ent_date|", `${between("plan_date")} and coalesce(ent_approve,'')=''`);
      break;
    case 114: // Packing In: Update shows what was taken in; Add starts the taken quantity at nothing.
      if (option(1) === "Update") {
        swap(" and a.quantity>coalesce(a.ag_qty,0)", " and coalesce(a.ag_qty,0)>0");
        swap("case when coalesce(a.ag_qty,0)=0 then coalesce(a.ag_qty,0) else a.quantity-coalesce(a.ag_qty,0) end", "coalesce(a.ag_qty,0)");
        swap("case when coalesce(a.ag_qty,0)=0 then coalesce(a.quantity,0) else a.quantity-coalesce(a.ag_qty,0) end", "coalesce(a.quantity,0)");
      } else {
        swap("case when coalesce(a.ag_qty,0)=0 then coalesce(a.ag_qty,0) else a.quantity-coalesce(a.ag_qty,0) end", "case when coalesce(a.ag_qty,0)=0 then coalesce(a.ag_qty,0) else 0 end");
      }
      break;
  }
  return { sql, warnings };
}
