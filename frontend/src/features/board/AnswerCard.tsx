import { useDraggable } from "@dnd-kit/core";
import type { BoardAnswer, Topic } from "./api";
import { ungrouped } from "./api";
import { CardAuthor } from "./CardAuthor";
import { MoveAnswerControl } from "./MoveAnswerControl";

export const dragControlId = (id: string) => `drag-answer-${id}`;
export function AnswerCard({
  answer,
  number,
  topics,
  busy,
  readOnly = false,
  onMove,
  onNewTheme,
  canStage,
}: {
  answer: BoardAnswer;
  number: number;
  topics: Topic[];
  busy: boolean;
  readOnly?: boolean;
  onMove: (topic: string, control: "move" | "drag") => void;
  onNewTheme?: () => void;
  canStage?: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: answer.id,
    disabled: busy || readOnly,
  });
  const author = answer.author?.displayName.trim() || answer.author?.email || "Former participant";
  // Decorative identity cue, not author/topic/status: keep it stable across moves.
  const tone = [...answer.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return (
    <article
      ref={setNodeRef}
      className={`board-card tone-${tone}${isDragging ? " dragging" : ""}`}
      aria-label={`Card ${number} by ${author}`}
      data-answer-id={answer.id}
    >
      <div className="board-card-heading">
        <CardAuthor number={number} name={author} email={answer.author?.email} />
        {!readOnly && (
          <div className="card-actions">
            <MoveAnswerControl
              answerId={answer.id}
              number={number}
              topicId={answer.assignment?.topicId ?? ungrouped}
              topics={topics}
              busy={busy}
              onMove={(topic) => onMove(topic, "move")}
              onNewTheme={onNewTheme}
              canStage={canStage}
            />
            <button
              ref={setActivatorNodeRef}
              id={dragControlId(answer.id)}
              className="drag-handle"
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Drag card ${number}`}
              aria-disabled={busy}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="7" cy="5" r="1.3" />
                <circle cx="13" cy="5" r="1.3" />
                <circle cx="7" cy="10" r="1.3" />
                <circle cx="13" cy="10" r="1.3" />
                <circle cx="7" cy="15" r="1.3" />
                <circle cx="13" cy="15" r="1.3" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <p className="answer-text">{answer.text}</p>
    </article>
  );
}
