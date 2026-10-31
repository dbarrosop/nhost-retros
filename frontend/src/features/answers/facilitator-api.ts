import type { Answer } from "./api.js";

// No content mutations for this role. Participation always uses the user role.
export type FacilitatorAnswersResult = { retroAnswers: (Answer & { authorId: string })[] };
export const facilitatorAnswersQuery = `query FacilitatorAnswers($questionId: uuid!) {
  retroAnswers(where: {questionId: {_eq: $questionId}}, order_by: [{createdAt: asc}, {id: asc}]) {
    id questionId authorId text createdAt updatedAt
  }
}`;
