import { useRef, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { useAuth } from "../../lib/auth";
import { useDrafts } from "../../lib/drafts";
import { readFailed, useRetroQuery } from "../../lib/retro-api";
import { ConfirmAction, TextForm, useChange } from "../sessions/controls";
import {
  type Answer,
  type AnswersResult,
  addAnswer,
  answersQuery,
  deleteAnswer,
  editAnswer,
} from "./api";

export function Answers({
  questionId,
  number,
  ended,
  readOnly,
}: {
  questionId: string;
  number: number;
  ended: boolean;
  readOnly: boolean;
}) {
  const { session } = useAuth();
  const query = useRetroQuery<AnswersResult>("user", ["answers", questionId], answersQuery, {
    questionId,
    authorId: session?.user?.id,
  });
  const change = useChange("user");
  const drafts = useDrafts();
  const draftKey = `new-answer:${questionId}`;
  const [dirty, setDirty] = useState(() => Boolean(drafts?.get(draftKey)));
  const heading = useRef<HTMLHeadingElement>(null);
  const locked = ended || readOnly || query.isError || query.isPending;
  return (
    <section
      className="answers-section"
      aria-label={`Your reflection cards for question ${number}`}
    >
      <h3 ref={heading} id={`answers-${questionId}`} tabIndex={-1}>
        Your reflection cards
      </h3>
      <p className="field-hint">
        {ended
          ? "This session has ended. All participants can now read everyone’s cards."
          : "Only you and trusted facilitators can read your cards until the session ends. Add a separate card for each thought."}
      </p>
      {query.isPending && <p role="status">Loading your cards…</p>}
      {query.isError && <p role="alert">{readFailed} Any unsaved draft is kept below.</p>}
      {query.data?.retroAnswers.length === 0 && (
        <p className="field-hint">
          {ended
            ? "You didn’t add any cards to this question."
            : "A small observation is a good place to start."}
        </p>
      )}
      <div className="answer-grid">
        {query.data?.retroAnswers.map((answer, index) => (
          <AnswerCard
            key={answer.id}
            answer={answer}
            number={index + 1}
            questionNumber={number}
            locked={locked}
            onDeleted={() => heading.current?.focus()}
          />
        ))}
      </div>
      {(!ended || dirty) && (
        <div className="answer-composer">
          <TextForm
            draftKey={draftKey}
            label={`New card for question ${number}`}
            multiline
            maximum={4000}
            submit={`Add card to question ${number}`}
            disabled={locked}
            onDirty={setDirty}
            onSave={async (text) => {
              await change.mutateAsync({
                query: addAnswer,
                variables: { questionId, text },
                field: "insertRetroAnswers",
              });
              setDirty(false);
            }}
          />
        </div>
      )}
      {ended && (
        <p className="field-hint">This session has ended. Your cards can no longer be changed.</p>
      )}
    </section>
  );
}

function AnswerCard({
  answer,
  number,
  questionNumber,
  locked,
  onDeleted,
}: {
  answer: Answer;
  number: number;
  questionNumber: number;
  locked: boolean;
  onDeleted: () => void;
}) {
  const drafts = useDrafts();
  const draftKey = `answer:${answer.id}`;
  const [editing, setEditing] = useState(() => drafts?.has(draftKey) ?? false);
  const heading = useRef<HTMLHeadingElement>(null);
  const change = useChange("user");
  const label = `card ${number} for question ${questionNumber}`;
  return (
    <article className="answer-card" aria-labelledby={`card-${answer.id}`}>
      <header className="title-row answer-card-header">
        <h4 ref={heading} id={`card-${answer.id}`} tabIndex={-1}>
          Card {number}
        </h4>
        {!locked && (
          <fieldset className="title-actions" aria-label={`Actions for ${label}`}>
            {!editing && (
              <IconButton
                label={`Edit ${label}`}
                icon="edit"
                disabled={change.isPending}
                onClick={() => setEditing(true)}
              />
            )}
            <ConfirmAction
              label={`Delete ${label}`}
              icon="delete"
              title="Delete your card?"
              description="This removes only this card. Your other reflections are kept. This cannot be undone."
              disabled={change.isPending}
              onConfirm={async () => {
                await change.mutateAsync({
                  query: deleteAnswer,
                  variables: { id: answer.id },
                  field: "deleteRetroAnswers",
                });
              }}
              afterConfirm={onDeleted}
            />
          </fieldset>
        )}
      </header>
      <p className="answer-text">{answer.text}</p>
      {editing && (
        <TextForm
          draftKey={draftKey}
          label={`Edit ${label}`}
          initial={answer.text}
          multiline
          maximum={4000}
          submit="Save card"
          focusOnMount
          disabled={locked}
          onCancel={() => {
            setEditing(false);
            heading.current?.focus();
          }}
          onSave={async (text) => {
            await change.mutateAsync({
              query: editAnswer,
              variables: { id: answer.id, text },
              field: "updateRetroAnswers",
            });
            setEditing(false);
            heading.current?.focus();
          }}
        />
      )}
    </article>
  );
}
