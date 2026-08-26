import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// npm runs package scripts through cmd.exe on Windows, where a leading
// `VAR=value` assignment is not valid syntax. A script that starts with one
// fails immediately, which silently skipped the whole test suite on Windows.
const posixEnvPrefix = /^\s*[A-Z_][A-Z0-9_]*=/;

test("package scripts do not use POSIX-only environment variable prefixes", async () => {
  const { scripts } = JSON.parse(await read("package.json"));

  for (const [name, command] of Object.entries(scripts)) {
    assert.doesNotMatch(
      command,
      posixEnvPrefix,
      `npm script "${name}" starts with a POSIX-only env assignment and cannot run on Windows`,
    );
  }
});

test("the vinext launcher supplies the wrangler log path itself", async () => {
  const launcher = await read("scripts/run-vinext.mjs");

  assert.match(launcher, /WRANGLER_LOG_PATH/);
  assert.match(launcher, /spawn\(/);

  const { scripts } = JSON.parse(await read("package.json"));
  for (const name of ["dev", "build", "start"]) {
    assert.match(scripts[name], /^node scripts\/run-vinext\.mjs /, `npm script "${name}" should use the launcher`);
  }
});
