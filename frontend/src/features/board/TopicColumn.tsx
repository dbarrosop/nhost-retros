import { useDroppable } from "@dnd-kit/core";
import { type ReactNode, useLayoutEffect, useState } from "react";
import { IconButton } from "../../components/IconButton";
import { useDrafts } from "../../lib/drafts";
import { ConfirmAction, TextForm } from "../sessions/controls";
import { groupingFailed, type Topic, ungrouped } from "./api";

export function TopicColumn({
  id,
  topic,
  count,
  totalCount,
  busy,
  onRename,
  onDelete,
  children,
}: {
  id: string;
  topic?: Topic;
  count: number;
  totalCount: number;
  busy: boolean;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const drafts = useDrafts();
  const draftKey = `topic:${id}`;
  const [editing, setEditing] = useState(() => drafts?.has(draftKey) ?? false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  useLayoutEffect(() => {
    if (restoreFocus && !editing && !busy) {
      document.getElementById(`rename-topic-${id}`)?.focus();
      setRestoreFocus(false);
    }
  }, [restoreFocus, editing, busy, id]);
  const name = topic?.name ?? "Ungrouped";
  return (
    <section
      ref={setNodeRef}
      className={`topic-column${isOver ? " drop-target" : ""}`}
      aria-labelledby={`topic-title-${id}`}
      data-topic-id={id}
    >
      <header className="topic-header">
        <div className="topic-title-row">
          <div className="topic-title-group">
            <h2 id={`topic-title-${id}`} tabIndex={-1}>
              {name}
            </h2>
            <span className="topic-count">
              {count === totalCount ? count : `${count} of ${totalCount}`}
              <span className="sr-only">{totalCount === 1 ? " card" : " cards"}</span>
            </span>
          </div>
          {topic && (
            <div className="title-actions">
              <IconButton
                id={`rename-topic-${id}`}
                label={`Rename topic ${name}`}
                icon="edit"
                disabled={busy}
                onClick={() => {
                  if (editing) drafts?.delete(draftKey);
                  setEditing(!editing);
                }}
                aria-expanded={editing}
              />
              <ConfirmAction
                label={`Delete topic ${name}`}
                icon="delete"
                title={`Delete topic “${name}”?`}
                description={`${totalCount} ${totalCount === 1 ? "card" : "cards"} will move to Ungrouped. No answer content or authorship will be deleted. This cannot be undone.`}
                disabled={busy}
                failureMessage={groupingFailed}
                onConfirm={onDelete}
                afterConfirm={() => document.getElementById(`topic-title-${ungrouped}`)?.focus()}
              />
            </div>
          )}
        </div>
        {!topic && <p className="field-hint">Reflections waiting for a theme.</p>}
        {editing && topic && (
          <TextForm
            draftKey={draftKey}
            label={`Rename topic ${name}`}
            maximum={120}
            initial={name}
            submit="Save topic name"
            focusOnMount
            blocked={busy}
            failureMessage={groupingFailed}
            onCancel={() => {
              setEditing(false);
              setRestoreFocus(true);
            }}
            onSave={async (value) => {
              await onRename(value);
              setEditing(false);
              setRestoreFocus(true);
            }}
          />
        )}
      </header>
      <div className="topic-cards">
        {children}
        {count === 0 && (
          <p className="column-empty">
            {totalCount > 0
              ? `No cards from the selected participants here (${totalCount} hidden by the filter).`
              : topic
                ? "Move a card here to start a theme."
                : "All reflections have a place."}
          </p>
        )}
      </div>
    </section>
  );
}
