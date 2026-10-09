import assert from "node:assert/strict";
import test from "node:test";
import { daysBetween, daysInYear, interestExpression, interestRate, parseDmy, percentExpression, summarize } from "../lib/report/interestSql.ts";

test("interest: 12% unless a rate is typed; 365 days, 366 when the year ends in a leap year", () => {
  assert.deepEqual(interestRate(""), { rate: 12, percent: 0.12, typed: false });
  assert.deepEqual(interestRate(" 18 "), { rate: 18, percent: 0.18, typed: true });
  assert.equal(interestRate("7.5").percent, 0.075);
  assert.equal(daysInYear(new Date(2027, 2, 31)), 365);
  assert.equal(daysInYear(new Date(2028, 2, 31)), 366);
  assert.equal(daysInYear(new Date(2100, 2, 31)), 365);
  assert.match(percentExpression(interestRate("")), /ac\.int_perc::numeric=0 then 0\.12 else round\(ac\.int_perc::numeric\/100,4\)/);
  assert.equal(percentExpression(interestRate("18")), "0.18");
  assert.equal(interestExpression(interestRate("18")), "18");
  assert.match(interestExpression(interestRate("")), /then 12 else ac\.int_perc::numeric/);
});

test("interest: days between two dates, and a dd/mm/yyyy text", () => {
  assert.equal(daysBetween(new Date(2026, 3, 1), new Date(2026, 9, 9)) + 1, 192);
  assert.deepEqual(parseDmy("09/10/2026"), new Date(2026, 9, 9));
  assert.equal(parseDmy("9 Oct 2026"), null);
});

test("interest summary: a party's balance by period, to the day before the next change and to Upto", () => {
  const upto = new Date(2026, 3, 30);
  const rows = summarize([
    { name: "Alpha", date: "01/04/2026", principal: 1000, side: "Cr" },
    { name: "Alpha", date: "11/04/2026", principal: 400, side: "Dr" },
    { name: "Beta", date: "01/04/2026", principal: 500, side: "Dr" },
  ], 12, 365, "30/Apr/2026", upto);
  assert.equal(rows.length, 3);
  // Alpha: 1000 from 01/04 to 10/04 (10 days), then 600 from 11/04 to Upto (20 days).
  assert.deepEqual([rows[0].FROM_DATE, rows[0].UPTO_DATE, rows[0].DAYS, rows[0].CLOSING_AMT, rows[0].Interest_Amt, rows[0].DR_CR], ["01/04/2026", "10/04/2026", 10, 1000, 3.29, "Cr"]);
  assert.deepEqual([rows[1].FROM_DATE, rows[1].UPTO_DATE, rows[1].DAYS, rows[1].CLOSING_AMT, rows[1].Interest_Amt], ["11/04/2026", "30/Apr/2026", 20, 600, 3.95]);
  // Beta: a debit balance owes: negative, shown Dr.
  assert.deepEqual([rows[2].SMART_NAME, rows[2].CLOSING_AMT, rows[2].DAYS, rows[2].Interest_Amt, rows[2].DR_CR, rows[2].SORTING_DATE], ["Beta", -500, 30, -4.93, "Dr", "Beta 20260401A"]);
  assert.deepEqual(summarize([], 12, 365, "30/Apr/2026", upto), []);
});

test("interest summary: a date that does not change adds no period", () => {
  const rows = summarize([
    { name: "A", date: "01/04/2026", principal: 100, side: "Cr" },
    { name: "A", date: "01/04/2026", principal: 50, side: "Cr" },
  ], 12, 365, "30/Apr/2026", new Date(2026, 3, 30));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].CLOSING_AMT, 150);
});
