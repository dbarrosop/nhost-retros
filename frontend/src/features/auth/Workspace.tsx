import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";
import { useLayoutEffect } from "react";
import { useActivity } from "../../lib/activity";
import { useAuth } from "../../lib/auth";
import { DraftProvider } from "../../lib/drafts";
import { isUuid } from "../../lib/ids";
import type { AppRole } from "../../lib/retro-api";
import { QuestionBoard } from "../board/QuestionBoard";
import { SessionDetail } from "../sessions/SessionDetail";
import { Sessions } from "../sessions/Sessions";

export function Workspace({
  appRole: role = "user",
  sessionId,
  questionId,
}: {
  appRole?: AppRole;
  sessionId?: string;
  questionId?: string;
}) {
  const { ready, session, notice, generation, canQuery } = useAuth();
  const activity = useActivity();
  const queries = useQueryClient();
  useLayoutEffect(() => {
    // A route-level role switch is a privacy boundary too, not just a different key.
    queries.removeQueries({ predicate: (query) => query.queryKey[2] !== role });
  }, [queries, role]);
  if (!ready)
    return (
      <main id="main-content" className="not-found" tabIndex={-1}>
        <p role="status">Checking your session…</p>
      </main>
    );
  if (!session) return <Navigate to="/auth" replace />;
  const facilitator = session.user?.roles.includes("facilitator");
  if (role === "facilitator" && !facilitator) return <Navigate to="/workspace" replace />;
  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      {notice && (
        <p role="status" aria-label="Session connection">
          {notice}
        </p>
      )}
      {(!canQuery || activity !== "active") && (
        <p
          role="status"
          aria-label="Workspace connection"
          className={`connection-status ${!canQuery ? "offline" : activity}`}
        >
          {!canQuery
            ? "Live updates are paused until your session reconnects."
            : activity === "offline"
              ? "You’re offline. Live updates are paused; unsaved drafts stay in this workspace. Reconnect before saving."
              : "Live updates are paused while this tab is in the background."}
        </p>
      )}
      <DraftProvider
        key={`${session.user?.id}:${[...(session.user?.roles ?? [])].sort().join(",")}:${role}:${sessionId ?? ""}:${questionId ?? ""}`}
      >
        {canQuery ? (
          <div key={`${generation}:${role}`}>
            {sessionId && !isUuid(sessionId) ? (
              <div className="empty-state">
                <h1>Session unavailable</h1>
                <p>It may have been deleted, or your access has changed.</p>
                <Link
                  className="quiet-link"
                  to={role === "facilitator" ? "/facilitate" : "/workspace"}
                >
                  ← All retrospectives
                </Link>
              </div>
            ) : sessionId && questionId && !isUuid(questionId) ? (
              <>
                <h1>Question unavailable</h1>
                <Link
                  className="quiet-link"
                  to={role === "facilitator" ? "/facilitate/$sessionId" : "/sessions/$sessionId"}
                  params={{ sessionId }}
                >
                  ← Back to session
                </Link>
              </>
            ) : sessionId && questionId ? (
              <QuestionBoard
                key={questionId}
                sessionId={sessionId}
                questionId={questionId}
                role={role}
              />
            ) : sessionId ? (
              <SessionDetail key={sessionId} id={sessionId} role={role} />
            ) : (
              <Sessions role={role} />
            )}
          </div>
        ) : (
          <p>
            Workspace data is paused until your session reconnects. Your unsaved drafts are kept for
            this account.
          </p>
        )}
      </DraftProvider>
      {canQuery && activity === "active" && (
        <p role="status" aria-label="Workspace connection" className="connection-status active">
          Live updates · changes appear automatically
        </p>
      )}
    </main>
  );
}
