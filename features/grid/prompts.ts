/** The questions every grid screen asks the same way (master, small entry, entry, reports). */

/** Refresh: warns that unsaved changes will be lost, else just confirms the reload. Ask it with No as the default. */
export function refreshQuestion(pending: number): string {
  return pending > 0
    ? `Refresh will reload the records and drop ${pending} unsaved change${pending === 1 ? "" : "s"}.\nRefresh anyway?`
    : "Reload the records from the database?";
}
