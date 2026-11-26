import { authReady } from "@/lib/auth/request";
import { transaction } from "@/lib/db";
import { logError, logWarn } from "@/lib/log";
import { buildMailFile } from "@/lib/report-mail/build";
import { MAIL_TYPES, MailRefusal } from "@/lib/report-mail/rules";
import { claimJob, ensureReportMail, finishJob, noteFile, noteMailer, readSchedule } from "@/lib/report-mail/store";
import type { JobOutcome } from "@/lib/report-mail/store";
import { MIN_TOKEN_LENGTH, sameToken, sha256 } from "@/lib/report-mail/token";
import { ReportRefusal } from "@/lib/report/generate";

/**
 * The mailer program's door (scripts/report-mailer.mts). No signed-in user: it is opened only by REPORT_MAILER_TOKEN, and is off when no
 * token is set. It can only take the next queued send and report its result; it cannot choose a report, a user or a recipient.
 */

type Body = Readonly<{ action: string; jobId?: number; jobKey?: string; outcome?: string; error?: string }>;

const headers = { "cache-control": "no-store" };
const OUTCOMES: ReadonlySet<string> = new Set(["sent", "retry", "failed", "unknown"]);

let ready = false;

export async function POST(request: Request) {
  const expected = (process.env.REPORT_MAILER_TOKEN ?? "").trim();
  if (expected.length < MIN_TOKEN_LENGTH) return Response.json({ error: "Not found" }, { status: 404, headers });
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!(await sameToken(given, expected))) return Response.json({ error: "Refused" }, { status: 401, headers });
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }

  try {
    if (!ready) {
      await authReady();
      await transaction(ensureReportMail, { timeoutMs: 15000 });
      ready = true;
    }
    if (body?.action === "result") {
      if (!OUTCOMES.has(String(body.outcome))) return Response.json({ error: "Unknown outcome" }, { status: 400, headers });
      const hash = await sha256(String(body.jobKey ?? ""));
      const done = await transaction((client) => finishJob(client, Math.trunc(Number(body.jobId) || 0), hash, body.outcome as JobOutcome, String(body.error ?? "")), { timeoutMs: 15000 });
      return Response.json({ recorded: done }, { status: done ? 200 : 409, headers });
    }
    if (body?.action !== "next") return Response.json({ error: "Unknown action" }, { status: 400, headers });

    const jobKey = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const hash = await sha256(jobKey);
    const claimed = await transaction(async (client) => {
      await noteMailer(client);
      const job = await claimJob(client, hash);
      return job ? { ...job, schedule: await readSchedule(client, job.scheduleId) } : null;
    }, { timeoutMs: 15000 });
    if (!claimed) return Response.json({ job: null }, { headers });

    try {
      if (!claimed.schedule?.active) throw new MailRefusal("The schedule is no longer active");
      const file = await buildMailFile(claimed.schedule);
      await transaction((client) => noteFile(client, claimed.jobId, file.fileName, file.bytes.length), { timeoutMs: 15000 });
      return Response.json({
        job: {
          id: claimed.jobId, key: jobKey, recipients: file.recipients, subject: file.subject, text: file.text,
          fileName: file.fileName, contentType: MAIL_TYPES[claimed.schedule.format], content: Buffer.from(file.bytes).toString("base64"),
        },
      }, { headers });
    } catch (error) {
      // Nothing was sent. A refusal is final; anything else (the database away for a moment) is tried again.
      const refused = error instanceof MailRefusal || error instanceof ReportRefusal;
      const message = error instanceof Error ? error.message : String(error);
      if (refused) logWarn(`Report email refused: ${message}`, { route: "/api/report-mailer", jobId: claimed.jobId });
      else logError({ request, route: "/api/report-mailer", action: "Build report email", error });
      await transaction((client) => finishJob(client, claimed.jobId, hash, refused ? "failed" : "retry", refused ? message : `The report could not be made: ${message}`), { timeoutMs: 15000 });
      return Response.json({ job: null, more: true }, { headers });
    }
  } catch (error) {
    const requestId = logError({ request, route: "/api/report-mailer", action: "Report mailer", error });
    return Response.json({ error: "The request failed", requestId }, { status: 500, headers });
  }
}
