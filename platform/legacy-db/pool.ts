import pg from "pg";

const { Pool } = pg;

declare global {
  var smartwinfaLegacyPool: pg.Pool | undefined;
}

function connectionString() {
  const configured = process.env.LEGACY_DATABASE_URL?.trim();
  if (!configured) throw new Error("LEGACY_DATABASE_URL is not configured");
  return configured;
}

export function legacyPool() {
  if (!globalThis.smartwinfaLegacyPool) {
    globalThis.smartwinfaLegacyPool = new Pool({
      connectionString: connectionString(),
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "smartwinfa-web-legacy-read",
    });
  }
  return globalThis.smartwinfaLegacyPool;
}
