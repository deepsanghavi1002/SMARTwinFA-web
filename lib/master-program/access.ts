/** Temporary deployment boundary, not authentication. Never enable on a public origin. */
export function trustedDevelopmentEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function requiredEditRights(records: readonly { deleted: boolean }[]): ("edit" | "delete")[] {
  const rights: ("edit" | "delete")[] = [];
  if (records.some((record) => !record.deleted)) rights.push("edit");
  if (records.some((record) => record.deleted)) rights.push("delete");
  return rights;
}

type Menu = Readonly<{ actionCode: string | null; actionMenu: string | null; menuShortName: string | null; children: readonly Menu[] }>;

/** Only accept module names attached to this program in the company's visible menu. */
export function allowedMasterMenu(menus: readonly Menu[], program: string, module: string): boolean {
  return menus.some((menu) => (
    menu.actionCode?.toUpperCase() === "MASTER" && menu.actionMenu === program &&
    (menu.menuShortName ?? "") === module
  ) || allowedMasterMenu(menu.children, program, module));
}
