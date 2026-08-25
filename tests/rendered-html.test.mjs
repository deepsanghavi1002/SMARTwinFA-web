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

async function renderHealth() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("health-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/api/health"), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("exposes a no-cache deployment health contract", async () => {
  const response = await renderHealth();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "ok",
    service: "smartwinfa-web",
    release: "development",
    schemaBaseline: "0002_canonical_accounting",
    runtimeMode: "migration-test",
  });
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
  assert.doesNotMatch(html, /aria-label="Switch to modern view"/i);
  assert.doesNotMatch(html, /Switch to modern/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the latest migrated application surface wired into the root route", async () => {
  const [page, layout, startup, addon, demoWorkflows, legacyMaster, entryWorkflow, entryContext, reportWorkflow, utilityWorkflows, productMaster, addonMaster, startupContext, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/startup/StartupGate.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/addon-master/AddonMaster.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/demo-workflows/DemoWorkflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/demo-workflows/LegacyMasterWorkflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/demo-workflows/LegacyEntryWorkflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../platform/legacy-db/entry-context.ts", import.meta.url), "utf8"),
    readFile(new URL("../features/demo-workflows/LegacyReportWorkflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../features/demo-workflows/LegacyUtilityWorkflows.tsx", import.meta.url), "utf8"),
    readFile(new URL("../platform/legacy-db/product-master.ts", import.meta.url), "utf8"),
    readFile(new URL("../platform/legacy-db/addon-master.ts", import.meta.url), "utf8"),
    readFile(new URL("../platform/legacy-db/startup-context.ts", import.meta.url), "utf8"),
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
  assert.match(page, /hasDemoWorkflow\(activeItem\)/);
  assert.match(page, /home-splash/);
  assert.match(startup, /stage.*"login".*"company".*"ready"/s);
  assert.match(startup, /\/api\/legacy\/startup/);
  assert.doesNotMatch(startup, /mock-data|Synthetic test company|Demo company/);
  assert.match(startupContext, /legacy-postgresql/);
  assert.match(startupContext, /legacyCompanySchema/);
  assert.match(addon, /Real Addon Master/);
  assert.match(addon, /Click any cell to edit/);
  assert.match(addon, /Save definitions/);
  assert.match(addon, /Save lookup values/);
  assert.doesNotMatch(addon, /<th>KEY<\/th>/);
  for (const action of ["Delete", "Print", "Refresh"]) {
    assert.match(addon, new RegExp(action));
  }
  for (const workflow of [
    "Account Master",
    "Product Master",
    "Sale Invoice",
    "Cash / Bank Voucher",
    "Journal Voucher",
    "Discount Voucher",
    "Product Import from Excel",
    "Day Book",
    "Ledger Report",
    "Outstanding Report",
    "Trial Balance",
    "Top Report",
    "Drop Analysis",
    "Multiple Invoice PDF",
    "Pie Chart",
    "Monthly Closing Stock",
    "Lock / Unlock Data",
  ]) {
    assert.match(demoWorkflows, new RegExp(workflow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(demoWorkflows, /PendingRealWorkflow/);
  assert.match(demoWorkflows, /LegacyEntryWorkflow/);
  assert.match(demoWorkflows, /No sample records or simulated save results/);
  assert.doesNotMatch(demoWorkflows, /saved locally|synthetic data|mock PDF/i);
  for (const workbookFlow of ["F4 Update", "Cancel Both", "PRODUCT GROUP", "BOOK / LEDGER", "displayed real"]) {
    assert.match(legacyMaster, new RegExp(workbookFlow));
  }
  assert.match(productMaster, /MASTER_PRODUCT/);
  assert.match(productMaster, /product_master pm/);
  assert.match(productMaster, /prod_balance/);
  assert.match(productMaster, /pricelist/);
  assert.match(productMaster, /addon_data/);
  assert.match(entryWorkflow, /\/api\/legacy\/transaction\/context/);
  assert.match(entryWorkflow, /Voucher requires equal non-zero debit and credit totals/);
  assert.match(entryWorkflow, /Reference posting/);
  assert.match(entryContext, /product_master/);
  assert.match(entryContext, /pricelist/);
  assert.match(entryContext, /prod_balance/);
  assert.match(reportWorkflow, /F4 Zoom/);
  assert.match(reportWorkflow, /sales-distribution/);
  assert.match(reportWorkflow, /conic-gradient/);
  for (const utilityFlow of ["IMPORT DATA FROM EXCEL", "parseXlsx", "PARTYWISE BILL PDF", "LOCK \/ UNLOCK DATA"]) {
    assert.match(utilityWorkflows, new RegExp(utilityFlow));
  }
  assert.match(addonMaster, /addon_fld/);
  assert.match(addonMaster, /addon_sub/);
  assert.match(layout, /title:\s*"SMARTwinFA Web"/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview/);
  assert.doesNotMatch(packageJson, /drizzle|sqlite|d1/i);
});
