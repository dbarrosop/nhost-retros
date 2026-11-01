import { Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "../../lib/auth";
import { EmailOTPForm } from "./EmailOTPForm";

export function AuthPage() {
  const { session, ready } = useAuth();
  if (ready && session) return <Navigate to="/workspace" replace />;
  return (
    <main id="main-content" className="auth-layout" tabIndex={-1}>
      <section className="auth-intro">
        <p className="eyebrow">Your team. Your perspective.</p>
        <h1>
          A little space <em>to be heard.</em>
        </h1>
        <p>Start with your email. We’ll send a one-time code — no password to remember.</p>
        <Link className="quiet-link" to="/">
          Back to welcome <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <EmailOTPForm />
    </main>
  );
}
