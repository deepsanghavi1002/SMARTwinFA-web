import type { Client } from "pg";
import type { MasterSession } from "../../master-program/session";
import type { RepostContext } from "../repost/context";
import { scalar, timings } from "../repost/context";
import { repostData } from "../repost";
import { ensureIndexes } from "../repost/indexes";
import { withNumericMoney } from "../repost/money";
import { transferAccounts } from "./account";
import type { TransferContext, TransferOptions } from "./context";
import { copyLastYearMasters, copyLastYearProducts, oldDivisionKeys } from "./masters";
import { transferPendingOrders } from "./orders";
import { transferOutstanding } from "./outclear";
import { transferPendingReco, transferProducts } from "./product";

export type { TransferOptions } from "./context";

/** The password the desktop asks (Z_UserPassword against Trf_Password) before it transfers, except for licence 3. */
const TRANSFER_PASSWORD = "TRF123";

const pad = (value: number) => String(value).padStart(2, "0");
const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dayBefore = (date: Date) => isoDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1));

/** The previous year of the open company, as the screen shows it. */
export type TransferInfo = Readonly<{
  found: boolean;
  message: string;
  /** This year's first and last day. */
  from: string;
  to: string;
  /** Last year's first and last day ('' when there is none). */
  prevFrom: string;
  prevTo: string;
  /** The desktop asks for a password before the transfer, except for licence 3. */
  passwordRequired: boolean;
  /** Last year's schema (never sent to the browser; the run reads it again). */
  prevSchema: string;
}>;

/**
 * Utility_Transferbal_Load: the company whose year ended the day before this one began (same company name, another company key) is the one the balances
 * come from. If this company already has such a year row, or none is found, there is nothing to transfer from and the Ok button stays off.
 */
export async function transferInfo(client: Client, session: MasterSession): Promise<TransferInfo> {
  const base = { from: isoDay(session.tarikh1), to: isoDay(session.tarikh2), passwordRequired: session.licence !== 3 };
  const none = (message: string): TransferInfo => ({ ...base, found: false, message, prevFrom: "", prevTo: "", prevSchema: "" });
  const day = dayBefore(session.tarikh1);
  const own = await client.query("SELECT 1 FROM smart_system.cname WHERE c_id = $1 AND c_tarikh2::date = $2::date", [session.companyKey, day]);
  if (own.rowCount) return none("This company already has the previous year, there is nothing to transfer from.");
  const others = (await client.query(
    "SELECT co_key, lower(btrim(coalesce(co_dataname, ''))) AS schema_name FROM smart_system.company WHERE btrim(name) = $1 AND co_key <> $2 ORDER BY co_key", [session.companyName, session.companyKey])).rows as { co_key: number; schema_name: string }[];
  for (const other of others) {
    const year = (await client.query("SELECT to_char(c_tarikh1::date, 'YYYY-MM-DD') AS d1, to_char(c_tarikh2::date, 'YYYY-MM-DD') AS d2 FROM smart_system.cname WHERE c_id = $1 AND c_tarikh2::date = $2::date LIMIT 1", [other.co_key, day])).rows[0];
    if (!year) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(other.schema_name)) continue;
    const there = await client.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [other.schema_name]);
    if (!there.rowCount) continue;
    return { ...base, found: true, message: "", prevFrom: year.d1, prevTo: year.d2, prevSchema: other.schema_name };
  }
  return none("No previous year was found for this company.");
}

/** The tables each block reads or writes (the money columns of these are made numeric for the run, in both years). */
function tablesUsed(opt: TransferOptions): Set<string> {
  const used = new Set<string>();
  const add = (...names: string[]) => names.forEach((name) => used.add(name));
  if (opt.lyAddon || opt.lyAccount) add("addon_sub", "sub_balance");
  if (opt.lyAccount) add("account", "ac_balance", "address", "asset_master", "int_master", "addon_data");
  if (opt.account) add("account", "ac_balance", "balsheet", "address", "ledger");
  if (opt.outclear) add("ledger", "outclear", "account", "ac_balance", "addon_aentry", "addon_sub");
  if (opt.lyProduct) add("product_master", "prod_balance", "level_desc", "addon_data", "addon_sub");
  if (opt.product) add("prod_balance", "product_master");
  if (opt.pendReco) add("ledger", "account");
  if (opt.pendOrder) add("process", "prod_ledger", "ledger_ext", "addon_aentry", "addon_ientry", "prod_link");
  return used;
}

