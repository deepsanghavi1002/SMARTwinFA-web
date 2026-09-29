import assert from "node:assert/strict";
import test from "node:test";
import { applyCompanyIndexes, COMPANY_INDEXES } from "../scripts/company-indexes.mjs";

/** A stand-in for pg.Client: tables and their columns, indexes already there, and the SQL it was sent. */
function fakeClient({ tables, indexes = [] }) {
  const sent = [];
  return {
    sent,
    async query(sql, params = []) {
      sent.push(sql);
      if (sql.includes("information_schema.columns")) return { rows: (tables[params[1]] ?? []).map((column_name) => ({ column_name })) };
      if (sql.includes("pg_indexes")) return { rowCount: indexes.includes(params[1]) ? 1 : 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
  };
}

const allTables = { pricelist: ["prod_id", "pl_pos", "pl_wefrom"], addon_data: ["prod_id"], prod_balance: ["prod_id", "year_id"] };

test("the Product master's indexes are listed", () => {
  assert.deepEqual(COMPANY_INDEXES.map((index) => index.name), ["ix_pricelist_prod_pos_wefrom", "ix_addon_data_prod", "ix_prod_balance_prod_year"]);
});

test("missing indexes are built concurrently, then the tables analysed", async () => {
  const client = fakeClient({ tables: allTables });
  const created = await applyCompanyIndexes(client, "abc_company26", { log: () => {} });
  assert.equal(created.length, 3);
  assert.ok(client.sent.some((sql) => sql === 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "ix_pricelist_prod_pos_wefrom" ON "abc_company26"."pricelist" ("prod_id", "pl_pos", "pl_wefrom")'));
  assert.match(client.sent.at(-1), /^ANALYZE "abc_company26"\."pricelist", "abc_company26"\."addon_data", "abc_company26"\."prod_balance"$/);
});

test("an index already there, a missing table or a missing column is left alone", async () => {
  const client = fakeClient({ tables: { pricelist: ["prod_id", "pl_pos"], prod_balance: ["prod_id", "year_id"] }, indexes: ["ix_prod_balance_prod_year"] });
  const notes = [];
  const created = await applyCompanyIndexes(client, "abc_company26", { log: (line) => notes.push(line) });
  assert.deepEqual(created, []);
  assert.ok(!client.sent.some((sql) => sql.startsWith("CREATE") || sql.startsWith("ANALYZE")));
  assert.ok(notes.some((line) => line.includes("pricelist: skipped (no column pl_wefrom)")));
  assert.ok(notes.some((line) => line.includes("addon_data: skipped (no such table)")));
});

test("a dry run creates nothing", async () => {
  const client = fakeClient({ tables: allTables });
  const created = await applyCompanyIndexes(client, "abc_company26", { dryRun: true, log: () => {} });
  assert.equal(created.length, 3);
  assert.ok(!client.sent.some((sql) => sql.startsWith("CREATE") || sql.startsWith("ANALYZE")));
});

test("a schema name that is not a plain identifier is refused", async () => {
  await assert.rejects(applyCompanyIndexes(fakeClient({ tables: allTables }), "bad;name", { log: () => {} }), /Invalid PostgreSQL identifier/);
});
