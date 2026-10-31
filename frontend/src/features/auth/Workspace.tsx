import { Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "../../lib/auth";
import type { AppRole } from "../../lib/retro-api";
import { SessionDetail } from "../sessions/SessionDetail";
import { Sessions } from "../sessions/Sessions";

export function Workspace({
  appRole: role = "user",
  sessionId,
}: {
  appRole?: AppRole;
  sessionId?: string;
}) {
  const { ready, session, notice, store, generation, canQuery } = useAuth();
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
      <section className="account-panel" aria-labelledby="account-title">
        <div>
          <span className="small-label">VERIFIED ACCOUNT</span>
          <h2 id="account-title">{session.user?.email}</h2>
          <p>
            {facilitator
              ? "Facilitator membership confirmed. Your default role remains participant."
              : "Signed in as a participant."}
          </p>
        </div>
        <div className="action-row">
          {facilitator && (
            <Link
              className="secondary-button"
              to={role === "facilitator" ? "/workspace" : "/facilitate"}
            >
              {role === "facilitator" ? "Participant workspace" : "Facilitator workspace"}
            </Link>
          )}
          <button className="secondary-button" type="button" onClick={() => void store.signOut()}>
            Sign out
          </button>
        </div>
      </section>
      {canQuery ? (
        <div key={`${generation}:${role}`}>
          {sessionId ? (
            <SessionDetail key={sessionId} id={sessionId} role={role} />
          ) : (
            <Sessions role={role} />
          )}
        </div>
      ) : (
        <p>Workspace data is paused until your session reconnects.</p>
      )}
    </main>
  );
}
