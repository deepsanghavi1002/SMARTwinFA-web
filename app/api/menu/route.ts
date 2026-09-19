import { readMenuCatalog } from "@/lib/menu-catalog";

export async function GET(request: Request) {
  const group = (new URL(request.url).searchParams.get("group") || "").trim().slice(0, 40);
  try {
    return Response.json({ menus: await readMenuCatalog(group || null) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Menu catalog error:", error);
    const message = error instanceof Error ? error.message : "Menu could not be loaded";
    return Response.json({ error: message }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
