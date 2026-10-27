"use client";

import { useEffect } from "react";
import { reportClientError } from "../features/ui/clientErrorReport";

/** The root layout itself failed: it replaces the whole page, so it brings its own html and body. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("global-error", error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <div role="alert" style={{ padding: 24, fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <p>The application could not be shown. The problem has been reported.{error.digest ? ` Reference: ${error.digest}` : ""}</p>
          <button type="button" onClick={reset}>Try again</button>
        </div>
      </body>
    </html>
  );
}
