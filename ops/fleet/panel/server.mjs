// SMARTwinFA control panel: one card per client on this Docker host, and a page per client with its
// logs, errors, containers and two actions (restart the web app, back up now). No dependencies: Node's own
// http, the Docker Engine API on its socket, and Loki's HTTP API.
//
//   PANEL_PASSWORD  the one sign-in (ops/fleet/.env, made by ops/smartwinfa.sh fleet up)
//   LOKI_URL        default http://loki:3100
//   PORT            default 8080
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKUP_STALE_HOURS, CLIENT_ID, PARTS, clientStatus, demuxDockerStream, flattenStreams, groupClients, hourlySlots, parseBackups,
} from "./lib.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const LOKI = (process.env.LOKI_URL ?? "http://loki:3100").replace(/\/+$/, "");
const PASSWORD = process.env.PANEL_PASSWORD ?? "";
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const SESSION_HOURS = 12;

if (PASSWORD.length < 8) {
  console.error("panel: PANEL_PASSWORD is missing or shorter than 8 characters");
  process.exit(1);
}

// ---- Docker Engine API over /var/run/docker.sock ----

function docker(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: "/var/run/docker.sock", path: apiPath, method, headers: body ? { "content-type": "application/json" } : {} }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.setTimeout(30_000, () => request.destroy(new Error("docker: no answer")));
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function dockerJson(method, apiPath, body) {
  const reply = await docker(method, apiPath, body);
  if (reply.status >= 400) throw new Error(`docker ${method} ${apiPath}: ${reply.status} ${reply.body.toString("utf8").slice(0, 200)}`);
  return reply.body.length > 0 ? JSON.parse(reply.body.toString("utf8")) : null;
}

async function listClients() {
  const filters = encodeURIComponent(JSON.stringify({ label: ["smartwinfa.client"] }));
  return groupClients(await dockerJson("GET", `/containers/json?all=1&filters=${filters}`));
}

/** Runs a command in a container and returns its output and exit code. */
async function exec(containerId, cmd, timeoutMs = 30_000) {
  const created = await dockerJson("POST", `/containers/${containerId}/exec`, { AttachStdout: true, AttachStderr: true, Cmd: cmd });
  const started = docker("POST", `/exec/${created.Id}/start`, { Detach: false, Tty: false });
  const reply = await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs))]);
  const { stdout, stderr } = demuxDockerStream(reply.body);
  const state = await dockerJson("GET", `/exec/${created.Id}/json`);
  return { stdout, stderr, exitCode: state.ExitCode };
}

// ---- Loki ----

async function loki(apiPath, params) {
  const response = await fetch(`${LOKI}${apiPath}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`loki ${apiPath}: ${response.status} ${(await response.text()).slice(0, 200)}`);
  return (await response.json()).data;
}

/** The log collector (alloy/config.alloy) labels a line error, fatal or panic by the first such word in it. */
const ERROR_LEVELS = 'level=~"error|fatal|panic"';

async function errorsLastHourByClient() {
  const data = await loki("/loki/api/v1/query", { query: `sum by (client) (count_over_time({client=~".+", ${ERROR_LEVELS}}[1h]))` });
  return new Map(data.result.map((row) => [row.metric.client, Number(row.value[1])]));
}

const regexEscape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function clientLogs(id, { part, minutes, search, level, limit }) {
  const selector = [`client="${id}"`];
  if (PARTS.includes(part)) selector.push(`service="${part}"`);
  if (level === "error") selector.push(ERROR_LEVELS);
  if (level === "warn") selector.push('level="warn"');
  let query = `{${selector.join(", ")}}`;
  if (search) query += ` |~ ${JSON.stringify(`(?i)${regexEscape(search)}`)}`;
  const end = Date.now();
  const data = await loki("/loki/api/v1/query_range", {
    query, limit: String(limit), direction: "backward", start: String((end - minutes * 60_000) * 1e6), end: String(end * 1e6),
  });
  return flattenStreams(data.result).slice(0, limit);
}

/** Errors in each of the last 24 hours (each point counts the hour before it), oldest first. */
async function errorsPerHour(id) {
  const end = Date.now();
  const start = end - 23 * 3600_000;
  const data = await loki("/loki/api/v1/query_range", {
    query: `sum(count_over_time({client="${id}", ${ERROR_LEVELS}}[1h]))`, start: String(start * 1e6), end: String(end * 1e6), step: "3600",
  });
  return hourlySlots(data.result[0]?.values ?? [], start);
}

// ---- What the panel knows about each client (backups are read at most every five minutes) ----

const backupCache = new Map();

/** The fleet's one backup job (ops/fleet/backup), which keeps /backups/<client>/ for every client. */
async function backupJob() {
  const filters = encodeURIComponent(JSON.stringify({ name: ["smartwinfa-backup"], status: ["running"] }));
  const found = (await dockerJson("GET", `/containers/json?filters=${filters}`)).find((container) => container.Names?.includes("/smartwinfa-backup"));
  return found ?? null;
}

async function backupsOf(client, fresh = false) {
  const cached = backupCache.get(client.id);
  if (!fresh && cached && Date.now() - cached.at < 300_000) return cached.list;
  const job = await backupJob();
  if (!job) return [];
  const listing = await exec(job.Id, ["sh", "-c", `cd /backups/${client.id} 2>/dev/null && for f in *.dump; do [ -e "$f" ] && stat -c "%Y %s %n" "$f"; done; true`]);
  const list = parseBackups(listing.stdout);
  backupCache.set(client.id, { at: Date.now(), list });
  return list;
}

async function healthOf(client) {
  const web = client.parts.web;
  if (!web || web.state !== "running") return { ok: false, release: "" };
  try {
    const response = await fetch(`http://${web.name}:3000/api/health`, { signal: AbortSignal.timeout(5_000) });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.status === "ok", release: String(body.release ?? "") };
  } catch {
    return { ok: false, release: "" };
  }
}

