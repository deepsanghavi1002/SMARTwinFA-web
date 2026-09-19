import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replaceSysValues } from "../lib/sys-values.ts";

// Func_ReplaceSysVal_CtrlValue in Master_ProgramGrid.cs is the reference for every
// expectation here; a test that disagrees with the C# is wrong, not the port.

const lookups = {
  calls: [],
  async accountHelpAddons() { return [{ save: "1 ", short: "AREA" }, { save: "4", short: "TRANSPORT" }]; },
  async addonSaveByKey(key) { this.calls.push(["key", key]); return key === "7" ? "3" : null; },
  async addonSaveBySubCode(code) { this.calls.push(["sub", code]); return "9"; },
};

const updateContext = (overrides = {}) => ({
  masterGrid: false,
  companySchema: "rishabh_plastic27",
  firstCombo: { text: "SUNDRY DEBTORS", value: "7" },
  secondCombo: { text: "(blank)", value: "" },
  updateCell: { text: "MUMBAI", backupValue: "42", propertyFieldInput: "Yes|No", fieldSaveNoChr: 3, code: "105" },
  editorText: "MUM",
  gridRow: { cells: ["", "", "105", "88"], byName: { code: "105", name: "RAM & CO", last_savedate: "2026-09-05", last_savetime: "10:15:00" } },
  keyFieldName: "CODE",
  fieldValues: [undefined, "abc", "", null],
  programId: 14,
  userNo: 3,
  userType: "A",
  companyKey: 12,
  ...overrides,
});

test("combo, cell and session placeholders are replaced as the desktop does", async () => {
  const sql = await replaceSysValues(
    "select * from t where book=|sys.firstcombovalue| and s=|sys.secondcombovalue| and n='|sys.firstcombotext|' and x=|sys.thiscombotext| and l='|sys.left.firstcombotext|' and u=|sys.user_no| and p=|sys.prog_id| and c=|sys.co_id|",
    updateContext(),
    lookups,
  );
  assert.equal(sql, "select * from t where book=7 and s=0 and n='SUNDRY DEBTORS' and x='MUMBAI' and l='SUN' and u=3 and p=14 and c=12");
});

test("(blank) in the first combo becomes an empty text and a zero id", async () => {
  const sql = await replaceSysValues("a='|sys.firstcombotext|' b=|sys.firstcombovalue| c=|sys.firstcomboid|", updateContext({ firstCombo: { text: "(blank)", value: "" } }), lookups);
  assert.equal(sql, "a='' b=0 c=0");
});

test("a row without a key swaps the whole query for the always-true one", async () => {
  const context = updateContext({ gridRow: { cells: ["", "", "  ", ""], byName: {} } });
  const sql = await replaceSysValues("select 1 from x where code=|sys.pkv| and y=|sys.user_no|", context, lookups);
  assert.equal(sql, "Select code from rishabh_plastic27.account where code=1");
});

test("pkv, gridpkv, pkv.NAME, col.NAME and pkvfield.value read the grid row", async () => {
  const sql = await replaceSysValues("k=|sys.pkv| g=|sys.gridpkv| n='|sys.pkv.NAME|' c=|sys.col.code||sys.pkvfield.value|", updateContext(), lookups);
  assert.equal(sql, "k=105 g=88 n='RAM & CO' c=105 and CODE<>105");
});

test("pkvfield.value is dropped on the Add grid and for a new row", async () => {
  assert.equal(await replaceSysValues("w|sys.pkvfield.value|", updateContext({ masterGrid: true, masterRow: { fieldInput: "", fieldComboValue: "", fieldSaveNoChr: 0, statusAgainstFld: "" } }), lookups), "w");
  assert.equal(await replaceSysValues("w|sys.pkvfield.value|", updateContext({ gridRow: { cells: ["", "", ""], byName: {} } }), lookups), "w");
});

