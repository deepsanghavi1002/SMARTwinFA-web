import type { RefObject } from "react";
import { isMessageBoxOpen } from "../ui/MessageBox";

/**
 * The keyboard must never end up on the page itself (Space would scroll the whole screen and
 * the arrows would scroll without moving the cursor). If nothing holds it once a move, an edit
 * or a message has settled, the first grid that is on screen takes it back.
 */
export function keepGridFocus(...grids: RefObject<HTMLElement | null>[]) {
  setTimeout(() => {
    const holder = document.activeElement;
    if (isMessageBoxOpen() || (holder && holder !== document.body && holder.isConnected)) return;
    grids.find((grid) => grid.current)?.current?.focus({ preventScroll: true });
  }, 0);
}
