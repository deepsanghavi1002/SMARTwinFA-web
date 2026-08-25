import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local Docker stack restores the private Rishabh seed and exposes the application on port 3000", async () => {
  const [compose, restore, envExample, gitignore] = await Promise.all([
    read("compose.local.yaml"),
    read("docker/postgres/init/10-restore-rishabh.sh"),
    read(".env.docker.example"),
    read(".gitignore"),
  ]);

  assert.match(compose, /SMARTWINFA_WEB_PORT:-3000/);
  assert.match(compose, /SMARTWINFA_POSTGRES_PORT:-5432/);
  assert.match(compose, /LEGACY_COMPANY_SCHEMA:-rishabh_plastic27/);
  assert.match(compose, /\.\/database\/fixtures\/private:\/seed:ro/);
  assert.match(restore, /rishabh-plastic27\.dump/);
  assert.match(restore, /pg_restore/);
  assert.match(restore, /--no-owner/);
  assert.match(envExample, /SMARTWINFA_DB_PASSWORD=/);
  assert.match(gitignore, /\/database\/fixtures\/private\//);
  assert.match(gitignore, /!\.env\.docker\.example/);
});
