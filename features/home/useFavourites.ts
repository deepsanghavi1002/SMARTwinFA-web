"use client";

import { useCallback, useEffect, useState } from "react";
import { messageBox } from "../ui/MessageBox";
import type { StartupSelection } from "../startup/StartupGate";

/** The signed-in user's menu favourites for the open company (app/api/menu-favourites). */

export type FavouriteChange = Readonly<{ action: "add" | "remove"; key: string } | { action: "swap"; key: string; other: string }>;

export function useFavourites(selection: StartupSelection | null) {
  const companyId = Number(selection?.companyId ?? NaN);
  const yearKey = selection?.yearKey ?? NaN;
  const owner = `${companyId}|${yearKey}|${selection?.loginName ?? ""}`;
  // Kept with whose they are, so another company's list never shows while the new one is read.
  const [saved, setSaved] = useState<{ owner: string; keys: readonly string[] }>({ owner: "", keys: [] });

  const call = useCallback(async (payload: Record<string, unknown>): Promise<readonly string[]> => {
    const response = await fetch("/api/menu-favourites", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ ...payload, companyId, yearKey }) });
    const body = await response.json() as { keys?: string[]; refusal?: string; error?: string };
    if (!response.ok || !body.keys) throw new Error(body.refusal || body.error || "Favourites could not be read");
    return body.keys;
  }, [companyId, yearKey]);

  useEffect(() => {
    if (!Number.isInteger(companyId) || !Number.isInteger(yearKey)) return;
    let live = true;
    // Favourites that cannot be read leave the menu as it is; adding one then says why.
    call({ action: "list" }).then((keys) => { if (live) setSaved({ owner, keys }); }).catch(() => undefined);
    return () => { live = false; };
  }, [call, owner, companyId, yearKey]);

  const change = useCallback((what: FavouriteChange) => {
    call(what).then((keys) => setSaved({ owner, keys })).catch((reason: unknown) => {
      void messageBox.alert(reason instanceof Error ? reason.message : "The favourite could not be saved", "Favourites", "warning");
    });
  }, [call, owner]);

  return { keys: saved.owner === owner ? saved.keys : [], change };
}
