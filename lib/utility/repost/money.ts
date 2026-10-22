import type { RepostContext } from "./context";
import { rows, run } from "./context";

type MoneyColumn = { table_name: string; column_name: string; column_default: string | null };

/**
 * This database keeps the desktop's money columns as PostgreSQL `money`, which has no operators against plain numbers (`amount < 0`, `coalesce(opening, 0)`),
 * as the procedure's SQL writes them. For the run those columns are made `numeric` and, when it has finished, made `money` again, in the same transaction
 * (DDL is transactional here), so the data keeps its type and a failure takes the change back with the rest. Only the tables the chosen blocks use are changed (each is rewritten twice).
 */
export async function withNumericMoney(ctx: RepostContext, only: readonly string[], work: () => Promise<void>): Promise<void> {
  const columns = await rows<MoneyColumn>(ctx, "Money columns",
    `SELECT c.table_name, c.column_name, c.column_default FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name`
    + ` WHERE c.table_schema = $1 AND t.table_type = 'BASE TABLE' AND c.data_type = 'money' AND c.table_name = ANY($2::text[]) ORDER BY c.table_name, c.ordinal_position`, [ctx.sch, [...only]]);
  const byTable = new Map<string, MoneyColumn[]>();
  for (const column of columns) byTable.set(column.table_name, [...(byTable.get(column.table_name) ?? []), column]);
  const safe = /^[a-z_][a-z0-9_]*$/;
  const tables = [...byTable.entries()].filter(([table, list]) => safe.test(table) && list.every((column) => safe.test(column.column_name)));

  ctx.log("Money columns to numeric");
  for (const [table, list] of tables) {
    const drop = list.filter((column) => column.column_default !== null).map((column) => `ALTER COLUMN ${column.column_name} DROP DEFAULT`);
    if (drop.length > 0) await run(ctx, `Defaults of ${table}`, `ALTER TABLE ${ctx.sch}.${table} ${drop.join(", ")}`);
    await run(ctx, `${table} to numeric`, `ALTER TABLE ${ctx.sch}.${table} ${list.map((column) => `ALTER COLUMN ${column.column_name} TYPE numeric USING ${column.column_name}::numeric`).join(", ")}`);
  }

  await work();

  ctx.log("Money columns back to money");
  for (const [table, list] of tables) {
    await run(ctx, `${table} back to money`, `ALTER TABLE ${ctx.sch}.${table} ${list.map((column) => `ALTER COLUMN ${column.column_name} TYPE money USING ${column.column_name}::money`).join(", ")}`);
    const restore = list.filter((column) => column.column_default !== null).map((column) => `ALTER COLUMN ${column.column_name} SET DEFAULT ${column.column_default}`);
    if (restore.length > 0) await run(ctx, `Defaults of ${table} back`, `ALTER TABLE ${ctx.sch}.${table} ${restore.join(", ")}`);
  }
}
