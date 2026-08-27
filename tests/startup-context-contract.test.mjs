import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const startupContext = readFileSync(new URL("../platform/legacy-db/startup-context.ts", import.meta.url), "utf8");
const startupGate = readFileSync(new URL("../features/startup/StartupGate.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("the startup context reads the real operator list", () => {
  assert.match(startupContext, /smart_setup|SETUP_SCHEMA/);
  assert.match(startupContext, /user_master/);
  assert.match(startupContext, /users: users\.rows\.map/);
});

test("no credential column ever leaves the database", () => {
  const code = startupContext.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /user_pw/, "the obfuscated password column must never be selected");
  assert.doesNotMatch(code, /super_pw/, "the supervisor password column must never be selected");
});

test("the login screen matches the typed operator against real data", () => {
  assert.doesNotMatch(startupGate, /migrationAccessUser/, "the hard-coded operator must be gone");
  assert.match(startupGate, /context\.users\.find/);
});

test("the shell shows the company, year and operator chosen at startup", () => {
  assert.match(startupGate, /StartupSelectionContext\.Provider/);
  assert.match(page, /useStartupSelection/);
  assert.doesNotMatch(page, /User: SRP/, "the status strip must not hard-code an operator");
});
