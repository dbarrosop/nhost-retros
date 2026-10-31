import type { AppRole } from "../../lib/retro-api";
import { useRetroQuery } from "../../lib/retro-api";

export type RetroSession = { id: string; name: string; ended: boolean; createdAt: string };
export type Question = { id: string; text: string; sessionId: string; createdAt: string };
export const sessionsQuery = `query Sessions {
  retroSessions(order_by: [{createdAt: asc}, {id: asc}]) { id name ended createdAt }
}`;
export const sessionQuery = `query Session($id: uuid!) {
  retroSessions(where: {id: {_eq: $id}}) {
    id name ended createdAt
    questions(order_by: [{createdAt: asc}, {id: asc}]) { id text sessionId createdAt }
  }
}`;
export const useSessions = (role: AppRole) =>
  useRetroQuery<{ retroSessions: RetroSession[] }>(role, ["sessions"], sessionsQuery);
export const useSession = (role: AppRole, id: string) =>
  useRetroQuery<{ retroSessions: (RetroSession & { questions: Question[] })[] }>(
    role,
    ["session", id],
    sessionQuery,
    { id },
  );
