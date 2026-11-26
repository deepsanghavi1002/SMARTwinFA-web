import assert from "node:assert/strict";
import test from "node:test";
import { isPublicApi } from "../lib/auth/paths.ts";
import { captionMover, wholeReportTable } from "../lib/report/exportTable.ts";
import type { OutputRow, ReportOutput } from "../lib/report/types.ts";
import { MailRefusal, canApproveRecipients, cleanFormat, cleanRecipients, recipientRefusal, rightsRefusal, viewSelection } from "../lib/report-mail/rules.ts";
import type { RightsFacts } from "../lib/report-mail/rules.ts";
import { sendMailJob, surelyNotSent } from "../lib/report-mail/send.ts";
import type { MailJob, Transport } from "../lib/report-mail/send.ts";
import { sameToken } from "../lib/report-mail/token.ts";

const allowed: RightsFacts = {
  user: { status: "active", role: "employee", operatorLogin: "ravi" }, operator: "RAVI",
  yearAllowed: true, companyAllowed: true, menuVisible: true, exportRight: true, reportKey: 6, passwordNow: "", passwordThen: "",
};

test("a report is sent only while every right holds", () => {
  assert.equal(rightsRefusal(allowed), "");
  const refused: [Partial<RightsFacts>, RegExp][] = [
    [{ user: null }, /not active/],
    [{ user: { status: "disabled", role: "employee", operatorLogin: "ravi" } }, /not active/],
    [{ user: { status: "active", role: "employee", operatorLogin: "other" } }, /no longer linked/],
    [{ user: { status: "active", role: "company_admin", operatorLogin: null } }, /no longer linked/],
    [{ yearAllowed: false }, /accounting year/],
    [{ companyAllowed: false }, /company/],
    [{ menuVisible: false }, /menu/],
    [{ reportKey: 24 }, /Only the Trial Balance/],
    [{ exportRight: false }, /Export rights/],
    [{ passwordNow: "abc", passwordThen: "" }, /module password/],
    [{ passwordNow: "abc", passwordThen: "old" }, /module password/],
  ];
  for (const [change, message] of refused) assert.match(rightsRefusal({ ...allowed, ...change }), message);
  assert.equal(rightsRefusal({ ...allowed, passwordNow: "abc", passwordThen: "abc" }), "");
  // The platform admin chooses the operator at sign-in, so has none of their own.
  assert.equal(rightsRefusal({ ...allowed, user: { status: "active", role: "platform_admin", operatorLogin: null } }), "");
});

test("recipients are the user's own address or approved ones", () => {
  assert.deepEqual(cleanRecipients(" A@x.com; b@y.in, a@x.com "), ["a@x.com", "b@y.in"]);
  for (const bad of ["", "nobody", "a@x.com\r\nBcc: z@z.com", "Name <a@x.com>", Array.from({ length: 11 }, (_, at) => `u${at}@x.com`)]) {
    assert.throws(() => cleanRecipients(bad), MailRefusal);
  }
  assert.equal(recipientRefusal(["me@x.com", "boss@x.com"], "Me@x.com", ["boss@x.com"]), "");
  assert.match(recipientRefusal(["me@x.com", "stranger@y.com"], "me@x.com", []), /stranger@y\.com/);
  assert.match(recipientRefusal(["me@x.com"], null, []), /me@x\.com/);
  assert.equal(canApproveRecipients("platform_admin"), true);
  assert.equal(canApproveRecipients("company_admin"), false);
});

test("only PDF or Excel, and no view with Group By", () => {
  assert.equal(cleanFormat("xlsx"), "xlsx");
  assert.throws(() => cleanFormat("exe"), MailRefusal);
  assert.deepEqual(viewSelection({ selection: { from: "x" }, groupBy: [] }), { from: "x" });
  assert.throws(() => viewSelection({ selection: {}, groupBy: [{ key: "NAME" }] }), /Group By/);
  assert.throws(() => viewSelection(null), MailRefusal);
});

test("the mailer's route needs no session; the users' route does", async () => {
  assert.equal(isPublicApi("/api/report-mailer", "POST"), true);
  assert.equal(isPublicApi("/api/report-mailer", "GET"), false);
  assert.equal(isPublicApi("/api/report-schedules", "POST"), false);
  assert.equal(await sameToken("a".repeat(40), "a".repeat(40)), true);
  assert.equal(await sameToken("a".repeat(39), "a".repeat(40)), false);
});

