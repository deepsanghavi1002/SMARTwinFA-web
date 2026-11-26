import { authReady, currentUser, signInRequired } from "@/lib/auth/request";
import { transaction } from "@/lib/db";
import { logError } from "@/lib/log";
import { readRights, readSession } from "@/lib/master-program/session";
import { ReportRefusal } from "@/lib/report/generate";
import { cleanSelection } from "@/lib/report/selection";
import { checkReportAccess } from "@/lib/report-mail/access";
import { MailRefusal, canApproveRecipients, cleanAddress, cleanFormat, cleanRecipients, recipientRefusal, viewSelection } from "@/lib/report-mail/rules";
import { approveAddress, approvedAddresses, ensureReportMail, ensureSavedViews, expireJobs, hasOpenJob, jobHistory, mailerRunning, queueJob, removeAddress, saveSchedule } from "@/lib/report-mail/store";

/**
 * Emailing a saved report view: what the signed-in user sees and does. A user sees only their own sends. The mailer program uses
 * /api/report-mailer instead.
 */

type Body = Readonly<{ action: string; companyId: number; yearKey: number; reportName: string; menuShortName?: string; viewName?: string; format?: string; recipients?: unknown; password?: string; address?: string }>;

const NAME = /^[A-Za-z0-9_]{1,64}$/;
const headers = { "cache-control": "no-store" };

let ready = false;

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return signInRequired(headers);
  const operator = user.operator;
  if (!operator) return Response.json({ error: "No operator is chosen for this session" }, { status: 403, headers });
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  const companyId = Number(body?.companyId);
  const yearKey = Number(body?.yearKey);
  if (!body || typeof body.action !== "string" || !NAME.test(String(body.reportName ?? "")) || !Number.isInteger(companyId) || !Number.isInteger(yearKey)) {
    return Response.json({ error: "action, company, year and reportName are required" }, { status: 400, headers });
  }
  const menuName = String(body.menuShortName ?? "");
  const viewName = String(body.viewName ?? "").trim().slice(0, 60);
  const place = { ownerUserId: user.id, operator, companyId, yearKey, reportName: body.reportName, menuName };

  try {
    if (!ready) {
      await authReady();
      await transaction(async (client) => { await ensureSavedViews(client); await ensureReportMail(client); }, { timeoutMs: 15000 });
      ready = true;
    }

    /** The screen's state: own history, the addresses this user may send to, and whether the mailer is running. */
    const state = async () => {
      // Opening the company checks the operator may use it before anything about it is returned.
      await checkReportAccess(place, { salt: "", mark: "" }).catch((error) => {
        // A module password is asked for at Send Now, not to look at one's own sends.
        if (!(error instanceof MailRefusal) || !/module password/i.test(error.message)) throw error;
      });
      return transaction(async (client) => {
        await expireJobs(client);
        const approved = await approvedAddresses(client);
        return {
          ownEmail: user.email, approved, canApprove: canApproveRecipients(user.role), mailerRunning: await mailerRunning(client),
          history: await jobHistory(client, user.id, operator, companyId, body.reportName),
        };
      }, { timeoutMs: 15000 });
    };

    switch (body.action) {
      case "state": return Response.json(await state(), { headers });
      case "send": {
        const format = cleanFormat(body.format);
        const recipients = cleanRecipients(body.recipients);
        const access = await checkReportAccess(place, { typedPassword: String(body.password ?? "") });
        await transaction(async (client) => {
          const session = await readSession(client, { companyId, yearKey, loginName: operator });
          const view = (await client.query("SELECT payload FROM smart_system.report_saved_view WHERE co_key = $1 AND user_no = $2 AND report_name = $3 AND view_name = $4", [session.companyKey, session.userNo, body.reportName, viewName])).rows[0];
          if (!view) throw new MailRefusal("The saved view was not found");
          const refused = recipientRefusal(recipients, access.ownEmail, await approvedAddresses(client));
          if (refused !== "") throw new MailRefusal(refused);
          const key = { ...place, name: viewName };
          if (await hasOpenJob(client, key)) throw new MailRefusal("This report is already waiting to be sent");
          const id = await saveSchedule(client, { ...key, reportKey: access.reportKey, selection: cleanSelection(viewSelection(view.payload)), format, recipients, passwordSalt: access.salt, passwordMark: access.mark });
          await queueJob(client, id, user.id);
        }, { timeoutMs: 15000 });
        return Response.json(await state(), { headers });
      }
      case "view": {
        // The dates the email would be for, and whether a module password will be asked.
        const found = await transaction(async (client) => {
          const session = await readSession(client, { companyId, yearKey, loginName: operator });
          const view = (await client.query("SELECT payload FROM smart_system.report_saved_view WHERE co_key = $1 AND user_no = $2 AND report_name = $3 AND view_name = $4", [session.companyKey, session.userNo, body.reportName, viewName])).rows[0];
          if (!view) throw new MailRefusal("The saved view was not found");
          const selection = cleanSelection(viewSelection(view.payload));
          return { from: selection.from, upto: selection.upto, needsPassword: (await readRights(client, session, `Menu-${menuName}`)).modulePassword !== "" };
        }, { readOnlyWork: true, timeoutMs: 15000 });
        return Response.json(found, { headers });
      }
      case "approve":
      case "unapprove": {
        if (!canApproveRecipients(user.role)) return Response.json({ error: "Only the platform admin can change the approved addresses" }, { status: 403, headers });
        const address = cleanAddress(body.address);
        await transaction((client) => (body.action === "approve" ? approveAddress(client, address, user.id) : removeAddress(client, address)), { timeoutMs: 15000 });
        return Response.json(await state(), { headers });
      }
      default: return Response.json({ error: `Unknown action ${body.action}` }, { status: 400, headers });
    }
  } catch (error) {
    if (error instanceof MailRefusal || error instanceof ReportRefusal) return Response.json({ refusal: error.message }, { headers });
    const requestId = logError({ request, route: "/api/report-schedules", action: `Report email ${body.action}`, error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
