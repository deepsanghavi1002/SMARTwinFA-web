"use client";

import { useEffect, useState } from "react";

/**
 * The bottom status line of a screen, as Main_Menu_New's StatusStrip: the hot keys of the control
 * in use (status_Hot_Keys), its message or the tooltip under the mouse (status_Message, red for an
 * error), Caps and Num lock (Caps_Lock / Num_Lock, bright when on) and the program version
 * (status_Winfa_Version, max winfa_version as 2026.07).
 *
 * A browser cannot read the lock keys until a key or the mouse is used, so they show off till then.
 */
export function useLockKeys() {
  const [locks, setLocks] = useState({ caps: false, num: false });
  useEffect(() => {
    const read = (event: KeyboardEvent | MouseEvent) => {
      if (typeof event.getModifierState !== "function") return;
      const caps = event.getModifierState("CapsLock");
      const num = event.getModifierState("NumLock");
      setLocks((current) => (current.caps === caps && current.num === num ? current : { caps, num }));
    };
    window.addEventListener("keydown", read, true);
    window.addEventListener("keyup", read, true);
    window.addEventListener("mousedown", read, true);
    return () => {
      window.removeEventListener("keydown", read, true);
      window.removeEventListener("keyup", read, true);
      window.removeEventListener("mousedown", read, true);
    };
  }, []);
  return locks;
}

/** `rows`: the grid's row status (status_Row_Status); `totals`: the selected cells' Sum / Count / Average. */
export function ScreenStatus({ hotKeys, message, error = false, version, rows = "", totals = "" }: { hotKeys: string; message: string; error?: boolean; version: string; rows?: string; totals?: string }) {
  const { caps, num } = useLockKeys();
  return (
    <div className="mp-status ui-status" role="status">
      <span className="ui-status-keys" title={hotKeys}>{hotKeys}</span>
      <span className={`ui-status-message ${error ? "ui-status-error" : ""}`} title={message}>{message}</span>
      {totals && <span className="ui-status-totals" title="Selected cells">{totals}</span>}
      {rows && <span className="ui-status-rows">{rows}</span>}
      <span className={`ui-status-lock ${caps ? "ui-status-lock-on" : ""}`} title="Caps Lock">Caps</span>
      <span className={`ui-status-lock ${num ? "ui-status-lock-on" : ""}`} title="Num Lock">Num</span>
      <span className="ui-status-version" title="Program version">{version}</span>
    </div>
  );
}
