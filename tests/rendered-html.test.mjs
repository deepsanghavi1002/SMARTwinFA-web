import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
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
  const [page, layout, startup, addon, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/startup/StartupGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/addon-master/AddonMaster.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const menu of [
    "TRANSACTION",
    "REPORT",
    "GST",
    "INVENTORY",
    "ANALYSIS REP.",
    "MASTER",
    "SETUP",
    "UTILITY",
    "HELP",
  ]) {
    assert.match(page, new RegExp(menu.replace(".", "\\.")));
  }

  assert.match(page, /<StartupGate>/);
  assert.match(page, /activeItem === "Addon Master"/);
  assert.match(page, /home-splash/);
  assert.match(startup, /stage.*"login".*"company".*"ready"/s);
  assert.match(addon, /Customer \/ Contact details/);
  assert.match(addon, /Business \/ Tax details/);
  for (const action of ["Save", "Cancel", "Delete", "Print", "Refresh"]) {
    assert.match(addon, new RegExp(action));
  }
  assert.match(layout, /title:\s*"SMARTwinFA Web"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /drizzle|sqlite|d1/i);
});
