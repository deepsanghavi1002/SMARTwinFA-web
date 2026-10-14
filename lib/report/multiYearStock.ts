import { ResultTable } from "./call";
import type { ResultRow } from "./call";

/**
 * Multi Year Stock Summary (report 104, SP_FRT_RPT_MULTI_YEAR_STOCK_SUMMARY_REP): the products of the company's years side by side,
 * apart from the database so it can be tested on its own. The queries that feed it are multiYearStock in reportFormating.ts.
 *
 * The rows start from the last year's products (not deleted; for STOCK only those kept in stock), each matched to the earlier years' live
 * (prod_pos A) product of the same short code. The first combo chooses the columns of a year (sx = its two-digit years, 25_26):
 *  1 STOCK: Op_sx, Add_sx, Less_sx, Cl_sx.
 *  2 SALE, 3 PURCHASE, 4 CREDIT NOTE, 5 DEBIT NOTE, 6 STOCK ADD, 7 STOCK LESS: the quantity (Qty_ with the first and last month's name and
 *    year, as the procedure names it); with Month Wise Require a column a month, April first (Apr_sx ...), then the year's total (Qty_sx,
 *    SAdd_sx for 6 and 7).
 * Only STOCK (without Month Wise) works on the year's own dates; the others take From / Upto's day and month in each year.
 *
 * STOCK without Month Wise also adds the products an earlier year had that the last year does not (by short code), with that year's
 * figures only. As the procedure: nothing is added for a single year's other years; with three or more years the added products' middle
 * years are filled with 0 and every earlier year is read again for the rows with no Add or Less (by short code, any position), and its
 * closing worked out as Op + Add - Less; the last year's columns stay blank on an added product.
 */

export type StockProduct = Readonly<{ key: number; code: string; desc: string; pos: string; inventory: string }>;
export type StockMovement = Readonly<{ add: number; less: number; net: number }>;
export type StockYear = Readonly<{
  /** The dates the figures were read for: the year's own, or From / Upto's day and month in it. */
  from: Date;
  upto: Date;
  products: readonly StockProduct[];
  /** STOCK: the opening pieces of each product key, and its movement in the dates. */
  opening: ReadonlyMap<number, number>;
  movement: ReadonlyMap<number, StockMovement>;
  /** The other choices: the quantity of each product key, by month (1-12; 0 for the whole period). */
  quantity: ReadonlyMap<number, ReadonlyMap<number, number>>;
}>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** April first, as the procedure lists them. */
const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

const yy = (date: Date) => String(date.getFullYear()).slice(-2);
const suffix = (year: StockYear) => `${yy(year.from)}_${yy(year.upto)}`;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

type Cells = { op: number | null; add: number | null; less: number | null; cl: number | null };
type StockRow = { code: string; desc: string; years: (Cells | null)[]; values: Map<string, number | null> };

