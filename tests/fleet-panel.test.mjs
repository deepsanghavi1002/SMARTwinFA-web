import assert from "node:assert/strict";
import test from "node:test";
import { clientStatus, demuxDockerStream, flattenStreams, groupClients, healthOf, hourlySlots, parseBackups } from "../ops/fleet/panel/lib.mjs";

const container = (client, service, state = "running", status = "Up 2 hours (healthy)") => ({
  Id: `${client}-${service}-id`, Names: [`/${client}-${service}`], State: state, Status: status, Image: `smartwinfa-${service}:local`, ImageID: "sha256:1", Created: 1,
  Labels: { "smartwinfa.client": client, "com.docker.compose.service": service },
});
const parts = (overrides = {}) => Object.fromEntries(["web", "db"].map((name) => [name, { state: "running", health: "", ...overrides[name] }]));
const now = Date.UTC(2026, 9, 27, 12);

test("the panel groups containers into clients by their smartwinfa.client label", () => {
  const clients = groupClients([
    container("vaishali", "web"), container("rishabh", "web"), container("rishabh", "db", "exited", "Exited (1) 3 minutes ago"),
    { Id: "x", Names: ["/smartwinfa-fleet-loki-1"], State: "running", Status: "Up", Labels: { "com.docker.compose.service": "loki" } },
    container("Bad Id", "web"),
  ]);
  assert.deepEqual(clients.map((client) => client.id), ["rishabh", "vaishali"]);
  assert.equal(clients[0].parts.db.state, "exited");
  assert.equal(clients[0].parts.web.name, "rishabh-web");
  assert.equal(clients[0].parts.web.health, "healthy");
});

test("container health is read from Docker's status text", () => {
  assert.equal(healthOf("Up 2 hours (healthy)"), "healthy");
  assert.equal(healthOf("Up 3 seconds (health: starting)"), "starting");
  assert.equal(healthOf("Up 1 minute (unhealthy)"), "unhealthy");
  assert.equal(healthOf("Up 7 hours"), "");
});

test("a client is red when its app does not answer or a part is down", () => {
  assert.deepEqual(clientStatus({ parts: parts(), healthOk: false, errorsLastHour: 0, lastBackupAt: now, now }), { level: "red", reasons: ["app not answering"] });
  const downDb = clientStatus({ parts: parts({ db: { state: "exited" } }), healthOk: true, errorsLastHour: 0, lastBackupAt: now, now });
  assert.equal(downDb.level, "red");
  assert.deepEqual(downDb.reasons, ["db down"]);
  const missingWeb = clientStatus({ parts: { ...parts(), web: undefined }, healthOk: true, errorsLastHour: 0, lastBackupAt: now, now });
  assert.deepEqual(missingWeb.reasons, ["web down"]);
  assert.equal(clientStatus({ parts: parts({ db: { health: "unhealthy" } }), healthOk: true, errorsLastHour: 0, lastBackupAt: now, now }).level, "red");
});

test("a client is amber for errors, a part starting, or an old or missing backup", () => {
  assert.deepEqual(clientStatus({ parts: parts(), healthOk: true, errorsLastHour: 3, lastBackupAt: now, now }).reasons, ["3 errors in the last hour"]);
  assert.deepEqual(clientStatus({ parts: parts({ web: { health: "starting" } }), healthOk: true, errorsLastHour: 0, lastBackupAt: now, now }).reasons, ["starting up"]);
  assert.deepEqual(clientStatus({ parts: parts(), healthOk: true, errorsLastHour: 0, lastBackupAt: 0, now }).reasons, ["no backup yet"]);
  assert.deepEqual(clientStatus({ parts: parts(), healthOk: true, errorsLastHour: 0, lastBackupAt: now - 37 * 3600_000, now }).reasons, ["last backup is old"]);
  assert.deepEqual(clientStatus({ parts: parts(), healthOk: true, errorsLastHour: 0, lastBackupAt: now - 3600_000, now }), { level: "green", reasons: [] });
});

test("Docker's exec output is split into stdout and stderr", () => {
  const frame = (stream, text) => Buffer.concat([Buffer.from([stream, 0, 0, 0]), Buffer.from([0, 0, 0, Buffer.byteLength(text)]), Buffer.from(text)]);
  assert.deepEqual(demuxDockerStream(Buffer.concat([frame(1, "one "), frame(2, "oops"), frame(1, "two")])), { stdout: "one two", stderr: "oops" });
  assert.deepEqual(demuxDockerStream(Buffer.alloc(0)), { stdout: "", stderr: "" });
});

test("backups are listed newest first, and manual ones are marked", () => {
  const list = parseBackups("1761530000 1048576 2026-10-27.dump\n1761540000 2048 manual-2026-10-27-0512.dump\n\nnot a backup line\n");
  assert.deepEqual(list.map((backup) => backup.name), ["manual-2026-10-27-0512.dump", "2026-10-27.dump"]);
  assert.equal(list[0].manual, true);
  assert.equal(list[1].at, 1761530000 * 1000);
  assert.equal(list[1].bytes, 1048576);
});

test("Loki's log streams become one list, newest first", () => {
  const lines = flattenStreams([
    { stream: { service: "web", level: "info" }, values: [["1761530000000000000", "started"]] },
    { stream: { service: "api", level: "error" }, values: [["1761530005000000000", "failed"], ["1761529990000000000", "older"]] },
    { stream: { service: "db", level: "fatal" }, values: [["1761529980000000000", "FATAL: no such database"]] },
  ]);
  assert.deepEqual(lines.map((line) => [line.part, line.level, line.line]), [
    ["api", "error", "failed"], ["web", "info", "started"], ["api", "error", "older"], ["db", "error", "FATAL: no such database"],
  ]);
  assert.equal(lines[0].at, 1761530005000);
});

test("errors per hour fill 24 slots, newest on the right, with empty hours at 0", () => {
  const start = now - 23 * 3600_000;
  const slots = hourlySlots([[String((now - 23 * 3600_000) / 1000), "2"], [String(now / 1000), "7"]], start);
  assert.equal(slots.length, 24);
  assert.equal(slots[0].count, 2);
  assert.equal(slots[23].count, 7);
  assert.equal(slots.slice(1, 23).every((slot) => slot.count === 0), true);
});
