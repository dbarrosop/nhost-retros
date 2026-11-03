import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { DisclosureChevron } from "../../components/DisclosureChevron";
import { useDrafts } from "../../lib/drafts";
import { type AppRole, readFailed } from "../../lib/retro-api";
import { type RetroSession, useSessions } from "./api";
import { TextForm, useChange } from "./controls";
import { createSession } from "./facilitator-api";

export function Sessions({ role }: { role: AppRole }) {
  const sessions = useSessions(role);
  const change = useChange(role);
  const drafts = useDrafts();
  const [creating, setCreating] = useState(() => drafts?.has("Session name") ?? false);
  const createButton = useRef<HTMLButtonElement>(null);
  const editorId = useId();
  const active = sessions.data?.retroSessions.filter((session) => !session.ended) ?? [];
  const ended = sessions.data?.retroSessions.filter((session) => session.ended) ?? [];
  const finishCreate = () => {
    setCreating(false);
    createButton.current?.focus();
  };
  return (
    <>
      <div className="workspace-heading">
        <div>
          <h1>Retrospectives</h1>
          <p className="workspace-description">
            {role === "facilitator"
              ? "Create and guide your team’s retrospectives."
              : "Choose a retrospective to reflect with your team."}
          </p>
        </div>
        {role === "facilitator" && (
          <button
            ref={createButton}
            className="primary-link"
            type="button"
            aria-expanded={creating}
            aria-controls={editorId}
            onClick={() => setCreating(true)}
          >
            <span aria-hidden="true">+</span> New retrospective
          </button>
        )}
      </div>
      {role === "facilitator" && (
        <div id={editorId}>
          {creating && (
            <section className="editor-panel" aria-labelledby="new-session-title">
              <h2 id="new-session-title">New retrospective</h2>
              <TextForm
                label="Retrospective name"
                draftKey="Session name"
                maximum={120}
                submit="Create retrospective"
                focusOnMount
                onCancel={finishCreate}
                onSave={async (name) => {
                  await change.mutateAsync({
                    query: createSession,
                    variables: { name },
                    field: "insertRetroSessions",
                  });
                  finishCreate();
                }}
              />
            </section>
          )}
        </div>
      )}
      {sessions.isPending && <p role="status">Loading retrospectives…</p>}
      {sessions.isError ? (
        <p role="alert">{readFailed}</p>
      ) : (
        sessions.data && (
          <>
            <section className="sessions-section" aria-labelledby="active-sessions-title">
              <div className="section-heading">
                <h2 id="active-sessions-title">Active</h2>
                <span className="small-label">{active.length} active</span>
              </div>
              {active.length === 0 ? (
                <div className="empty-state">
                  <h3>No active retrospectives</h3>
                  <p>
                    {role === "facilitator"
                      ? "Start a new retrospective when your team is ready."
                      : "Ask a facilitator to add you to a retrospective."}
                  </p>
                </div>
              ) : (
                <SessionList sessions={active} role={role} label="Active retrospectives" />
              )}
            </section>
            {ended.length > 0 && (
              <details className="ended-sessions">
                <summary>
                  Ended retrospectives <span className="small-label">{ended.length}</span>
                  <DisclosureChevron />
                </summary>
                <SessionList sessions={ended} role={role} label="Ended retrospectives" />
              </details>
            )}
          </>
        )
      )}
    </>
  );
}

function SessionList({
  sessions,
  role,
  label,
}: {
  sessions: RetroSession[];
  role: AppRole;
  label: string;
}) {
  return (
    <ul className="session-list" aria-label={label}>
      {sessions.map((session) => (
        <li key={session.id}>
          <Link
            className="session-link"
            to={role === "facilitator" ? "/facilitate/$sessionId" : "/sessions/$sessionId"}
            params={{ sessionId: session.id }}
          >
            <span className={`session-status ${session.ended ? "ended" : ""}`}>
              {session.ended ? "Ended" : "Active"}
            </span>
            <h3>{session.name}</h3>
            <span className="small-label">
              {new Date(session.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="session-arrow" aria-hidden="true">
              ↗
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
