import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const companyMenu = read("lib/company-menu.ts");
const startupGate = read("features/startup/StartupGate.tsx");
const companiesRoute = read("app/api/companies/route.ts");
const yearsRoute = read("app/api/accounting-years/route.ts");
const operatorsRoute = read("app/api/operators/route.ts");

// SMARTwinFA is installed per client and every installation carries a
// different company set, so a literal here would show one client's companies
// to another.
test("the company, accounting-year and operator lists are read at runtime", () => {
  assert.match(companyMenu, /\$\{SYSTEM_SCHEMA\}\.company/);
  assert.match(companyMenu, /\$\{SYSTEM_SCHEMA\}\.cname/);
  assert.match(companyMenu, /\$\{SYSTEM_SCHEMA\}\.year_ac/);
  assert.match(companyMenu, /\$\{SYSTEM_SCHEMA\}\.user_master/);
  assert.doesNotMatch(startupGate, /DREAMHOUSE|dreamhouse|mock-data/, "the mock company list must be gone");
  assert.doesNotMatch(startupGate, /useState\("SRP"\)/, "the operator must not be hard-coded");
});

// Setup_CompanySelect scopes both lists by the signed-in operator: USER_YEAR
// pins the accounting years, WEBSITE pins the companies via CO_SELECT_GROUP,
// and the company grid refills for whichever year is highlighted.
test("the company menu is operator scoped and refills per accounting year", () => {
  assert.match(companyMenu, /user_year/);
  assert.match(companyMenu, /co_select_group/);
  assert.match(companyMenu, /readCompanies\(loginName: string, yearKey: number\)/);
  assert.match(startupGate, /\/api\/accounting-years\?login=/);
  assert.match(startupGate, /\/api\/companies\?login=/);
});

test("no credential column ever leaves the database", () => {
  const code = companyMenu.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /user_pw/, "the obfuscated password column must never be selected");
  assert.doesNotMatch(code, /super_pw/, "the supervisor password column must never be selected");
});

// The startup screens read the live company system database, so they must be
// unable to write whatever the query text says, and every filter is bound.
test("the company menu reads the live database read-only, with bound filters", () => {
  assert.match(read("lib/db.ts"), /BEGIN READ ONLY/);
  assert.match(companyMenu, /readOnly\(async \(client\)/);
  assert.doesNotMatch(companyMenu, /\$\{yearKey\}/);
  assert.doesNotMatch(companyMenu, /\$\{loginName\}/);
  assert.doesNotMatch(companyMenu, /\$\{scope\.groups\}/);
});

test("the routes reject a request that names no operator or year", () => {
  assert.match(operatorsRoute, /readOperators/);
  assert.match(yearsRoute, /An operator is required/);
  assert.match(companiesRoute, /An operator is required/);
  assert.match(companiesRoute, /An accounting year is required/);
  assert.match(companiesRoute, /\^\\d\{1,9\}\$/);
});
