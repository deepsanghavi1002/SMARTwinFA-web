/**
 * User-wise menu favourites: which menu row a favourite means, and the list the "Favourites" menu shows. Pure.
 */

export type FavouriteNode<N> = Readonly<{ id: number; label: string; actionCode: string | null; actionMenu: string | null; menuShortName: string | null; programName: string | null; children: readonly N[] }>;

export const MAX_FAVOURITES = 30;

/** The web-only menu row, which is not in menumaster (app/page.tsx adds it under UTILITY). */
export const WEB_ONLY_KEYS: ReadonlySet<string> = new Set(["PRINT_DESIGNER|||"]);

/** What a row runs, not its menuid or label, so a favourite stays after the menu setup is renumbered or a row renamed. "" for a row that runs nothing. */
export function favouriteKey(node: Readonly<{ actionCode: string | null; actionMenu: string | null; menuShortName: string | null; programName: string | null }>): string {
  const parts = [node.actionCode, node.actionMenu, node.menuShortName, node.programName].map((part) => (part ?? "").trim().toUpperCase());
  return parts.some((part) => part !== "") ? parts.join("|") : "";
}

/** The menu's rows that open something, by key, each with the name of the menu it is under; the first row wins where two run the same thing. */
export function favouriteRows<N extends FavouriteNode<N>>(menus: readonly N[]): Map<string, { node: N; parent: string }> {
  const rows = new Map<string, { node: N; parent: string }>();
  const walk = (nodes: readonly N[], parent: string) => {
    for (const node of nodes) {
      if (node.children.length > 0) { walk(node.children, node.label); continue; }
      const key = favouriteKey(node);
      if (key !== "" && !rows.has(key)) rows.set(key, { node, parent });
    }
  };
  walk(menus, "");
  return rows;
}

/**
 * The saved favourites that this company's menu has, in the user's order. A label two favourites or two menu rows share ("Master") gets the
 * name of the menu it is under. A saved key the menu does not have is left out (it comes back if the row does).
 */
export function favouriteList<N extends FavouriteNode<N>>(menus: readonly N[], keys: readonly string[]): { key: string; node: N; label: string }[] {
  const rows = favouriteRows(menus);
  const named = new Map<string, number>();
  for (const { node } of rows.values()) named.set(node.label, (named.get(node.label) ?? 0) + 1);
  return keys.flatMap((key) => {
    const row = rows.get(key);
    if (!row) return [];
    return [{ key, node: row.node, label: (named.get(row.node.label) ?? 0) > 1 && row.parent !== "" ? `${row.node.label} (${row.parent})` : row.node.label }];
  });
}
