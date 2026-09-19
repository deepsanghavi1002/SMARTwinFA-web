/**
 * Safe, source-independent contracts for the metadata-driven parts of SMARTwinFA.
 * These definitions deliberately describe queries; they never contain executable
 * SQL or browser-controlled table/column identifiers.
 */

export type DefinitionStatus = "draft" | "validated" | "approved" | "active" | "retired";
export type ValueType = "text" | "integer" | "decimal" | "date" | "boolean" | "uuid";
export type Comparison = "eq" | "neq" | "in" | "between" | "contains" | "is_null";

export type TenantContext = {
  tenantId: string;
  companyId: string;
  accountingYearId: string;
};

export type DefinitionScope = {
  module?: string;
  tenantId?: string;
  companyId?: string;
  accountingYearId?: string;
};

export type ParameterDefinition = {
  id: string;
  type: ValueType;
  required: boolean;
  defaultValue?: string | number | boolean;
};

export type OutputFieldDefinition = {
  id: string;
  label: string;
  type: ValueType;
  nullable: boolean;
  source: { table: string; column: string };
};

export type FilterDefinition = {
  field: string;
  operator: Comparison;
  parameter?: string;
};

export type QueryDefinition = {
  tables: string[];
  filters: FilterDefinition[];
  orderBy: Array<{ field: string; direction: "asc" | "desc" }>;
  pageSize: number;
};

export type ActionDefinition = {
  id: string;
  kind: "read" | "write";
  permission: string;
  auditEvent?: string;
};

export type MetadataDefinition = {
  stableId: string;
  version: string;
  owner: string;
  changeReason: string;
  sourceHash: string;
  status: DefinitionStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  scope: DefinitionScope;
  parameters: ParameterDefinition[];
  output: OutputFieldDefinition[];
  query: QueryDefinition;
  actions: ActionDefinition[];
};

