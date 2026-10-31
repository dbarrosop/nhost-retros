// Participant projection deliberately has no author or grouping fields.
export type Answer = {
  id: string;
  questionId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};
export type AnswersResult = { retroAnswers: Answer[] };
export const answersQuery = `query MyAnswers($questionId: uuid!) {
  retroAnswers(where: {questionId: {_eq: $questionId}}, order_by: [{createdAt: asc}, {id: asc}]) {
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