async function images() {
  const list = await dockerJson("GET", "/images/json");
  return new Map(list.map((image) => [image.Id, image.Created * 1000]));
}

async function summary(client, errors, imageDates) {
  const [health, backups] = await Promise.all([healthOf(client), backupsOf(client).catch(() => [])]);
  const errorsLastHour = errors.get(client.id) ?? 0;
  const lastBackupAt = backups[0]?.at ?? 0;
  const web = client.parts.web;
  return {
    id: client.id,
    status: clientStatus({ parts: client.parts, healthOk: health.ok, errorsLastHour, lastBackupAt }),
    parts: Object.fromEntries(PARTS.map((name) => {
      const part = client.parts[name];
      return [name, part ? { state: part.state, health: part.health, status: part.status } : null];
    })),
    errorsLastHour,
    lastBackup: backups[0] ?? null,
    version: { release: health.release, image: web?.image ?? "", builtAt: imageDates.get(web?.imageId) ?? 0 },
  };
}

async function clientsSummary() {
  const [clients, errors, imageDates] = await Promise.all([listClients(), errorsLastHourByClient().catch(() => new Map()), images().catch(() => new Map())]);
  return Promise.all(clients.map((client) => summary(client, errors, imageDates)));
}

async function findClient(id) {
  if (!CLIENT_ID.test(id)) return null;
  return (await listClients()).find((client) => client.id === id) ?? null;
}

async function memoryOf(part) {
  if (part.state !== "running") return 0;
  const stats = await dockerJson("GET", `/containers/${part.id}/stats?stream=false&one-shot=true`).catch(() => null);
  return stats?.memory_stats?.usage ?? 0;
}

async function clientDetail(id) {
  const client = await findClient(id);
  if (!client) return null;
  const [errors, imageDates] = await Promise.all([errorsLastHourByClient().catch(() => new Map()), images().catch(() => new Map())]);
  const card = await summary(client, errors, imageDates);
  const [backups, perHour, memories] = await Promise.all([
    backupsOf(client).catch(() => []),
    errorsPerHour(id).catch(() => []),
    Promise.all(PARTS.map((name) => (client.parts[name] ? memoryOf(client.parts[name]) : 0))),
  ]);
  const containers = PARTS.filter((name) => client.parts[name]).map((name) => {
    const part = client.parts[name];
    return { part: name, name: part.name, state: part.state, health: part.health, status: part.status, image: part.image, memory: memories[PARTS.indexOf(name)] };
  });
  return { ...card, containers, backups: backups.slice(0, 10), errorsPerHour: perHour, backupStaleHours: BACKUP_STALE_HOURS, job: jobs.get(id) ?? null };
}

// ---- Actions: restart the app, back up now (one at a time per client) ----

const jobs = new Map();

function startJob(id, kind, work) {
  const running = jobs.get(id);
  if (running && running.state === "running") return { ok: false, message: `${running.kind} is still running` };
  const job = { kind, state: "running", startedAt: Date.now(), message: "" };
  jobs.set(id, job);
  console.log(`panel: ${kind} for ${id} started`);
  work().then((message) => { job.state = "done"; job.message = message; console.log(`panel: ${kind} for ${id} done: ${message}`); })
    .catch((error) => { job.state = "failed"; job.message = error.message; console.error(`panel: ${kind} for ${id} failed: ${error.message}`); })
    .finally(() => { job.finishedAt = Date.now(); });
  return { ok: true };
}

async function restartApp(client) {
  const part = client.parts.web;
  if (!part) throw new Error("the web app is not part of this stack");
  await dockerJson("POST", `/containers/${part.id}/restart?t=20`);
  return "the web app was restarted";
}

