import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanFiles } from "../scripts/repository-safety-check.mjs";

async function withFixture(files, assertion) {
  const root = await mkdtemp(path.join(os.tmpdir(), "smartwinfa-safety-"));

  try {
    await Promise.all(
      Object.entries(files).map(async ([file, content]) => {
        const absolutePath = path.join(root, file);
        await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(absolutePath), { recursive: true }));
        await writeFile(absolutePath, content);
      }),
    );
    await assertion(root, Object.keys(files));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("allows sanitized source and documentation files", async () => {
  await withFixture(
    {
      "README.md": "Use synthetic fixtures only.",
      "docs/migration.md": "No client data is stored here.",
    },
    async (root, files) => {
      assert.deepEqual(await scanFiles(root, files), []);
    },
  );
});

test("rejects prohibited database, credential, and environment paths", async () => {
  await withFixture(
    {
      "connection.ini": "ServerName=PC1\nPassword=not-printed",
      "database/snapshots/client.dump": "archive",
      ".env.local": "SAFE_EXAMPLE=value",
    },
    async (root, files) => {
      const violations = await scanFiles(root, files);
      assert.deepEqual(
        violations.map(({ file, rule }) => [file, rule]),
        [
          ["connection.ini", "legacy connection file"],
          ["database/snapshots/client.dump", "legacy database export"],
          [".env.local", "environment file"],
        ],
      );
    },
  );
});

test("rejects secret material without exposing the secret value", async () => {
  await withFixture(
    {
      "config/example.txt": "DATABASE_URL=postgres://app:super-secret@db.internal/smartwin",
      "config/key.txt": "-----BEGIN PRIVATE KEY-----\nnot-a-real-key",
    },
    async (root, files) => {
      const violations = await scanFiles(root, files);
      assert.deepEqual(
        violations.map(({ file, rule }) => [file, rule]),
        [
          ["config/example.txt", "database connection string with credentials"],
          ["config/key.txt", "private key material"],
        ],
      );
      assert.doesNotMatch(JSON.stringify(violations), /super-secret/);
    },
  );
});
