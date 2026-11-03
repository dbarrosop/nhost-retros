import { useEffect, useId, useState } from "react";
import { useDrafts } from "../../lib/drafts";
import { plainText } from "../../lib/text";
import type { ParticipantAccount } from "../sessions/participants-api";
import { type FollowUpInput, followUpFailed } from "./api";
import { ticketUrl } from "./validation";

const empty: FollowUpInput = { action: "", ownerId: "", ticketUrl: null };

export function FollowUpForm({
  label,
  draftKey,
  initial = empty,
  retainedOwner,
  accounts,
  blocked,
  onSave,
  onCancel,
}: {
  label: string;
  draftKey: string;
  initial?: FollowUpInput;
  retainedOwner?: ParticipantAccount | null;
  accounts: ParticipantAccount[];
  blocked: boolean;
  onSave: (input: FollowUpInput) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const id = useId();
  const drafts = useDrafts();
  const [patch, setPatch] = useState<Partial<FollowUpInput>>(() => {
    const draft = drafts?.get(draftKey);
    try {
      return draft ? (JSON.parse(draft) as Partial<FollowUpInput>) : {};
    } catch {
      return {};
    }
  });
  const value = { ...initial, ...patch };
  const retainedOwnerName = retainedOwner?.displayName
    ? `${retainedOwner.displayName} (${retainedOwner.email})`
    : retainedOwner?.email;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(onCancel);
  useEffect(() => {
    if (editing) document.getElementById(`${id}-action`)?.focus();
  }, [id, editing]);
  const busy = pending || blocked;
  const update = (fields: Partial<FollowUpInput>) => {
    const next = { ...patch, ...fields };
    setPatch(next);
    drafts?.set(draftKey, JSON.stringify(next));
  };
  return (
    <form
      className="text-form"
      aria-label={label}
      aria-busy={pending}
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setError("");
        let input: FollowUpInput;
        try {
          input = {
            action: plainText(value.action, 500),
            ownerId: value.ownerId,
            ticketUrl: ticketUrl(value.ticketUrl ?? ""),
          };
          if (
            !input.ownerId ||
            (!accounts.some((account) => account.id === input.ownerId) &&
              input.ownerId !== initial.ownerId)
          )
            throw new Error("Choose a current session participant as owner.");
        } catch (failure) {
          setError((failure as Error).message);
          return;
        }
        setPending(true);
        try {
          await onSave(input);
          drafts?.delete(draftKey);
          setPatch({});
        } catch {
          setError(followUpFailed);
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor={`${id}-action`}>Action</label>
      <textarea
        id={`${id}-action`}
        value={value.action}
        readOnly={busy}
        required
        rows={3}
        aria-describedby={`${id}-action-hint`}
        onChange={(event) => update({ action: event.target.value })}
      />
      <span id={`${id}-action-hint`} className="field-hint">
        1–500 characters. What needs to happen?
      </span>
      <label htmlFor={`${id}-owner`}>Owner</label>
      <select
        id={`${id}-owner`}
        value={value.ownerId}
        disabled={busy}
        required
        onChange={(event) => update({ ownerId: event.target.value })}
      >
        <option value="">Choose a participant</option>
        {initial.ownerId && !accounts.some((account) => account.id === initial.ownerId) && (
          <option value={initial.ownerId}>
            {retainedOwnerName
              ? `${retainedOwnerName} — unavailable; keep current owner`
              : "Retained owner (not available for new assignments)"}
          </option>
        )}
        {value.ownerId &&
          value.ownerId !== initial.ownerId &&
          !accounts.some((account) => account.id === value.ownerId) && (
            <option value={value.ownerId} disabled>
              Selected owner is no longer available
            </option>
          )}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName ? `${account.displayName} (${account.email})` : account.email}
          </option>
        ))}
      </select>
      {accounts.length === 0 && (
        <p className="field-hint">
          Add eligible participants on the session page to assign follow-ups.
        </p>
      )}
      <label htmlFor={`${id}-ticket`}>Ticket link (optional)</label>
      <input
        id={`${id}-ticket`}
        type="url"
        value={value.ticketUrl ?? ""}
        readOnly={busy}
        aria-describedby={`${id}-ticket-hint`}
        onChange={(event) => update({ ticketUrl: event.target.value })}
      />
      <span id={`${id}-ticket-hint`} className="field-hint">
        An http:// or https:// link, up to 2,048 characters.
      </span>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="action-row">
        <button className="primary-link" type="submit" aria-disabled={busy}>
          {pending ? "Saving…" : onCancel ? "Save follow-up" : "Add follow-up"}
        </button>
        {onCancel && (
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => {
              drafts?.delete(draftKey);
              onCancel();
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
