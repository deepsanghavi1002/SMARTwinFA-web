export type LegacyPhysicalType = "text" | "integer" | "numeric" | "money" | "date" | "timestamp" | "unresolved";
export type TargetType = "text" | "integer" | "decimal" | "money_minor_units" | "local_date" | "utc_timestamp";
export class TypeMappingError extends Error { constructor(message: string) { super(message); this.name = "TypeMappingError"; } }

const allowed: Readonly<Record<Exclude<LegacyPhysicalType, "unresolved">, TargetType>> = Object.freeze({ text: "text", integer: "integer", numeric: "decimal", money: "money_minor_units", date: "local_date", timestamp: "utc_timestamp" });
/** Requires an explicit reviewer decision for unresolved legacy physical types. */
export function mapPhysicalType(type: LegacyPhysicalType): TargetType {
  if (type === "unresolved") throw new TypeMappingError("unresolved source type requires review");
  return allowed[type];
}
