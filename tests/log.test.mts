import assert from "node:assert/strict";
import test from "node:test";
import { logError, requestIdOf, scrub } from "../lib/log.ts";

function capture(run: () => void): string[] {
  const lines: string[] = [];
  const originals = { error: console.error, warn: console.warn, log: console.log };
  console.error = console.warn = console.log = (line: string) => void lines.push(line);
  try {
    run();
  } finally {
    Object.assign(console, originals);
  }
  return lines;
}

test("logError writes one JSON line with context and returns the request id", () => {
  let id = "";
  const lines = capture(() => {
    id = logError({ route: "/api/report", action: "Report", userId: "ALICE", companyKey: "3/2026", error: new Error("boom") });
  });
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, "error");
  assert.equal(line.route, "/api/report");
  assert.equal(line.userId, "ALICE");
  assert.equal(line.companyKey, "3/2026");
  assert.equal(line.message, "boom");
  assert.equal(line.requestId, id);
  assert.match(line.stack, /boom/);
});

test("a request id from the proxy is kept, a malformed one is replaced", () => {
  assert.equal(requestIdOf(new Request("http://x/", { headers: { "x-request-id": "abc-123456" } })), "abc-123456");
  assert.match(requestIdOf(new Request("http://x/", { headers: { "x-request-id": "bad id!" } })), /^[0-9a-f]{12}$/);
});

test("passwords, tokens and bearer values never reach the line", () => {
  assert.equal(scrub("login failed password=hunter2 for x"), "login failed password=[redacted] for x");
  assert.equal(scrub('{"token":"abcdef"}'), '{"token":[redacted]}');
  assert.match(scrub("Authorization: Bearer abcdefghijklmnop"), /\[redacted\]/);
  const lines = capture(() => logError({ error: new Error("bad cookie=SESSION123") }));
  assert.ok(!lines[0].includes("SESSION123"));
});

test("a non-Error value and a warn level are written as such", () => {
  const lines = capture(() => logError({ error: "plain text", level: "warn" }));
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, "warn");
  assert.equal(line.message, "plain text");
});
