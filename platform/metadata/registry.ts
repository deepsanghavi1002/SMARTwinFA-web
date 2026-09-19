import {
  type DefinitionScope,
  type DefinitionStatus,
  type MetadataDefinition,
  MetadataValidationError,
  validateMetadataDefinition,
} from "./definition.ts";

export type DefinitionTransitionEvent = Readonly<{
  event: "metadata.definition_validated" | "metadata.definition_approved" | "metadata.definition_activated" | "metadata.definition_retired";
  definitionKey: string;
  actorId: string;
  occurredAt: string;
}>;

export class MetadataRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataRegistryError";
  }
}

const transitions: Record<DefinitionStatus, DefinitionStatus[]> = {
  draft: ["validated"],
  validated: ["approved"],
  approved: ["active"],
  active: ["retired"],
  retired: [],
};

const transitionEvents: Partial<Record<DefinitionStatus, DefinitionTransitionEvent["event"]>> = {
  validated: "metadata.definition_validated",
  approved: "metadata.definition_approved",
  active: "metadata.definition_activated",
  retired: "metadata.definition_retired",
};

function scopeKey(scope: DefinitionScope) {
  return [
    `module=${scope.module ?? "*"}`,
    `tenant=${scope.tenantId ?? "*"}`,
    `company=${scope.companyId ?? "*"}`,
    `year=${scope.accountingYearId ?? "*"}`,
  ].join("|");
}

export function metadataDefinitionKey(definition: Pick<MetadataDefinition, "stableId" | "version" | "scope">) {
  return `${definition.stableId}@${definition.version}#${scopeKey(definition.scope)}`;
}

function immutableDefinition(definition: MetadataDefinition): MetadataDefinition {
  return Object.freeze({
    ...definition,
    scope: Object.freeze({ ...definition.scope }),
    parameters: Object.freeze(definition.parameters.map((parameter) => Object.freeze({ ...parameter }))),
    output: Object.freeze(definition.output.map((field) => Object.freeze({ ...field, source: Object.freeze({ ...field.source }) }))),
    query: Object.freeze({
      ...definition.query,
      tables: Object.freeze([...definition.query.tables]),
      filters: Object.freeze(definition.query.filters.map((filter) => Object.freeze({ ...filter }))),
      orderBy: Object.freeze(definition.query.orderBy.map((order) => Object.freeze({ ...order }))),
    }),
    actions: Object.freeze(definition.actions.map((action) => Object.freeze({ ...action }))),
  }) as MetadataDefinition;
}

function sameScope(left: DefinitionScope, right: DefinitionScope) {
  return scopeKey(left) === scopeKey(right);
}

function rangesOverlap(left: MetadataDefinition, right: MetadataDefinition) {
  const leftEnd = left.effectiveTo ?? "9999-12-31";
  const rightEnd = right.effectiveTo ?? "9999-12-31";
  return left.effectiveFrom <= rightEnd && right.effectiveFrom <= leftEnd;
}

function requireActorAndTime(actorId: string, occurredAt: string) {
  if (!/^[a-z][a-z0-9_-]{2,99}$/i.test(actorId)) throw new MetadataRegistryError("actorId is invalid");
  if (Number.isNaN(Date.parse(occurredAt))) throw new MetadataRegistryError("occurredAt is invalid");
}

export function registerDraft(registry: readonly MetadataDefinition[], definition: MetadataDefinition) {
  if (definition.status !== "draft") throw new MetadataRegistryError("new definitions must enter the registry as draft");
  validateMetadataDefinition(definition);
  const key = metadataDefinitionKey(definition);
  if (registry.some((candidate) => metadataDefinitionKey(candidate) === key)) throw new MetadataRegistryError(`definition ${key} already exists`);
  return Object.freeze([...registry, immutableDefinition(definition)]);
}

export function transitionDefinition(
  registry: readonly MetadataDefinition[],
  definitionKey: string,
  targetStatus: Exclude<DefinitionStatus, "draft">,
  actorId: string,
  occurredAt: string,
): { registry: readonly MetadataDefinition[]; definition: MetadataDefinition; event: DefinitionTransitionEvent } {
  requireActorAndTime(actorId, occurredAt);
  const index = registry.findIndex((candidate) => metadataDefinitionKey(candidate) === definitionKey);
  if (index < 0) throw new MetadataRegistryError(`definition ${definitionKey} was not found`);
  const current = registry[index];
  if (!transitions[current.status].includes(targetStatus)) throw new MetadataRegistryError(`cannot transition metadata from ${current.status} to ${targetStatus}`);

  validateMetadataDefinition(current);
  if (targetStatus === "active") {
    const conflict = registry.find((candidate, candidateIndex) => candidateIndex !== index
      && candidate.status === "active"
      && candidate.stableId === current.stableId
      && sameScope(candidate.scope, current.scope)
      && rangesOverlap(candidate, current));
    if (conflict) throw new MetadataRegistryError(`active definition overlaps ${metadataDefinitionKey(conflict)}`);
  }

  const updated = immutableDefinition({ ...current, status: targetStatus });
  const next = Object.freeze(registry.map((candidate, candidateIndex) => candidateIndex === index ? updated : candidate));
  const eventName = transitionEvents[targetStatus];
  if (!eventName) throw new MetadataValidationError([`no event is defined for target status ${targetStatus}`]);

  return {
    registry: next,
    definition: updated,
    event: Object.freeze({ event: eventName, definitionKey, actorId, occurredAt }),
  };
}
