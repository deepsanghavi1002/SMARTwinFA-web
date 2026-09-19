import type { DefinitionScope, DefinitionStatus, TenantContext, ValueType } from "../metadata/definition.ts";

export type CustomFieldEntity = "account" | "product" | "entry_header" | "entry_line";
export type CustomFieldUse = "master" | "entry" | "report" | "document";

export type CustomFieldConstraints = {
  maxLength?: number;
  precision?: number;
  scale?: number;
};

export type CustomFieldDefinition = {
  stableId: string;
  version: string;
  owner: string;
  changeReason: string;
  sourceHash: string;
  status: DefinitionStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  scope: DefinitionScope;
  entity: CustomFieldEntity;
  fieldKey: string;
  label: string;
  valueType: ValueType;
  constraints: CustomFieldConstraints;
  uses: CustomFieldUse[];
  required: boolean;
  readPermission: string;
  writePermission: string;
  auditEvent: string;
};

const identifier = /^[a-z][a-z0-9_]*$/;
const stableId = /^CF-[A-Z0-9-]*\d{3}$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const namespaced = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export class CustomFieldValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Custom field definition is invalid: ${problems.join("; ")}`);
    this.name = "CustomFieldValidationError";
    this.problems = problems;
  }
}

function validDate(value: string | undefined) {
  return Boolean(value && dateOnly.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
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

function effectiveOn(definition: CustomFieldDefinition, date: string) {
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

/** Validates a typed custom-field manifest before persistence or compilation. */
export function validateCustomFieldDefinition(definition: CustomFieldDefinition) {
  const problems: string[] = [];
  const unsafe = definition as unknown as {
    rawSql?: unknown; sql?: unknown; formula?: unknown; relationshipExpression?: unknown;
    legacyMarker?: unknown; entityTypes?: unknown;
  };

  if (!stableId.test(definition.stableId)) problems.push("stableId must use the CF-ENTITY-001 format");
  if (!semver.test(definition.version)) problems.push("version must be semantic versioning");
  if (!definition.owner.trim()) problems.push("owner is required");
  if (!definition.changeReason.trim()) problems.push("changeReason is required");
  if (!/^[a-f0-9]{64}$/i.test(definition.sourceHash)) problems.push("sourceHash must be a SHA-256 hex value");
  if (!validDate(definition.effectiveFrom)) problems.push("effectiveFrom must be an ISO date");
  if (definition.effectiveTo && !validDate(definition.effectiveTo)) problems.push("effectiveTo must be an ISO date");
  if (definition.effectiveTo && definition.effectiveTo < definition.effectiveFrom) problems.push("effectiveTo cannot be before effectiveFrom");
  if (unsafe.rawSql !== undefined || unsafe.sql !== undefined || unsafe.formula !== undefined || unsafe.relationshipExpression !== undefined || unsafe.legacyMarker !== undefined) {
    problems.push("raw SQL, formulas, relationship expressions, and legacy markers are prohibited");
  }
  if (unsafe.entityTypes !== undefined) problems.push("a custom field must attach to exactly one entity");

  const { scope } = definition;
  if (scope.companyId && !scope.tenantId) problems.push("company scope requires tenant scope");
  if (scope.accountingYearId && (!scope.companyId || !scope.tenantId)) problems.push("accounting-year scope requires company and tenant scope");

  if (!(["account", "product", "entry_header", "entry_line"] as string[]).includes(definition.entity)) problems.push("entity is not supported");
  if (!identifier.test(definition.fieldKey)) problems.push("fieldKey must be a catalog identifier");
  if (!definition.label.trim()) problems.push("label is required");
  if (!(["text", "integer", "decimal", "date", "boolean", "uuid"] as string[]).includes(definition.valueType)) problems.push("valueType is not supported");
  if (!definition.uses.length || hasDuplicates(definition.uses)) problems.push("uses must contain unique supported surfaces");
  if (definition.uses.some((use) => !(["master", "entry", "report", "document"] as string[]).includes(use))) problems.push("uses contains an unsupported surface");
  if (!namespaced.test(definition.readPermission) || !namespaced.test(definition.writePermission)) problems.push("permissions must be namespaced");
  if (!namespaced.test(definition.auditEvent)) problems.push("auditEvent must be namespaced");

  const { constraints } = definition;
  const maxLength = constraints.maxLength;
  const precision = constraints.precision;
  const scale = constraints.scale;
  const hasLength = maxLength !== undefined;
  const hasDecimal = precision !== undefined || scale !== undefined;
  if (definition.valueType === "text" && (!Number.isInteger(maxLength) || maxLength === undefined || maxLength < 1 || maxLength > 5000)) {
    problems.push("text fields require maxLength between 1 and 5000");
  }
  if (definition.valueType !== "text" && hasLength) problems.push("only text fields may set maxLength");
  if (definition.valueType === "decimal" && (!Number.isInteger(precision) || !Number.isInteger(scale) || precision === undefined || scale === undefined || precision < 1 || precision > 28 || scale < 0 || scale > precision)) {
    problems.push("decimal fields require precision 1-28 and scale 0-precision");
  }
  if (definition.valueType !== "decimal" && hasDecimal) problems.push("only decimal fields may set precision or scale");

  if (problems.length) throw new CustomFieldValidationError(problems);
  return definition;
}

/** Resolves an active field version with the same explicit override precedence as metadata. */
export function resolveActiveCustomField(definitions: CustomFieldDefinition[], stableDefinitionId: string, context: TenantContext, module: string, date: string) {
  if (!validDate(date)) throw new CustomFieldValidationError(["resolution date must be an ISO date"]);
  const candidates = definitions
    .filter((definition) => definition.stableId === stableDefinitionId && definition.status === "active")
    .filter((definition) => scopeMatches(definition.scope, context, module) && effectiveOn(definition, date))
    .map(validateCustomFieldDefinition);
  if (!candidates.length) return null;

  const highestScope = Math.max(...candidates.map((definition) => scopeRank(definition.scope)));
  const scoped = candidates.filter((definition) => scopeRank(definition.scope) === highestScope);
  scoped.sort((left, right) => compareVersions(right.version, left.version));
  if (scoped.length > 1 && scoped[0].version === scoped[1].version) {
    throw new CustomFieldValidationError([`ambiguous active custom field ${stableDefinitionId} at scope rank ${highestScope}`]);
  }
  return scoped[0];
}
