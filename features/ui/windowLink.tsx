"use client";

import { createContext, useContext } from "react";

/**
 * Windows opened by zoom (a report row's voucher or account) belong to the window they were opened from. When one of them changes data (an entry saved or
 * deleted), the windows it was opened from, up the chain (Trial Balance > Ledger > Entry), are stale: each runs its report again when it is next in front.
 */
export type WindowLink = Readonly<{
  /** Something this window's zoom windows changed since it last ran. */
  stale: boolean;
  clearStale: () => void;
  /** This window changed data: the windows it was zoomed from are stale. */
  changed: () => void;
}>;

const NONE: WindowLink = { stale: false, clearStale: () => undefined, changed: () => undefined };
const WindowLinkContext = createContext<WindowLink>(NONE);

export const WindowLinkProvider = WindowLinkContext.Provider;
export const useWindowLink = () => useContext(WindowLinkContext);
