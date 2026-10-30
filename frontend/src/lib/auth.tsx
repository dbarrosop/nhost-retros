import { createContext, type ReactNode, useContext, useEffect, useSyncExternalStore } from "react";
import { AuthStore } from "./auth-store";
import { nhost } from "./nhost";
import { queryClient } from "./query-client";

export const authStore = new AuthStore(nhost, queryClient);
const AuthContext = createContext(authStore);
export function AuthProvider({
  children,
  store = authStore,
}: {
  children: ReactNode;
  store?: AuthStore;
}) {
  useEffect(() => store.start(), [store]);
  return <AuthContext.Provider value={store}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const store = useContext(AuthContext);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...snapshot, store };
}
