import { test } from "node:test";
import assert from "node:assert/strict";
import { packedOutputStream, unpackOutput } from "../lib/report/wire.ts";

const output = {
  title: "REPORT : CHECKLIST INVENTORY", dateLine: "", selectionLine: "", columns: [], groups: [], records: 3, frozen: 0, levelColours: {},
  rows: [
    { kind: "data", level: -2, rowType: "", values: { name: "Anil \"Plastics\"", QTY: "216.00", AMOUNT: "" }, ledKey: 12, processKey: 0 },
    { kind: "data", level: -2, rowType: "LED", values: { name: "B", QTY: "1.00", EXTRA: "x" }, ledKey: 0, processKey: 7 },
    { kind: "subtotal", level: 0, rowType: "", values: { name: "Sub", QTY: "217.00" }, ledKey: 0, processKey: 0 },
    { kind: "total", level: -1, rowType: "", values: { name: "* Final Total : " }, ledKey: 0, processKey: 0 },
  ],
} as never;

async function wireText(batch: number) {
  return new Response(packedOutputStream(output, batch)).text();
}

test("packed rows come back as the same output, whatever the batch size", async () => {
  for (const batch of [1, 2, 3, 2000]) {
    const body = JSON.parse(await wireText(batch));
    assert.deepEqual(unpackOutput(body.output), output);
  }
});

test("column names are sent once, not on every row", async () => {
  const body = JSON.parse(await wireText(2));
  assert.deepEqual(body.output.rowKeys, ["name", "QTY", "AMOUNT", "EXTRA"]);
  assert.deepEqual(body.output.packedRows[2], [1, 0, "", 0, 0, "Sub", "217.00", null, null]);
});

test("an output with no rows", async () => {
  const empty = { ...(output as object), rows: [] } as never;
  const body = JSON.parse(await new Response(packedOutputStream(empty)).text());
  assert.deepEqual(unpackOutput(body.output), empty);
});

test("an output that was not packed is left alone", () => {
  assert.equal(unpackOutput(output), output);
});
