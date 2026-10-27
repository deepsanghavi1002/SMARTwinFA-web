import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("generated Modern theme stylesheet is up to date", async () => {
  const { generate } = await import("../scripts/generate-modern-theme.mjs");
  const fresh = await generate();
  assert.equal(readFileSync(new URL("../app/modern-theme.generated.css", import.meta.url), "utf8"), fresh, "run `npm run theme`");
});

test("Modern theme rules are scoped to the Modern view only", () => {
  const css = readFileSync(new URL("../app/modern-theme.generated.css", import.meta.url), "utf8");
  assert.ok(css.includes('html[data-mtheme="dark"]'));
  assert.ok(css.includes('html[data-mtheme="light"]'));
});
