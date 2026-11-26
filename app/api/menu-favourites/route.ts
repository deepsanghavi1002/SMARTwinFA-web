import { currentUser, signInRequired } from "@/lib/auth/request";
import { transaction } from "@/lib/db";
import { logError } from "@/lib/log";
import { readSession } from "@/lib/master-program/session";
import { readMenuCatalog } from "@/lib/menu-catalog";
import { MAX_FAVOURITES, WEB_ONLY_KEYS, favouriteRows } from "@/lib/menu-favourites/items";
import { addFavourite, ensureFavourites, listFavourites, removeFavourite, swapFavourites } from "@/lib/menu-favourites/store";

/**
 * The signed-in user's own menu favourites for the open company. A favourite is only a shortcut: it opens the same menu row, with the same
 * rights checks, and only rows of the company's menu can be added.
 */

type Body = Readonly<{ action: string; companyId: number; yearKey: number; key?: string; other?: string }>;

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
  const key = String(body?.key ?? "").slice(0, 300);
  if (!body || !["list", "add", "remove", "swap"].includes(body.action) || !Number.isInteger(companyId) || !Number.isInteger(yearKey)) {
    return Response.json({ error: "action, company and year are required" }, { status: 400, headers });
  }

  try {
    if (!ready) {
      await transaction(ensureFavourites, { timeoutMs: 15000 });
      ready = true;
    }
    const result = await transaction(async (client) => {
      const session = await readSession(client, { companyId, yearKey, loginName: operator });
      const owner = { userId: user.id, companyName: session.companyName, companyGroup: session.companyGroup };
      if (body.action === "add") {
        if (!WEB_ONLY_KEYS.has(key) && !favouriteRows(await readMenuCatalog(session.companyGroup || null)).has(key)) return { refusal: "This item is not in this company's menu" };
        if (!(await addFavourite(client, owner, key))) return { refusal: `At most ${MAX_FAVOURITES} favourites can be kept. Remove one first` };
      }
      if (body.action === "remove") await removeFavourite(client, owner, key);
      if (body.action === "swap") await swapFavourites(client, owner, key, String(body.other ?? ""));
      return { keys: await listFavourites(client, owner) };
    }, { timeoutMs: 15000 });
    return Response.json(result, { headers });
  } catch (error) {
    const requestId = logError({ request, route: "/api/menu-favourites", action: `Menu favourites ${body.action}`, error, userId: operator });
    return Response.json({ error: error instanceof Error ? error.message : "The request failed", requestId }, { status: 500, headers });
  }
}
