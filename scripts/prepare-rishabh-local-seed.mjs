#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const privateDir = resolve(repoRoot, "database", "fixtures", "private");

// The local stack needs both documented intake schemas: the per-company schema
// and the shared smart_setup metadata schema. Menu catalog, account master and
// product master all read smart_setup, so a company-only seed leaves them
// failing with "relation smart_setup.<table> does not exist".
const seeds = [
  {
    label: "company",
    source: process.argv[2] ?? resolve(homedir(), "Downloads", "rishabh_plastic27_backup.sql"),
    target: resolve(privateDir, "rishabh-plastic27.dump"),
  },
  {
    label: "setup",
    source: process.argv[3] ?? resolve(homedir(), "Downloads", "smart_setup_postgres_pc.sql"),
    target: resolve(privateDir, "smart-setup.dump"),
  },
];

try {
  await mkdir(privateDir, { recursive: true });

  for (const seed of seeds) {
    const source = resolve(seed.source);
    const contents = await readFile(source);

    if (contents.subarray(0, 5).toString("ascii") !== "PGDMP") {
      throw new Error(`The supplied ${seed.label} file is not a PostgreSQL custom dump (expected a PGDMP header).`);
    }

    await copyFile(source, seed.target);
    if (platform() !== "win32") {
      await chmod(seed.target, 0o600);
    }

    const { size } = await stat(seed.target);
    console.log(`Prepared ${seed.label} seed at: ${seed.target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log("Both seeds are ignored by Git.");
  console.log("Docker verifies and restores the rishabh_plastic27 and smart_setup schemas on first startup.");
} catch (error) {
  console.error(`Unable to prepare Rishabh Plastic seed: ${error.message}`);
  console.error("Pass the authorized company dump as the first argument and the smart_setup dump as the second.");
  process.exitCode = 1;
}
