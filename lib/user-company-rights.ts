import type { Client } from "pg";
import { SYSTEM_SCHEMA } from "./master-program/session";
import { toText } from "./master-program/legacy";

/**
 * Setup > Security > User Company Rights (Utility_User_Company_Rights.cs): which companies a user may open.
 *
 * The companies are listed by name with their group (smart_system.company.co_select_group, the GST number or group name the companies of one
 * business share); the user's choice is kept as the comma separated list of the groups ticked, in smart_system.user_master.website. A company
 * with no group has nothing to be ticked by, so it cannot be given.
 */

export type RightsUser = Readonly<{ name: string; no: number }>;
export type CompanyRow = Readonly<{ name: string; group: string }>;

export async function rightsUsers(client: Client): Promise<RightsUser[]> {
  const result = await client.query(`SELECT user_no, login_name FROM ${SYSTEM_SCHEMA}.user_master WHERE user_pos <> 'D' ORDER BY login_name`);
  return result.rows.map((row) => ({ name: toText(row.login_name).trim(), no: Number(row.user_no) }));
}

/** Every company (distinct name and group) and the groups the user already has. */
export async function loadCompanyRights(client: Client, userNo: number): Promise<{ companies: CompanyRow[]; groups: string[] }> {
  const user = (await client.query(`SELECT website FROM ${SYSTEM_SCHEMA}.user_master WHERE user_no = $1 AND user_pos <> 'D'`, [userNo])).rows[0];
  if (!user) throw new Error("User not found");
  const companies = (await client.query(`SELECT DISTINCT name, COALESCE(co_select_group, '') AS group_name FROM ${SYSTEM_SCHEMA}.company WHERE co_pos <> 'D' ORDER BY name, group_name`)).rows
    .map((row) => ({ name: toText(row.name).trim(), group: toText(row.group_name).trim() }));
  const groups = toText(user.website).split(",").map((group) => group.trim()).filter((group) => group !== "");
  return { companies, groups };
}

/** The save: the groups of the ticked companies, each once, in the order of the list. */
export async function saveCompanyRights(client: Client, userNo: number, groups: readonly string[]): Promise<void> {
  const clean: string[] = [];
  for (const group of groups) {
    const text = group.trim();
    if (text !== "" && !text.includes(",") && !clean.includes(text)) clean.push(text);
  }
  const updated = await client.query(`UPDATE ${SYSTEM_SCHEMA}.user_master SET website = $1 WHERE user_no = $2 AND user_pos <> 'D'`, [clean.join(","), userNo]);
  if (updated.rowCount === 0) throw new Error("User not found");
}
