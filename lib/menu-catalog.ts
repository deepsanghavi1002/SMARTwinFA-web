import { readOnly } from "./db";
import { companyLicence } from "./company-license";

/**
 * The application menu, read from smart_setup.menumaster.
 *
 * The desktop's Main_Menu_New builds the same tree from the same table, so the
 * menu is data, not application code: a client whose menumaster differs sees a
 * different menu without the software changing.
 */

// Read per request, not at module load: the worker's environment is only
// populated once a request is being handled.
function setupSchema() {
  const candidate = process.env.DB_SCHEMA_SETUP?.trim() || "smart_setup";
  if (!/^[a-z_][a-z0-9_]*$/i.test(candidate)) {
    throw new Error("DB_SCHEMA_SETUP must be a PostgreSQL identifier.");
  }
  return candidate;
}

export type MenuNode = Readonly<{
  id: number;
  label: string;
  shortcut: string | null;
  actionCode: string | null;
  programName: string | null;
  children: ReadonlyArray<MenuNode>;
}>;

type MenuRow = {
  menuid: number;
  parentid: number | null;
  menutext: string | null;
  actioncode: string | null;
  menuprogname: string | null;
  menushortname: string | null;
  menuhide: string | null;
  menuvisible: string | null;
  menuspecial: boolean | null;
  menudisplay: boolean | null;
  shortcutkey: string | null;
};

/** MenuText carries the keyboard accelerator as "&": "S&PECIAL" is "SPECIAL". */
function label(row: MenuRow) {
  return (row.menutext ?? "").replace(/&/g, "").trim();
}

/**
 * Whether this licence may see the row, following Main_Menu_New exactly: a
 * special menu appears only for a licence listed in MenuVisible, an ordinary
 * one disappears for a licence listed in MenuHide, and a MenuDisplay row is
 * reserved for the desktop's hidden-book mode. Both columns are comma lists
 * written with a leading space, so the licence is matched as " 21,".
 */
function isVisible(row: MenuRow, licence: number) {
  const needle = ` ${licence},`;
  const listed = (value: string | null) => (value ?? "").includes(needle);
  if (row.menudisplay) return false;
  return row.menuspecial ? listed(row.menuvisible) : !listed(row.menuhide);
}

/** The menu tree a company may open, in menumaster's own order. */
export async function readMenuCatalog(companyGroup: string | null): Promise<MenuNode[]> {
  const licence = companyLicence(companyGroup);
  const SETUP_SCHEMA = setupSchema();
  return readOnly(async (client) => {
    const result = await client.query<MenuRow>(
      `SELECT menuid, parentid, menutext, actioncode, menuprogname, menushortname,
              menuhide, menuvisible, menuspecial, menudisplay, shortcutkey
       FROM ${SETUP_SCHEMA}.menumaster
       ORDER BY menuid`,
    );

    const visible = result.rows.filter((row) => isVisible(row, licence) && label(row).length > 0);
    const childrenOf = new Map<number | null, MenuRow[]>();
    for (const row of visible) {
      const parent = row.parentid ?? null;
      const siblings = childrenOf.get(parent);
      if (siblings) siblings.push(row); else childrenOf.set(parent, [row]);
    }

    // A row whose parent was filtered out goes with it, so an orphan is never
    // promoted to the menu bar.
    const build = (parent: number | null): MenuNode[] =>
      (childrenOf.get(parent) ?? []).map((row) => ({
        id: row.menuid,
        label: label(row),
        shortcut: row.shortcutkey?.trim() || null,
        actionCode: row.actioncode?.trim() || null,
        programName: row.menuprogname?.trim() || null,
        children: build(row.menuid),
      }));

    return build(null);
  });
}
