import { Navigate } from "@tanstack/react-router";
import { useAuth } from "../../lib/auth";

export function Workspace() {
  const { ready, session, notice, store } = useAuth();
  if (!ready)
    return (
      <main id="main-content" className="not-found" tabIndex={-1}>
        <p role="status">Checking your session…</p>
      </main>
    );
  if (!session) return <Navigate to="/auth" replace />;
  return (
    <main id="main-content" className="workspace" tabIndex={-1}>
      <p className="eyebrow">You’re in the right place</p>
      <h1>
        Welcome to <em>the team space.</em>
      </h1>
      {notice && <p role="status">{notice}</p>}
      <section className="account-panel" aria-labelledby="account-title">
        <div>
          <span className="small-label">VERIFIED ACCOUNT</span>
          <h2 id="account-title">{session.user?.email}</h2>
          <p>
            {session.user?.roles.includes("facilitator")
              ? "Facilitator membership confirmed. Your default role remains participant."
              : "Signed in as a participant."}
          </p>
          <p>
            Session conversations will arrive here. For now, your account is ready — no
            retrospective data is available yet.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void store.signOut()}>
          Sign out
        </button>
      </section>
    </main>
  );
}
