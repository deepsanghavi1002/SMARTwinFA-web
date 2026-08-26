#!/usr/bin/env node

// Cross-platform launcher for the vinext CLI.
//
// npm runs package scripts through cmd.exe on Windows, where the POSIX
// `VAR=value command` prefix is not valid syntax. Using it directly made
// `npm run dev`, `npm run build`, `npm start`, and therefore `npm test`
// fail before doing any work on Windows developer machines.

import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-vinext.mjs <vinext-command> [...args]");
  process.exit(1);
}

const child = spawn("vinext", args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
  },
});

child.on("error", (error) => {
  console.error(`Unable to start vinext: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