export function multiYearStock(years: readonly StockYear[], combo: number, monthWise: boolean): ResultTable {
  const table = new ResultTable();
  table.addColumn("PROD_CODE");
  table.addColumn("PROD_DESC");
  if (years.length === 0) return table;
  const last = years[years.length - 1];

  // The earlier years' products by short code: the live one (the join), and the first any (the re-reading).
  const liveByCode = years.map((year) => {
    const map = new Map<string, StockProduct>();
    for (const product of year.products) if (product.pos === "A" && !map.has(product.code)) map.set(product.code, product);
    return map;
  });
  const anyByCode = years.map((year) => {
    const map = new Map<string, StockProduct>();
    for (const product of year.products) if (product.inventory === "Y" && !map.has(product.code)) map.set(product.code, product);
    return map;
  });

  if (combo === 1) {
    const labels = years.map(suffix);
    for (const label of labels) for (const part of ["Op", "Add", "Less", "Cl"]) table.setKind(`${part}_${label}`, "decimal");
    const cellsOf = (year: StockYear, product: StockProduct | undefined): Cells => {
      const op = product ? year.opening.get(product.key) ?? 0 : 0;
      const move = product ? year.movement.get(product.key) : undefined;
      return { op, add: move?.add ?? 0, less: move?.less ?? 0, cl: round(op + (move?.net ?? 0)) };
    };
    const rows: StockRow[] = [];
    const known = new Set<string>();
    for (const product of last.products) {
      if (product.pos === "D" || product.inventory !== "Y") continue;
      const cells = years.map((year, index) => (index === years.length - 1 ? cellsOf(year, product) : cellsOf(year, liveByCode[index].get(product.code))));
      rows.push({ code: product.code, desc: product.desc, years: cells, values: new Map() });
      known.add(product.code);
    }
    if (!monthWise && years.length > 1) {
      const count = years.length;
      for (let index = 0; index < count - 1; index++) {
        const year = years[index];
        // The next year's blanks (the added products') become 0, except the last year's.
        if (index >= 1) for (const row of rows) if (row.years[index] === null) row.years[index] = { op: 0, add: 0, less: 0, cl: 0 };
        for (const product of year.products) {
          if (product.pos === "D" || product.inventory !== "Y" || known.has(product.code)) continue;
          const cells = years.map((_, at) => (at === index ? cellsOf(year, product) : null));
          rows.push({ code: product.code, desc: product.desc, years: cells, values: new Map() });
          known.add(product.code);
        }
        if (count < 3) continue;
        for (const row of rows) {
          const cells = row.years[index];
          if (!cells) continue;
          if (cells.add === 0 && cells.less === 0) {
            const again = anyByCode[index].get(row.code);
            if (again) {
              const fresh = cellsOf(year, again);
              cells.op = fresh.op; cells.add = fresh.add; cells.less = fresh.less;
            }
          }
          cells.cl = cells.op === null || cells.add === null || cells.less === null ? null : round(cells.op + cells.add - cells.less);
        }
      }
    }
    return finish(table, rows, labels, (row, label, index) => {
      const cells = row.years[index];
      row.values.set(`Op_${label}`, cells?.op ?? null);
      row.values.set(`Add_${label}`, cells?.add ?? null);
      row.values.set(`Less_${label}`, cells?.less ?? null);
      row.values.set(`Cl_${label}`, cells?.cl ?? null);
    });
  }

  // SALE, PURCHASE, CREDIT / DEBIT NOTE, STOCK ADD / LESS: the quantity of the product (and its month).
  const names = years.map((year) => {
    const label = suffix(year);
    const month = (date: Date) => MONTHS[date.getMonth()];
    const total = monthWise ? (combo >= 6 ? `SAdd_${label}` : `Qty_${label}`)
      : combo >= 6 ? `Qty_${month(year.from)}${yy(year.from)}_${month(year.from)}${yy(year.upto)}`
        : `Qty_${month(year.from)}${yy(year.from)}_${month(year.upto)}${yy(year.upto)}`;
    return { months: monthWise ? FISCAL_MONTHS.map((number) => ({ number, name: `${MONTHS[number - 1]}_${label}` })) : [], total };
  });
  for (const name of names) {
    for (const month of name.months) table.setKind(month.name, "decimal");
    table.setKind(name.total, "decimal");
  }
  const rows: StockRow[] = [];
  for (const product of last.products) {
    if (product.pos === "D") continue;
    rows.push({ code: product.code, desc: product.desc, years: [], values: new Map() });
    const row = rows[rows.length - 1];
    years.forEach((year, index) => {
      const match = index === years.length - 1 ? product : liveByCode[index].get(product.code);
      const by = match ? year.quantity.get(match.key) : undefined;
      for (const month of names[index].months) row.values.set(month.name, by?.get(month.number) ?? 0);
      row.values.set(names[index].total, by?.get(0) ?? 0);
    });
  }
  return finish(table, rows, [], () => undefined);
}

function finish(table: ResultTable, rows: StockRow[], labels: string[], fill: (row: StockRow, label: string, index: number) => void): ResultTable {
  rows.forEach((row) => labels.forEach((label, index) => fill(row, label, index)));
  table.rows = rows
    .map((row, index) => ({ row, index, key: row.code.toUpperCase() }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1))
    .map(({ row }) => {
      const values: ResultRow = { PROD_CODE: row.code, PROD_DESC: row.desc };
      for (const column of table.columns.slice(2)) values[column] = row.values.has(column) ? row.values.get(column) : null;
      return values;
    });
  return table;
}
