import { Link } from "@tanstack/react-router";
import { type AppRole, readFailed } from "../../lib/retro-api";
import { useSessions } from "./api";
import { TextForm, useChange } from "./controls";
import { createSession } from "./facilitator-api";

export function Sessions({ role }: { role: AppRole }) {
  const sessions = useSessions(role);
  const change = useChange(role);
  return (
    <>
      <div className="workspace-intro">
        <p className="eyebrow">
          {role === "facilitator" ? "Facilitator workspace" : "Our conversations"}
        </p>
        <h1>
          Welcome to <em>the team space.</em>
        </h1>
        <p className="hero-description">
          A little distance from the day-to-day. Browse our retrospectives and the questions guiding
          each conversation.
        </p>
      </div>
      {role === "facilitator" && (
        <section className="editor-panel" aria-labelledby="new-session-title">
          <h2 id="new-session-title">Start a conversation</h2>
          <TextForm
            label="Session name"
            maximum={120}
            submit="Create session"
            onSave={(name) =>
              change.mutateAsync({
                query: createSession,
                variables: { name },
                field: "insertRetroSessions",
              })
            }
          />
        </section>
      )}
      <section className="sessions-section" aria-labelledby="sessions-title">
        <div className="section-heading">
          <h2 id="sessions-title">Retrospectives</h2>
          <span className="small-label">Shared with the team</span>
        </div>
        {sessions.isPending && <p role="status">Loading conversations…</p>}
        {sessions.isError ? (
          <p role="alert">{readFailed}</p>
        ) : (
          sessions.data && (
            <>
              {sessions.data.retroSessions.length === 0 && (
                <div className="empty-state">
                  <h3>A fresh page.</h3>
                  <p>
                    No retrospectives are available.{" "}
                    {role === "facilitator"
                      ? "Create the first conversation above."
                      : "A facilitator can start one for the team."}
                  </p>
                </div>
              )}
              <ul className="session-list">
                {sessions.data.retroSessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      className="session-link"
                      to={
                        role === "facilitator" ? "/facilitate/$sessionId" : "/sessions/$sessionId"
                      }
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
            </>
          )
        )}
      </section>
    </>
  );
}
