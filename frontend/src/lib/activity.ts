import { useSyncExternalStore } from "react";

// Read browser state directly: a disabled interval alone will not restart when a
// hidden tab becomes visible, and Query does not cancel an already-running read.
function snapshot() {
  return !navigator.onLine
    ? "offline"
    : document.visibilityState === "visible"
      ? "active"
      : "hidden";
}
function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
    document.removeEventListener("visibilitychange", notify);
  };
}
export function useActivity() {
  return useSyncExternalStore(subscribe, snapshot);
}
