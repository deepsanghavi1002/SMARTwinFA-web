import type { Client } from "pg";
import { transaction } from "@/lib/db";
import { requireOperator } from "@/lib/auth/request";
import { readSession } from "@/lib/master-program/session";
import type { MasterSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { ask, hasTemplate, matchedId, partyScope, questionList, searchParties, searchProducts } from "@/lib/ask/ask";
import { ensureMemory, forget, listMemory, noteMissed, recall, remember } from "@/lib/ask/memory";

/**
 * Ask AI (no model): a question is matched to a fixed list and answered by a fixed read-only query over the open company's tables
 * (lib/ask/ask.ts). The work runs in a read-only transaction and nothing the browser sends reaches the SQL text.
 */

type Body = Readonly<{ session: SessionKey; question?: string; templateId?: number; partyCode?: number; allParties?: boolean; /** A row of an answer opened for its parties. */ detail?: string; /** "parties": the party help; "memory": the recent and most asked questions; "forget": one remembered question (question) or all of them. */ action?: string; /** "forget" of all: only the recent or only the most asked list. */ scope?: string; term?: string; /** The wording that was not understood, taught by picking this question. */ teach?: string }>;

const headers = { "cache-control": "no-store" };

export async function GET() {
  return Response.json({ questions: questionList() }, { headers });
}

export async function POST(request: Request) {
  const operator = await requireOperator(request, headers);
  if (operator instanceof Response) return operator;
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || !body.session) return Response.json({ error: "session is required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: operator };
  try {
    /** The memory is kept in its own write transaction (the answer runs read-only); a failure there never stops an answer. */
    const memory = async <T,>(work: (client: Client, session: MasterSession) => Promise<T>): Promise<T | null> => {
      try {
        return await transaction(async (client) => { await ensureMemory(client); return await work(client, await readSession(client, key)); }, { timeoutMs: 10000 });
      } catch (error) {
        console.error("Ask AI memory error:", error instanceof Error ? error.message : error);
        return null;
      }
    };
    if (body.action === "forget") { await memory((client, session) => forget(client, session, typeof body.question === "string" && body.question.trim() !== "" ? body.question : undefined, body.scope === "recent" || body.scope === "favourite" ? body.scope : undefined)); return Response.json({ ok: true }, { headers }); }
    if (body.action === "memory") return Response.json(await memory(listMemory) ?? { recent: [], favourite: [] }, { headers });

    const question = String(body.question ?? "").trim();
    const fresh = !body.action && !body.detail && body.templateId === undefined && body.partyCode === undefined && body.allParties !== true && question !== "";
    // A question asked before is answered with what it was answered with then (its template and its party or product).
    const recalled = fresh ? await memory((client, session) => recall(client, session, question)) : null;
    // What was remembered is used when it was taught, or still agrees with how the question is read now; a remembered match that the program
    // now reads differently (a better question was added since) is not trusted, and the new answer is remembered in its place.
    const now = fresh ? matchedId(question) : 0;
    const known = recalled !== null && hasTemplate(recalled.templateId) && (recalled.taught || now === 0 || now === recalled.templateId);

    const reply = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (body.action === "products") return { parties: await searchProducts(client, session, String(body.term ?? "").slice(0, 60)) };
      if (body.action === "parties") {
        const scope = typeof body.question === "string" && body.templateId !== undefined ? partyScope(session, body.question.slice(0, 300), Number(body.templateId)) : {};
        return { parties: await searchParties(client, session, String(body.term ?? "").slice(0, 60), scope.period, scope.book) };
      }
      return await ask(client, session, {
        question: body.question, detail: typeof body.detail === "string" ? body.detail : undefined,
        templateId: known ? recalled.templateId : body.templateId === undefined ? undefined : Number(body.templateId),
        // The party or product chosen last time is not used again: a question that needs one shows the list to choose from every time.
        partyCode: body.partyCode === undefined ? undefined : Number(body.partyCode), allParties: body.allParties === true,
      });
    }, { readOnlyWork: true, timeoutMs: 90000 });

    if (!body.action && !body.detail && question !== "" && "kind" in reply) {
      if (reply.kind === "answer" && reply.used) {
        const used = reply.used;
        await memory(async (client, session) => {
          await remember(client, session, { question, templateId: used.templateId, partyCode: used.partyCode });
          // A wording the program did not know, taught by picking the nearest question: kept against the same template.
          if (typeof body.teach === "string" && body.teach.trim() !== "") await remember(client, session, { question: body.teach, templateId: used.templateId, partyCode: used.partyCode, taught: true });
        });
      } else if (reply.kind === "refuse") await memory((client, session) => noteMissed(client, session, question));
    }
    return Response.json(reply, { headers });
  } catch (error) {
    console.error("Ask AI error:", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "The question could not be answered" }, { status: 500, headers });
  }
}
