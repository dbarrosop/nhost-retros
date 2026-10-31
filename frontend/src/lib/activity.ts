import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

// Share Query's optimistic, event-driven connectivity model. navigator.onLine
// can report false on reachable LAN/loopback networks and must not block boot.
// Visibility still cancels pending reads and restarts intervals on foregrounding.
function snapshot() {
  return !onlineManager.isOnline()
    ? "offline"
    : document.visibilityState === "visible"
      ? "active"
      : "hidden";
}
function subscribe(notify: () => void) {
  const unsubscribe = onlineManager.subscribe(notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", notify);
  };
}
export function useActivity() {
  return useSyncExternalStore(subscribe, snapshot);
}
