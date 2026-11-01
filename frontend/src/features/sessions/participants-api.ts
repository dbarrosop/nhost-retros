export type ParticipantAccount = { id: string; displayName: string; email: string };
export type ParticipantsResult = {
  retroSessions: {
    id: string;
    participants: { userId: string; account: ParticipantAccount | null }[];
  }[];
  retroParticipantAccounts: ParticipantAccount[];
};
export const participantsQuery = `query SessionParticipants($sessionId: uuid!) {
  retroSessions(where: {id: {_eq: $sessionId}}) {
    id participants(order_by: [{userId: asc}]) { userId account { id displayName email } }
  }
  retroParticipantAccounts(order_by: [{displayName: asc}, {email: asc}]) { id displayName email }
}`;
export const addParticipant = `mutation AddParticipant($sessionId: uuid!, $userId: uuid!) {
  insertRetroSessionParticipants(objects: [{sessionId: $sessionId, userId: $userId}]) { affected_rows }
}`;
export const removeParticipant = `mutation RemoveParticipant($sessionId: uuid!, $userId: uuid!) {
  deleteRetroSessionParticipants(where: {sessionId: {_eq: $sessionId}, userId: {_eq: $userId}}) { affected_rows }
}`;
