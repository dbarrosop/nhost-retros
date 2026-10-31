// Facilitator-only operations. Participant reads live in api.ts.
export const createSession = `mutation CreateSession($name: String!) {
  insertRetroSessions(objects: [{name: $name}]) { affected_rows }
}`;
export const renameSession = `mutation RenameSession($id: uuid!, $name: String!) {
  updateRetroSessions(where: {id: {_eq: $id}}, _set: {name: $name}) { affected_rows }
}`;
export const endSession = `mutation EndSession($id: uuid!) {
  updateRetroSessions(where: {id: {_eq: $id}}, _set: {ended: true}) { affected_rows }
}`;
export const deleteSession = `mutation DeleteSession($id: uuid!) {
  deleteRetroSessions(where: {id: {_eq: $id}}) { affected_rows }
}`;
