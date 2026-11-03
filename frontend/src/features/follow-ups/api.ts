import type { ParticipantAccount } from "../sessions/participants-api.js";

// Private outcomes: these documents are only used with the facilitator role.
export type FollowUp = {
  id: string;
  action: string;
  ownerId: string;
  ticketUrl: string | null;
  owner: ParticipantAccount | null;
};
export type FollowUpInput = { action: string; ownerId: string; ticketUrl: string | null };
export type FollowUpsResult = {
  retroQuestions: {
    id: string;
    followUps: FollowUp[];
    session: { participants: { userId: string; account: ParticipantAccount | null }[] };
  }[];
};
const projection = `id action ownerId ticketUrl owner { id displayName email }`;
export const followUpsQuery = `query QuestionFollowUps($questionId: uuid!, $sessionId: uuid!) {
  retroQuestions(where: {id: {_eq: $questionId}, sessionId: {_eq: $sessionId}}) {
    id
    followUps(order_by: [{createdAt: asc}, {id: asc}]) { ${projection} }
    session { participants(order_by: [{userId: asc}]) { userId account { id displayName email } } }
  }
}`;
export type FollowUpSummaryResult = {
  retroSessions: { id: string; questions: { id: string; text: string; followUps: FollowUp[] }[] }[];
};
export const followUpSummaryQuery = `query SessionFollowUps($sessionId: uuid!) {
  retroSessions(where: {id: {_eq: $sessionId}}) {
    id questions(order_by: [{createdAt: asc}, {id: asc}]) {
      id text followUps(order_by: [{createdAt: asc}, {id: asc}]) { ${projection} }
    }
  }
}`;
export const addFollowUp = `mutation AddFollowUp($questionId: uuid!, $action: String!, $ownerId: uuid!, $ticketUrl: String) {
  insertRetroFollowUps(objects: [{questionId: $questionId, action: $action, ownerId: $ownerId, ticketUrl: $ticketUrl}]) { affected_rows }
}`;
export const editFollowUp = `mutation EditFollowUp($id: uuid!, $action: String!, $ownerId: uuid!, $ticketUrl: String) {
  updateRetroFollowUps(where: {id: {_eq: $id}}, _set: {action: $action, ownerId: $ownerId, ticketUrl: $ticketUrl}) { affected_rows }
}`;
export const deleteFollowUp = `mutation DeleteFollowUp($id: uuid!) {
  deleteRetroFollowUps(where: {id: {_eq: $id}}) { affected_rows }
}`;
export const followUpFailed =
  "This follow-up wasn’t saved. The question, owner or your access may have changed, or you may be offline. Your draft is kept; review the current participants and try again.";
