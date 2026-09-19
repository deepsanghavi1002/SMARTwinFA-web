import assert from "node:assert/strict";
import test from "node:test";
import { allowedMasterMenu, requiredEditRights, trustedDevelopmentEnabled } from "../lib/master-program/access.ts";

test("master migration requires an explicit trusted development opt-in", () => {
  for (const value of [undefined, "", "false", "1", "TRUE"]) assert.equal(trustedDevelopmentEnabled(value), false);
  assert.equal(trustedDevelopmentEnabled("true"), true);
});

test("mixed saves require both edit and delete rights", () => {
  assert.deepEqual(requiredEditRights([{ deleted: false }, { deleted: true }]), ["edit", "delete"]);
  assert.deepEqual(requiredEditRights([{ deleted: true }]), ["delete"]);
  assert.deepEqual(requiredEditRights([{ deleted: false }]), ["edit"]);
  assert.deepEqual(requiredEditRights([]), []);
});

test("module names must belong to the selected program in the visible menu", () => {
  const menus = [{ actionCode: "MASTER", actionMenu: "ACCOUNT", menuShortName: "Accounts", children: [] }];
  assert.equal(allowedMasterMenu(menus, "ACCOUNT", "Accounts"), true);
  assert.equal(allowedMasterMenu(menus, "ACCOUNT", "InventedUnrestrictedModule"), false);
  assert.equal(allowedMasterMenu(menus, "PRODUCT", "Accounts"), false);
  assert.equal(allowedMasterMenu([], "ACCOUNT", "Accounts"), false);
});
