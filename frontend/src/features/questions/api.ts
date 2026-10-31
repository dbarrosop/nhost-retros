export const addQuestion = `mutation AddQuestion($sessionId: uuid!, $text: String!) {
  insertRetroQuestions(objects: [{sessionId: $sessionId, text: $text}]) { affected_rows }
}`;
export const editQuestion = `mutation EditQuestion($id: uuid!, $text: String!) {
  updateRetroQuestions(where: {id: {_eq: $id}}, _set: {text: $text}) { affected_rows }
}`;
export const deleteQuestion = `mutation DeleteQuestion($id: uuid!) {
  deleteRetroQuestions(where: {id: {_eq: $id}}) { affected_rows }
}`;