/**
 * Utility > Transfer Balance: SP_TRANSFER_DATA for the open company and year. Last year's balances, pending bills, product stock and orders come into
 * this year as the procedure carries them (the blocks run in its order). All of it is one transaction: a failed statement takes everything back.
 */
export async function transferData(client: Client, session: MasterSession, requested: TransferOptions, password: string): Promise<{ steps: string[] }> {
  if (session.licence !== 3 && password.trim().toUpperCase() !== TRANSFER_PASSWORD) throw new Error("The password is not correct");
  const info = await transferInfo(client, session);
  if (!info.found) throw new Error(info.message);
  const steps: string[] = [];
  const sch = session.companySchema;
  const o = info.prevSchema;
  if (!/^[a-z_][a-z0-9_]*$/.test(sch)) throw new Error("The company's database name is not a valid schema");
  if (o === sch) throw new Error("Last year's database is the same as this year's");

  // The procedure drops two choices for some companies before it reads them.
  const upper = sch.toUpperCase();
  const opt: TransferOptions = {
    ...requested,
    osOnAccountClear: session.licence === 3 || session.licence === 11 ? false : requested.osOnAccountClear,
  };
  const dropsProduct = (session.licence === 1 && upper.includes("FOOD")) || (session.licence === 6 && upper.includes("COMET_ALCON")) || session.licence === 23;

  const lyYearId = String(await scalar({ client } as RepostContext, "Year of last year", `SELECT year_id FROM ${o}.ac_balance LIMIT 1`) ?? "");
  const [ly1, ly2] = [new Date(`${info.prevFrom}T00:00:00`), new Date(`${info.prevTo}T00:00:00`)];

  // Last year's own re-post first. The procedure's chain of else-ifs runs only the first choice that is ticked, and passes it in the fixed place of the
  // re-post's parameter list (account, outstanding, product entry recalc, product, verify) where it names the choice: ticked "product" is passed in the
  // second place, ticked "outstanding" in the fourth.
  const lastYear = { ...session, companySchema: o, yearId: lyYearId, tarikh1: ly1, tarikh2: ly2 };
  if (opt.account) await repostData(client, lastYear, { account: true, outstanding: false, productRecalc: false, product: false, verify: false });
  else if (opt.product) await repostData(client, lastYear, { account: false, outstanding: true, productRecalc: false, product: false, verify: false });
  else if (opt.outclear) await repostData(client, lastYear, { account: false, outstanding: false, productRecalc: false, product: true, verify: false });

  const ctx: TransferContext = {
    client, sch, yearId: session.yearId, from: isoDay(session.tarikh1), to: isoDay(session.tarikh2), licence: session.licence,
    einvoiceReq: false, prodAcPost: false, schemaName: sch, log: (message) => steps.push(message),
    o, t1: isoDay(session.tarikh1), t1m1: dayBefore(session.tarikh1), ly1: info.prevFrom, ly2: info.prevTo, lyYearId,
    opt: { ...opt, product: dropsProduct ? false : opt.product },
  };
  timings.length = 0;

  const used = tablesUsed(ctx.opt);
  const work = async () => {
    await oldDivisionKeys(ctx);
    if (ctx.opt.lyAddon || ctx.opt.lyAccount) await copyLastYearMasters(ctx);
    if (ctx.opt.account) await transferAccounts(ctx);
    if (ctx.opt.outclear) await transferOutstanding(ctx);
    if (ctx.opt.lyProduct) await copyLastYearProducts(ctx);
    if (ctx.opt.product) await transferProducts(ctx);
    if (ctx.opt.pendReco) await transferPendingReco(ctx);
    if (ctx.opt.pendOrder) await transferPendingOrders(ctx);
  };
  const lastYearCtx: RepostContext = { ...ctx, sch: o };
  if (used.size > 0) {
    await ensureIndexes(ctx, used);
    await ensureIndexes(lastYearCtx, used);
    await withNumericMoney(lastYearCtx, [...used], () => withNumericMoney(ctx, [...used], work));
  } else await work();

  const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 15).map((item) => `${(item.ms / 1000).toFixed(1)} s  ${item.step}`);
  console.log(["[transfer] slowest steps:", ...slowest].join("\n"));
  timings.length = 0;
  return { steps };
}