test("fld_value_N is quoted, or null when blank or missing", async () => {
  const sql = await replaceSysValues("|sys.fld_value_1|,|sys.fld_value_2|,|sys.fld_value_3|,|sys.fld_value_9|", updateContext(), lookups);
  assert.equal(sql, "'abc',null,null,null");
});

test("last save date and time are pasted in, or their condition is removed when blank", async () => {
  const filled = await replaceSysValues("x and last_savedate=|sys.last_savedate| and last_savetime=|sys.last_savetime|", updateContext(), lookups);
  assert.equal(filled, "x and last_savedate='05/Sep/2026' and last_savetime='10:15:00'");
  const blank = updateContext({ gridRow: { cells: ["", "", "1"], byName: { last_savedate: "", last_savetime: "" } } });
  assert.equal(await replaceSysValues("x and last_savedate=|sys.last_savedate| and last_savetime=|sys.last_savetime|", blank, lookups), "x");
});

test("accode is the row's code on the Update grid and its condition is dropped on the Add grid", async () => {
  assert.equal(await replaceSysValues("where name=1 and code<>|sys.accode|", updateContext(), lookups), "where name=1 and code<>105");
  const add = updateContext({ masterGrid: true, masterRow: { fieldInput: "", fieldComboValue: "", fieldSaveNoChr: 0, statusAgainstFld: "" } });
  assert.equal(await replaceSysValues("where name=1 and code<>|sys.accode|", add, lookups), "where name=1 ");
});

test("thiscombolistid is only replaced when the backup holds digits", async () => {
  assert.equal(await replaceSysValues("id=|sys.thiscombolistid|", updateContext(), lookups), "id=42");
  const text = updateContext({ updateCell: { ...updateContext().updateCell, backupValue: "Yes" } });
  assert.equal(await replaceSysValues("id=|sys.thiscombolistid|", text, lookups), "id=|sys.thiscombolistid|");
});

test("addon placeholders are looked up", async () => {
  lookups.calls = [];
  const sql = await replaceSysValues("select |sys.replace_acaddon|, name, |sys.keyname|, |sys.keyfldname| from account", updateContext(), lookups);
  assert.equal(sql, "select txt_1 as AREA,txt_4 as TRANSPORT, name, key_3, key_9 from account");
  assert.deepEqual(lookups.calls, [["key", "7"], ["sub", "7"]]);
});

test("detection ignores case but replacement does not, as in the C#", async () => {
  assert.equal(await replaceSysValues("x=|SYS.USER_NO|", updateContext(), lookups), "x=|SYS.USER_NO|");
});

test("a quote in a value cannot close the literal it is pasted into", async () => {
  const context = updateContext({ updateCell: { ...updateContext().updateCell, text: "D'SOUZA' or '1'='1" } });
  assert.equal(await replaceSysValues("where name=|sys.thiscombotext|", context, lookups), "where name='D''SOUZA'' or ''1''=''1'");
});

test("an unquoted id that is not a whole number is refused", async () => {
  const context = updateContext({ firstCombo: { text: "X", value: "1 or 1=1" } });
  await assert.rejects(() => replaceSysValues("book=|sys.firstcombovalue|", context, lookups), /whole number/);
  await assert.rejects(() => replaceSysValues("x", updateContext({ companySchema: "a;drop" }), lookups), /schema/);
});

test("a null source is an empty string", async () => {
  assert.equal(await replaceSysValues(null, updateContext(), lookups), "");
});

test("the browser never receives program_body's SQL settings", () => {
  const route = readFileSync(new URL("../app/api/master-rules/route.ts", import.meta.url), "utf8");
  const rules = readFileSync(new URL("../lib/master-rules.ts", import.meta.url), "utf8");
  assert.match(route, /publicSetup\(field\.setup\)/);
  for (const column of ["duplicate_query", "defa_against_query", "combo_fixquery", "onchange_repl_value_query", "field_save", "field_restore"]) {
    assert.match(rules, new RegExp(`SERVER_ONLY_COLUMNS = \\[[^\\]]*"${column}"`), `${column} must be server-only`);
  }
});
