/**
 * Sends a finished HTML document to the printer through a hidden frame, so the print dialog
 * shows only the report (not the screen around it). Used by Print Preview and the master's
 * Print button, which both print the same pages.
 */
export function printHtmlDocument(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  // Give the pages a moment to lay out before the print dialog reads them.
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60000);
  }, 250);
}

/** The page setup a user last chose (orientation, font, totals), kept in this browser only. */
const SETUP_KEY = "smartwinfa.printSetup";
export type PrintSetup = { orientation: "portrait" | "landscape"; fontSize: number; totals: boolean };

export function readPrintSetup(): PrintSetup | null {
  try {
    const value = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "null") as Partial<PrintSetup> | null;
    if (!value || (value.orientation !== "portrait" && value.orientation !== "landscape")) return null;
    return { orientation: value.orientation, fontSize: Number(value.fontSize) || 8, totals: value.totals !== false };
  } catch {
    return null;
  }
}

export function savePrintSetup(setup: PrintSetup) {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* storage may be unavailable; the setup then lasts for this visit only */ }
}
