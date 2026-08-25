import { legacyPool } from "./pool.ts";

const SETUP_SCHEMA = "smart_setup";

export type LegacyMenuNode = Readonly<{
  id: number;
  parentId: number | null;
  label: string;
  program: string | null;
  action: string | null;
  children: ReadonlyArray<LegacyMenuNode>;
}>;

export type LegacyMenuCatalog = Readonly<{
  source: "legacy-postgresql";
  total: number;
  roots: ReadonlyArray<LegacyMenuNode>;
}>;

function label(value: string | null) {
  return (value || "").replaceAll("&", "").replace(/\s+/g, " ").trim();
}

export async function readLegacyMenuCatalog(): Promise<LegacyMenuCatalog> {
  const client = await legacyPool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    const result = await client.query<{ menuid: number; parentid: number | null; menutext: string | null; menuprogname: string | null; actioncode: string | null }>(`
      SELECT menuid, parentid, menutext, menuprogname, actioncode
      FROM ${SETUP_SCHEMA}.menumaster
      WHERE COALESCE(menutext, '') <> ''
      ORDER BY menukey
    `);
    await client.query("COMMIT");
    const byId = new Map<number, { id: number; parentId: number | null; label: string; program: string | null; action: string | null; children: LegacyMenuNode[] }>();
    for (const row of result.rows) byId.set(row.menuid, { id: row.menuid, parentId: row.parentid, label: label(row.menutext), program: row.menuprogname?.trim() || null, action: row.actioncode?.trim() || null, children: [] });
    const roots: LegacyMenuNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId === null ? undefined : byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { source: "legacy-postgresql", total: result.rows.length, roots };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
