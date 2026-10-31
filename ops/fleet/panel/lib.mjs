// The control panel's own logic, kept free of I/O so tests can run it (tests/fleet-panel.test.mjs).

/** The parts of a client stack, in the order the panel shows them. */
export const PARTS = ["web", "db"];

/** A nightly backup older than this marks the client amber. */
export const BACKUP_STALE_HOURS = 36;

export const CLIENT_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** "Up 2 hours (healthy)" -> "healthy"; "Up 5 seconds (health: starting)" -> "starting"; none -> "". */
export function healthOf(statusText) {
  const found = /\((healthy|unhealthy|health: starting)\)/.exec(statusText ?? "");
  if (!found) return "";
  return found[1] === "health: starting" ? "starting" : found[1];
}

/**
 * Docker's container list (GET /containers/json) grouped into clients by the smartwinfa.client label.
 * Each part is { name, id, state, health, status, image, imageId, created }.
 */
export function groupClients(containers) {
  const clients = new Map();
  for (const container of containers) {
    const labels = container.Labels ?? {};
    const client = labels["smartwinfa.client"];
    if (!client || !CLIENT_ID.test(client)) continue;
    const part = labels["com.docker.compose.service"] ?? "";
    if (!clients.has(client)) clients.set(client, { id: client, parts: {} });
    clients.get(client).parts[part] = {
      name: (container.Names?.[0] ?? "").replace(/^\//, ""),
      id: container.Id,
      state: container.State ?? "",
      health: healthOf(container.Status),
      status: container.Status ?? "",
      image: container.Image ?? "",
      imageId: container.ImageID ?? "",
      created: container.Created ?? 0,
    };
  }
  return [...clients.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** A part is fine when it runs and is not reported unhealthy. */
export function partOk(part) {
  return Boolean(part) && part.state === "running" && part.health !== "unhealthy";
}

/**
 * The client's colour and why: red when the app does not answer or a part is down, amber for
 * errors in the last hour, a part still starting or an old / missing backup, else green.
 */
export function clientStatus({ parts, healthOk, errorsLastHour, lastBackupAt, now = Date.now() }) {
  const reasons = [];
  const missing = PARTS.filter((name) => !partOk(parts[name]));
  if (!healthOk) reasons.push("app not answering");
  if (missing.length > 0) reasons.push(`${missing.join(", ")} down`);
  if (reasons.length > 0) return { level: "red", reasons };
  if (errorsLastHour > 0) reasons.push(`${errorsLastHour} error${errorsLastHour === 1 ? "" : "s"} in the last hour`);
  if (PARTS.some((name) => parts[name]?.health === "starting")) reasons.push("starting up");
  if (!lastBackupAt) reasons.push("no backup yet");
  else if (now - lastBackupAt > BACKUP_STALE_HOURS * 3600_000) reasons.push("last backup is old");
  return { level: reasons.length > 0 ? "amber" : "green", reasons };
}

/**
 * The output of a Docker exec without a TTY: frames of an 8-byte header (stream, 0, 0, 0, size as
 * big-endian uint32) followed by that many bytes. Returns { stdout, stderr }.
 */
export function demuxDockerStream(buffer) {
  const out = { stdout: [], stderr: [] };
  let at = 0;
  while (at + 8 <= buffer.length) {
    const stream = buffer[at];
    const size = buffer.readUInt32BE(at + 4);
    const chunk = buffer.subarray(at + 8, at + 8 + size);
    (stream === 2 ? out.stderr : out.stdout).push(chunk);
    at += 8 + size;
  }
  return { stdout: Buffer.concat(out.stdout).toString("utf8"), stderr: Buffer.concat(out.stderr).toString("utf8") };
}

/** Lines of "<mtime seconds> <size bytes> <name>" -> backups, newest first. */
export function parseBackups(text) {
  return text
    .split("\n")
    .map((line) => /^(\d+) (\d+) (.+\.dump)$/.exec(line.trim()))
    .filter(Boolean)
    .map(([, mtime, size, name]) => ({ name, at: Number(mtime) * 1000, bytes: Number(size), manual: name.startsWith("manual-") }))
    .sort((a, b) => b.at - a.at);
}

/**
 * Loki's matrix values ([seconds, "count"], only where there were any) -> 24 hourly points from `start` (ms),
 * oldest first, with 0 where Loki returned nothing.
 */
export function hourlySlots(values, start) {
  const slots = Array.from({ length: 24 }, (_, index) => ({ at: start + index * 3600_000, count: 0 }));
  for (const [seconds, count] of values) {
    const index = Math.round((Number(seconds) * 1000 - start) / 3600_000);
    if (index >= 0 && index < 24) slots[index].count = Number(count);
  }
  return slots;
}

/** Loki's streams (query_range) -> lines, newest first: { at (ms), part, level, line }. */
export function flattenStreams(result) {
  const lines = [];
  for (const stream of result ?? []) {
    const labels = stream.stream ?? {};
    for (const [ns, line] of stream.values ?? []) {
      const level = ["fatal", "panic"].includes(labels.level) ? "error" : labels.level ?? "info";
      lines.push({ at: Number(BigInt(ns) / 1_000_000n), part: labels.service ?? "", level, line });
    }
  }
  return lines.sort((a, b) => b.at - a.at);
}
