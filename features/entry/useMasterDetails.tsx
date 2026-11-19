"use client";

import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import type { MasterDetails as MasterDetailsData, MasterHint } from "../../lib/entry/details";
import { useStartupSelection } from "../startup/StartupGate";
import type { StartupSelection } from "../startup/StartupGate";
import { MasterDetails } from "./MasterDetails";

/**
 * F1 on an account or an item, for every screen: its whole master record in the Master Details window. The entry screens ask by the key of the
 * highlighted help row; a report asks by the name a cell shows (the server finds the account or the item). One call, one window.
 */
export type MasterDetailsRequest = Readonly<{ kind: "account" | "product"; key: number } | { name: string; hint?: MasterHint }>;
export type MasterDetailsReply = Readonly<{ kind: "account" | "product"; details: MasterDetailsData } | null>;

export async function masterDetailsCall(selection: StartupSelection, request: MasterDetailsRequest): Promise<MasterDetailsReply> {
  const response = await fetch("/api/master-details", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...request }),
  });
  const body = await response.json() as { kind: "account" | "product" | null; details: MasterDetailsData | null; error?: string };
  if (!response.ok || body.error) throw new Error(body.error || "Master details request failed");
  return body.kind && body.details ? { kind: body.kind, details: body.details } : null;
}

/** For a screen that has no window of its own (the reports): `show` asks, and `element` is the window to draw while it is open. */
export function useMasterDetails(onClosed?: () => void): { show: (request: MasterDetailsRequest) => Promise<boolean>; element: ReactNode; open: boolean } {
  const selection = useStartupSelection();
  const [shown, setShown] = useState<{ kind: "account" | "product"; data: MasterDetailsData } | null>(null);
  const show = useCallback(async (request: MasterDetailsRequest) => {
    if (!selection) throw new Error("No company is open");
    const reply = await masterDetailsCall(selection, request);
    if (!reply) return false;
    setShown({ kind: reply.kind, data: reply.details });
    return true;
  }, [selection]);
  const close = useCallback(() => { setShown(null); onClosed?.(); }, [onClosed]);
  return { show, open: shown !== null, element: shown ? <MasterDetails details={shown.data} kind={shown.kind} onClose={close} /> : null };
}
