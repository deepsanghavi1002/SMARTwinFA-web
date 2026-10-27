// The control panel's page: #/ shows a card per client, #/client/<id> one client's page.
const view = document.getElementById("view");
const signout = document.getElementById("signout");
const PARTS = ["web", "api", "db", "backup"];
const PART_NAMES = { web: "Web app", api: "API", db: "Database", backup: "Backup" };
let timer = 0;

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const title = (id) => id.charAt(0).toUpperCase() + id.slice(1);

function ago(ms) {
  if (!ms) return "never";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`);
const LEVEL_WORD = { green: "All good", amber: "Needs a look", red: "Down" };

async function api(path, options = {}) {
  const response = await fetch(`/panel/api/${path}`, { ...options, headers: { "x-panel": "1", "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "login") { showLogin(); throw new Error("signed out"); }
  if (!response.ok) throw new Error(body.error ?? `Error ${response.status}`);
  return body;
}

/** Refreshes later, but not while someone is choosing log filters (the page is redrawn on refresh). */
function schedule(fn, ms) {
  clearTimeout(timer);
  timer = setTimeout(() => (document.activeElement?.closest("#filters") ? schedule(fn, 5_000) : fn()), ms);
}

// ---- Sign-in ----

function showLogin(message = "") {
  clearTimeout(timer);
  signout.hidden = true;
  view.innerHTML = `
    <form class="login" id="login">
      <h1>Sign in</h1>
      <p class="muted">The control panel for every SMARTwinFA client on this server.</p>
      <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <p class="error" id="login-error">${escapeHtml(message)}</p>
      <button type="submit" class="primary">Sign in</button>
    </form>`;
  document.getElementById("login").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.target).get("password");
    try {
      await api("login", { method: "POST", body: JSON.stringify({ password }) });
      route();
    } catch (error) {
      document.getElementById("login-error").textContent = error.message;
    }
  });
}

signout.addEventListener("click", async () => {
  await api("logout", { method: "POST" }).catch(() => undefined);
  showLogin();
});

// ---- Every client ----

function partChips(parts) {
  return PARTS.map((name) => {
    const part = parts[name];
    const state = !part ? "missing" : part.state !== "running" ? "down" : part.health === "unhealthy" ? "down" : part.health === "starting" ? "starting" : "up";
    const word = { up: "running", down: part ? part.state : "missing", starting: "starting", missing: "missing" }[state];
    return `<span class="chip ${state}" title="${escapeHtml(PART_NAMES[name])}: ${escapeHtml(word)}"><i></i>${escapeHtml(PART_NAMES[name])}</span>`;
  }).join("");
}

function card(client) {
  const { level, reasons } = client.status;
  return `
    <a class="card ${level}" href="#/client/${encodeURIComponent(client.id)}">
      <div class="card-top">
        <h2>${escapeHtml(title(client.id))}</h2>
        <span class="pill ${level}">${LEVEL_WORD[level]}</span>
      </div>
      <p class="reasons">${escapeHtml(reasons.join(" · ") || "Everything is running")}</p>
      <div class="chips">${partChips(client.parts)}</div>
      <dl class="facts">
        <div><dt>Errors (1 h)</dt><dd class="${client.errorsLastHour > 0 ? "warn" : ""}">${client.errorsLastHour}</dd></div>
        <div><dt>Last backup</dt><dd>${escapeHtml(ago(client.lastBackup?.at))}</dd></div>
        <div><dt>Version</dt><dd>${escapeHtml(client.version.release || "—")}${client.version.builtAt ? ` <small>${escapeHtml(when(client.version.builtAt))}</small>` : ""}</dd></div>
      </dl>
    </a>`;
}

async function showClients() {
  try {
    const { clients, at } = await api("clients");
    signout.hidden = false;
    const count = (level) => clients.filter((client) => client.status.level === level).length;
    view.innerHTML = `
      <section class="head">
        <h1>Clients</h1>
        <p class="muted">${clients.length} on this server · <span class="dot green"></span>${count("green")} good · <span class="dot amber"></span>${count("amber")} need a look · <span class="dot red"></span>${count("red")} down · updated ${escapeHtml(time(at))}</p>
      </section>
      ${clients.length === 0 ? `<p class="empty">No client stacks on this server yet. Start one with <code>ops/smartwinfa.sh client up &lt;id&gt;</code>.</p>` : `<div class="grid">${clients.map(card).join("")}</div>`}`;
  } catch (error) {
    if (error.message !== "signed out") view.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    else return;
  }
  schedule(route, 15_000);
}

// ---- One client ----

const logFilters = { part: "", level: "", minutes: 60, search: "" };

function errorChart(points) {
  if (!points.some((point) => point.count > 0)) return `<p class="muted">No errors in the last 24 hours.</p>`;
  const max = Math.max(1, ...points.map((point) => point.count));
  const width = 24 * 22;
  const bars = points.map((point, index) => {
    const height = Math.max(point.count > 0 ? 3 : 0, Math.round((point.count / max) * 90));
    return `<rect x="${index * 22 + 3}" y="${100 - height}" width="16" height="${height}" rx="2"><title>${escapeHtml(when(point.at))}: ${point.count} error${point.count === 1 ? "" : "s"}</title></rect>`;
  }).join("");
  const total = points.reduce((sum, point) => sum + point.count, 0);
  return `<svg class="chart" viewBox="0 0 ${width} 104" role="img" aria-label="${total} errors in the last 24 hours, per hour">${bars}<line x1="0" y1="100.5" x2="${width}" y2="100.5"></line></svg>
    <p class="muted small">${total} error lines in the last 24 hours · each bar is one hour, newest on the right</p>`;
}

function containersTable(containers) {
  return `<table class="table"><thead><tr><th>Part</th><th>State</th><th>Since</th><th>Memory</th><th>Image</th></tr></thead><tbody>
    ${containers.map((row) => `<tr>
      <td>${escapeHtml(PART_NAMES[row.part] ?? row.part)}</td>
      <td><span class="chip ${row.state === "running" && row.health !== "unhealthy" ? (row.health === "starting" ? "starting" : "up") : "down"}"><i></i>${escapeHtml(row.health || row.state)}</span></td>
      <td>${escapeHtml(row.status)}</td>
      <td>${row.memory ? escapeHtml(size(row.memory)) : "—"}</td>
      <td class="mono">${escapeHtml(row.image)}</td>
    </tr>`).join("")}</tbody></table>`;
}

function backupsList(backups, staleHours) {
  if (backups.length === 0) return `<p class="muted">No backups yet. The nightly one runs at the backup hour, or press Backup now.</p>`;
  return `<ul class="list">${backups.map((backup) => `<li><span class="mono">${escapeHtml(backup.name)}</span><span>${escapeHtml(size(backup.bytes))}</span><span class="${Date.now() - backup.at > staleHours * 3600_000 ? "warn" : ""}">${escapeHtml(when(backup.at))} · ${escapeHtml(ago(backup.at))}</span></li>`).join("")}</ul>`;
}

function jobBanner(job) {
  if (!job) return "";
  const word = { running: "is running…", done: "finished", failed: "failed" }[job.state];
  return `<p class="job ${job.state}">${escapeHtml(job.kind)} ${word}${job.message ? ` — ${escapeHtml(job.message)}` : ""}${job.finishedAt ? ` (${escapeHtml(ago(job.finishedAt))})` : ""}</p>`;
}

async function loadLogs(id) {
  const box = document.getElementById("logs");
  if (!box) return;
  const params = new URLSearchParams({ minutes: String(logFilters.minutes), limit: "400" });
  if (logFilters.part) params.set("part", logFilters.part);
  if (logFilters.level) params.set("level", logFilters.level);
  if (logFilters.search) params.set("search", logFilters.search);
  try {
    const { lines } = await api(`clients/${encodeURIComponent(id)}/logs?${params}`);
    box.innerHTML = lines.length === 0
      ? `<p class="muted">No log lines for this choice.</p>`
      : lines.map((line) => `<div class="line ${escapeHtml(line.level)}"><time>${escapeHtml(time(line.at))}</time><b>${escapeHtml(line.part)}</b><span>${escapeHtml(line.line)}</span></div>`).join("");
  } catch (error) {
    if (error.message !== "signed out") box.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function act(id, action, question) {
  if (!window.confirm(question)) return;
  try {
    await api(`clients/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  } catch (error) {
    window.alert(error.message);
  }
  route();
}

