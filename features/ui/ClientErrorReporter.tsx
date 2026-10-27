"use client";

import { useEffect } from "react";
import { reportClientError } from "./clientErrorReport";

/** Mounted once in app/layout.tsx: reports uncaught errors and unhandled promise rejections to the server log. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError("window.error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportClientError("unhandledrejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
