import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { type AppRole, readFailed, useRetroQuery } from "../../lib/retro-api";
import { type FollowUpSummaryResult, followUpSummaryQuery } from "./api";
import { FollowUpDetails } from "./FollowUpDetails";

export function FollowUpSummary({
  sessionId,
  role = "facilitator",
}: {
  sessionId: string;
  role?: AppRole;
}) {
  const heading = useId();
  const query = useRetroQuery<FollowUpSummaryResult>(
    role,
    ["follow-up-summary", sessionId],
    followUpSummaryQuery,
    { sessionId },
  );
  const session = query.data?.retroSessions[0];
  const questions = session?.questions.filter((question) => question.followUps.length > 0) ?? [];
  return (
    <section className="follow-ups-section" aria-labelledby={heading}>
      <div className="section-heading">
        <h2 id={heading}>Follow-up summary</h2>
      </div>
      {query.isPending ? (
        <p role="status">Loading follow-up summary…</p>
      ) : query.isError ? (
        <p role="alert">{readFailed}</p>
      ) : !session ? (
        <p>Session unavailable.</p>
      ) : questions.length === 0 ? (
        <p className="field-hint">
          {role === "facilitator"
            ? "No follow-ups yet. Open a question’s reflection board to capture an action."
            : "No follow-ups yet."}
        </p>
      ) : (
        questions.map((question) => (
          <div key={question.id} className="follow-up-summary-group">
            <h3>
              <Link
                className="quiet-link"
                to={
                  role === "facilitator"
                    ? "/facilitate/$sessionId/questions/$questionId"
                    : "/sessions/$sessionId/questions/$questionId"
                }
                params={{ sessionId, questionId: question.id }}
              >
                {question.text}
              </Link>
            </h3>
            <ul className="follow-up-list">
              {question.followUps.map((followUp) => (
                <li key={followUp.id} className="follow-up-card">
                  <FollowUpDetails followUp={followUp} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
