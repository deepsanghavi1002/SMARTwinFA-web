const release = process.env.SMARTWINFA_RELEASE?.trim() || "development";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "smartwinfa-web",
    release,
    schemaBaseline: "0002_canonical_accounting",
    runtimeMode: "migration-test",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
