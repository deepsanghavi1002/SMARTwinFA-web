import { formatDesktopDate, parseDesktopDate, toInt } from "../master-program/legacy";
import type { Loader } from "../master-program/load";
import type { SysContext } from "./load";
import { cellOf } from "./entrySave";
import type { EntryStatement } from "./entrySave";
import type { EditedRow } from "./types";

/**
 * Small_Entry.Save_Click, the approval entries the desktop saves in code: FG Entry Approved
 * (52), Add-Less Entry Approved (57), Stock JV Approved (60), Job Out Approved (64) and
 * Meher In-Out Approved (68).
 *
 * An approved entry's stock lines become inventory and are posted to prod_balance (a less
 * line out of stock, the rest in); a line that would take a product's stock below nothing
 * stops that entry, with the desktop's message, and the others still save. A rejected entry
 * is cancelled (il_pos 'D'). The desktop ran each statement on its own; here they all run in
 * the save's one transaction.
 */

type Row = Record<string, unknown>;

export const APPROVAL_ENTRIES: ReadonlySet<number> = new Set([52, 57, 60, 64, 68]);

export type ApprovalResult = Readonly<{
  statements: EntryStatement[];
  /** Rows that were approved or rejected, for the special log. */
  savedRows: Set<number>;
  /** Entries left unapproved and why (the desktop's "Stock Negative not allowed"). */
  messages: string[];
}>;

