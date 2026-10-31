import { query } from "@/lib/db";
import { logError } from "@/lib/log";

export async function GET() {
  try {
    // Test connection by querying schemas
    const result = await query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
      ORDER BY schema_name;
    `);

    return Response.json({
      success: true,
      message: "Database connection successful",
      schemas: result.rows,
    });
  } catch (error) {
    const requestId = logError({ route: "/api/db/test", action: "Database test", error });
    return Response.json(
      {
        success: false,
        message: "Database connection failed",
        error: error instanceof Error ? error.message : String(error),
        requestId,
      },
      { status: 500 }
    );
  }
}
