import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CI keeps the clean-install quality and repository-safety gates", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

  for (const requiredStep of [
    "uses: actions/checkout@v7",
    "uses: actions/setup-node@v7",
    "run: npm ci",
    "run: npm run security:check",
    "run: npm run lint",
    "run: npm run typecheck",
    "run: npm test",
    "run: docker compose config --quiet",
  ]) {
    assert.match(workflow, new RegExp(requiredStep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
