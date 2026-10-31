import { focusManager, QueryClient } from "@tanstack/react-query";

// Query v5's default listener only observes visibility. A window can regain
// keyboard focus without changing visibility (e.g. returning from another app).
// Query owns subscription cleanup when the last provider unmounts.
focusManager.setEventListener((notify) => {
  if (typeof window === "undefined") return () => {};
  const focus = () => notify();
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", focus);
  return () => {
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", focus);
  };
});

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true },
      mutations: { retry: false },
    },
  });
}

export function clearPrivateQueries(client: QueryClient) {
  void client.cancelQueries();
  client.clear();
}
export const queryClient = createQueryClient();
export const authQueryKey = (generation: number, userId: string, role: "user" | "facilitator") =>
  [generation, userId, role] as const;
