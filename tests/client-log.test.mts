import assert from "node:assert/strict";
import test from "node:test";
import { handleClientLog, MAX_BODY_BYTES, PER_CLIENT_PER_MINUTE, resetClientLogLimits } from "../lib/client-log.ts";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://app.example/api/client-log", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1", "user-agent": "TestAgent/1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function capture(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => void lines.push(line);
  return run().then(() => lines).finally(() => { console.error = original; });
}

test("a report becomes one structured line without the query string or secrets", async () => {
  resetClientLogLimits();
  const lines = await capture(async () => {
    const response = await handleClientLog(post({ source: "window.error", message: "x is undefined password=abc", stack: "at f (a.js:1)", url: "https://h.example/set-password?token=SECRET#t=SECRET", view: "Modern", screenWidth: 390.7 }));
    assert.equal(response.status, 204);
  });
  assert.equal(lines.length, 1);
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, "error");
  assert.equal(line.route, "client");
  assert.equal(line.view, "Modern");
  assert.equal(line.url, "https://h.example/set-password");
  assert.equal(line.screenWidth, 390);
  assert.equal(line.userAgent, "TestAgent/1");
  assert.ok(!lines[0].includes("SECRET") && !lines[0].includes("=abc"));
});

test("a body without a message, not JSON, or too large is refused and writes nothing", async () => {
  resetClientLogLimits();
  const lines = await capture(async () => {
    assert.equal((await handleClientLog(post({ stack: "s" }))).status, 400);
    assert.equal((await handleClientLog(post("not json"))).status, 400);
    assert.equal((await handleClientLog(post({ message: "a".repeat(MAX_BODY_BYTES + 1) }))).status, 413);
    assert.equal((await handleClientLog(post({ message: "m" }, { "content-length": String(MAX_BODY_BYTES + 1) }))).status, 413);
  });
  assert.equal(lines.length, 0);
});

test("one address is limited per minute and recovers afterwards", async () => {
  resetClientLogLimits();
  await capture(async () => {
    for (let i = 0; i < PER_CLIENT_PER_MINUTE; i += 1) assert.equal((await handleClientLog(post({ message: `m${i}` }), 1000)).status, 204);
    assert.equal((await handleClientLog(post({ message: "more" }), 1000)).status, 429);
    assert.equal((await handleClientLog(post({ message: "other" }, { "x-forwarded-for": "10.0.0.2" }), 1000)).status, 204);
    assert.equal((await handleClientLog(post({ message: "later" }), 62_000)).status, 204);
  });
});
