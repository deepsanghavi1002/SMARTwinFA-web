import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const execFileAsync = promisify(execFile);

const prohibitedPathRules = [
  ["legacy database export", /(?:^|\/)(?:backups|database\/snapshots|database\/fixtures\/private)(?:\/|$)/i],
  ["database archive", /\.(?:dump|backup|bak)$/i],
  ["legacy database export", /(?:_backup|_postgres_pc)\.sql$/i],
  ["legacy connection file", /(?:^|\/)connection\.ini$/i],
  ["private key file", /\.(?:pem|key|p12|pfx)$/i],
  ["environment file", /(?:^|\/)\.env(?:\.[^/]+)?$/i],
];

const secretContentRules = [
  ["private key material", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["database connection string with credentials", /(?:postgres(?:ql)?|mysql|mariadb):\/\/[^\s/:@]+:[^\s/@]+@/i],
  ["GitHub access token", /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ["OpenAI API key", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
];

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/").replace(/^\.\//, "");
}

export async function scanFiles(root, files) {
  const violations = [];

  for (const file of files) {
    const relativePath = normalizeRelativePath(file);
    const matchedPathRule = prohibitedPathRules.find(([, pattern]) => pattern.test(relativePath));

    if (matchedPathRule) {
      violations.push({ file: relativePath, rule: matchedPathRule[0] });
      continue;
    }

    const absolutePath = path.resolve(root, relativePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size > 1024 * 1024) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    if (content.includes("\0")) {
      continue;
    }

    for (const [rule, pattern] of secretContentRules) {
      if (pattern.test(content)) {
        violations.push({ file: relativePath, rule });
      }
    }
  }

  return violations;
}

export async function trackedFiles(root) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  return stdout.split("\0").filter(Boolean);
}

async function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const violations = await scanFiles(root, await trackedFiles(root));

  if (violations.length > 0) {
    console.error("Repository safety check failed. Remove or sanitize these tracked artifacts:");
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.rule}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Repository safety check passed.");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error(`Repository safety check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
