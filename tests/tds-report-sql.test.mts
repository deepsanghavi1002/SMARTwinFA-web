import assert from "node:assert/strict";
import test from "node:test";
import { finishRows, journalLookup, returnLookup, tdsQuery, TDS_COLUMNS } from "../lib/report/tdsReportSql.ts";

test("tds report: the vouchers of books 10, 13 and 15, the party, the chart, the slab of the book and the TDS journal", () => {
  const sql = tdsQuery("s.", "smart_setup", 11, 22, "'f'", "'u'");
  assert.match(sql, /led\.book in \(10,13,15\)/);
  assert.match(sql, /led\.doc_pos='A'/);
  assert.match(sql, /smart_setup\.TDS_CHART smrtset on smrtset\.tds_key::text=ac\.nature_pay::text/);
  assert.match(sql, /slab_id=case when led\.book=13 then 11 else 22 end/);
  assert.match(sql, /outclr1\.out_entrybook=19 and outclr1\.out_ledid in \(select led_key from s\.LEDGER where book = 19 and imp_ledkey>0\)/);
  assert.match(sql, /when position\('JOB' in upper\(led\.doc_series\)\) > 0 then 'Job' when led\.book=10 then 'ExpReturn' else 'Exp'/);
  assert.match(sql, /when led\.book=10 then outclr1\.out_entryamt::numeric\*-1/);
  assert.match(sql, /order by led\.doc_date,led\.doc_no1$/);
  assert.match(returnLookup("s."), /p\.code <> code and out_fulldocno in/);
  assert.match(journalLookup("s."), /out_ag_outid=p\.k/);
});

const voucher = (over: Record<string, unknown>) => ({ name: "A", Net_Amount: 10000, TDS_Rate: 1, TDS_AMOUNT: 100, TDS_JV_No: "JV/1", ...over });

test("tds report: the TDS the rate gives, to the rupee, and the difference; only vouchers with a rate and TDS deducted", () => {
  const rows = finishRows([
    voucher({}),
    voucher({ name: "B", Net_Amount: 10050, TDS_Rate: 2, TDS_AMOUNT: 190 }),
    voucher({ name: "C", TDS_Rate: 0 }),
    voucher({ name: "D", TDS_AMOUNT: 0 }),
    voucher({ name: "E", TDS_AMOUNT: null }),
    voucher({ name: "F", Net_Amount: 0, TDS_AMOUNT: 30 }),
  ]);
  assert.deepEqual(rows.map((row) => [row.name, row.ACT_TDS_AMT, row.DIFF_TDS_AMT]), [["A", 100, 0], ["B", 201, -11], ["F", 0, 30]]);
  assert.deepEqual(Object.keys(rows[0]), [...TDS_COLUMNS]);
});
