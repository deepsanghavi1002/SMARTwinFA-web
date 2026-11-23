"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { columnCaption, groupCaptions } from "../../lib/report/names";
import { normalName, plainName, SECTION_NAME } from "../../lib/report/detailTypes";
import type { DetailField, DetailIdentity, DetailSection, DetailValues } from "../../lib/report/detailTypes";
import type { OutputColumn, OutputRow, ReportOutput } from "../../lib/report/types";

/**
 * Add Details (web only): the master and entry fields ticked in the panel, as extra columns at the end of the report's columns. The field
 * lists and the values come from the server (lib/report/details.ts); which report column holds the account / product name is found there too
 * (the column whose values are in the master). The values are read once per ticked field for the names and vouchers of the report as generated,
 * then every row takes its own by name (account, product) or by voucher (entry).
 */

export type DetailsLoad = (action: "detailFields" | "detailIdentity" | "detailValues", payload: Record<string, unknown>) => Promise<unknown>;

const DETAIL = "__DET_";
/** A column added by Add Details. */
export const isDetailColumn = (key: string) => key.startsWith(DETAIL);

const SAMPLE_ROWS = 6000;
const SAMPLE_VALUES = 80;
const SEP = "\u0001";

export type DetailsState = ReturnType<typeof useDetailColumns>;