const job: MailJob = { id: 1, key: "k", recipients: ["a@x.com"], subject: "s", text: "t", fileName: "f.pdf", contentType: "application/pdf", content: Buffer.from("PDF").toString("base64") };
const transport = (send: Transport["sendMail"], verify: Transport["verify"] = async () => true): Transport => ({ verify, sendMail: send });
const failing = (fields: Record<string, unknown>) => async () => { throw Object.assign(new Error("boom"), fields); };

test("a send is repeated only when it surely did not go", async () => {
  const options = (value: Transport) => ({ from: "r@x.com", maxBytes: 1000, transport: value });
  assert.equal((await sendMailJob(job, options(transport(async () => ({ rejected: [] }))))).outcome, "sent");
  const partly = await sendMailJob(job, options(transport(async () => ({ rejected: ["b@x.com"] }))));
  assert.equal(partly.outcome, "sent");
  assert.match(partly.error, /b@x\.com/);
  let tried = false;
  assert.equal((await sendMailJob(job, options(transport(async () => { tried = true; return {}; }, failing({ code: "EAUTH" }))))).outcome, "retry");
  assert.equal(tried, false);
  assert.equal((await sendMailJob(job, options(transport(failing({ responseCode: 552, command: "DATA" }))))).outcome, "retry");
  // nodemailer reports a connection lost in the middle as command CONN: it may have gone.
  assert.equal((await sendMailJob(job, options(transport(failing({ code: "ECONNECTION", command: "CONN" }))))).outcome, "unknown");
  assert.equal((await sendMailJob(job, options(transport(failing({ code: "ETIMEDOUT" }))))).outcome, "unknown");
  assert.equal(surelyNotSent({ code: "EENVELOPE" }), true);
  const large = await sendMailJob(job, { from: "r@x.com", maxBytes: 2, transport: transport(async () => ({})) });
  assert.equal(large.outcome, "failed");
  assert.match(large.error, /limit/);
});

const row = (kind: OutputRow["kind"], rowType: string, values: Record<string, string>, level = 0): OutputRow => ({ kind, level, rowType, values, ledKey: 0, processKey: 0 });

test("the emailed table reads like the screen's export", () => {
  const output = {
    title: "TRIAL BALANCE", dateLine: "As on", records: 2, headingColours: { SCHEDULE: "Pink" }, headingCaptions: { SCHEDULE: "Schedule" },
    columns: [
      { key: "CODE", caption: "CODE", width: 50, align: "L", kind: "text", decimals: 0, visible: true },
      { key: "NAME", caption: "NAME", width: 200, align: "L", kind: "text", decimals: 0, visible: true },
      { key: "DEBIT", caption: "DEBIT", width: 100, align: "R", kind: "number", decimals: 2, visible: true },
    ],
    rows: [
      row("data", "SCHEDULE", { NAME: "FIXED ASSETS" }),
      row("data", "LED", { NAME: "Plant", DEBIT: "1,250.50" }),
      row("subtotal", "", { NAME: "Subtotal", DEBIT: "1,250.50" }),
      row("total", "", { CODE: "Total", DEBIT: "1,250.50" }),
    ],
  } as unknown as ReportOutput;
  const table = wholeReportTable(output, "COMPANY", "Fallback");
  assert.equal(table.title, "TRIAL BALANCE");
  assert.equal(table.footerCenter, "2 entries");
  assert.equal(table.rows.length, 4);
  assert.equal(table.rows[1][2], 1250.5);
  // The final total's caption moves under the subtotals' captions.
  assert.deepEqual(table.rows[3], [null, "Total", 1250.5]);
  assert.equal(captionMover(output)(output.rows[1]), output.rows[1]);
  assert.equal(table.columns[1].width, 240);
  assert.equal(table.rowStyles?.[1], null);
  assert.equal(table.rowStyles?.[0]?.bold, true);
  assert.match(table.rowStyles?.[0]?.fill ?? "", /^[0-9A-F]{6}$/);
  assert.equal(table.totals, undefined);
});
