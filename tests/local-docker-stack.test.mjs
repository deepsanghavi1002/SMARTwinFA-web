import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local Docker stack restores a selected private company seed and exposes the application on port 3000", async () => {
  const [compose, restore, settingsExample, gitignore, seedPreparer] = await Promise.all([
    read("compose.local.yaml"),
    read("docker/postgres/init/10-restore-company-seed.sh"),
    read("docker/local-settings.example"),
    read(".gitignore"),
    read("scripts/prepare-rishabh-local-seed.mjs"),
  ]);

  assert.match(compose, /SMARTWINFA_WEB_PORT:-3000/);
  assert.match(compose, /SMARTWINFA_POSTGRES_PORT:-5432/);
  assert.match(compose, /SMARTWINFA_COMPANY_DUMP/);
  assert.match(compose, /LEGACY_COMPANY_SCHEMA:-smartwinfa_demo/);
  assert.match(compose, /\.\/database\/fixtures\/private:\/seed:ro/);
  assert.match(restore, /SMARTWINFA_COMPANY_DUMP/);
  assert.match(restore, /LEGACY_COMPANY_SCHEMA/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /--no-owner/);
  assert.match(settingsExample, /SMARTWINFA_DB_PASSWORD=/);
  assert.match(settingsExample, /SMARTWINFA_COMPANY_DUMP=mock-company\.dump/);
  assert.match(gitignore, /\/database\/fixtures\/private\//);
  assert.match(seedPreparer, /PGDMP/);
  assert.match(seedPreparer, /platform\(\) !== "win32"/);
});