/** Convert.ToInt32 of a decimal: to the nearest whole number, a half to the even one. */
export function toInt32(value: unknown): number {
  const number = Number(String(value ?? "").replace(/,/g, "")) || 0;
  const floor = Math.floor(number);
  const fraction = number - floor;
  if (Math.abs(fraction - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(number);
}

const units = ["pcs", "pack", "weight", "qty1", "qty2", "qty3"] as const;

/** The prod_balance update for one stock line: a less line out (L), any other in. */
export function balanceUpdate(line: Readonly<Record<string, unknown>>, less: boolean): string {
  const value = (unit: string) => toInt32(line[`trn_${unit}`] ?? cellOf(line as Record<string, string>, `trn_${unit}`));
  const side = less ? "less" : "add";
  const sign = less ? "-" : "+";
  const sets = [...units.map((unit) => `${side}_${unit}=${side}_${unit}+${value(unit)}`), ...units.map((unit) => `clsg_${unit}=clsg_${unit}${sign}${value(unit)}`)];
  return `Update prod_balance set ${sets.join(",")} where prec_flag='RP' and prod_id=${toInt32(line.prod_id ?? cellOf(line as Record<string, string>, "prod_id"))}`;
}

/** A product's stock as the approval checks it: opening plus every inventory line. */
async function stockOf(loader: Loader, productId: number): Promise<number> {
  const schema = loader.session.companySchema;
  const rows = await loader.readTable(
    `select coalesce(prodbal.open_pcs,0)+coalesce((select sum(case when stock_nat='A' then case when trn_module='JOB-IN' then quantity else (quantity-ag_qty) end else case when trn_module='JOB-OUT' then quantity else (quantity-ag_qty)*-1 end end) from ${schema}.prod_ledger where il_pos='A' and inventory='Y' and prod_id=prodbal.prod_id),0) as stock from ${schema}.prod_balance prodbal left join ${schema}.product_master product on product.prod_key=prodbal.prod_id where prec_flag='RP' and product.prod_pos='A' and product.inventory='Y' and prod_id=$1`,
    [productId],
  );
  return Number(rows?.[0]?.stock ?? 0) || 0;
}

const decimal = (value: unknown) => Number(String(value ?? "").replace(/,/g, "")) || 0;
const negative = (what: string, docNo: string, product: string, stock: number, input: unknown) =>
  `${what}${docNo} - Product Name : ${product}  - Stock Quantity : ${stock}  - Input Quantity : ${String(input ?? "")} - Stock Negative not allowed`;

/**
 * The approval entries' statements, or null for any other entry. `context` carries the
 * header values (dates, the book's stock module) the serial renumbering uses.
 */
export async function approvalStatements(loader: Loader, entryId: number, rows: readonly EditedRow[], context: SysContext): Promise<ApprovalResult | null> {
  if (!APPROVAL_ENTRIES.has(entryId)) return null;
  const schema = loader.session.companySchema;
  const statements: EntryStatement[] = [];
  const savedRows = new Set<number>();
  const messages: string[] = [];
  const firstBook = (context.state.firstCombo?.text ?? "").trim();
  let renumber = false;

  for (const [index, { values, deleted }] of rows.entries()) {
    if (deleted) continue;
    const decision = (cellOf(values, "ENT_APPROVE") ?? "").trim();
    const processKey = toInt(cellOf(values, "process_key"));
    const ilKey = toInt(cellOf(values, "il_key"));

    if (decision === "Yes") {
      switch (entryId) {
        case 52: { // FG production: its inventory lines
          const lines = (await loader.readTable(`select prodled.*, product.prod_desc from ${schema}.prod_ledger prodled left join ${schema}.product_master product on product.prod_key=prodled.prod_id where prodled.il_pos='A' and product.inventory='Y' and process_id=$1`, [processKey])) ?? [];
          let stopped = false;
          for (const line of lines) {
            if (String(line.stock_nat ?? "") !== "L") continue;
            const stock = await stockOf(loader, toInt(line.prod_id));
            if (decimal(line.quantity) > stock) { messages.push(negative("Production No.: ", String(line.full_docno ?? ""), String(line.prod_desc ?? ""), stock, line.quantity)); stopped = true; break; }
          }
          if (stopped) break;
          for (const line of lines) {
            statements.push({ sql: `Update prod_ledger set inventory='Y' where il_key=${toInt32(line.il_key)}` });
            statements.push({ sql: balanceUpdate(line as Row, String(line.stock_nat ?? "") === "L") });
          }
          statements.push({ sql: `Update process set ent_approve='Yes' where process_key=${processKey}` });
          savedRows.add(index);
          break;
        }
        case 57: { // add-less voucher line: out of stock on the STOCK VOUCHER-LESS book, in on the rest
          const less = firstBook === "STOCK VOUCHER-LESS";
          if (less) {
            const stock = await stockOf(loader, toInt(cellOf(values, "prod_id")));
            if (decimal(cellOf(values, "quantity")) > stock) { messages.push(negative("Stock Voucher Less : ", cellOf(values, "full_docno") ?? "", cellOf(values, "prod_desc") ?? "", stock, cellOf(values, "trn_pcs"))); break; }
          }
          statements.push({ sql: `Update prod_ledger set inventory='Y' where il_key=${ilKey}` });
          statements.push({ sql: balanceUpdate(values as Row, less) });
          savedRows.add(index);
          break;
        }
        case 60: { // stock JV: its lines of inventory products
          const lines = (await loader.readTable(`select a.*, b.inventory as invent, b.prod_desc from ${schema}.prod_ledger a left join ${schema}.product_master b on b.prod_key=a.prod_id where a.il_pos='A' and process_id=$1`, [processKey])) ?? [];
          let stopped = false;
          for (const line of lines) {
            if (String(line.stock_nat ?? "") !== "L" || String(line.invent ?? "") !== "Y") continue;
            const stock = await stockOf(loader, toInt(line.prod_id));
            if (decimal(line.quantity) > stock) { messages.push(negative("Stock JV : ", cellOf(values, "full_docno") ?? "", String(line.prod_desc ?? ""), stock, line.factor)); stopped = true; break; }
          }
          if (stopped) break;
          for (const line of lines) {
            if (String(line.invent ?? "") !== "Y") continue;
            statements.push({ sql: `Update prod_ledger set inventory='Y' where il_key=${toInt32(line.il_key)}` });
            statements.push({ sql: balanceUpdate(line as Row, String(line.stock_nat ?? "") === "L") });
          }
          statements.push({ sql: `Update process set ent_approve='Yes' where process_key=${processKey}` });
          savedRows.add(index);
          break;
        }
        case 64: // job out
          statements.push({ sql: `Update process set ent_approve='Yes' where process_key=${processKey}` });
          savedRows.add(index);
          break;
        case 68: // Meher in-out line
          statements.push({ sql: `Update prod_ledger set lot_no='Yes' where il_key=${ilKey}` });
          savedRows.add(index);
          break;
      }
    } else if (decision === "No") {
      switch (entryId) {
        case 57: case 68:
          statements.push({ sql: `Update prod_ledger set il_pos='D',il_serial=0 where il_key=${ilKey}` });
          savedRows.add(index);
          break;
        case 60:
          statements.push({ sql: `Update prod_ledger set il_pos='D',il_serial=0 where process_id=${processKey}` });
          statements.push({ sql: `Update process set il_pos='D' where process_key=${processKey}` });
          savedRows.add(index);
          break;
      }
    }
    if (entryId === 57 || entryId === 68) renumber = true;
  }

  // 57 and 68 number each voucher's remaining lines 1, 2, 3... again (the desktop's
  // "WITH CTE ... update CTE set IL_SERIAL=rnk", which PostgreSQL writes as UPDATE ... FROM).
  if (renumber && context.stkModule !== undefined) {
    const date = (name: string) => { const parsed = parseDesktopDate(context.state.controls[name] ?? ""); return `'${formatDesktopDate(parsed ?? new Date())}'`; };
    statements.push({
      sql: `Update prod_ledger p set il_serial=c.rnk from (select il_key, row_number() over (partition by process_id order by il_serial, il_key) as rnk from ${schema}.prod_ledger where il_pos='A' and il_date between ${date("dtp_date")} and ${date("dtp_date2")} and process_id > 0 and trn_module='${context.stkModule.replace(/'/g, "''")}') c where p.il_key=c.il_key`,
    });
  }
  return { statements, savedRows, messages };
}
