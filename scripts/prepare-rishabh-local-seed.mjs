#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultSource = resolve(homedir(), "Downloads", "rishabh_plastic27_backup.sql");
const sourceDump = resolve(process.argv[2] ?? defaultSource);
const targetDump = resolve(repoRoot, "database", "fixtures", "private", "rishabh-plastic27.dump");

try {
  const source = await readFile(sourceDump);

  if (source.subarray(0, 5).toString("ascii") !== "PGDMP") {
    throw new Error("The supplied file is not a PostgreSQL custom dump (expected a PGDMP header).");
  }

  await mkdir(dirname(targetDump), { recursive: true });
  await copyFile(sourceDump, targetDump);

  if (platform() !== "win32") {
    await chmod(targetDump, 0o600);
  }

  const { size } = await stat(targetDump);
  console.log(`Private Rishabh Plastic seed prepared at: ${targetDump}`);
  console.log(`Copied ${(size / 1024 / 1024).toFixed(1)} MB. It is ignored by Git.`);
  console.log("Docker verifies and restores the rishabh_plastic27 schema on first startup.");
} catch (error) {
  console.error(`Unable to prepare Rishabh Plastic seed: ${error.message}`);
  console.error("Pass the authorized PostgreSQL custom dump path as the first argument.");
  process.exitCode = 1;
}
