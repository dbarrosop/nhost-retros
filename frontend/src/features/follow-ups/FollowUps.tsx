import { useId, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { useDrafts } from "../../lib/drafts";
import { type AppRole, readFailed, useRetroQuery } from "../../lib/retro-api";
import { ConfirmAction, useChange } from "../sessions/controls";
import type { ParticipantAccount } from "../sessions/participants-api";
import {
  addFollowUp,
  deleteFollowUp,
  editFollowUp,
  type FollowUp,
  type FollowUpsResult,
  followUpFailed,
  followUpsQuery,
  participantFollowUpsQuery,
} from "./api";
import { FollowUpDetails } from "./FollowUpDetails";
import { FollowUpForm } from "./FollowUpForm";

export function FollowUps({
  sessionId,
  questionId,
  readOnly = false,
  role = "facilitator",
}: {
  sessionId: string;
  questionId: string;
  readOnly?: boolean;
  role?: AppRole;
}) {
  const query = useRetroQuery<FollowUpsResult>(
    role,
    ["follow-ups", questionId, sessionId],
    role === "facilitator" ? followUpsQuery : participantFollowUpsQuery,
    { sessionId, questionId },
  );
  const change = useChange(role);
  const canManage = role === "facilitator";
  const heading = useId();
  const question = query.data?.retroQuestions[0];
  const busy = !canManage || readOnly || query.isError || change.isPending;
  const accounts =
    question?.session?.participants.flatMap((participant) =>
      participant.account ? [participant.account] : [],
    ) ?? [];
  return (
    <section className="follow-ups-section" aria-labelledby={heading}>
      <div className="section-heading">
        <h2 id={heading} tabIndex={-1}>
          Follow-ups
        </h2>
        <span className="small-label">Turn reflections into actions</span>
      </div>
      <p className="field-hint">
        {canManage
          ? "Facilitators manage these actions. Participants can read them once the session ends."
          : "These actions are shared with session participants. Only facilitators can change them."}
      </p>
      {query.isPending ? (
        <p role="status">Loading follow-ups…</p>
      ) : !question ? (
        <p role="alert">
          {query.isError
            ? readFailed
            : "Follow-ups unavailable. This question or your access may have changed."}
        </p>
      ) : (
        <>
          {query.isError && <p role="alert">{readFailed} Your follow-up drafts are kept below.</p>}
          {question.followUps.length === 0 && <p className="field-hint">No follow-ups yet.</p>}
          <ol className="follow-up-list">
            {question.followUps.map((followUp, index) => (
              <FollowUpItem
                key={followUp.id}
                followUp={followUp}
                number={index + 1}
                accounts={accounts}
                busy={busy}
                canManage={canManage}
                onSave={(input) =>
                  change.mutateAsync({
                    query: editFollowUp,
                    variables: { id: followUp.id, ...input },
                    field: "updateRetroFollowUps",
                  })
                }
                onDelete={() =>
                  change.mutateAsync({
                    query: deleteFollowUp,
                    variables: { id: followUp.id },
                    field: "deleteRetroFollowUps",
                  })
                }
                onDeleted={() => document.getElementById(heading)?.focus()}
              />
            ))}
          </ol>
          {canManage && (
            <div className="editor-panel">
              <h3>Add a follow-up</h3>
              <FollowUpForm
                label="New follow-up"
                draftKey={`follow-up:new:${questionId}`}
                accounts={accounts}
                blocked={busy}
                onSave={(input) =>
                  change.mutateAsync({
                    query: addFollowUp,
                    variables: { questionId, ...input },
                    field: "insertRetroFollowUps",
                  })
                }
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FollowUpItem({
  followUp,
  number,
  accounts,
  busy,
  canManage,
  onSave,
  onDelete,
  onDeleted,
}: {
  followUp: FollowUp;
  number: number;
  accounts: ParticipantAccount[];
  busy: boolean;
  canManage: boolean;
  onSave: React.ComponentProps<typeof FollowUpForm>["onSave"];
  onDelete: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  const drafts = useDrafts();
  const draftKey = `follow-up:${followUp.id}`;
  const [editing, setEditing] = useState(() => drafts?.has(draftKey) ?? false);
  const titleId = useId();
  const finish = () => {
    setEditing(false);
    document.getElementById(titleId)?.focus();
  };
  return (
    <li>
      <article className="follow-up-card" aria-label={`Follow-up ${number}`}>
        <div className="title-row">
          <h3 id={titleId} tabIndex={-1}>
            Follow-up {number}
          </h3>
          {canManage && (
            <div className="title-actions">
              {!editing && (
                <IconButton
                  label={`Edit follow-up ${number}`}
                  icon="edit"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                />
              )}
              <ConfirmAction
                label={`Delete follow-up ${number}`}
                icon="delete"
                title="Delete this follow-up?"
                description="This removes the action from the retrospective. Any linked external ticket is left unchanged. This cannot be undone."
                disabled={busy}
                failureMessage={followUpFailed}
                onConfirm={onDelete}
                afterConfirm={onDeleted}
              />
            </div>
          )}
        </div>
        {canManage && editing ? (
          <FollowUpForm
            label={`Edit follow-up ${number}`}
            draftKey={draftKey}
            initial={followUp}
            retainedOwner={followUp.owner}
            accounts={accounts}
            blocked={busy}
            onCancel={finish}
            onSave={async (input) => {
              await onSave(input);
              finish();
            }}
          />
        ) : (
          <FollowUpDetails followUp={followUp} />
        )}
      </article>
    </li>
  );
}
