import { amountOf, isEntry } from "./compare";
import { cellDate } from "./groupBy";
import type { ReportOutput } from "./types";

/**
 * Business development (web only), worked on the entries of the output on screen: the parties
 * ranked by an amount with their A / B / C class, which parties grew, fell, are new or are gone
 * against an earlier period, and which parties have not had an entry for a number of days.
 * Pure (no database); the screen is features/report/GrowthPanel.tsx.
 */

type Entries = Pick<ReportOutput, "columns" | "rows">;

/** The party of an entry: its text in the chosen column, "(blank)" when empty. */
const partyOf = (value: string | undefined) => { const text = (value ?? "").trim(); return text === "" ? "(blank)" : text; };

export type Ranked = { party: string; value: number; entries: number; share: number; running: number; grade: "A" | "B" | "C" };

/** Parties by amount, largest first. A is the parties making the first 80% of the total, B the next 15%, C the rest. */
export function rankParties(output: Entries, byKey: string, valueKey: string): Ranked[] {
  const sums = new Map<string, { value: number; entries: number }>();
  for (const row of output.rows) {
    if (!isEntry(row)) continue;
    const party = partyOf(row.values[byKey]);
    const sum = sums.get(party) ?? { value: 0, entries: 0 };
    sum.value += amountOf(row.values[valueKey]);
    sum.entries += 1;
    sums.set(party, sum);
  }
  const sorted = [...sums].map(([party, sum]) => ({ party, ...sum })).sort((a, b) => b.value - a.value || a.party.localeCompare(b.party));
  const total = sorted.reduce((all, item) => all + Math.max(item.value, 0), 0);
  let before = 0;
  return sorted.map((item) => {
    // The party that carries the total across a limit still belongs to the class below it.
    const grade = total <= 0 || before < total * 0.8 ? "A" : before < total * 0.95 ? "B" : "C";
    before += Math.max(item.value, 0);
    return { ...item, share: total > 0 ? Math.max(item.value, 0) / total : 0, running: total > 0 ? Math.min(before / total, 1) : 0, grade };
  });
}

export type MoverKind = "new" | "gone" | "up" | "down" | "same";
export type Mover = { party: string; now: number; then: number; change: number; kind: MoverKind };

/** Each party's amount now against before (a party in only one of them counts 0 in the other), the biggest change first. */
export function movers(now: Entries, before: Entries, byKey: string, valueKey: string): Mover[] {
  const sum = (output: Entries) => {
    const map = new Map<string, number>();
    for (const row of output.rows) if (isEntry(row)) { const party = partyOf(row.values[byKey]); map.set(party, (map.get(party) ?? 0) + amountOf(row.values[valueKey])); }
    return map;
  };
  const a = sum(now);
  const b = sum(before);
  return [...new Set([...a.keys(), ...b.keys()])].map((party) => {
    const current = a.get(party) ?? 0;
    const earlier = b.get(party) ?? 0;
    const kind: MoverKind = !b.has(party) ? "new" : !a.has(party) ? "gone" : current > earlier ? "up" : current < earlier ? "down" : "same";
    return { party, now: current, then: earlier, change: current - earlier, kind };
  }).sort((x, y) => Math.abs(y.change) - Math.abs(x.change) || x.party.localeCompare(y.party));
}

export type Quiet = { party: string; last: Date; days: number; entries: number; value: number };

/**
 * Parties whose latest entry is `days` or more before `asOf` (the last day of the report), the
 * longest quiet first. A party with no dated entry is left out: there is nothing to count from.
 */
export function quietParties(output: Entries, byKey: string, valueKey: string, dateKey: string, asOf: Date, days: number): Quiet[] {
  const seen = new Map<string, Quiet>();
  for (const row of output.rows) {
    if (!isEntry(row)) continue;
    const date = cellDate(row.values[dateKey] ?? "");
    if (!date) continue;
    const party = partyOf(row.values[byKey]);
    const item = seen.get(party) ?? { party, last: date, days: 0, entries: 0, value: 0 };
    if (date > item.last) item.last = date;
    item.entries += 1;
    item.value += amountOf(row.values[valueKey]);
    seen.set(party, item);
  }
  const day = 86400000;
  const end = Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return [...seen.values()]
    .map((item) => ({ ...item, days: Math.round((end - Date.UTC(item.last.getFullYear(), item.last.getMonth(), item.last.getDate())) / day) }))
    .filter((item) => item.days >= days)
    .sort((x, y) => y.days - x.days || x.party.localeCompare(y.party));
}

// ---- The report's own groups (area, zone, book, the account heading ...) as columns ----

const HEADING_ROW = /^(AC|BOOK|SCHEDULE|ADDON_\d+|ST)$/;
/** Outer groups first, the account last; an outer heading ends the groups inside it. */
const GROUP_ORDER = ["BOOK", "SCHEDULE", "ADDON_1", "ADDON_2", "ADDON_3", "ADDON_4", "AC"];
export const GROUP_PREFIX = "__group:";

/**
 * A report that heads its entries by group (the ageing and the clearance head each party; with addon groups an
 * area or a zone above it) keeps the group's name only on the heading row. Each entry row of the returned output
 * also carries it in a column of its own (GROUP_PREFIX + the heading type), so a growth can be measured by a
 * party, an area or a zone alike. `groups` lists them, the outer groups first.
 */
export function withGroups(output: ReportOutput): { output: ReportOutput; groups: { key: string; caption: string }[] } {
  const types = GROUP_ORDER.filter((type) => output.rows.some((row) => row.kind === "data" && row.rowType === type));
  if (types.length === 0) return { output, groups: [] };
  const headed = (column: { key: string }) => output.rows.some((row) => row.kind === "data" && HEADING_ROW.test(row.rowType) && (row.values[column.key] ?? "").trim() !== "");
  const nameColumn = output.columns.find((column) => /^name$/i.test(column.key) && headed(column)) ?? output.columns.find((column) => column.kind === "text" && headed(column));
  if (!nameColumn) return { output, groups: [] };
  const current = new Map<string, string>();
  const rows = output.rows.map((row) => {
    if (row.kind === "data" && HEADING_ROW.test(row.rowType)) {
      // The clearance appends the party's phone, credit days and limit to its heading: not part of the name.
      current.set(row.rowType, (row.values[nameColumn.key] ?? "").replace(/^\*+\s*/, "").replace(/ (Contact |Tel No\. |Mobil No\. |Cr\.Days |Gr\.Days |Limit : |Budget ).*$/, "").trim());
      const at = GROUP_ORDER.indexOf(row.rowType);
      if (at >= 0) for (const inner of GROUP_ORDER.slice(at + 1)) current.delete(inner);
    }
    return { ...row, values: { ...row.values, ...Object.fromEntries(types.map((type) => [GROUP_PREFIX + type, current.get(type) ?? ""])) } };
  });
  return { output: { ...output, rows }, groups: types.map((type) => ({ key: GROUP_PREFIX + type, caption: output.headingCaptions[type] ?? type })) };
}
