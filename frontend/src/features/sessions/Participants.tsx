import { useId, useState } from "react";
import { changeFailed, readFailed, useRetroQuery } from "../../lib/retro-api";
import { ConfirmAction, useChange } from "./controls";
import {
  addParticipant,
  type ParticipantsResult,
  participantsQuery,
  removeParticipant,
} from "./participants-api";

export function Participants({ sessionId }: { sessionId: string }) {
  const query = useRetroQuery<ParticipantsResult>(
    "facilitator",
    ["participants", sessionId],
    participantsQuery,
    { sessionId },
  );
  const change = useChange("facilitator");
  const inputId = useId();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const session = query.data?.retroSessions[0];
  const participants = session?.participants ?? [];
  const available = (query.data?.retroParticipantAccounts ?? []).filter(
    (account) => !participants.some((p) => p.userId === account.id),
  );
  const busy = query.isError || change.isPending;
  return (
    <section className="editor-panel" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`} tabIndex={-1}>
        Participants
      </h2>
      <p>
        Only added participants can open this session or write their own reflection cards.
        Facilitators retain management access. Responses are kept when someone is removed.
      </p>
      {query.isPending ? (
        <p role="status">Loading participants…</p>
      ) : query.isError ? (
        <p role="alert">{readFailed}</p>
      ) : !session ? (
        <p>Session unavailable.</p>
      ) : (
        <>
          {participants.length === 0 && <p>No participants yet.</p>}
          <ul className="participant-list">
            {participants.map(({ userId, account }) => {
              const label = account
                ? `${account.displayName || account.email} (${account.email})`
                : "Unavailable account";
              return (
                <li key={userId}>
                  <span>{label}</span>{" "}
                  <ConfirmAction
                    label={`Remove ${account?.email || "participant"}`}
                    title="Remove participant?"
                    description="They will lose access to this session and their cards. Their saved responses will remain visible to facilitators."
                    disabled={busy}
                    afterConfirm={() => document.getElementById(`${inputId}-heading`)?.focus()}
                    onConfirm={() =>
                      change.mutateAsync({
                        query: removeParticipant,
                        variables: { sessionId, userId },
                        field: "deleteRetroSessionParticipants",
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
          <form
            className="text-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || !available.some((a) => a.id === selected)) return;
              setError("");
              try {
                await change.mutateAsync({
                  query: addParticipant,
                  variables: { sessionId, userId: selected },
                  field: "insertRetroSessionParticipants",
                });
                setSelected("");
              } catch {
                setError(changeFailed);
              }
            }}
          >
            <label htmlFor={inputId}>Add participant</label>
            <select
              id={inputId}
              value={selected}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Select a verified account</option>
              {available.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName || account.email} · {account.email}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              type="submit"
              disabled={busy || !available.some((a) => a.id === selected)}
            >
              Add participant
            </button>
            {!available.length && (
              <p>
                No more verified accounts available. New participants must sign up and verify their
                email first.
              </p>
            )}
            {error && <p role="alert">{error}</p>}
          </form>
        </>
      )}
    </section>
  );
}