const identifier = /^[a-z][a-z0-9_]*$/;
const stableId = /^[A-Z][A-Z0-9-]*-\d{3}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const permission = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const eventName = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export class MetadataValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Metadata definition is invalid: ${problems.join("; ")}`);
    this.name = "MetadataValidationError";
    this.problems = problems;
  }
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

function validDate(value: string | undefined) {
  return Boolean(value && dateOnly.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function scopeRank(scope: DefinitionScope) {
  if (scope.accountingYearId) return 4;
  if (scope.companyId) return 3;
  if (scope.tenantId) return 2;
  if (scope.module) return 1;
  return 0;
}

function scopeMatches(scope: DefinitionScope, context: TenantContext, module: string) {
  return (!scope.module || scope.module === module)
    && (!scope.tenantId || scope.tenantId === context.tenantId)
    && (!scope.companyId || scope.companyId === context.companyId)
    && (!scope.accountingYearId || scope.accountingYearId === context.accountingYearId);
}

function effectiveOn(definition: MetadataDefinition, date: string) {
  return definition.effectiveFrom <= date && (!definition.effectiveTo || definition.effectiveTo >= date);
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

/** Validates a manifest before it can enter the registry/compiler pipeline. */
export function validateMetadataDefinition(definition: MetadataDefinition) {
  const problems: string[] = [];
  const unsafe = definition as unknown as { rawSql?: unknown; sql?: unknown };

  if (!stableId.test(definition.stableId)) problems.push("stableId must use the FEATURE-001 format");
  if (!semver.test(definition.version)) problems.push("version must be semantic versioning");
  if (!definition.owner.trim()) problems.push("owner is required");
  if (!definition.changeReason.trim()) problems.push("changeReason is required");
  if (!/^[a-f0-9]{64}$/i.test(definition.sourceHash)) problems.push("sourceHash must be a SHA-256 hex value");
  if (!validDate(definition.effectiveFrom)) problems.push("effectiveFrom must be an ISO date");
  if (definition.effectiveTo && !validDate(definition.effectiveTo)) problems.push("effectiveTo must be an ISO date");
  if (definition.effectiveTo && definition.effectiveTo < definition.effectiveFrom) problems.push("effectiveTo cannot be before effectiveFrom");
  if (unsafe.rawSql !== undefined || unsafe.sql !== undefined) problems.push("raw SQL is prohibited in metadata definitions");

  const { scope } = definition;
  if (scope.companyId && !scope.tenantId) problems.push("company scope requires tenant scope");
  if (scope.accountingYearId && (!scope.companyId || !scope.tenantId)) problems.push("accounting-year scope requires company and tenant scope");

  if (!definition.query.tables.length || definition.query.tables.some((table) => !identifier.test(table))) problems.push("query tables must be catalog identifiers");
  if (hasDuplicates(definition.query.tables)) problems.push("query tables cannot repeat");
  if (!Number.isInteger(definition.query.pageSize) || definition.query.pageSize < 1 || definition.query.pageSize > 500) problems.push("query pageSize must be between 1 and 500");

  const parameterIds = definition.parameters.map((parameter) => parameter.id);
  if (parameterIds.some((id) => !identifier.test(id))) problems.push("parameter IDs must be catalog identifiers");
  if (hasDuplicates(parameterIds)) problems.push("parameter IDs cannot repeat");

  const outputIds = definition.output.map((field) => field.id);
  if (!definition.output.length) problems.push("at least one output field is required");
  if (outputIds.some((id) => !identifier.test(id))) problems.push("output field IDs must be catalog identifiers");
  if (hasDuplicates(outputIds)) problems.push("output field IDs cannot repeat");
  for (const field of definition.output) {
    if (!field.label.trim()) problems.push(`output field ${field.id} requires a label`);
    if (!definition.query.tables.includes(field.source.table) || !identifier.test(field.source.column)) problems.push(`output field ${field.id} must use an allowlisted table and column`);
  }

  for (const filter of definition.query.filters) {
    if (!outputIds.includes(filter.field)) problems.push(`filter field ${filter.field} is not an output field`);
    if (filter.operator !== "is_null" && (!filter.parameter || !parameterIds.includes(filter.parameter))) problems.push(`filter ${filter.field} requires a declared parameter`);
  }
  for (const order of definition.query.orderBy) {
    if (!outputIds.includes(order.field)) problems.push(`order field ${order.field} is not an output field`);
  }

  const actionIds = definition.actions.map((action) => action.id);
  if (!definition.actions.length) problems.push("at least one action is required");
  if (actionIds.some((id) => !identifier.test(id))) problems.push("action IDs must be catalog identifiers");
  if (hasDuplicates(actionIds)) problems.push("action IDs cannot repeat");
  for (const action of definition.actions) {
    if (!permission.test(action.permission)) problems.push(`action ${action.id} requires a namespaced permission`);
    if (action.kind === "write" && (!action.auditEvent || !eventName.test(action.auditEvent))) problems.push(`write action ${action.id} requires a namespaced audit event`);
  }

  if (problems.length) throw new MetadataValidationError(problems);
  return definition;
}

/**
 * Resolves one active definition using explicit scope precedence:
 * global → module → tenant → company → accounting year.
 */
export function resolveActiveDefinition(definitions: MetadataDefinition[], stableDefinitionId: string, context: TenantContext, module: string, date: string) {
  if (!validDate(date)) throw new MetadataValidationError(["resolution date must be an ISO date"]);
  const candidates = definitions
    .filter((definition) => definition.stableId === stableDefinitionId && definition.status === "active")
    .filter((definition) => scopeMatches(definition.scope, context, module) && effectiveOn(definition, date))
    .map(validateMetadataDefinition);

  if (!candidates.length) return null;
  const highestScope = Math.max(...candidates.map((definition) => scopeRank(definition.scope)));
  const scoped = candidates.filter((definition) => scopeRank(definition.scope) === highestScope);
  scoped.sort((left, right) => compareVersions(right.version, left.version));

  if (scoped.length > 1 && scoped[0].version === scoped[1].version) {
    throw new MetadataValidationError([`ambiguous active definition for ${stableDefinitionId} at scope rank ${highestScope}`]);
  }

  return scoped[0];
}
