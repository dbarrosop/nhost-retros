import type { OAuth2LoginResponse } from "@nhost/nhost-js/auth";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth";
import { isUuid } from "../../lib/ids";
import { EmailOTPForm } from "../auth/EmailOTPForm";
import { consentFailure, consentRedirect, scopeDescription, validateLoginRequest } from "./consent";

type Failure = ReturnType<typeof consentFailure>;
type RequestState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; request: OAuth2LoginResponse };

export function OAuth2LoginPage({ requestId }: { requestId: string }) {
  const [cancelled, setCancelled] = useState(false);
  if (cancelled || !isUuid(requestId)) {
    return (
      <main id="main-content" className="not-found" tabIndex={-1}>
        <p className="eyebrow">Nhost authorization</p>
        <h1>{cancelled ? "Access not granted" : "Invalid authorization request"}</h1>
        <p>
          {cancelled
            ? "No access was granted. You can close this page and return to the application."
            : "Open this page by signing in from the application you want to connect. The request is missing or invalid."}
        </p>
      </main>
    );
  }
  return <ConsentRequest requestId={requestId} onCancel={() => setCancelled(true)} />;
}

function ConsentRequest({ requestId, onCancel }: { requestId: string; onCancel: () => void }) {
  const { ready, session, generation, store } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RequestState>({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the request after a transport failure.
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void store.client.auth
      .oauth2LoginGet(
        { request_id: requestId },
        {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
          cache: "no-store",
          referrerPolicy: "no-referrer",
        },
      )
      .then(({ body }) => {
        const request = validateLoginRequest(body, requestId);
        if (!controller.signal.aborted) setState({ status: "ready", request });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", failure: consentFailure(error) });
        }
      });
    return () => controller.abort();
  }, [requestId, store, attempt]);

  if (state.status !== "ready") {
    return (
      <main id="main-content" className="not-found" tabIndex={-1}>
        <p className="eyebrow">Nhost authorization</p>
        <h1>Connect your account</h1>
        {state.status === "loading" ? (
          <p role="status">Loading authorization request…</p>
        ) : (
          <>
            <p className="form-error" role="alert">
              {state.failure.message}
            </p>
            {state.failure.retry && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setAttempt(attempt + 1)}
              >
                Try again
              </button>
            )}
          </>
        )}
        <button className="text-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </main>
    );
  }

  const { request } = state;
  return (
    <main id="main-content" className="auth-layout oauth2-layout" tabIndex={-1}>
      <section className="auth-intro" aria-labelledby="consent-title">
        <p className="eyebrow">Nhost authorization</p>
        <h1 id="consent-title">
          Your account. <em>Your choice.</em>
        </h1>
        <p>
          An application wants to connect to your Nhost account. Only continue if you recognize it.
        </p>
        <dl className="oauth2-details">
          <dt>Application (client ID)</dt>
          <dd>
            <code>{request.clientId}</code>
          </dd>
          <dt>Return address</dt>
          <dd>{request.redirectUri}</dd>
        </dl>
        <h2 className="oauth2-permissions-title">Requested permissions</h2>
        {request.scopes.length ? (
          <ul className="oauth2-scopes">
            {[...new Set(request.scopes)].map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
                <span>{scopeDescription(scope)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No additional permissions requested.</p>
        )}
      </section>
      {!ready ? (
        <p role="status">Checking your session…</p>
      ) : session ? (
        <ConsentApproval key={generation} request={request} onCancel={onCancel} />
      ) : (
        <div>
          <p className="auth-description">
            Sign in to review and approve this request. Signing in alone does not grant access.
          </p>
          <EmailOTPForm />
          <button className="text-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </main>
  );
}

function ConsentApproval({
  request,
  onCancel,
}: {
  request: OAuth2LoginResponse;
  onCancel: () => void;
}) {
  const { session, canQuery, notice, generation, store } = useAuth();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);

  async function approve() {
    const before = store.getSnapshot();
    if (
      operation.current ||
      !before.session ||
      !before.canQuery ||
      before.generation !== generation
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setFailure(null);
    try {
      const { body } = await store.client.auth.oauth2LoginPost(
        { requestId: request.requestId },
        {
          headers: { Authorization: `Bearer ${before.session.accessToken}` },
          signal: AbortSignal.any([
            controller.signal,
            store.getDataSignal(),
            AbortSignal.timeout(12_000),
          ]),
          referrerPolicy: "no-referrer",
        },
      );
      const current = store.getSnapshot();
      if (controller.signal.aborted || current.generation !== generation || !current.canQuery)
        return;
      location.assign(consentRedirect(body.redirectUri, request));
    } catch (error) {
      if (!controller.signal.aborted && store.getSnapshot().generation === generation) {
        setFailure(consentFailure(error, true));
        setPending(false);
        operation.current = null;
      }
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="approval-title" aria-busy={pending}>
      <span className="small-label">REVIEW ACCESS</span>
      <h2 id="approval-title">Authorize application</h2>
      <p className="auth-description">
        Signed in as <strong>{session?.user?.email}</strong>.
      </p>
      <p className="auth-description">
        By choosing Allow access, you grant this application the permissions listed on this page.
      </p>
      {!canQuery && (
        <p role="status">{notice || "Reconnecting your session. Wait before allowing access."}</p>
      )}
      {failure && (
        <p className="form-error" role="alert">
          {failure.message}
        </p>
      )}
      <div className="oauth2-actions">
        <button
          className="primary-link"
          type="button"
          onClick={() => void approve()}
          disabled={pending || !canQuery || failure?.retry === false}
        >
          {pending ? "Returning to application…" : "Allow access"}
        </button>
        <button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void store.signOut()}
          disabled={pending}
        >
          Use another account
        </button>
      </div>
    </section>
  );
}
