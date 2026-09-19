import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "../features/master-program/calculate.ts";

test("the cell calculator works out ordinary arithmetic", () => {
  assert.equal(evaluate("1250*4"), 5000);
  assert.equal(evaluate("12.5 x 48 + 150"), 750);
  assert.equal(evaluate("(100 + 50) / 3"), 50);
  assert.equal(evaluate("-20 + 5"), -15);
  assert.equal(evaluate("1,250.50 + 10"), 1260.5);
});

test("percent works as on a desk calculator", () => {
  assert.equal(evaluate("5000+18%"), 5900, "18% on top");
  assert.equal(evaluate("5000-10%"), 4500, "10% off");
  assert.equal(evaluate("200*15%"), 30, "15% of 200");
  assert.equal(evaluate("1250*4+18%"), 5900);
});

test("anything that is not arithmetic is refused, never run", () => {
  for (const text of ["", "abc", "alert(1)", "2+", "5/0", "(1+2", "1..2"]) assert.equal(evaluate(text), null, text);
});
