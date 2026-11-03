import { useIsMutating } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { DisclosureChevron } from "../../components/DisclosureChevron";
import { HeaderMenu } from "../../components/HeaderMenu";
import { Answers } from "../answers/Answers";
import type { Question } from "../sessions/api";

export function ParticipantQuestions({
  questions,
  ended,
  readOnly,
}: {
  questions: Question[];
  ended: boolean;
  readOnly: boolean;
}) {
  const { question: selectedId } = useSearch({ from: "/sessions/$sessionId" });
  const navigate = useNavigate({ from: "/sessions/$sessionId" });
  const saving = useIsMutating() > 0;
  const index = Math.max(
    0,
    questions.findIndex((question) => question.id === selectedId),
  );
  const question = questions[index];
  const heading = useRef<HTMLHeadingElement>(null);
  const region = useRef<HTMLElement>(null);
  const previousId = useRef(question?.id);

  useLayoutEffect(() => {
    if (previousId.current !== question?.id) {
      previousId.current = question?.id;
      heading.current?.focus();
      region.current?.scrollIntoView({ block: "start" });
    }
  }, [question?.id]);

  if (!question)
    return (
      <section ref={region} className="empty-state" aria-labelledby="questions-title">
        <h2 id="questions-title" ref={heading} tabIndex={-1}>
          No questions yet
        </h2>
        <p>
          {ended
            ? "No questions were added to this session."
            : "Your facilitator hasn’t added any questions yet."}
        </p>
      </section>
    );

  function goTo(target: Question | undefined) {
    if (!target || saving) return;
    void navigate({ search: { question: target.id }, resetScroll: false });
  }

  return (
    <section ref={region} className="participant-questions" aria-labelledby="active-question-title">
      <div className="question-toolbar">
        <HeaderMenu
          className="question-chooser"
          summary={
            <>
              Question {index + 1} of {questions.length}
              <DisclosureChevron />
            </>
          }
        >
          {(close) => (
            <div className="popup-panel question-chooser-panel">
              <p className="small-label popup-label">Jump to a question</p>
              <ol className="question-chooser-options" aria-label="Questions">
                {questions.map((item, itemIndex) => (
                  <li key={item.id}>
                    <button
                      className="popup-item question-choice"
                      type="button"
                      aria-current={item.id === question.id ? "true" : undefined}
                      disabled={saving}
                      onClick={() => {
                        // Selection is an action, just like Previous/Next. Close
                        // explicitly rather than depending on link activation.
                        close();
                        goTo(item);
                      }}
                    >
                      <span className="question-choice-number">{itemIndex + 1}.</span>
                      <span className="question-choice-text">{item.text}</span>
                      {item.id === question.id && <span aria-hidden="true">✓</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </HeaderMenu>
        {ended && <span className="small-label">Read-only</span>}
      </div>
      {selectedId && selectedId !== question.id && (
        <p role="status" className="field-hint">
          That question is no longer available. Showing the first question.
        </p>
      )}
      <h2 id="active-question-title" ref={heading} tabIndex={-1}>
        {question.text}
      </h2>
      {ended && (
        <Link
          className="secondary-button open-board-link"
          to="/sessions/$sessionId/questions/$questionId"
          params={{ sessionId: question.sessionId, questionId: question.id }}
        >
          Explore everyone’s cards and follow-ups →
        </Link>
      )}
      <Answers
        key={question.id}
        questionId={question.id}
        number={index + 1}
        ended={ended}
        readOnly={readOnly}
      />
      <nav className="question-pagination" aria-label="Question navigation">
        <button
          className="secondary-button"
          type="button"
          disabled={index === 0 || saving}
          onClick={() => goTo(questions[index - 1])}
        >
          <span aria-hidden="true">←</span> Previous
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={index === questions.length - 1 || saving}
          onClick={() => goTo(questions[index + 1])}
        >
          Next <span aria-hidden="true">→</span>
        </button>
      </nav>
      <p className="field-hint question-draft-hint" role="status">
        {saving
          ? "Saving your card…"
          : !ended
            ? "Unsaved text stays with each question while you switch."
            : "Everyone’s saved cards are now shared with participants. Open the board to explore themes and follow-ups."}
      </p>
    </section>
  );
}
