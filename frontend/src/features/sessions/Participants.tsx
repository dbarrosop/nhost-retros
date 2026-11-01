import { useId } from "react";
import { ParticipantAvatar } from "../../components/ParticipantAvatar";
import { readFailed, useRetroQuery } from "../../lib/retro-api";
import { ConfirmAction, useChange } from "./controls";
import { ParticipantPicker } from "./ParticipantPicker";
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
  const headingId = useId();
  const session = query.data?.retroSessions[0];
  const participants = session?.participants ?? [];
  const available = (query.data?.retroParticipantAccounts ?? []).filter(
    (account) => !participants.some((p) => p.userId === account.id),
  );
  const busy = query.isError || change.isPending;
  return (
    <section className="editor-panel participants-panel" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        Participants
      </h2>
      <p className="participants-description">
        Choose who can join this conversation. Removing someone keeps their saved responses.
      </p>
      {query.isPending ? (
        <p role="status">Loading participants…</p>
      ) : query.isError ? (
        <p role="alert">{readFailed}</p>
      ) : !session ? (
        <p>Session unavailable.</p>
      ) : (
        <>
          {participants.length === 0 && <p className="field-hint">No participants yet.</p>}
          <ul className="participant-list" aria-label="Session participants">
            {participants.map(({ userId, account }) => {
              const name = account?.displayName || account?.email || "Unavailable account";
              return (
                <li key={userId}>
                  <div className="participant-identity">
                    <ParticipantAvatar name={name} />
                    <span className="participant-label">
                      <span className="participant-name" title={name}>
                        {name}
                      </span>
                      {account && (
                        <span className="participant-email" title={account.email}>
                          {account.email}
                        </span>
                      )}
                    </span>
                  </div>
                  <ConfirmAction
                    label={`Remove ${account?.email || "participant"}`}
                    icon={
                      <svg
                        viewBox="0 0 16 16"
                        width="16"
                        height="16"
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                      >
                        <path d="m4 4 8 8M12 4l-8 8" />
                      </svg>
                    }
                    title="Remove participant?"
                    description="They will lose access to this session and their cards. Their saved responses will remain visible to facilitators."
                    disabled={busy}
                    afterConfirm={() => document.getElementById(headingId)?.focus()}
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
          <ParticipantPicker
            accounts={available}
            disabled={busy}
            onAdd={(account) =>
              change.mutateAsync({
                query: addParticipant,
                variables: { sessionId, userId: account.id },
                field: "insertRetroSessionParticipants",
              })
            }
          />
        </>
      )}
    </section>
  );
}
