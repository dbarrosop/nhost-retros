// The personal editor stays owner-scoped even after the board becomes shared.
// This also prevents a stale active-session screen from offering edits on other authors' cards.
export type Answer = {
  id: string;
  questionId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};
export type AnswersResult = { retroAnswers: Answer[] };
export const answersQuery = `query MyAnswers($questionId: uuid!, $authorId: uuid!) {
  retroAnswers(where: {questionId: {_eq: $questionId}, authorId: {_eq: $authorId}}, order_by: [{createdAt: asc}, {id: asc}]) {
    id questionId text createdAt updatedAt
  }
}`;
export const addAnswer = `mutation AddAnswer($questionId: uuid!, $text: String!) {
  insertRetroAnswers(objects: [{questionId: $questionId, text: $text}]) { affected_rows }
}`;
export const editAnswer = `mutation EditAnswer($id: uuid!, $text: String!) {
  updateRetroAnswers(where: {id: {_eq: $id}}, _set: {text: $text}) { affected_rows }
}`;
export const deleteAnswer = `mutation DeleteAnswer($id: uuid!) {
  deleteRetroAnswers(where: {id: {_eq: $id}}) { affected_rows }
}`;