async function backupNow(client) {
  if (!client.parts.db || client.parts.db.state !== "running") throw new Error("the database is not running");
  const job = await backupJob();
  if (!job) throw new Error("the backup job (smartwinfa-backup) is not running");
  const result = await exec(job.Id, ["/bin/sh", "/backup/backup.sh", "now", client.id], 30 * 60_000);
  if (result.exitCode !== 0) throw new Error(`pg_dump failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
  await backupsOf(client, true).catch(() => []);
  return `backup written: ${result.stdout.trim().split("\n").pop()}`;
}

// ---- Sign-in: one password, a cookie, failed attempts slowed down ----

const sessions = new Map();
const failures = new Map();
const digest = (text) => createHash("sha256").update(text).digest();

function clientIp(request) {
  return String(request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",")[0].trim();
}

function sessionOf(request) {
  const token = /(?:^|;\s*)panel_session=([A-Za-z0-9_-]+)/.exec(request.headers.cookie ?? "")?.[1];
  const session = token ? sessions.get(token) : undefined;
  if (!session || session.expires < Date.now()) return null;
  return token;
}

function secureRequest(request) {
  return /"scheme":"https"/.test(String(request.headers["cf-visitor"] ?? "")) || request.headers["x-forwarded-proto"] === "https";
}

function cookie(request, token, maxAge) {
  return `panel_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureRequest(request) ? "; Secure" : ""}`;
}

// ---- HTTP ----

function send(response, status, body, headers = {}) {
  const json = typeof body !== "string" && !Buffer.isBuffer(body);
  response.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", "content-type": json ? "application/json" : "text/plain; charset=utf-8", ...headers });
  response.end(json ? JSON.stringify(body) : body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10_000) throw new Error("body too large");
    chunks.push(chunk);
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/panel/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/panel/style.css": ["style.css", "text/css; charset=utf-8"],
};

async function route(request, response) {
  const url = new URL(request.url ?? "/", "http://panel");
  const file = STATIC[url.pathname];
  if (request.method === "GET" && file) {
    return send(response, 200, await readFile(path.join(PUBLIC, file[0])), { "content-type": file[1], "content-security-policy": "default-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
  }
  if (url.pathname === "/panel/healthz") return send(response, 200, { status: "ok" });
  if (!url.pathname.startsWith("/panel/api/")) return send(response, 404, { error: "not found" });

  // Every change needs the panel's own header: a page on another site cannot send it without asking first.
  if (request.method !== "GET" && request.headers["x-panel"] !== "1") return send(response, 403, { error: "refused" });

  if (url.pathname === "/panel/api/login" && request.method === "POST") {
    const ip = clientIp(request);
    const recent = (failures.get(ip) ?? []).filter((at) => Date.now() - at < 600_000);
    if (recent.length >= 10) return send(response, 429, { error: "Too many attempts. Try again in a few minutes." });
    const { password } = await readBody(request).catch(() => ({}));
    if (typeof password !== "string" || !timingSafeEqual(digest(password), digest(PASSWORD))) {
      failures.set(ip, [...recent, Date.now()]);
      console.warn(`panel: failed sign-in from ${ip}`);
      return send(response, 401, { error: "Wrong password." });
    }
    failures.delete(ip);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { expires: Date.now() + SESSION_HOURS * 3600_000 });
    console.log(`panel: signed in from ${ip}`);
    return send(response, 200, { ok: true }, { "set-cookie": cookie(request, token, SESSION_HOURS * 3600) });
  }

  const token = sessionOf(request);
  if (url.pathname === "/panel/api/session") return send(response, 200, { signedIn: Boolean(token) });
  if (!token) return send(response, 401, { error: "Sign in first." });

  if (url.pathname === "/panel/api/logout" && request.method === "POST") {
    sessions.delete(token);
    return send(response, 200, { ok: true }, { "set-cookie": cookie(request, "", 0) });
  }
  if (url.pathname === "/panel/api/clients" && request.method === "GET") return send(response, 200, { clients: await clientsSummary(), at: Date.now() });

  const match = /^\/panel\/api\/clients\/([a-z0-9-]+)(?:\/(logs|restart|backup))?$/.exec(url.pathname);
  if (!match) return send(response, 404, { error: "not found" });
  const [, id, action] = match;

  if (!action && request.method === "GET") {
    const detail = await clientDetail(id);
    return detail ? send(response, 200, detail) : send(response, 404, { error: "No such client on this server." });
  }
  if (action === "logs" && request.method === "GET") {
    if (!(await findClient(id))) return send(response, 404, { error: "No such client on this server." });
    const minutes = Math.min(Math.max(Number(url.searchParams.get("minutes")) || 60, 5), 7 * 24 * 60);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 300, 10), 1000);
    const lines = await clientLogs(id, {
      part: url.searchParams.get("part") ?? "", level: url.searchParams.get("level") ?? "", search: (url.searchParams.get("search") ?? "").slice(0, 200), minutes, limit,
    });
    return send(response, 200, { lines });
  }
  if ((action === "restart" || action === "backup") && request.method === "POST") {
    const client = await findClient(id);
    if (!client) return send(response, 404, { error: "No such client on this server." });
    const started = startJob(id, action === "restart" ? "Restart" : "Backup", () => (action === "restart" ? restartApp(client) : backupNow(client)));
    return started.ok ? send(response, 202, { ok: true }) : send(response, 409, { error: started.message });
  }
  return send(response, 405, { error: "not allowed" });
}

http.createServer((request, response) => {
  route(request, response).catch((error) => {
    console.error(`panel: ${request.method} ${request.url}: ${error.message}`);
    if (!response.headersSent) send(response, 500, { error: "The panel could not read this right now." });
  });
}).listen(PORT, () => console.log(`panel: listening on ${PORT}`));
