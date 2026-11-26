import assert from "node:assert/strict";
import test from "node:test";
import { isPublicApi } from "../lib/auth/paths.ts";
import { favouriteKey, favouriteList, favouriteRows } from "../lib/menu-favourites/items.ts";

type Node = { id: number; label: string; actionCode: string | null; actionMenu: string | null; menuShortName: string | null; programName: string | null; children: Node[] };
const node = (id: number, label: string, actionCode: string | null, actionMenu: string | null, children: Node[] = []): Node => ({ id, label, actionCode, actionMenu, menuShortName: actionMenu ? `M_${actionMenu}` : null, programName: null, children });

const menus = [
  node(1, "MASTER", null, null, [node(2, "Addon", null, null, [node(3, "Master", "MASTER", "ADDON")]), node(4, "Product", null, null, [node(5, "Master", "MASTER", "PRODUCT")])]),
  node(6, "REPORT", null, null, [node(7, "Trial Balance", "REPORT", "REPORT_TRIAL_BALANCE"), node(8, "Empty row", null, null)]),
];

test("a favourite is named by what the row runs, not its number or label", () => {
  assert.equal(favouriteKey(menus[1].children[0]), "REPORT|REPORT_TRIAL_BALANCE|M_REPORT_TRIAL_BALANCE|");
  assert.equal(favouriteKey({ ...menus[1].children[0], actionCode: " report " }), favouriteKey(menus[1].children[0]));
  assert.equal(favouriteKey(menus[1].children[1]), "");
  // Branches and rows that run nothing cannot be favourites.
  assert.equal(favouriteRows(menus).size, 3);
});

test("the list keeps the user's order, leaves out rows this menu lacks, and tells same labels apart", () => {
  const keys = ["REPORT|REPORT_TRIAL_BALANCE|M_REPORT_TRIAL_BALANCE|", "MASTER|GONE|M_GONE|", "MASTER|PRODUCT|M_PRODUCT|"];
  assert.deepEqual(favouriteList(menus, keys).map((entry) => [entry.node.id, entry.label]), [[7, "Trial Balance"], [5, "Master (Product)"]]);
  assert.deepEqual(favouriteList(menus, []), []);
});

test("favourites need a session", () => {
  assert.equal(isPublicApi("/api/menu-favourites", "POST"), false);
});
