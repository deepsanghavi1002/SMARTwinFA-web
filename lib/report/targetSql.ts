/**
 * SP_FRT_RPT_TARGET's arithmetic and SQL pieces, apart from the database (so they can be tested on their own): the months of the
 * period, the quarter targets, the shortfalls, and the three summaries. PostgreSQL; the SQL Server original is quoted where it differs.
 */
type Row = Record<string, unknown>;

const num = (value: unknown): number => { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; };
const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

/** The loop's dates: From, then a month later each time (DATEADD(m, 1, ...), a 31st going to the month's last day), while not past Upto. */
export function monthStarts(from: Date, upto: Date): Date[] {
  const out: Date[] = [];
  for (let step = 0; ; step += 1) {
    const first = new Date(from.getFullYear(), from.getMonth() + step, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const date = new Date(first.getFullYear(), first.getMonth(), Math.min(from.getDate(), last));
    if (date.getTime() > upto.getTime() || step > 120) return out;
    out.push(date);
  }
}

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const yyyymmdd = (date: Date): string => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;

/** A quarter's target: the budget times the percentages of the months in it (a percentage between 0.01 and 99.99), rounded to a whole number. */
export function quarterTarget(db: string, from: number, to: number): string {
  return `coalesce((case when ac.budget::numeric > 0 then round(ac.budget::numeric*(coalesce((select round(sum(a.trg_perc::numeric),0) from ${db}TARGET a where a.trg_aaocode=targ.trg_aaocode and EXTRACT(MONTH FROM a.trg_from) between ${from} and ${to} and a.trg_perc::numeric between 0.01 and 99.99),0)/100),0) else 0 end),0)`;
}

/**
 * SHORT_FALL = Month_Target - Net_Sale and Archive = Net_Sale / Month_Target % where both are above nothing; then each customer's running
 * shortfall (Tot_Short) month by month (its rows of the same month all take the figure the running sum reaches).
 */
export function finishRows(rows: readonly Row[]): Row[] {
  const out: Row[] = rows.map((row) => ({ ...row, Short_fall: 0, Tot_Short: 0, Archive: 0 }));
  for (const row of out) {
    if (num(row.Net_Sale) > 0 && num(row.Month_Target) > 0) {
      row.Short_fall = round2(num(row.Month_Target) - num(row.Net_Sale));
      row.Archive = round2((num(row.Net_Sale) / num(row.Month_Target)) * 100);
    }
  }
  const customers = [...new Set(out.map((row) => text(row.Customer_Name)))];
  for (const customer of customers) {
    let run = 0;
    const own = out.filter((row) => text(row.Customer_Name) === customer).sort((a, b) => text(a.SORTING_COL).localeCompare(text(b.SORTING_COL)));
    for (const row of own) {
      run += num(row.Short_fall);
      for (const same of own) if (text(same.Month) === text(row.Month)) same.Tot_Short = round2(run);
    }
  }
  return out;
}

/** CHK_SUMMARY: a row for each customer, the months added; Archive = Net_Sale / Month_Target % (nil when the yearly target is 1 or less). */
export function customerSummary(rows: readonly Row[]): Row[] {
  const groups = new Map<string, Row>();
  for (const row of rows) {
    if (num(row.Yearly_Trg) <= 0) continue;
    const key = ["SMART_SELECTED_ADDON1", "Sales_Person", "Cust_Type", "Customer_Name", "Yearly_Trg", "Trg_Qtr1", "Trg_Qtr2", "Trg_Qtr3", "Trg_Qtr4"].map((name) => text(row[name])).join("\u0000");
    const current = groups.get(key);
    if (!current) groups.set(key, { SMART_SELECTED_ADDON1: row.SMART_SELECTED_ADDON1, Sales_Person: row.Sales_Person, Cust_Type: row.Cust_Type, Customer_Name: row.Customer_Name, Yearly_Trg: row.Yearly_Trg, Trg_Qtr1: row.Trg_Qtr1, Trg_Qtr2: row.Trg_Qtr2, Trg_Qtr3: row.Trg_Qtr3, Trg_Qtr4: row.Trg_Qtr4, Month_Target: num(row.Month_Target), Net_Sale: num(row.Net_Sale), Short_fall: num(row.Short_fall), Archive: 0 });
    else { current.Month_Target = num(current.Month_Target) + num(row.Month_Target); current.Net_Sale = num(current.Net_Sale) + num(row.Net_Sale); current.Short_fall = num(current.Short_fall) + num(row.Short_fall); }
  }
  for (const row of groups.values()) row.Archive = num(row.Yearly_Trg) > 1 && num(row.Month_Target) !== 0 ? round2((num(row.Net_Sale) / num(row.Month_Target)) * 100) : 0;
  return [...groups.values()];
}

export type SalesExpense = { code: string; month: string; salary: number; expense: number };

/** CHK_SMSALEXP: a row for each sales person and month with the target, the net sale, the salary and expense, and the two percentages. */
export function salesExpenseRows(rows: readonly Row[], costs: readonly SalesExpense[]): Row[] {
  const groups = new Map<string, Row>();
  for (const row of rows) {
    if (!(num(row.Net_Sale) > 0 && num(row.Yearly_Trg) > 0 && num(row.Month_Target) > 0)) continue;
    for (const cost of costs) {
      if (cost.code !== text(row.Sales_Person_Code) || cost.month !== text(row.Month)) continue;
      const key = [row.SORTING_COL, row.Sales_Person, row.Month, cost.salary, cost.expense].map(text).join("\u0000");
      const current = groups.get(key);
      if (!current) groups.set(key, { SORTING_COL: row.SORTING_COL, SMART_SELECTED_ADDON1: null, Sales_Person: row.Sales_Person, Month: row.Month, Month_Target: num(row.Month_Target), Net_Sale: num(row.Net_Sale), Expense: round2(cost.salary + cost.expense), "Target_Vs_Sale_%": 0, "Sale_Vs_Exp_%": 0 });
      else { current.Month_Target = num(current.Month_Target) + num(row.Month_Target); current.Net_Sale = num(current.Net_Sale) + num(row.Net_Sale); }
    }
  }
  for (const row of groups.values()) {
    if (num(row.Net_Sale) > 0 && num(row.Month_Target) > 0) row["Target_Vs_Sale_%"] = round2((num(row.Net_Sale) / num(row.Month_Target)) * 100);
    if (num(row.Net_Sale) > 0 && num(row.Expense) > 0) row["Sale_Vs_Exp_%"] = round2((num(row.Expense) / num(row.Net_Sale)) * 100);
  }
  return [...groups.values()];
}

/**
 * CHK_GRPSUM: a row for each customer type (as its sales person name) with its target (the sales persons' target for the months), its net
 * sale, the shortfall and the % achieved; a sales person with a target and no sale is added; rows with no target are left out.
 */
export function groupSummary(rows: readonly Row[], targets: ReadonlyMap<string, number>): Row[] {
  const sales = new Map<string, number>();
  for (const row of rows) sales.set(text(row.Cust_Type), round2((sales.get(text(row.Cust_Type)) ?? 0) + num(row.Net_Sale)));
  const out: Row[] = [];
  for (const [name, netSale] of sales) {
    const target = targets.get(name) ?? 0;
    out.push({ Sales_Person: name, Target: target, Net_Sale: netSale, Shortfall: netSale > 0 && target > 1 ? round2(target - netSale) : 0, "Achieved_%": netSale > 0 && target > 1 ? round2((netSale / target) * 100) : 0 });
  }
  for (const [name, target] of targets) if (!sales.has(name)) out.push({ Sales_Person: name, Target: target, Net_Sale: 0, Shortfall: 0, "Achieved_%": 0 });
  return out.filter((row) => num(row.Target) > 0).sort((a, b) => text(a.Sales_Person).toLowerCase().localeCompare(text(b.Sales_Person).toLowerCase()));
}