async function showClient(id) {
  let client;
  try {
    client = await api(`clients/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error.message !== "signed out") view.innerHTML = `<p><a href="#/">← All clients</a></p><p class="error">${escapeHtml(error.message)}</p>`;
    return;
  }
  signout.hidden = false;
  const { level, reasons } = client.status;
  const busy = client.job?.state === "running";
  const keepScroll = document.getElementById("logs")?.scrollTop ?? 0;
  const sameClient = view.dataset.client === id;
  view.dataset.client = id;
  view.innerHTML = `
    <p><a href="#/">← All clients</a></p>
    <section class="head client-head">
      <div>
        <h1>${escapeHtml(title(client.id))} <span class="pill ${level}">${LEVEL_WORD[level]}</span></h1>
        <p class="muted">${escapeHtml(reasons.join(" · ") || "Everything is running")}</p>
      </div>
      <div class="actions">
        <button type="button" id="restart" ${busy ? "disabled" : ""}>Restart app</button>
        <button type="button" id="backup" class="primary" ${busy ? "disabled" : ""}>Backup now</button>
        <a class="button" href="/grafana/d/smartwinfa-clients?var-client=${encodeURIComponent(client.id)}" target="_blank" rel="noopener">Open in Grafana</a>
      </div>
    </section>
    ${jobBanner(client.job)}
    <dl class="tiles">
      <div><dt>Errors (1 h)</dt><dd class="${client.errorsLastHour > 0 ? "warn" : ""}">${client.errorsLastHour}</dd></div>
      <div><dt>Last backup</dt><dd>${escapeHtml(ago(client.lastBackup?.at))}</dd></div>
      <div><dt>Version</dt><dd>${escapeHtml(client.version.release || "—")}</dd><small>${escapeHtml(client.version.builtAt ? `built ${when(client.version.builtAt)}` : "")}</small></div>
      <div><dt>Parts running</dt><dd>${client.containers.filter((row) => row.state === "running").length} of ${PARTS.length}</dd></div>
    </dl>
    <section class="panel"><h2>Parts</h2>${containersTable(client.containers)}</section>
    <div class="two">
      <section class="panel"><h2>Errors</h2>${errorChart(client.errorsPerHour)}</section>
      <section class="panel"><h2>Backups</h2>${backupsList(client.backups, client.backupStaleHours)}</section>
    </div>
    <section class="panel">
      <h2>Logs</h2>
      <form class="filters" id="filters">
        <label>Part <select name="part"><option value="">All</option>${PARTS.map((name) => `<option value="${name}" ${logFilters.part === name ? "selected" : ""}>${PART_NAMES[name]}</option>`).join("")}</select></label>
        <label>Level <select name="level"><option value="">All</option><option value="error" ${logFilters.level === "error" ? "selected" : ""}>Errors</option><option value="warn" ${logFilters.level === "warn" ? "selected" : ""}>Warnings</option></select></label>
        <label>Period <select name="minutes">${[[15, "15 min"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"], [10080, "7 days"]].map(([value, word]) => `<option value="${value}" ${logFilters.minutes === value ? "selected" : ""}>${word}</option>`).join("")}</select></label>
        <label class="grow">Search <input type="search" name="search" value="${escapeHtml(logFilters.search)}" placeholder="text in the line"></label>
        <button type="submit">Show</button>
      </form>
      <div class="logs" id="logs"><p class="muted">Loading…</p></div>
    </section>`;
  document.getElementById("restart").addEventListener("click", () => act(id, "restart", `Restart ${title(id)}'s app (API and web)? It is unavailable for up to a minute; users stay signed in.`));
  document.getElementById("backup").addEventListener("click", () => act(id, "backup", `Back up ${title(id)}'s database now?`));
  document.getElementById("filters").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    Object.assign(logFilters, { part: form.get("part"), level: form.get("level"), minutes: Number(form.get("minutes")), search: String(form.get("search") ?? "").trim() });
    loadLogs(id);
  });
  await loadLogs(id);
  if (sameClient) document.getElementById("logs").scrollTop = keepScroll;
  schedule(route, busy ? 4_000 : 20_000);
}

// ---- Routing ----

async function route() {
  clearTimeout(timer);
  const match = /^#\/client\/([a-z0-9-]+)$/.exec(location.hash);
  if (!match) delete view.dataset.client;
  try {
    const { signedIn } = await api("session");
    if (!signedIn) return showLogin();
  } catch {
    return;
  }
  return match ? showClient(match[1]) : showClients();
}

window.addEventListener("hashchange", () => {
  if (!/^#\/client\//.test(location.hash)) Object.assign(logFilters, { part: "", level: "", minutes: 60, search: "" });
  route();
});
route();
