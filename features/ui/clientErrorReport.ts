/**
 * Sends a browser error to the server's log (app/api/client-log). No cookies' contents, form values
 * or tokens are read here: only the message, stack, page, view, user agent and screen width.
 * Failures are swallowed on purpose: reporting an error must never raise another.
 */
const MAX_REPORTS_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();

function currentView(): "Modern" | "Legacy" {
  try {
    return localStorage.getItem("view-mode") === "modern" ? "Modern" : "Legacy";
  } catch {
    return "Legacy";
  }
}

export function reportClientError(source: string, error: unknown): void {
  try {
    if (sent >= MAX_REPORTS_PER_PAGE) return;
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
    const stack = error instanceof Error ? error.stack ?? "" : "";
    const key = `${source}|${message}|${stack.slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        source,
        message: message.slice(0, 1000),
        stack: stack.slice(0, 4000),
        url: location.href,
        view: currentView(),
        userAgent: navigator.userAgent,
        screenWidth: window.innerWidth,
      }),
    }).catch(() => undefined);
  } catch {
    // Nothing to do: the report itself failed.
  }
}
