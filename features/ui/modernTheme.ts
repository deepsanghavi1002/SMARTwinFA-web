import { useSyncExternalStore } from "react";

/**
 * Whether the Modern view is on in its dark theme. The page carries it (html[data-mtheme], set by the startup gate), so any screen,
 * pop-up or chart can follow it without being handed the choice; colours drawn in code (a chart's ink, a report's level fills) use it.
 */
function subscribe(listener: () => void) {
  const watcher = new MutationObserver(listener);
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mtheme"] });
  return () => watcher.disconnect();
}

export function useModernDark(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.mtheme === "dark", () => false);
}
