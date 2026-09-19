import assert from "node:assert/strict";
import test from "node:test";
import { buildSanitizedIntakeCatalog } from "../scripts/export-postgres-intake-catalog.mjs";

const archiveHashes = {
  companyYear: "a".repeat(64),
  smartSetup: "b".repeat(64),
};

function aggregateInput(overrides = {}) {
  return {
    observedOn: "2026-08-21",
    archiveHashes,
    structural: {
      schemas: [
        { name: "rishabh_plastic27", tables: 75, columns: 1864, estimatedRows: 705743, primaryKeys: 0, foreignKeys: 0, views: 0, triggers: 0 },
        { name: "smart_setup", tables: 37, columns: 940, estimatedRows: 146964, primaryKeys: 36, foreignKeys: 0, views: 0, triggers: 0 },
      ],
    },
    metadata: {
      counts: { program_top: 49, program_body: 1308, menumaster: 592, query_table: 216, database_keys: 45, entry_control: 704 },
      logicalKeyRelationships: 45,
      accountMaster: {
        programTopKey: 14,
        fieldCount: 87,
        addActiveFields: 76,
        updateActiveFields: 76,
        compulsoryFields: 27,
        validationFields: 4,
        lookupQueryFields: 12,
        duplicateCheckFields: 2,
        fieldTypes: { T: 53, N: 16, I: 15, D: 3 },
        updateDefinitionLength: 989,
        updateDefinitionChecksum: "c".repeat(32),
        addonDefinitionLength: 281,
        addonDefinitionChecksum: "d".repeat(32),
      },
    },
    ...overrides,
  };
}

test("builds a deterministic aggregate-only intake catalogue", () => {
  const first = buildSanitizedIntakeCatalog(aggregateInput());
  const second = buildSanitizedIntakeCatalog(aggregateInput());

  assert.equal(first.catalogVersion, 1);
  assert.equal(first.restrictedData, false);
  assert.equal(first.catalogHash, second.catalogHash);
  assert.deepEqual(first.structural.schemas.map(({ name }) => name), ["rishabh_plastic27", "smart_setup"]);
  assert.equal(first.metadata.accountMaster.sourceId, "program_top:14");
  assert.deepEqual(first.metadata.accountMaster.fieldTypes, { D: 3, I: 15, N: 16, T: 53 });
  assert.doesNotMatch(JSON.stringify(first), /select\s|password|rawSql/i);
});

test("rejects missing schemas, unsafe numeric inputs, and invalid provenance", () => {
  assert.throws(() => buildSanitizedIntakeCatalog(aggregateInput({ structural: { schemas: [] } })), /required intake schemas/);
  assert.throws(() => buildSanitizedIntakeCatalog(aggregateInput({ archiveHashes: { ...archiveHashes, smartSetup: "not-a-hash" } })), /SHA-256/);

  const badCount = aggregateInput();
  badCount.metadata.accountMaster.fieldCount = -1;
  assert.throws(() => buildSanitizedIntakeCatalog(badCount), /fieldCount must be a non-negative integer/);
});
