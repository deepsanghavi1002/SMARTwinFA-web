import { publicSetup, readMasterRules } from "@/lib/master-rules";

/**
 * The per-column setup of one master, as smart_setup.program_body holds it.
 *
 * The grid asks for this before it lets anything be typed, so a column behaves the way
 * the installation says it should rather than the way the web app assumes. The program
 * name is the one program_top carries (MASTER_ADDON_SUB and the like), not the menu's.
 *
 * The settings that carry SQL stay on the server; each field only says which of them
 * it has, so the browser knows when a check has to go back for an answer.
 */
export async function GET(request: Request) {
  const program = (new URL(request.url).searchParams.get("program") || "").trim().slice(0, 64);
  const headers = { "cache-control": "no-store" };

  if (!program) {
    return Response.json({ error: "A program is required" }, { status: 400, headers });
  }
  if (!/^[A-Za-z0-9_]+$/.test(program)) {
    return Response.json({ error: "The program name is not valid" }, { status: 400, headers });
  }

  try {
    const fields = (await readMasterRules(program)).map((field) => ({ ...field, setup: publicSetup(field.setup) }));
    return Response.json({ fields }, { headers });
  } catch (error) {
    console.error("Master rules error:", error);
    const message = error instanceof Error ? error.message : "The master setup could not be loaded";
    return Response.json({ error: message }, { status: 503, headers });
  }
}
