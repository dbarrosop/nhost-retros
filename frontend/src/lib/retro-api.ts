import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { graphqlUrl } from "./nhost";
import { authQueryKey } from "./query-client";

export type AppRole = "user" | "facilitator";
export const changeFailed =
  "This change wasn’t saved. The session may have ended or your access changed. Your draft is still here. Check your connection and try again.";
export const readFailed =
  "We couldn’t load this workspace. Check your connection or sign in again if your access has changed.";

export function useRetroApi(role: AppRole) {
  const { store, generation, session, canQuery } = useAuth();
  const client = useQueryClient();
  const key = authQueryKey(generation, session?.user?.id ?? "", role);
  async function request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const before = store.getSnapshot();
    if (
      !before.canQuery ||
      before.generation !== generation ||
      !before.session ||
      (role === "facilitator" && !before.session.user?.roles.includes(role))
    )
      throw new Error(readFailed);
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${before.session.accessToken}`,
        "x-hasura-role": role,
      },
      body: JSON.stringify({ query, variables }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
        : AbortSignal.timeout(12_000),
    });
    const body = (await response.json()) as { data?: T; errors?: unknown[] };
    if (store.getSnapshot().generation !== generation || signal?.aborted)
      throw new DOMException("Account changed", "AbortError");
    if (!response.ok || body.errors?.length || !body.data) throw new Error(readFailed);
    return body.data;
  }
  return {
    request,
    key,
    enabled: canQuery,
    invalidate: () => client.invalidateQueries({ queryKey: key }),
  };
}

// Only mounted foreground routes poll; Query's online/focus managers pause hidden/offline work.
export function useRetroQuery<T>(
  role: AppRole,
  suffix: readonly string[],
  query: string,
  variables = {},
) {
  const api = useRetroApi(role);
  return useQuery({
    queryKey: [...api.key, ...suffix],
    queryFn: ({ signal }) => api.request<T>(query, variables, signal),
    enabled: api.enabled,
    refetchInterval: () =>
      document.visibilityState === "visible" && navigator.onLine ? 2000 : false,
    refetchIntervalInBackground: false,
  });
}

export function requireAffected(result: { affected_rows: number } | null | undefined) {
  if (result?.affected_rows !== 1) throw new Error(changeFailed);
}
