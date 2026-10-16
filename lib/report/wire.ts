import type { OutputRow, ReportOutput } from "./types";

/**
 * A report's rows on their way to the browser. Sent as they are, every row repeats every column's name (a year's Checklist Inventory of
 * all books: 462,000 rows, 398 MB of JSON, more than the server or the browser could hold at once, so the connection broke). Here the
 * column names go once (`rowKeys`) and each row is a list: kind, level, row type, voucher keys, then its values in `rowKeys` order
 * (null: the row has no such value). The server writes it in pieces (`packedOutputStream`); `unpackOutput` gives the browser back the
 * same `ReportOutput`.
 */

export type PackedRow = readonly unknown[];
export type PackedOutput = Omit<ReportOutput, "rows"> & { rowKeys: readonly string[]; packedRows: readonly PackedRow[] };

const KIND: Record<OutputRow["kind"], number> = { data: 0, subtotal: 1, total: 2 };
const KIND_OF: readonly OutputRow["kind"][] = ["data", "subtotal", "total"];

function rowKeysOf(rows: readonly OutputRow[]): string[] {
  const keys = new Set<string>();
  let shape = "";
  for (const row of rows) {
    // Rows of one report mostly share their keys: only a row with a different set adds any.
    const names = Object.keys(row.values);
    const now = names.join("\u0001");
    if (now === shape) continue;
    shape = now;
    for (const name of names) keys.add(name);
  }
  return [...keys];
}

function packRow(row: OutputRow, keys: readonly string[]): PackedRow {
  const packed: unknown[] = [KIND[row.kind], row.level, row.rowType, row.ledKey, row.processKey];
  for (const key of keys) packed.push(Object.prototype.hasOwnProperty.call(row.values, key) ? row.values[key] : null);
  // After the values: what the row carries besides them (its cell colours, its zoom account), when it has any.
  if (row.cellColours || row.acCode) packed.push({ c: row.cellColours, a: row.acCode });
  return packed;
}

/** The output's JSON (`{ output: ... }`) in pieces, the rows a batch at a time: never the whole text in one string. */
export function packedOutputStream(output: ReportOutput, batch = 2000): ReadableStream<Uint8Array> {
  const { rows, ...rest } = output;
  const keys = rowKeysOf(rows);
  const encoder = new TextEncoder();
  const head = JSON.stringify({ ...rest, rowKeys: keys });
  let at = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`{"output":${head.slice(0, -1)},"packedRows":[`));
    },
    pull(controller) {
      if (at >= rows.length) {
        controller.enqueue(encoder.encode("]}}"));
        controller.close();
        return;
      }
      const part = rows.slice(at, at + batch).map((row) => JSON.stringify(packRow(row, keys)));
      controller.enqueue(encoder.encode((at > 0 ? "," : "") + part.join(",")));
      at += batch;
    },
  });
}

/** Back to the output the screens use (an output that was not packed is returned as it is). */
export function unpackOutput(output: ReportOutput | PackedOutput): ReportOutput {
  if (!("packedRows" in output)) return output;
  const { rowKeys, packedRows, ...rest } = output;
  const rows: OutputRow[] = new Array(packedRows.length);
  for (let index = 0; index < packedRows.length; index++) {
    const packed = packedRows[index];
    const values: Record<string, string> = {};
    for (let column = 0; column < rowKeys.length; column++) {
      const value = packed[column + 5];
      if (value !== null && value !== undefined) values[rowKeys[column]] = value as string;
    }
    const extras = packed[rowKeys.length + 5] as { c?: Record<string, string>; a?: number } | undefined;
    rows[index] = { kind: KIND_OF[packed[0] as number] ?? "data", level: packed[1] as number, rowType: packed[2] as string, values, ledKey: packed[3] as number, processKey: packed[4] as number, ...(extras?.c ? { cellColours: extras.c } : {}), ...(extras?.a ? { acCode: extras.a } : {}) };
  }
  return { ...rest, rows };
}
