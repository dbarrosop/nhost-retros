import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useActivity } from "./activity";
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
  const lifetime = useMemo(
    () => ({ generation, role, pending: new Set<AbortController>() }),
    [generation, role],
  );
  useEffect(
    () => () => {
      for (const controller of lifetime.pending) controller.abort();
      lifetime.pending.clear();
    },
    [lifetime],
  );
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
    const controller = new AbortController();
    lifetime.pending.add(controller);
    try {
      const response = await fetch(graphqlUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${before.session.accessToken}`,
          "x-hasura-role": role,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.any([
          controller.signal,
          ...(store.getDataSignal ? [store.getDataSignal()] : []),
          ...(signal ? [signal] : []),
          AbortSignal.timeout(12_000),
        ]),
      });
      const body = (await response.json()) as { data?: T; errors?: unknown[] };
      if (
        store.getSnapshot().generation !== generation ||
        !store.getSnapshot().canQuery ||
        controller.signal.aborted ||
        signal?.aborted
      )
        throw new DOMException("Account changed", "AbortError");
      if (!response.ok || body.errors?.length || !body.data) throw new Error(readFailed);
      return body.data;
    } finally {
      lifetime.pending.delete(controller);
    }
  }
  return {
    request,
    key,
    enabled: canQuery,
    invalidate: () => client.invalidateQueries({ queryKey: key }),
  };
}

// Mounted, visible, online routes only. Disable AND cancel reads on transitions;
// enabling again refetches immediately, including browsers without a focus event.
export function useRetroQuery<T>(
  role: AppRole,
  suffix: readonly string[],
  query: string,
  variables = {},
) {
  const api = useRetroApi(role);
  const activity = useActivity();
  const client = useQueryClient();
  const queryKey = [...api.key, ...suffix];
  const keyId = JSON.stringify(queryKey);
  useEffect(() => {
    if (activity !== "active")
      void client.cancelQueries({ queryKey: JSON.parse(keyId), exact: true });
  }, [activity, client, keyId]);
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => api.request<T>(query, variables, signal),
    enabled: api.enabled && activity === "active",
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });
}

export function requireAffected(result: { affected_rows: number } | null | undefined) {
  if (result?.affected_rows !== 1) throw new Error(changeFailed);
}
