import type { ReportSelection } from "./types.ts";

/** A report selection as sent or saved, reduced to plain strings, lists and flags (planReport checks every value against setup). */
export const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((entry) => String(entry ?? "")).slice(0, 20000) : []);
const record = <T>(value: unknown, map: (entry: unknown) => T): Record<string, T> => (value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, entry]) => [String(key), map(entry)]))
  : {});

export function cleanSelection(value: unknown): ReportSelection {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    firstCombo: String(source.firstCombo ?? ""),
    from: String(source.from ?? ""),
    upto: String(source.upto ?? ""),
    groups: strings(source.groups),
    ticks: record(source.ticks, strings),
    choices: record(source.choices, (entry) => String(entry ?? "")),
    columns: strings(source.columns),
    texts: record(source.texts, (entry) => String(entry ?? "").slice(0, 40)),
    checks: record(source.checks, (entry) => entry === true),
  };
}
