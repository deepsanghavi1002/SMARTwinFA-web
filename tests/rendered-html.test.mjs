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

test("generic master requests fail closed before database access by default", async () => {
  const previous = process.env.SMARTWINFA_TRUSTED_LOCAL_MODE;
  delete process.env.SMARTWINFA_TRUSTED_LOCAL_MODE;
  try {
    const response = await render("/api/master-program", { method: "POST", body: "{}" });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /disabled until authenticated sessions/);
  } finally {
    if (previous === undefined) delete process.env.SMARTWINFA_TRUSTED_LOCAL_MODE;
    else process.env.SMARTWINFA_TRUSTED_LOCAL_MODE = previous;
  }
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
  assert.match(html, /aria-label="Switch to modern view"/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the latest migrated application surface wired into the root route", async () => {
  const [page, layout, startup, master, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/startup/StartupGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/master-program/MasterProgram.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  // The menu roots used to be literals here. They now come from
  // smart_setup.menumaster for the company that was opened, so the page is
  // checked for the wiring rather than for any particular menu name.
  assert.match(page, /\/api\/menu\?group=/);
  assert.match(page, /menus\.map\(\(menu\) =>/);
  assert.match(page, /menu-branch/, "menumaster is three levels deep");

  assert.match(page, /<StartupGate>/);
  // Every MASTER menu row opens the one generic master for its ActionMenu program.
  assert.match(page, /actionCode\?\.toUpperCase\(\) === "MASTER" && running\.actionMenu/);
  assert.match(page, /<MasterProgram /);
  assert.match(page, /home-splash/);
  assert.match(startup, /stage.*"login".*"company".*"ready"/s);
  for (const action of ["Save", "Cancel", "Refresh", "Export", "Quit", "Delete Row", "Hide Column", "Restore Cell Value"]) {
    assert.match(master, new RegExp(action));
  }
  // Print, image tab, edit log, module password, program 39/50 boxes, zoom and the Ezeone push.
  for (const action of ["Print", "Image", "Log", "module-password", "product-image", "master-log", "zoom-book", "cloud-push", "SCH_SALEHO", "PL_SRATE", "Numeric Filter", "Text Filter", "Date Filter", "Arrange Columns", "Clear the ", "\"figure\"", "useDraggable", "↓ Calendar", "Del Clear", "toolKeys", "CalendarPopup"]) {
    assert.match(master, new RegExp(action));
  }
  assert.match(layout, /title:\s*"SMARTwinFA Web"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /drizzle|sqlite|d1/i);
});
