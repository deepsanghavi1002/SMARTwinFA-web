const DEFAULT_COMPANY_SCHEMA = "rishabh_plastic27";

/**
 * The live application keeps its original schema by default.  A freshly
 * cloned source schema can be selected explicitly for parity development
 * without changing production/test data in place.
 */
export function legacyCompanySchema() {
  const candidate = process.env.LEGACY_COMPANY_SCHEMA?.trim() || DEFAULT_COMPANY_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/i.test(candidate)) {
    throw new Error("LEGACY_COMPANY_SCHEMA must be a PostgreSQL identifier.");
  }
  return candidate;
}
