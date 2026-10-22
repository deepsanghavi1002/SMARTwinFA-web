import type { RepostContext } from "./context";
import { run, scalar, typeColumn } from "./context";

/** The six quantities of a product line the balance keeps, as the procedure names them (the balance column, the line column). */
const FIELDS = [["pcs", "trn_pcs"], ["pack", "trn_pack"], ["weight", "trn_weight"], ["qty1", "trn_qty1"], ["qty2", "trn_qty2"], ["qty3", "trn_qty3"]] as const;

/** SP_REPOST_DATA, @bit_product = 1: the product balances (opening, receipt, issue, closing) of the year again from the product lines. */
export async function repostProduct(ctx: RepostContext): Promise<void> {
  const { sch: s, yearId: y, from: f, to: t, licence } = ctx;
  const q = (step: string, sql: string) => run(ctx, step, sql);
  ctx.log("Product posting");

  if (licence === 7) await q("Scheme rows", `DELETE FROM ${s}.scheme WHERE sch_mastcd IN (SELECT sub_code FROM ${s}.addon_sub WHERE coalesce(address_1, '') = '')`);
  if (licence === 5) await q("Product links of deleted vouchers", `DELETE FROM ${s}.prod_link WHERE led_rec2 IN (SELECT led_key FROM ${s}.ledger WHERE doc_pos = 'D')`);
  await q("Price list rows of nothing", `DELETE FROM ${s}.pricelist WHERE coalesce(pl_prate, 0) = 0 AND coalesce(pl_srate, 0) = 0 AND coalesce(pl_mrp, 0) = 0 AND coalesce(pl_slabperc, 0) = 0`);

  if (licence === 21) {
    await q("Product line division", `UPDATE ${s}.prod_ledger prodled SET il_div = adata.key_prodtype FROM (SELECT DISTINCT ON (prod_id) prod_id, key_prodtype FROM ${s}.addon_data WHERE prod_id > 0 ORDER BY prod_id, aon_key) adata WHERE prodled.prod_id = adata.prod_id AND prodled.il_pos = 'A' AND prodled.il_div IS DISTINCT FROM adata.key_prodtype`);
    await q("Against quantity", `UPDATE ${s}.prod_ledger SET ag_qty = 0 WHERE ag_qty <> 0 AND ag_fact = 0 AND setof_qty = 0 AND il_key NOT IN (SELECT iled_rec1 FROM ${s}.prod_link WHERE iled_rec1 IS NOT NULL)`);
    await q("Pieces", `UPDATE ${s}.prod_ledger SET trn_pcs = quantity WHERE quantity > 0 AND trn_pcs = 0 AND il_pos = 'A'`);
    await q("Factor", `UPDATE ${s}.prod_ledger SET factor = quantity WHERE quantity > 0 AND factor = 0 AND il_pos = 'A'`);
    await q("Orders and quotations not in stock", `UPDATE ${s}.prod_ledger SET inventory = 'N' WHERE (trn_module = 'ORD-OUT' OR trn_module = 'ORD-IN' OR trn_module = 'QTN-PURCH' OR trn_module = 'IND-PURCH') AND inventory = 'Y'`);
    await q("Order bills in stock", `UPDATE ${s}.prod_ledger SET inventory = 'Y' WHERE trn_module = 'LORD-BILL' AND il_pos = 'A' AND inventory = 'N'`);
    const same = "factor = quantity, trn_qty1 = quantity, trn_qty2 = quantity, trn_qty3 = quantity, trn_pcs = quantity, trn_weight = quantity, trn_pack = quantity";
    await q("Quantities of unit 13", `UPDATE ${s}.prod_ledger SET ${same} WHERE quantity <> trn_pcs AND il_pos = 'A' AND uomentry_id = 13 AND inventory = 'Y'`);
    await q("Quantities of units 13 and 5", `UPDATE ${s}.prod_ledger SET ${same} WHERE (quantity <> factor OR quantity <> trn_qty1 OR quantity <> trn_pcs) AND il_pos = 'A' AND (uomentry_id = 13 OR uomentry_id = 5) AND inventory = 'Y'`);
    await q("Production lines in stock", `UPDATE ${s}.prod_ledger SET inventory = 'Y' WHERE il_pos = 'A' AND inventory = 'N' AND (trn_module = 'PROD-FG' OR trn_module = 'STK-JV') AND process_id IN (SELECT process_key FROM ${s}.process WHERE ent_approve = 'Yes' AND (stk_module = 'PROD-FG' OR stk_module = 'STK-JV')) AND prod_id IN (SELECT prod_key FROM ${s}.product_master WHERE inventory = 'Y')`);
    await q("Against packs", `UPDATE ${s}.prod_ledger SET ag_pack = round(ag_qty / nullif(pack_qty, 0), 0) WHERE il_pos = 'A' AND ag_pack = 0 AND quantity - ag_qty > 0 AND ag_qty > 0 AND trn_module = 'ORD-OUT' AND pack_qty > 0`);
    await q("Against packs over the bundle", `UPDATE ${s}.prod_ledger SET ag_pack = round(ag_qty / nullif(pack_qty, 0), 0) WHERE il_pos = 'A' AND ag_pack > bundle AND ag_qty > 0 AND trn_module = 'ORD-OUT' AND pack_qty > 0`);
  }

  // The book of rate difference entries (stock method NR, actual X) is left out of the quantities; 44 when it is not set.
  const rateDiff = Number(await scalar(ctx, "Rate difference book", `SELECT book_key FROM ${s}.book_properties WHERE stkm_id = 'NR' AND stkm_pos <> 'D' AND book_actual = 'X' ORDER BY book_key DESC LIMIT 1`)) || 44;

  if (licence === 2) await q("Packs", `UPDATE ${s}.prod_ledger SET trn_pack = bundle WHERE trn_pack <> bundle`);
  if ([22, 28, 51, 68, 75].includes(licence)) await q("Tax product", `UPDATE ${s}.product_master SET txprod_id = prod_key WHERE coalesce(txprod_id, 0) = 0`);

  // A blank quantity becomes 0 (only the blank rows are written, all the columns in one pass).
  const blanks = ["open_qty1", "open_qty2", "open_qty3", "open_pcs", "open_pack", "open_weight", "clsg_qty1", "clsg_qty2", "clsg_qty3", "clsg_pcs", "clsg_pack", "clsg_weight"];
  await q("Blank opening and closing quantities", `UPDATE ${s}.prod_balance SET ${blanks.map((column) => `${column} = coalesce(${column}, 0)`).join(", ")} WHERE ${blanks.map((column) => `${column} IS NULL`).join(" OR ")}`);
  await q("Godown rows without a godown", `DELETE FROM ${s}.prod_balance WHERE prec_flag = 'GW' AND coalesce(nullif(i_mastcd::text, ''), '0') = '0' AND coalesce(nullif(i_paracd::text, ''), '0') = '0'`);

  // Receipt and issue to nothing, the closing back to the opening; products not kept in stock have no opening or closing.
  const kinds = `(prec_flag = 'RP' OR prec_flag = 'GW' OR prec_flag = 'BT') AND year_id = '${y}'`;
  await q("Receipt and issue to zero",
    `UPDATE ${s}.prod_balance SET add_qty1 = 0, add_qty2 = 0, add_qty3 = 0, add_pcs = 0, add_pack = 0, add_weight = 0, less_qty1 = 0, less_qty2 = 0, less_qty3 = 0, less_pcs = 0, less_pack = 0, less_weight = 0,`
    + ` clsg_qty1 = open_qty1, clsg_qty2 = open_qty2, clsg_qty3 = open_qty3, clsg_pcs = open_pcs, clsg_pack = open_pack, clsg_weight = open_weight WHERE ${kinds}`);
  await q("Products not in stock",
    `UPDATE ${s}.prod_balance SET open_qty1 = 0, open_qty2 = 0, open_qty3 = 0, open_pcs = 0, open_pack = 0, open_weight = 0, clsg_qty1 = 0, clsg_qty2 = 0, clsg_qty3 = 0, clsg_pcs = 0, clsg_pack = 0, clsg_weight = 0`
    + ` WHERE ${kinds} AND prod_id IN (SELECT prod_key FROM ${s}.product_master WHERE inventory = 'N')`);

  /**
   * One balance update: add_* from the receipts (stock nature A) and less_* from the issues (L) of the year's product lines.
   * `through` is the line module whose whole quantity counts (a job work line, the others count what is not set against); `godown`
   * joins the line's addon entry; `batch` matches the batch and expiry; `plain` is the form of the batch update (no quantity test, no case).
   */
  const prodType = await typeColumn(ctx, "prod_ledger");
  const balanceUpdate = (step: string, kind: "RP" | "GW" | "BT") => {
    const sets: string[] = [];
    for (const [nature, prefix, jobModule] of [["A", "add", "JOB-IN"], ["L", "less", "JOB-OUT"]] as const) {
      for (const [column, source] of FIELDS) {
        // The procedure's godown receipts name JOB-OUT in the case of add_pack and add_qty2, where the test above them names JOB-IN.
        const caseModule = kind === "GW" && nature === "A" && (column === "pack" || column === "qty2") ? "JOB-OUT" : jobModule;
        const amount = kind === "BT"
          ? `(b.${source}::numeric / nullif(b.quantity, 0)) * (b.quantity - b.ag_qty)`
          : `(b.${source}::numeric / nullif(b.quantity, 0)) * (CASE WHEN ltrim(rtrim(b.trn_module)) = '${caseModule}' THEN b.quantity ELSE (b.quantity - b.ag_qty) END)`;
        const quantityTest = kind === "BT"
          ? (nature === "A" && column === "pcs" ? "b.quantity - b.ag_qty > 0" : `(b.quantity - b.ag_qty > 0 OR b.trn_module = 'JOB-OUT')`)
          : `(b.quantity - b.ag_qty > 0 OR b.trn_module = '${jobModule}')`;
        const join = kind === "RP" ? "" : ` LEFT JOIN ${s}.addon_ientry a ON a.aoni_il_id = b.il_key`;
        const match = kind === "GW" ? ` AND a.key_godown::text = ${s}.prod_balance.i_paracd::text` : kind === "BT" ? ` AND a.input_batch_no = ${s}.prod_balance.addon_input1 AND a.input_expiry_date = ${s}.prod_balance.expiry_date` : "";
        sets.push(`${prefix}_${column} = ${prefix}_${column} + (SELECT sum(${amount}) FROM ${s}.prod_ledger b${join} WHERE b.stock_nat = '${nature}'${kind === "BT" ? "" : " AND b.quantity > 0"} AND b.il_pos = 'A'${prodType ? ` AND b.${prodType} <> ${rateDiff}` : ""}`
          + ` AND b.il_date >= '${f}' AND b.il_date <= '${t}'${match} AND b.prod_id = ${s}.prod_balance.prod_id AND ${quantityTest} AND b.inventory = 'Y')`);
      }
    }
    return q(step, `UPDATE ${s}.prod_balance SET ${sets.join(", ")} WHERE prec_flag = '${kind}' AND year_id = '${y}'`);
  };
  // The products' own balance rows: every receipt and issue summed in one read of the product lines, then applied to the rows (a row with no line keeps its zeros).
  {
    const picks: string[] = [];
    const sets: string[] = [];
    for (const [nature, prefix, jobModule] of [["A", "add", "JOB-IN"], ["L", "less", "JOB-OUT"]] as const) {
      for (const [column, source] of FIELDS) {
        const amount = `(b.${source}::numeric / nullif(b.quantity, 0)) * (CASE WHEN ltrim(rtrim(b.trn_module)) = '${jobModule}' THEN b.quantity ELSE (b.quantity - b.ag_qty) END)`;
        picks.push(`sum(${amount}) FILTER (WHERE b.stock_nat = '${nature}' AND (b.quantity - b.ag_qty > 0 OR b.trn_module = '${jobModule}')) AS ${prefix}_${column}`);
        sets.push(`${prefix}_${column} = pb.${prefix}_${column} + agg.${prefix}_${column}`);
      }
    }
    await q("Receipts and issues of the products",
      `UPDATE ${s}.prod_balance pb SET ${sets.join(", ")} FROM (SELECT b.prod_id, ${picks.join(", ")} FROM ${s}.prod_ledger b WHERE b.quantity > 0 AND b.il_pos = 'A'${prodType ? ` AND b.${prodType} <> ${rateDiff}` : ""}`
      + ` AND b.il_date >= '${f}' AND b.il_date <= '${t}' AND b.inventory = 'Y' GROUP BY b.prod_id) agg WHERE agg.prod_id = pb.prod_id AND pb.prec_flag = 'RP' AND pb.year_id = '${y}'`);
  }
  for (const kind of ["GW", "BT"] as const) {
    const count = Number(await scalar(ctx, `Rows of ${kind}`, `SELECT count(*) FROM ${s}.prod_balance WHERE prec_flag = '${kind}' AND year_id = '${y}'`)) || 0;
    if (count > 0) await balanceUpdate(kind === "GW" ? "Receipts and issues of the godowns" : "Receipts and issues of the batches", kind);
  }

  const moves = ["add", "less"].flatMap((prefix) => FIELDS.map(([column]) => `${prefix}_${column}`));
  await q("Blank receipts and issues", `UPDATE ${s}.prod_balance SET ${moves.map((column) => `${column} = coalesce(${column}, 0)`).join(", ")} WHERE year_id = '${y}' AND (${moves.map((column) => `${column} IS NULL`).join(" OR ")})`);
  await q("Closing of the products",
    `UPDATE ${s}.prod_balance SET clsg_pcs = open_pcs + add_pcs - less_pcs, clsg_pack = open_pack + add_pack - less_pack, clsg_weight = open_weight + add_weight - less_weight,`
    + ` clsg_qty1 = open_qty1 + add_qty1 - less_qty1, clsg_qty2 = open_qty2 + add_qty2 - less_qty2, clsg_qty3 = open_qty3 + add_qty3 - less_qty3 WHERE ${kinds}`);
  await q("Duplicate addon rows of the products", `DELETE FROM ${s}.addon_data WHERE aon_key IN (SELECT aon_key FROM (SELECT aon_key, row_number() OVER (PARTITION BY prod_id ORDER BY aon_key) AS n FROM ${s}.addon_data WHERE coalesce(prod_id, 0) > 0) x WHERE n > 1)`);
}
