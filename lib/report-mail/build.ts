/**
 * The file of one queued send: the rights and recipients checked again, the report run read-only, and its PDF or Excel made the way the
 * screen's export makes it.
 */
import { transaction } from "../db";
import { pdf } from "../export/pdf";
import { safeFileName } from "../export/table";
import { xlsx } from "../export/xlsx";
import { Loader } from "../master-program/load";
import { readSession } from "../master-program/session";
import { wholeReportTable, gridWidth } from "../report/exportTable";
import { runReport } from "../report/reportCombine";
import { cleanSelection } from "../report/selection";
import { checkReportAccess } from "./access";
import { MailRefusal, recipientRefusal } from "./rules";
import { approvedAddresses } from "./store";
import type { Schedule } from "./store";

export type MailFile = Readonly<{ fileName: string; bytes: Uint8Array; subject: string; text: string; recipients: readonly string[] }>;

/** Date and time in India, whatever the server's own time zone is. */
function now(): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return { date: `${parts.day}-${parts.month}-${parts.year}`, time: `${parts.hour}:${parts.minute}` };
}

export async function buildMailFile(schedule: Schedule): Promise<MailFile> {
  const access = await checkReportAccess(schedule, { salt: schedule.passwordSalt, mark: schedule.passwordMark });
  const approved = await transaction((client) => approvedAddresses(client), { readOnlyWork: true });
  const refused = recipientRefusal(schedule.recipients, access.ownEmail, approved);
  if (refused !== "") throw new MailRefusal(refused);

  const output = await transaction(async (client) => {
    const loader = new Loader(client, await readSession(client, { companyId: schedule.companyId, yearKey: schedule.yearKey, loginName: schedule.operator }));
    const result = await runReport(loader, schedule.reportName, cleanSelection(schedule.selection));
    // An emailed report only reads: one that asks to write something (Update Value In Master) is not sent.
    if (loader.writes.length > 0) throw new MailRefusal("This selection also writes to the books, so it cannot be emailed. Untick the option that updates the master.");
    return result;
  }, { readOnlyWork: true, timeoutMs: 120000 });

  const table = wholeReportTable(output, access.companyName, schedule.name);
  const when = now();
  const width = output.columns.reduce((sum, column) => sum + gridWidth(column), 0);
  const bytes = schedule.format === "pdf"
    ? pdf(table, { orientation: width > 700 ? "landscape" : "portrait", fontSize: 10, totals: true, footer: `Printed ${when.date} ${when.time} by ${schedule.operator}` })
    : xlsx(table, (output.title || schedule.name).slice(0, 31));
  const title = output.title || schedule.name;
  return {
    fileName: `${safeFileName(`${title} - ${when.date}`)}.${schedule.format}`,
    bytes,
    subject: `${access.companyName} - ${title} - ${schedule.name}`.replace(/[\r\n]+/g, " ").slice(0, 200),
    text: [`${access.companyName}`, title, output.dateLine, output.selectionLine, "", `Saved view: ${schedule.name}`, `Entries: ${output.records}`, ...(output.warnings.length > 0 ? ["", "Report warnings:", ...output.warnings] : []), "", `Sent from SMARTwinFA on ${when.date} at ${when.time}, requested by ${schedule.operator}.`].join("\n"),
    recipients: schedule.recipients,
  };
}
