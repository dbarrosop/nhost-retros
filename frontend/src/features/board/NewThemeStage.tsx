import { useDroppable } from "@dnd-kit/core";
import { useEffect, useRef } from "react";
import { TextForm } from "../sessions/controls";
import { type BoardAnswer, groupingFailed } from "./api";

export const newThemeDropId = "new-theme";
export const newThemeButtonId = "new-theme-button";
export const themeNameDraftKey = "New topic";
export const stagedCardDraftKey = "new-theme:card";
const editorId = "new-theme-editor";

export function NewThemeStage({
  stagedId,
  busy,
  dragging,
  onOpen,
}: {
  stagedId: string | null;
  busy: boolean;
  dragging: boolean;
  onOpen: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: newThemeDropId, disabled: busy || !!stagedId });
  const editing = stagedId !== null;
  return (
    <section
      ref={setNodeRef}
      className={`topic-column new-theme-column${isOver ? " drop-target" : ""}`}
      aria-label="New theme staging area"
      data-new-theme="true"
    >
      <button
        id={newThemeButtonId}
        className="new-theme-add"
        type="button"
        aria-label="New theme"
        title="New theme"
        aria-describedby="new-theme-hint"
        aria-expanded={editing}
        aria-controls={editing ? editorId : undefined}
        disabled={busy || dragging}
        onClick={() => {
          if (editing) document.getElementById(editorId)?.querySelector("input")?.focus();
          else onOpen();
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <p className="sr-only" id="new-theme-hint">
        Drop a card here to start a theme, or choose New theme to create an empty one.
      </p>
    </section>
  );
}

export function NewThemeEditor({
  stagedId,
  answer,
  busy,
  dragging,
  onOpen,
  onCancel,
  onSave,
}: {
  stagedId: string | null;
  answer?: BoardAnswer;
  busy: boolean;
  dragging: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (stagedId !== null) root.current?.querySelector("input")?.focus();
  }, [stagedId]);
  if (stagedId === null) return null;
  const missing = !!stagedId && !answer;
  const characters = Array.from(answer?.text ?? "");
  const preview = characters.slice(0, 240).join("") + (characters.length > 240 ? "…" : "");
  return (
    <section
      id={editorId}
      ref={root}
      className={`new-theme-editor${answer || missing ? " with-card" : ""}`}
      aria-labelledby="new-theme-title"
    >
      <h2 id="new-theme-title" tabIndex={-1}>
        New theme
      </h2>
      <div className="new-theme-editor-content">
        {answer && (
          <div className="staged-card-preview">
            <p className="small-label">
              Card by {answer.author?.displayName || answer.author?.email || "a former participant"}
            </p>
            <blockquote>{preview}</blockquote>
            <p className="field-hint">This card stays where it is until you create the theme.</p>
          </div>
        )}
        {missing && (
          <div className="new-theme-missing">
            <p role="alert" className="form-error">
              The staged card is no longer available. Your theme name is kept.
            </p>
            <button
              className="text-button"
              type="button"
              disabled={busy || dragging}
              onClick={onOpen}
            >
              Continue without the card
            </button>
          </div>
        )}
        <TextForm
          label="Theme name"
          draftKey={themeNameDraftKey}
          maximum={120}
          submit="Create theme"
          focusOnMount
          blocked={busy || dragging || missing}
          failureMessage={groupingFailed}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
    </section>
  );
}
