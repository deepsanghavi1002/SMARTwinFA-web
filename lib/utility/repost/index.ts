import type { Client } from "pg";
import type { MasterSession } from "../../master-program/session";
import { repostAccount } from "./account";
import type { RepostContext } from "./context";
import { run, scalar } from "./context";
import { timings } from "./context";
import { ensureIndexes } from "./indexes";
import { withNumericMoney } from "./money";
import { repostOutstanding } from "./outclear";
import { repostProduct } from "./product";
import { repostProductRecalc } from "./productRecalc";
import { repostVerify } from "./verify";

/** What the Re-Post Data screen asks for (its five check boxes). */
export type RepostOptions = Readonly<{ account: boolean; outstanding: boolean; productRecalc: boolean; product: boolean; verify: boolean }>;

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Utility > Re-Post Data: SP_REPOST_DATA. The blocks run in the procedure's order (Account, Outstanding, Product entry recalc, Product, Verify); the
 * companies of licence 46 (RPI Sales) and 59 (RPI Inventory) run only what the procedure keeps for them. Returns 1 when something was run, as the
 * procedure's @PrimaryID does (0 when no block was asked for). All of it is one transaction: a failed statement takes everything back.
 */
export async function repostData(client: Client, session: MasterSession, options: RepostOptions): Promise<{ primaryId: number; steps: string[] }> {
  const steps: string[] = [];
  timings.length = 0;
  const sch = session.companySchema;
  if (!/^[a-z_][a-z0-9_]*$/.test(sch)) throw new Error("The company's database name is not a valid schema");
  const flag = async (column: string) => Number(await scalar({ client } as RepostContext, `Setup ${column}`, `SELECT CASE WHEN position('Y' in coalesce(${column}, '')) > 0 THEN 1 ELSE 0 END FROM ${sch}.setup LIMIT 1`)) === 1;
  const ctx: RepostContext = {
    client, sch, yearId: session.yearId, from: isoDay(session.tarikh1), to: isoDay(session.tarikh2), licence: session.licence,
    einvoiceReq: await flag("einvoice_req"), prodAcPost: await flag("i_posting"), schemaName: sch, log: (message) => steps.push(message),
  };
  let { account, outstanding, productRecalc, product, verify } = options;

  if (ctx.licence === 46) {
    // RPI Sales: only these (the narration rows and the discounts of the day's processes), never the blocks.
    account = outstanding = productRecalc = product = verify = false;
    const s = sch;
    ctx.log("RPI Sales");
    await run(ctx, "Narration rows", `INSERT INTO ${s}.narration (narr_accode, narr_fromdt, narr_short, narr_long) SELECT p.code, p.p_date, '', '' FROM ${s}.process p WHERE coalesce(p.einv_irnno, '') = '' AND coalesce(p.user_id, 0) > 0 AND p.il_pos = 'A' AND p.code NOT IN (SELECT narr_accode FROM ${s}.narration WHERE narr_fromdt = p.p_date)`);
    await run(ctx, "Salesman mobile number", `UPDATE ${s}.process proce SET einv_irnno = left(asub.mobile_no, 10) FROM ${s}.addon_data adata, ${s}.addon_sub asub WHERE proce.code = adata.code AND adata.key_salesman = asub.sub_code AND coalesce(proce.user_id, 0) > 0 AND proce.il_pos = 'A' AND coalesce(proce.einv_irnno, '') = ''`);
    await run(ctx, "Discount percent", `UPDATE ${s}.prod_ledger SET dis_perc = round(dis_value / nullif(il_value, 0) * 100, 0) WHERE coalesce(dis_value, 0) > 0 AND coalesce(dis_perc, 0) = 0 AND il_pos = 'A'`);
    await run(ctx, "Discount value", `UPDATE ${s}.prod_ledger SET dis_value = round(il_value * dis_perc / 100, 2) WHERE coalesce(dis_value, 0) = 0 AND coalesce(dis_perc, 0) > 0 AND il_pos = 'A'`);
    await run(ctx, "Discount of the account", `UPDATE ${s}.prod_ledger prodled SET dis_perc = ac.a_perc, dis_value = round(prodled.il_value * ac.a_perc / 100, 2) FROM ${s}.account ac, ${s}.process proce WHERE prodled.code = ac.code AND prodled.process_id = proce.process_key AND (coalesce(prodled.dis_perc, 0) = 0 OR coalesce(prodled.dis_value, 0) = 0) AND prodled.il_pos = 'A' AND coalesce(ac.a_perc, 0) > 0 AND proce.il_pos = 'A'`);
    await run(ctx, "Narration of the day", `UPDATE ${s}.narration narr SET narr_short = proce.einv_irnno FROM ${s}.process proce WHERE narr.narr_accode = proce.code AND narr.narr_fromdt = proce.p_date AND coalesce(proce.user_id, 0) > 0 AND proce.il_pos = 'A' AND coalesce(proce.einv_ackno, '') = ''`);
  }
  if (ctx.licence === 59) account = outstanding = productRecalc = product = verify = false;

  let done = 0;
  const blocks = async () => {
    if (account) { await repostAccount(ctx); done += 1; }
    if (outstanding) { await repostOutstanding(ctx); done += 1; }
    if (productRecalc) { await repostProductRecalc(ctx); done += 1; }
    if (product) { await repostProduct(ctx); done += 1; }
    if (verify) { await repostVerify(ctx); done += 1; }
  };
  // The tables each block reads or writes: only their money columns are made numeric for the run.
  const used = new Set<string>();
  if (account) ["ledger", "ledger_post", "ac_balance", "sub_balance", "account", "slab_master", "tax_master", "balsheet", "addon_data", "int_master", "address", "entry_qrcode"].forEach((table) => used.add(table));
  // The product lines matter to the account posting only where products post to their own account.
  if (account && ctx.prodAcPost) ["prod_ledger", "product_master"].forEach((table) => used.add(table));
  if (outstanding) ["outclear", "ledger", "account", "ac_balance"].forEach((table) => used.add(table));
  if (productRecalc) ["prod_balance", "level_desc", "addon_data", "addon_ientry", "addon_aentry"].forEach((table) => used.add(table));
  if (product) ["prod_balance", "pricelist", "addon_ientry", "addon_data", "scheme", "prod_link"].forEach((table) => used.add(table));
  if (used.size > 0) await ensureIndexes(ctx, used);
  if (used.size > 0) await withNumericMoney(ctx, [...used], blocks);
  else await blocks();
  const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 15).map((item) => `${(item.ms / 1000).toFixed(1)} s  ${item.step}`);
  console.log(["[repost] slowest steps:", ...slowest].join("\n"));
  timings.length = 0;
  return { primaryId: done === 0 ? 0 : 1, steps };
}
