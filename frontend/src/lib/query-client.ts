import { QueryClient } from "@tanstack/react-query";

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
