import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local Docker stack restores the private Rishabh seed and exposes the application on port 3000", async () => {
  const [compose, restore, envExample, gitignore, seedPreparer] = await Promise.all([
    read("compose.local.yaml"),
    read("docker/postgres/init/10-restore-rishabh.sh"),
    read(".env.docker.example"),
    read(".gitignore"),
    read("scripts/prepare-rishabh-local-seed.mjs"),
  ]);

  assert.match(compose, /SMARTWINFA_WEB_PORT:-3000/);
  assert.match(compose, /SMARTWINFA_POSTGRES_PORT:-5432/);
  assert.match(compose, /LEGACY_COMPANY_SCHEMA:-rishabh_plastic27/);
  assert.match(compose, /\.\/database\/fixtures\/private:\/seed:ro/);
  assert.match(restore, /rishabh-plastic27\.dump/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /--no-owner/);
  // Menu catalog, account master and product master read smart_setup, so the
  // stack must seed both documented intake schemas, not the company one alone.
  assert.match(restore, /smart-setup\.dump/);
  assert.match(restore, /count_tables smart_setup/);
  assert.match(seedPreparer, /smart-setup\.dump/);
  // The dumps store money as pre-formatted currency text that no locale can
  // parse; the restore must normalize those columns rather than fail on them.
  assert.match(restore, /TYPE money USING/);
  assert.match(restore, /data_type = 'money'/);
  assert.match(envExample, /SMARTWINFA_DB_PASSWORD=/);
  assert.match(gitignore, /\/database\/fixtures\/private\//);
  assert.match(gitignore, /!\.env\.docker\.example/);
  assert.match(seedPreparer, /PGDMP/);
  assert.match(seedPreparer, /platform\(\) !== "win32"/);
});