export function useDetailColumns(base: ReportOutput, load: DetailsLoad | undefined) {
  const [catalog, setCatalog] = useState<readonly DetailField[] | null>(null);
  const [found, setFound] = useState<{ forBase: ReportOutput; identity: DetailIdentity } | null>(null);
  const [state, setState] = useState<{ forBase: ReportOutput; ticked: readonly string[] }>({ forBase: base, ticked: [] });
  const [printToo, setPrintToo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState(0);
  /** The values read so far, for the report as generated: "section SEP key SEP field id" → text. */
  const store = useRef<{ forBase: ReportOutput; values: Map<string, string>; done: Set<string> }>({ forBase: base, values: new Map(), done: new Set() });
  if (store.current.forBase !== base) store.current = { forBase: base, values: new Map(), done: new Set() };

  const ticked = state.forBase === base ? state.ticked : [];
  const identity = found && found.forBase === base ? found.identity : null;
  /** Whether the report has vouchers (not a summary): its rows carry a voucher key. */
  const hasEntries = useMemo(() => base.rows.some((row) => row.kind === "data" && row.ledKey > 0), [base]);

  /** The names the report already shows its columns under (as the panels call them), so a field it has is not offered again. */
  const existing = useMemo(() => {
    const names = new Set<string>();
    for (const column of base.columns) { names.add(normalName(column.key)); names.add(normalName(column.caption)); names.add(normalName(columnCaption(base, column))); }
    for (const name of groupCaptions(base)) names.add(normalName(name));
    for (const name of base.groups) names.add(normalName(name));
    return names;
  }, [base]);

  /** The field lists and which column holds the account / product name (once per report). */
  const ensure = useCallback(async () => {
    if (!load) return;
    try {
      if (!catalog) setCatalog(((await load("detailFields", {})) as { fields: DetailField[] }).fields);
      if (!found || found.forBase !== base) {
        const sample = new Map<string, Set<string>>();
        const textColumns = base.columns.filter((column) => column.kind === "text").slice(0, 16);
        for (const column of textColumns) sample.set(column.key, new Set());
        base.rows.slice(0, SAMPLE_ROWS).forEach((row) => {
          for (const column of textColumns) {
            const values = sample.get(column.key);
            const value = plainName(row.values[column.key] ?? "");
            if (values && values.size < SAMPLE_VALUES && value !== "" && value.length < 120) values.add(value);
          }
        });
        const candidates = [...sample].map(([key, values]) => ({ key, values: [...values] })).filter((item) => item.values.length > 0);
        const reply = candidates.length === 0 ? { identity: { account: null, product: null } } : (await load("detailIdentity", { candidates })) as { identity: DetailIdentity };
        setFound({ forBase: base, identity: reply.identity });
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [load, catalog, found, base]);

  const keyOf = (row: OutputRow, section: DetailSection): string => {
    if (section === "ent") return row.kind === "data" && row.ledKey > 0 ? String(row.ledKey) : "";
    const column = section === "acc" ? identity?.account : identity?.product;
    return column ? plainName(row.values[column] ?? "") : "";
  };

  /** Reads the ticked fields' values for every name / voucher of the report. */
  const fetchValues = async (ids: readonly string[]) => {
    if (!load || !catalog) return;
    const needed = ids.filter((id) => !store.current.done.has(id));
    if (needed.length === 0) return;
    const sections = new Set(needed.map((id) => id.split(":")[0] as DetailSection));
    const accountNames = new Set<string>();
    const productNames = new Set<string>();
    const ledKeys = new Set<number>();
    for (const row of base.rows) {
      if (sections.has("acc")) { const key = keyOf(row, "acc"); if (key) accountNames.add(key); }
      if (sections.has("prod")) { const key = keyOf(row, "prod"); if (key) productNames.add(key); }
      if (sections.has("ent") && row.kind === "data" && row.ledKey > 0) ledKeys.add(row.ledKey);
    }
    const reply = (await load("detailValues", { request: { fields: needed, accountNames: [...accountNames], productNames: [...productNames], ledKeys: [...ledKeys] } })) as { values: DetailValues };
    for (const section of ["acc", "prod", "ent"] as const) {
      for (const [key, fields] of Object.entries(reply.values[section])) for (const [id, value] of Object.entries(fields)) store.current.values.set(`${section}${SEP}${key}${SEP}${id}`, value);
    }
    for (const id of needed) store.current.done.add(id);
  };

  /** Tick or untick fields: a tick reads the values first, then the columns appear. */
  const toggle = async (ids: readonly string[], on: boolean) => {
    if (!on) {
      setState((current) => ({ forBase: base, ticked: (current.forBase === base ? current.ticked : []).filter((id) => !ids.includes(id)) }));
      return;
    }
    const fresh = ids.filter((id) => !ticked.includes(id));
    if (fresh.length === 0) return;
    setBusy(true);
    setError("");
    try {
      await fetchValues(fresh);
      setState((current) => { const have = current.forBase === base ? current.ticked : []; return { forBase: base, ticked: [...have, ...fresh.filter((id) => !have.includes(id))] }; });
      setStamp((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** The output with the ticked fields as columns after its own. */
  const apply = useCallback((output: ReportOutput): ReportOutput => {
    if (ticked.length === 0 || !catalog) return output;
    const fields = ticked.map((id) => catalog.find((field) => field.id === id)).filter((field): field is DetailField => field !== undefined);
    if (fields.length === 0) return output;
    const columns: OutputColumn[] = fields.map((field) => {
      const caption = `${SECTION_NAME[field.section]} · ${field.caption}`;
      return { key: `${DETAIL}${field.id.replace(/[^A-Za-z0-9]+/g, "_")}`, caption, width: Math.min(260, Math.max(110, caption.length * 7 + 30)), align: field.right ? "R" : "L", kind: "text", decimals: 0, visible: true };
    });
    const rows = output.rows.map((row) => {
      if (row.kind === "total") return row;
      const values: Record<string, string> = { ...row.values };
      const keys: Partial<Record<DetailSection, string>> = {};
      fields.forEach((field, at) => {
        const key = keys[field.section] ?? (keys[field.section] = keyOf(row, field.section));
        values[columns[at].key] = key ? store.current.values.get(`${field.section}${SEP}${key}${SEP}${field.id}`) ?? "" : "";
      });
      return { ...row, values };
    });
    return { ...output, columns: [...output.columns, ...columns], rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyOf and the store follow identity and stamp
  }, [ticked, catalog, identity, stamp]);

  return { catalog, identity, hasEntries, existing, ticked, toggle, ensure, apply, printToo, setPrintToo, busy, error, available: load !== undefined };
}
