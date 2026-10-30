import { Link, Navigate } from "@tanstack/react-router";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { authMessage, companyEmail, normalizeEmail } from "../../lib/auth-store";

export function AuthPage() {
  const { session, ready, notice, store } = useAuth();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (sent) codeInput.current?.focus();
  }, [sent]);
  useEffect(() => {
    if (resendAt <= now) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAt, now]);
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  if (ready && session) return <Navigate to="/workspace" replace />;

  async function send(resend = false) {
    setError("");
    setMessage("");
    if (!companyEmail(email)) {
      setError("Use your exact @nhost.io email address.");
      return;
    }
    setPending(true);
    try {
      await store.sendCode(email, signup && !resend);
      setEmail(normalizeEmail(email));
      setSent(true);
      setOtp("");
      setResendAt(Date.now() + 30_000);
      setNow(Date.now());
      setMessage(
        resend
          ? "A new code is on its way. Use the latest email."
          : "Check your inbox for a one-time code.",
      );
    } catch (failure) {
      setError(authMessage(failure));
    } finally {
      setPending(false);
    }
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sent) {
      await send();
      return;
    }
    setPending(true);
    setError("");
    setMessage("");
    try {
      await store.verify(email, otp);
    } catch (failure) {
      setError(authMessage(failure, true));
    } finally {
      setPending(false);
    }
  }
  return (
    <main id="main-content" className="auth-layout" tabIndex={-1}>
      <section className="auth-intro">
        <p className="eyebrow">Your team. Your perspective.</p>
        <h1>
          A little space <em>to be heard.</em>
        </h1>
        <p>Start with your Nhost email. We’ll send a one-time code — no password to remember.</p>
        <Link className="quiet-link" to="/">
          Back to welcome <span aria-hidden="true">↗</span>
        </Link>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <span className="small-label">NHOST TEAM WORKSPACE</span>
        <h2 id="auth-title">
          {sent ? "Check your inbox" : signup ? "Create your account" : "Welcome back"}
        </h2>
        <p className="auth-description">
          {sent ? (
            <>
              Enter the code sent to <strong>{email}</strong>. Codes expire; you can request a fresh
              one below.
            </>
          ) : signup ? (
            "New here? Verify your company email to join."
          ) : (
            "Sign in with your verified company email."
          )}
        </p>
        <form onSubmit={submit} aria-busy={pending}>
          {sent ? (
            <>
              <label htmlFor="otp">One-time code</label>
              <input
                ref={codeInput}
                id="otp"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                required
                disabled={pending}
                aria-describedby="auth-feedback"
              />
            </>
          ) : (
            <>
              <label htmlFor="email">Company email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@nhost.io"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={pending || !ready}
                aria-describedby="email-help auth-feedback"
              />
              <p id="email-help" className="field-hint">
                Only exact @nhost.io addresses are eligible.
              </p>
            </>
          )}
          <div id="auth-feedback">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="form-status" role="status">
              {message || notice}
            </p>
          </div>
          <button className="primary-link" type="submit" disabled={pending || !ready}>
            {pending
              ? "Please wait…"
              : sent
                ? "Verify and continue"
                : signup
                  ? "Create account & send code"
                  : "Send sign-in code"}
          </button>
        </form>
        {sent ? (
          <div className="auth-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => void send(true)}
              disabled={pending || seconds > 0}
            >
              {seconds > 0 ? `Resend code in ${seconds}s` : "Resend code"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={pending}
              onClick={() => {
                setSent(false);
                setOtp("");
                setError("");
                setMessage("");
              }}
            >
              Use another email
            </button>
          </div>
        ) : (
          <p className="auth-switch">
            {signup ? "Already have an account?" : "First time here?"}{" "}
            <button
              className="text-button"
              type="button"
              disabled={pending}
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Sign in" : "Create account"}
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
