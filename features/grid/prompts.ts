/** The questions every grid screen asks the same way (master, small entry, entry, reports). */

/** Refresh: warns that unsaved changes will be lost, else just confirms the reload. Ask it with No as the default. */
export function refreshQuestion(pending: number): string {
  return pending > 0
    ? `Refresh will reload the records and drop ${pending} unsaved change${pending === 1 ? "" : "s"}.\nRefresh anyway?`
    : "Reload the records from the database?";
}

type Answer = "OK" | "Yes" | "No" | "Cancel";

/**
 * Esc / Quit: "Returning To Main Menu ?" with No as the default, so an Esc pressed by mistake in the
 * middle of editing (or Enter on the question) keeps the screen open. True when the answer is Yes.
 */
export async function confirmLeave(ask: (text: string, heading: string, buttons: Answer[], defaultButton: Answer) => Promise<unknown>): Promise<boolean> {
  return (await ask("Returning To Main Menu ? ", "Confirmation", ["Yes", "No"], "No")) === "Yes";
}
