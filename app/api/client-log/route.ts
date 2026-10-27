import { handleClientLog } from "@/lib/client-log";

/** Browser errors, reported by features/ui/ClientErrorReporter. Open to signed-out users; see lib/client-log.ts for the caps. */
export async function POST(request: Request) {
  return handleClientLog(request);
}
