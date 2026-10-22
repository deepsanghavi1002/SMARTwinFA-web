import { transaction } from "@/lib/db";
import { trustedDevelopmentEnabled } from "@/lib/master-program/access";
import { readSession } from "@/lib/master-program/session";
import type { SessionKey } from "@/lib/master-program/types";
import { ask, questionList, searchParties, searchProducts } from "@/lib/ask/ask";

/**
 * Ask AI (no model): a question is matched to a fixed list and answered by a fixed read-only query over the open company's tables
 * (lib/ask/ask.ts). The work runs in a read-only transaction and nothing the browser sends reaches the SQL text.
 */

type Body = Readonly<{ session: SessionKey; question?: string; templateId?: number; partyCode?: number; allParties?: boolean; /** A row of an answer opened for its parties. */ detail?: string; /** "parties": the party help. */ action?: string; term?: string }>;

const headers = { "cache-control": "no-store" };

export async function GET() {
  return Response.json({ questions: questionList() }, { headers });
}

export async function POST(request: Request) {
  if (!trustedDevelopmentEnabled(process.env.SMARTWINFA_TRUSTED_LOCAL_MODE)) {
    return Response.json({ error: "Ask AI is disabled until authenticated sessions are implemented. SMARTWINFA_TRUSTED_LOCAL_MODE=true is for isolated development with disposable data only." }, { status: 403, headers });
  }
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  if (!body || !body.session) return Response.json({ error: "session is required" }, { status: 400, headers });
  const key: SessionKey = { companyId: Number(body.session.companyId), yearKey: Number(body.session.yearKey), loginName: String(body.session.loginName ?? "") };
  try {
    const reply = await transaction(async (client) => {
      const session = await readSession(client, key);
      if (body.action === "products") return { parties: await searchProducts(client, session, String(body.term ?? "").slice(0, 60)) };
      if (body.action === "parties") return { parties: await searchParties(client, session, String(body.term ?? "").slice(0, 60)) };
      return await ask(client, session, { question: body.question, detail: typeof body.detail === "string" ? body.detail : undefined, templateId: body.templateId === undefined ? undefined : Number(body.templateId), partyCode: body.partyCode === undefined ? undefined : Number(body.partyCode), allParties: body.allParties === true });
    }, { readOnlyWork: true, timeoutMs: 20000 });
    return Response.json(reply, { headers });
  } catch (error) {
    console.error("Ask AI error:", error instanceof Error ? error.message : error);
    return Response.json({ error: error instanceof Error ? error.message : "The question could not be answered" }, { status: 500, headers });
  }
}
