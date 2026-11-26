/**
 * One send by the mailer program, and what its failure means: whether the email can safely be tried again, or may already be on its way.
 * The mail library is passed in, so this is tested without a mail server.
 */

export type MailJob = Readonly<{ id: number; key: string; recipients: string[]; subject: string; text: string; fileName: string; contentType: string; content: string }>;

export type SendResult = Readonly<{ outcome: "sent" | "retry" | "failed" | "unknown"; error: string }>;

export type Transport = Readonly<{
  verify: () => Promise<unknown>;
  sendMail: (message: { from: string; to: string[]; subject: string; text: string; attachments: { filename: string; content: Buffer; contentType: string }[] }) => Promise<{ rejected?: readonly unknown[] }>;
}>;

type MailError = { message?: string; code?: string; command?: string; responseCode?: number };

const describe = (error: unknown) => (error instanceof Error ? error.message : String((error as MailError)?.message ?? error));

/**
 * Whether the message surely did not go: the server answered with a refusal, or the failure was in signing in or in the addresses. Anything
 * else (a connection lost or timed out) may have come after the server took the message.
 */
export function surelyNotSent(error: unknown): boolean {
  const { code, command, responseCode } = (error ?? {}) as MailError;
  if (typeof responseCode === "number" && responseCode >= 400) return true;
  if (code === "EAUTH" || code === "EENVELOPE" || code === "EDNS") return true;
  return command === "MAIL FROM" || command === "RCPT TO" || String(command ?? "").startsWith("AUTH");
}

export async function sendMailJob(job: MailJob, options: Readonly<{ from: string; maxBytes: number; transport: Transport }>): Promise<SendResult> {
  const content = Buffer.from(job.content, "base64");
  if (content.length > options.maxBytes) {
    return { outcome: "failed", error: `The file is ${(content.length / 1048576).toFixed(1)} MB, over the ${(options.maxBytes / 1048576).toFixed(0)} MB limit. Choose fewer accounts, or Excel` };
  }
  // Connecting and signing in on their own first: a failure here has sent nothing.
  try { await options.transport.verify(); } catch (error) { return { outcome: "retry", error: `Mail server: ${describe(error)}` }; }
  try {
    const info = await options.transport.sendMail({ from: options.from, to: [...job.recipients], subject: job.subject, text: job.text, attachments: [{ filename: job.fileName, content, contentType: job.contentType }] });
    const rejected = (info.rejected ?? []).map(String);
    return { outcome: "sent", error: rejected.length > 0 ? `The mail server did not accept: ${rejected.join(", ")}` : "" };
  } catch (error) {
    return surelyNotSent(error)
      ? { outcome: "retry", error: `Mail server: ${describe(error)}` }
      : { outcome: "unknown", error: `The connection failed while sending. Check whether the email arrived before sending again (${describe(error)})` };
  }
}
