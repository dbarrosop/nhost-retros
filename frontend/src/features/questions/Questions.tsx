import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ActionIcon, IconButton } from "../../components/IconButton";
import { useDrafts } from "../../lib/drafts";
import type { AppRole } from "../../lib/retro-api";
import { Answers } from "../answers/Answers";
import type { Question } from "../sessions/api";
import { ConfirmAction, TextForm, useChange } from "../sessions/controls";
import { addQuestion, deleteQuestion, editQuestion } from "./api";

export function Questions({
  questions,
  sessionId,
  ended,
  role,
  readOnly = false,
}: {
  questions: Question[];
  sessionId: string;
  ended: boolean;
  role: AppRole;
  readOnly?: boolean;
}) {
  const change = useChange(role);
  const drafts = useDrafts();
  const [dirty, setDirty] = useState(() => Boolean(drafts?.get("New question")));
  const locked = ended || readOnly;
  return (
    <section className="questions-section" aria-labelledby="questions-title">
      <div className="section-heading">
        <h2 id="questions-title" tabIndex={-1}>
          Questions
        </h2>
        <span className="small-label">Room to reflect</span>
      </div>
      {questions.length === 0 && (
        <div className="empty-state">
          <h3>The conversation starts here.</h3>
          <p>
            {ended
              ? "No questions were added to this session."
              : role === "facilitator"
                ? "Add a question to give this retrospective a direction."
                : "Your facilitator hasn’t added any questions yet."}
          </p>
        </div>
      )}
      <ol className="question-list">
        {questions.map((question, index) => (
          <QuestionItem
            key={question.id}
            question={question}
            number={index + 1}
            ended={ended}
            readOnly={readOnly}
            role={role}
          />
        ))}
      </ol>
      {role === "facilitator" && (!locked || dirty) && (
        <div className="editor-panel">
          <h3>Add a question</h3>
          <TextForm
            label="New question"
            multiline
            maximum={500}
            submit="Add question"
            disabled={locked}
            onDirty={setDirty}
            onSave={async (text) => {
              await change.mutateAsync({
                query: addQuestion,
                variables: { sessionId, text },
                field: "insertRetroQuestions",
              });
              setDirty(false);
            }}
          />
        </div>
      )}
    </section>
  );
}
function QuestionItem({
  question,
  number,
  ended,
  readOnly,
  role,
}: {
  question: Question;
  number: number;
  ended: boolean;
  readOnly: boolean;
  role: AppRole;
}) {
  const drafts = useDrafts();
  const draftKey = `question:${question.id}`;
  const [editing, setEditing] = useState(() => drafts?.has(draftKey) ?? false);
  const change = useChange(role);
  const finishEdit = () => {
    setEditing(false);
    document.getElementById(`question-title-${question.id}`)?.focus();
  };
  return (
    <li className="question-item">
      <span className="question-number" aria-hidden="true">
        {String(number).padStart(2, "0")}
      </span>
      <div className="question-content">
        <div className="title-row question-title-row">
          <h3 id={`question-title-${question.id}`} tabIndex={-1}>
            {question.text}
          </h3>
          {role === "facilitator" && (
            <fieldset className="title-actions" aria-label={`Actions for question ${number}`}>
              <Link
                className="secondary-button open-board-link"
                aria-label={`Open board for question ${number}`}
                to="/facilitate/$sessionId/questions/$questionId"
                params={{ sessionId: question.sessionId, questionId: question.id }}
              >
                <ActionIcon name="board" />
                <span>Open board</span>
              </Link>
              {!ended && !readOnly && (
                <>
                  {!editing && (
                    <IconButton
                      label={`Edit question ${number}`}
                      icon="edit"
                      disabled={change.isPending}
                      onClick={() => setEditing(true)}
                    />
                  )}
                  <ConfirmAction
                    label={`Delete question ${number}`}
                    icon="delete"
                    title="Delete this question?"
                    description="Only a question without answers can be deleted. This cannot be undone."
                    disabled={change.isPending}
                    onConfirm={async () => {
                      await change.mutateAsync({
                        query: deleteQuestion,
                        variables: { id: question.id },
                        field: "deleteRetroQuestions",
                      });
                    }}
                    afterConfirm={() => document.getElementById("questions-title")?.focus()}
                  />
                </>
              )}
            </fieldset>
          )}
        </div>
        {editing && (
          <TextForm
            draftKey={draftKey}
            label={`Edit question ${number}`}
            initial={question.text}
            multiline
            maximum={500}
            submit="Save question"
            focusOnMount
            disabled={ended || readOnly}
            onCancel={finishEdit}
            onSave={async (text) => {
              await change.mutateAsync({
                query: editQuestion,
                variables: { id: question.id, text },
                field: "updateRetroQuestions",
              });
              finishEdit();
            }}
          />
        )}
        {role === "user" && (
          <Answers questionId={question.id} number={number} ended={ended} readOnly={readOnly} />
        )}
      </div>
    </li>
  );
}
