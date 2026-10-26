import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
      ...init,
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("API requests without a session fail closed before database access", async () => {
  // No cookie means no lookup: these answer without a database, which the test run does not have.
  for (const [path, method] of [["/api/master-program", "POST"], ["/api/companies?year=1", "GET"], ["/api/operators", "GET"], ["/api/auth/me", "GET"], ["/api/auth/users", "GET"]]) {
    const response = await render(path, { method, ...(method === "POST" ? { body: "{}" } : {}) });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.match((await response.json()).error, /Sign in to continue/);
  }
});

test("a forged session cookie is refused without a lookup when it is not a token", async () => {
  const response = await render("/api/companies?year=1", { headers: { accept: "application/json", cookie: "swfa_session=not a token" } });
  assert.equal(response.status, 401);
});

test("writes from another site are refused before anything else", async () => {
  const response = await render("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 403);
});

test("health stays public", async () => {
  const response = await render("/api/health", { headers: { accept: "application/json" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("server-renders the SMARTwinFA login shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SMARTwinFA Web<\/title>/i);
  assert.match(html, /User Login Screen/);
  assert.match(html, /Developed By/);
  assert.match(html, /PRANAV COMPUTERS/);
  // The Legacy / Modern switch left the login screens; the view is chosen from the menu once signed in.
  assert.doesNotMatch(html, /aria-label="Switch to (modern|legacy) view"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the latest migrated application surface wired into the root route", async () => {
  const [page, layout, startup, masterScreen, packageJson, ...gridLibrary] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/startup/StartupGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/master-program/MasterProgram.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    // The grid features the master uses live in the shared grid library (features/grid).
    ...["filter.ts", "ColumnFilter.tsx", "EditorTools.tsx", "useDraggable.ts", "GridMenu.tsx", "LogViewer.tsx"].map((name) => readFile(new URL(`../features/grid/${name}`, import.meta.url), "utf8")),
  ]);
  const master = [masterScreen, ...gridLibrary].join("\n");

  // The menu roots used to be literals here. They now come from
  // smart_setup.menumaster for the company that was opened, so the page is
  // checked for the wiring rather than for any particular menu name.
  assert.match(page, /\/api\/menu\?group=/);
  assert.match(page, /menus\.map\(\(menu\) =>/);
  assert.match(page, /menu-branch/, "menumaster is three levels deep");

  assert.match(page, /<StartupGate>/);
  // Every MASTER menu row opens the one generic master for its ActionMenu program.
  assert.match(page, /code === "MASTER" && node\.actionMenu/);
  assert.match(page, /<MasterProgram /);
  assert.match(page, /home-splash/);
  assert.match(startup, /stage.*"login".*"company".*"ready"/s);
  for (const action of ["Save", "Cancel", "Refresh", "Export", "Quit", "Delete Row", "Hide Column", "Restore Cell Value"]) {
    assert.match(master, new RegExp(action));
  }
  // Print, image tab, edit log, module password, program 39/50 boxes, zoom and the Ezeone push.
  for (const action of ["Print", "Image", "Log", "module-password", "product-image", "master-log", "zoom-book", "cloud-push", "SCH_SALEHO", "PL_SRATE", "Numeric Filter", "Text Filter", "Date Filter", "Arrange Columns", "Clear the ", "\"figure\"", "useDraggable", "↓ Calendar", "Del Clear", "useEditorTools", "CalendarPopup"]) {
    assert.match(master, new RegExp(action));
  }
  assert.match(layout, /title:\s*"SMARTwinFA Web"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /drizzle|sqlite|d1/i);
});
