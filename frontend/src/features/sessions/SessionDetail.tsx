import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { IconButton } from "../../components/IconButton";
import { useDrafts } from "../../lib/drafts";
import { type AppRole, readFailed } from "../../lib/retro-api";
import { Questions } from "../questions/Questions";
import { useSession } from "./api";
import { ConfirmAction, TextForm, useChange } from "./controls";
import { deleteSession, endSession, renameSession } from "./facilitator-api";
import { Participants } from "./Participants";

export function SessionDetail({ id, role }: { id: string; role: AppRole }) {
  const query = useSession(role, id);
  const change = useChange(role);
  const navigate = useNavigate();
  const drafts = useDrafts();
  const [renaming, setRenaming] = useState(() => drafts?.has("Rename session") ?? false);
  const session = query.data?.retroSessions[0];
  const finishRename = () => {
    setRenaming(false);
    document.getElementById("session-title")?.focus();
  };
  return (
    <div className={role === "user" ? "participant-session" : undefined}>
      <Link className="quiet-link" to={role === "facilitator" ? "/facilitate" : "/workspace"}>
        ← All retrospectives
      </Link>
      {query.isPending ? (
        <p role="status">Loading the conversation…</p>
      ) : query.isError && !session ? (
        <p role="alert">{readFailed}</p>
      ) : !session ? (
        <div className="empty-state">
          <h1>Session unavailable</h1>
          <p>It may have been deleted, or your access has changed.</p>
        </div>
      ) : (
        <>
          {query.isError && <p role="alert">{readFailed} Your draft is kept below.</p>}
          <div className="session-intro">
            <div className="session-meta">
              <p className="eyebrow">
                {role === "facilitator" ? "Facilitator workspace" : "Team retrospective"}
              </p>
              <span className={`session-status ${session.ended ? "ended" : ""}`}>
                {session.ended ? "Ended" : "Active"}
              </span>
            </div>
            <div className="title-row session-title-row">
              <h1 id="session-title" tabIndex={-1}>
                {session.name}
              </h1>
              {role === "facilitator" && !session.ended && !query.isError && (
                <fieldset className="title-actions" aria-label="Session actions">
                  {!renaming && (
                    <IconButton
                      label="Rename session"
                      icon="edit"
                      disabled={change.isPending}
                      onClick={() => setRenaming(true)}
                    />
                  )}
                  <ConfirmAction
                    label="End session"
                    icon="end"
                    title="End this retrospective?"
                    description="Ending is permanent. The session name, questions and answer cards will be frozen, including changes from other open tabs. You cannot reopen it."
                    disabled={change.isPending}
                    onConfirm={async () => {
                      await change.mutateAsync({
                        query: endSession,
                        variables: { id },
                        field: "updateRetroSessions",
                      });
                    }}
                    afterConfirm={() => document.getElementById("session-title")?.focus()}
                  />
                  {session.questions.length === 0 && (
                    <ConfirmAction
                      label="Delete session"
                      icon="delete"
                      title="Delete this empty session?"
                      description="Only an active session with no questions can be deleted. This cannot be undone."
                      disabled={change.isPending}
                      onConfirm={async () => {
                        await change.mutateAsync({
                          query: deleteSession,
                          variables: { id },
                          field: "deleteRetroSessions",
                        });
                        await navigate({ to: "/facilitate" });
                      }}
                    />
                  )}
                </fieldset>
              )}
            </div>
            <p className="session-description">
              {session.ended
                ? "This conversation has ended. Its name, questions and answer cards are now permanently read-only."
                : role === "facilitator"
                  ? "Manage questions below. Open a board to explore your team’s reflections."
                  : "Reflect at your own pace. Add a card for each thought."}
            </p>
          </div>
          {renaming && (
            <div className="editor-panel">
              <TextForm
                label="Rename session"
                maximum={120}
                initial={session.name}
                submit="Save name"
                focusOnMount
                disabled={session.ended || query.isError}
                onCancel={finishRename}
                onSave={async (name) => {
                  await change.mutateAsync({
                    query: renameSession,
                    variables: { id, name },
                    field: "updateRetroSessions",
                  });
                  finishRename();
                }}
              />
            </div>
          )}
          {role === "facilitator" && (
            <p className="session-participation">
              <Link className="quiet-link" to="/sessions/$sessionId" params={{ sessionId: id }}>
                Write your own reflections →
              </Link>{" "}
              <span className="field-hint">Enroll yourself in Participants to contribute.</span>
            </p>
          )}
          {role === "facilitator" && <Participants sessionId={id} />}
          <Questions
            questions={session.questions}
            sessionId={id}
            ended={session.ended}
            readOnly={query.isError}
            role={role}
          />
        </>
      )}
    </div>
  );
}
