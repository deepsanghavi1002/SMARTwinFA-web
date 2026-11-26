/**
 * The rights of an emailed report, read from the database as they are now: when Send Now is pressed and again just before the file is made.
 * readSession alone does not check the operator's company and year limits, so they are checked here with the company screen's own lists.
 */
import type { Client } from "pg";
import { AUTH_SCHEMA } from "../auth/schema";
import { readAccountingYears, readCompanies } from "../company-menu";
import { transaction } from "../db";
import { allowedMasterMenu } from "../master-program/access";
import { Loader } from "../master-program/load";
import { readRights, readSession } from "../master-program/session";
import { readMenuCatalog } from "../menu-catalog";
import { readReportProperties, reportRights } from "../report/setup";
import { MailRefusal, rightsRefusal } from "./rules";

export type RightsRequest = Readonly<{ ownerUserId: number; operator: string; companyId: number; yearKey: number; reportName: string; menuName: string }>;

export async function passwordMark(salt: string, password: string): Promise<string> {
  if (password === "") return "";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}\n${password}`));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The operator's company and year limits, as the company screen applies them. */
async function companyScope(operator: string, companyId: number, yearKey: number): Promise<{ yearAllowed: boolean; companyAllowed: boolean }> {
  const years = await readAccountingYears(operator);
  const yearAllowed = years.some((year) => year.key === yearKey);
  const companies = yearAllowed ? await readCompanies(operator, yearKey) : [];
  return { yearAllowed, companyAllowed: companies.some((company) => company.key === companyId) };
}

async function webUser(client: Client, id: number) {
  const row = (await client.query(`SELECT status, role, operator_login, email FROM ${AUTH_SCHEMA}.app_user WHERE id = $1`, [id])).rows[0];
  return row ? { status: String(row.status), role: String(row.role), operatorLogin: row.operator_login === null ? null : String(row.operator_login), email: row.email === null ? null : String(row.email) } : null;
}

/**
 * Refuses (MailRefusal) when the report may not be sent. `typedPassword` is given when the user presses Send Now and must be the module
 * password; a queued job passes the mark kept with its schedule instead.
 */
export async function checkReportAccess(request: RightsRequest, proof: Readonly<{ typedPassword: string } | { salt: string; mark: string }>): Promise<{ reportKey: number; ownEmail: string | null; companyName: string; salt: string; mark: string }> {
  const scope = await companyScope(request.operator, request.companyId, request.yearKey);
  return transaction(async (client) => {
    const user = await webUser(client, request.ownerUserId);
    const session = await readSession(client, { companyId: request.companyId, yearKey: request.yearKey, loginName: request.operator });
    const menuVisible = allowedMasterMenu(await readMenuCatalog(session.companyGroup), request.reportName, request.menuName, "REPORT");
    const loader = new Loader(client, session);
    const reportKey = Number((await readReportProperties(loader, request.reportName)).report_key) || 0;
    const exportRight = (await reportRights(loader, request.menuName)).export;
    const password = (await readRights(client, session, `Menu-${request.menuName}`)).modulePassword;

    let salt = "salt" in proof ? proof.salt : crypto.randomUUID();
    const passwordNow = await passwordMark(salt, password);
    let passwordThen = "mark" in proof ? proof.mark : "";
    if ("typedPassword" in proof) {
      if (password !== "" && proof.typedPassword !== password) throw new MailRefusal("Incorrect module password");
      passwordThen = passwordNow;
    }
    if (password === "") salt = "";

    const refusal = rightsRefusal({ user, operator: request.operator, ...scope, menuVisible, exportRight, reportKey, passwordNow, passwordThen });
    if (refusal !== "") throw new MailRefusal(refusal);
    return { reportKey, ownEmail: user?.email ?? null, companyName: session.companyName, salt, mark: passwordNow };
  }, { readOnlyWork: true, timeoutMs: 30000 });
}
