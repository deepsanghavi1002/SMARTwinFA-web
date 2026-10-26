import { NextResponse } from "next/server";
import { crossSiteWrite } from "@/lib/auth/cookies";
import { isPublicApi } from "@/lib/auth/paths";
import { currentUser, signInRequired } from "@/lib/auth/request";

/**
 * Every /api call needs a live session unless lib/auth/paths.ts lists it as public, and no call
 * that changes something is accepted from another site. Routes still read the user themselves
 * (lib/auth/request.ts); this gate makes sure a route that forgets to is not open.
 */
export async function middleware(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (crossSiteWrite(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403, headers });
  if (isPublicApi(new URL(request.url).pathname, request.method)) return NextResponse.next();
  try {
    if (await currentUser(request)) return NextResponse.next();
  } catch (error) {
    console.error("Session check error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The session could not be checked" }, { status: 503, headers });
  }
  return signInRequired(headers);
}

export const config = { matcher: ["/api/:path*"] };
