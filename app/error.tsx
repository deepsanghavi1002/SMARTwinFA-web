"use client";

import { useEffect } from "react";
import { reportClientError } from "../features/ui/clientErrorReport";

/** A screen failed while rendering: the error goes to the server log, and the user can try again. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("error-boundary", error);
  }, [error]);
  return (
    <div role="alert" style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h2>Something went wrong</h2>
      <p>The screen could not be shown. The problem has been reported.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
      <button type="button" onClick={reset}>Try again</button>
    </div>
  );
}
