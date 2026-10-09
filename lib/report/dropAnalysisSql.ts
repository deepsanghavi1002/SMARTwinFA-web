/**
 * SP_FRT_RPT_DROP_ANALYSIS' SQL and pivot, apart from the database (so they can be tested on their own). PostgreSQL; the SQL Server original is
 * quoted where it differs. A "drop" is one sale invoice (party) or one sale line (product); the figure is their count, quantity or amount.
 */
export type DropMeasure = "count" | "quantity" | "amount";

export type DropAddon = { save: string; text: boolean };

export const MONTH_NAMES = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"] as const;
const LONG_MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** 'Drop Count' / 'Quantity' / 'Amount' (the sorting combo's text); anything else leaves the desktop with no select, so the count is used. */
export function dropMeasure(sortingText: string): DropMeasure {
  const text = sortingText.trim().toLowerCase();
  return text === "quantity" ? "quantity" : text === "amount" ? "amount" : "count";
}

export type DropWindow = { from: string; upto: string; days: string[] };

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The month the first combo names: January to March are in the year the financial year ends, April to December in the year it starts. February
 * ends on the 28th or 29th by the end year's leap year. The days are the pivot's columns "01".."31". Null when the text is no month.
 */
export function dropWindow(monthText: string, startYear: number, endYear: number): DropWindow | null {
  const index = LONG_MONTHS.indexOf(monthText.trim().toUpperCase());
  if (index < 0) return null;
  const year = index <= 2 ? endYear : startYear;
  const last = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
  return { from: `${year}-${pad(index + 1)}-01`, upto: `${year}-${pad(index + 1)}-${pad(last)}`, days: Array.from({ length: last }, (_, i) => pad(i + 1)) };
}

/** The addon columns of the select (COALESCE(adata.txt_X,'') AS "X") and of the group by. */
export const addonSelect = (addons: readonly DropAddon[]): string => addons.map((a) => `COALESCE(adata.${a.text ? "txt_" : "input_"}${a.save},'') AS "${a.save}"`).join(",");
export const addonGroup = (addons: readonly DropAddon[]): string => addons.map((a) => `adata.${a.text ? "txt_" : "input_"}${a.save}`).join(",");

export type DropQueryInput = {
  db: string;
  product: boolean;
  measure: DropMeasure;
  /** Month-wise (CHK_MONTH): no date window, the bucket is the month's name. */
  monthly: boolean;
  window: DropWindow | null;
  /** SLAB_KEY of the sale book's first master slab (the party's amount). */
  slab: number;
  addons: readonly DropAddon[];
};

/** The rows of TEMP_TABLE_DROP_ANALYSIS1: name, bucket (day "01" or month "Apr"), Drop_Count and the addon columns, ordered by name and bucket. */
export function dropQuery(input: DropQueryInput): string {
  const { db, product, measure, monthly, window, slab, addons } = input;
  const dateColumn = product ? "il_date" : "doc_date";
  const bucket = monthly ? `to_char(${dateColumn},'Mon')` : `to_char(${dateColumn},'DD')`;
  const bucketName = monthly ? "Month_Name" : "Day_Name";
  const figure = measure === "count" ? "COUNT(*)"
    : measure === "quantity" ? `sum(${product ? "a" : "d"}.quantity::numeric)`
    : product ? "sum(a.il_value::numeric)"
    : `coalesce((select sum(s_lastot::numeric-slab_amt::numeric) from ${db}LEDGER_EXT where led_id=a.led_key and il_id is null and slab_id=${Math.trunc(slab)}),0)`;
  const nameColumn = product ? `c.PROD_DESC AS "Description"` : `b.name AS "name"`;
  const nameGroup = product ? "c.PROD_DESC" : "b.name";
  const select = `SELECT ${nameColumn},${bucket} as "${bucketName}",${figure} as "Drop_Count"${addons.length > 0 ? `,${addonSelect(addons)}` : ""}`;
  const dates = !monthly && window ? ` and a.${dateColumn} BETWEEN '${window.from}'::date and '${window.upto}'::date` : "";
  const group = `group by ${nameGroup},${bucket}${!product && measure === "amount" ? ",a.led_key" : ""}${addons.length > 0 ? `,${addonGroup(addons)}` : ""} order by ${nameGroup},${bucket}`;
  if (product) {
    return `${select} FROM ${db}PROD_LEDGER a LEFT JOIN ${db}ADDON_DATA adata on adata.PROD_ID=a.PROD_ID LEFT JOIN ${db}PRODUCT_MASTER c on c.PROD_KEY=a.PROD_ID`
      + ` where a.IL_POS='A' and a.book=8 and c.prod_pos='A' and a.led_id is not null and c.inventory='Y' and position('PACKING CHARGE' in c.prod_desc)=0 and position('DELIVERY CHARGES' in c.prod_desc)=0${dates} ${group}`;
  }
  return `${select} FROM ${db}LEDGER a left join ${db}ACCOUNT b on a.CODE=b.CODE LEFT JOIN ${db}ADDON_DATA adata on adata.CODE=b.CODE${measure === "quantity" ? ` LEFT JOIN ${db}PROD_LEDGER d on d.led_id=a.led_key` : ""}`
    + ` where a.DOC_POS='A' and a.DOC_POSTING='P' and a.book=8 and b.a_pos='A'${measure === "quantity" ? " and d.il_pos='A' and d.led_id is not null" : ""}${dates} ${group}`;
}

export type DropRow = Record<string, unknown>;

const cell = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * PIVOT SUM(Drop_Count) FOR Day_Name / Month_Name IN (...): one line per name and addon values, the figure of each bucket (blank where
 * there was none), then TOTAL = the sum of the cells each cut to an integer (CAST(... AS int)). Ordered by name.
 */
export function pivotDrops(rows: readonly DropRow[], nameColumn: string, bucketColumn: string, buckets: readonly string[], addons: readonly string[]): DropRow[] {
  const lines = new Map<string, DropRow>();
  for (const row of rows) {
    const key = JSON.stringify([row[nameColumn], ...addons.map((a) => row[a])]);
    let line = lines.get(key);
    if (!line) {
      line = { [nameColumn]: row[nameColumn] ?? null };
      for (const b of buckets) line[b] = null;
      line.TOTAL = 0;
      for (const a of addons) line[a] = row[a] ?? "";
      lines.set(key, line);
    }
    const bucket = String(row[bucketColumn]);
    if (!buckets.includes(bucket)) continue;
    line[bucket] = (line[bucket] === null ? 0 : cell(line[bucket])) + cell(row.Drop_Count);
  }
  const result = [...lines.values()];
  for (const line of result) line.TOTAL = buckets.reduce((sum, b) => sum + Math.trunc(cell(line[b])), 0);
  return result.sort((a, b) => String(a[nameColumn] ?? "").localeCompare(String(b[nameColumn] ?? ""), "en", { sensitivity: "base" }));
}
