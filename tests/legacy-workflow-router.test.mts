import assert from "node:assert/strict";
import test from "node:test";
import { resolveLegacyWorkflow } from "../features/navigation/legacy-workflow-router.ts";

const item = (program: string, action = "REPORT", label = "Source label") => ({ id: 1, label, program, action });

test("routes authoritative master programs to real master workflows", () => {
  assert.deepEqual(resolveLegacyWorkflow(item("MstAccount", "MASTER"), "MASTER"), { kind: "demo", workflowId: "Account Master" });
  assert.deepEqual(resolveLegacyWorkflow(item("MstProduct", "MASTER"), "MASTER"), { kind: "demo", workflowId: "Product Master" });
  assert.deepEqual(resolveLegacyWorkflow(item("MstAddonSub", "MASTER"), "MASTER"), { kind: "addon", workflowId: "Addon Master" });
});

test("routes implemented reports by desktop program rather than ambiguous labels", () => {
  assert.deepEqual(resolveLegacyWorkflow(item("Rep_Daybook"), "REPORT"), { kind: "demo", workflowId: "Bank / Cash" });
  assert.deepEqual(resolveLegacyWorkflow(item("Rep_MasterProduct"), "INVENTORY"), { kind: "demo", workflowId: "Product Master" });
  assert.deepEqual(resolveLegacyWorkflow(item("Rep_EwayBill"), "TRANSACTION"), { kind: "demo", workflowId: "E-Way Bill" });
});

test("provides explicit assumed prototype routes for unknown desktop programs", () => {
  assert.deepEqual(resolveLegacyWorkflow(item("Rep_NotMigrated"), "REPORT"), { kind: "demo", workflowId: "TRANSACTION::Register", assumed: true });
  assert.deepEqual(resolveLegacyWorkflow(item("UnknownStock", "SMALL_ENTRY", "Production"), "INVENTORY"), { kind: "demo", workflowId: "Stock Movement", assumed: true });
});

test("covers every restored desktop action family without a pending route", () => {
  const actions = ["ENTRY", "REPORT", "SMALL_ENTRY", "MASTER", "PRODUCT_IMAGE", "MASTER_DESIGN", "TALLY_IMPORT", "COMPANY_SELECT", "YEAR_OPEN", "Security_Menu", "Transfer_Data", "Repost_Data", "Backup_Data", "Import_Data", "EINVOICE_TOKEN", "EWAY_TOKEN"];
  for (const action of actions) assert.ok(resolveLegacyWorkflow(item(`Prototype_${action}`, action), action.includes("REPORT") ? "REPORT" : "UTILITY"));
});
