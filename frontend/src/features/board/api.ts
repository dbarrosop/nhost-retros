import type { Answer } from "../answers/api.js";

// Only the facilitator route imports these projections; never use the user role.
export type Topic = { id: string; name: string };
export type BoardAnswer = Answer & {
  author: { id: string; displayName: string; email: string } | null;
  assignment: { topicId: string } | null;
};
export type Board = { id: string; topics: Topic[]; answers: BoardAnswer[] };
export type BoardResult = { retroQuestions: Board[] };
export const boardQuery = `query QuestionBoard($questionId: uuid!, $sessionId: uuid!) {
  retroQuestions(where: {id: {_eq: $questionId}, sessionId: {_eq: $sessionId}}) {
    id
    topics(order_by: [{createdAt: asc}, {id: asc}]) { id name }
    answers(order_by: [{createdAt: asc}, {id: asc}]) {
      id questionId text createdAt updatedAt
      author { id displayName email }
      assignment { topicId }
    }
  }
}`;
export const addTopic = `mutation AddTopic($questionId: uuid!, $name: String!) {
  insertRetroTopics(objects: [{questionId: $questionId, name: $name}]) { affected_rows returning { id } }
}`;
// Both fields execute in one database transaction. A failed nested assignment
// rolls back the old-assignment deletion and the newly inserted theme together.
export const createThemeFromCard = `mutation CreateThemeFromCard($questionId: uuid!, $answerId: uuid!, $name: String!) {
  removedAssignment: deleteRetroAnswerTopics(where: {answerId: {_eq: $answerId}, questionId: {_eq: $questionId}}) { affected_rows }
  createdTheme: insertRetroTopics(objects: [{questionId: $questionId, name: $name, assignments: {data: [{answerId: $answerId}]}}]) {
    affected_rows returning { id }
  }
}`;
export const renameTopic = `mutation RenameTopic($id: uuid!, $name: String!) {
  updateRetroTopics(where: {id: {_eq: $id}}, _set: {name: $name}) { affected_rows }
}`;
export const deleteTopic = `mutation DeleteTopic($id: uuid!) {
  deleteRetroTopics(where: {id: {_eq: $id}}) { affected_rows }
}`;
export const assignAnswer = `mutation AssignAnswer($answerId: uuid!, $questionId: uuid!, $topicId: uuid!) {
  insertRetroAnswerTopics(objects: [{answerId: $answerId, questionId: $questionId, topicId: $topicId}]) { affected_rows }
}`;
export const moveAnswer = `mutation MoveAnswer($answerId: uuid!, $topicId: uuid!) {
  updateRetroAnswerTopics(where: {answerId: {_eq: $answerId}}, _set: {topicId: $topicId}) { affected_rows }
}`;
export const ungroupAnswer = `mutation UngroupAnswer($answerId: uuid!) {
  deleteRetroAnswerTopics(where: {answerId: {_eq: $answerId}}) { affected_rows }
}`;
export const groupingFailed =
  "This grouping change wasn’t saved. The card or topic may have changed, your access may have been lost, or you may be offline. Check your connection and review the board before trying again.";
export const ungrouped = "ungrouped";
