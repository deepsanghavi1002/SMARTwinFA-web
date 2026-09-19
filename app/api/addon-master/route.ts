import { readAddonGroups, readAddonRecords } from "@/lib/addon-master";

/**
 * Addon sub master data for the company opened at startup.
 *
 * Without `group`, the list of addons. With it, that addon's records.
 * The schema always comes from the caller's startup selection, so the route
 * serves whichever company is open rather than a fixed one.
 */
export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const schema = (parameters.get("schema") || "").trim().slice(0, 63);
  const group = (parameters.get("group") || "").trim();
  const headers = { "cache-control": "no-store" };

  if (!schema) {
    return Response.json({ error: "A company is required" }, { status: 400, headers });
  }

  try {
    if (!group) {
      return Response.json({ groups: await readAddonGroups(schema) }, { headers });
    }
    if (!/^\d{1,9}$/.test(group)) {
      return Response.json({ error: "The addon id is not a number" }, { status: 400, headers });
    }
    return Response.json({ records: await readAddonRecords(schema, Number(group)) }, { headers });
  } catch (error) {
    console.error("Addon master error:", error);
    const message = error instanceof Error ? error.message : "Addon master could not be loaded";
    return Response.json({ error: message }, { status: 503, headers });
  }
}
