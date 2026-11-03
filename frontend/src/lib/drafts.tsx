import { createContext, type ReactNode, useContext, useState } from "react";

// Only unsaved input and intent target IDs, never server response snapshots.
// The workspace owns this memory and
// replaces it on account/role/session/board changes, not participant question
// selection. Temporary JWT expiry may remount the query subtree without losing
// a same-account draft. Nothing is persisted.
const Drafts = createContext<Map<string, string> | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, string>());
  return <Drafts.Provider value={drafts}>{children}</Drafts.Provider>;
}
export function useDrafts() {
  return useContext(Drafts);
}
