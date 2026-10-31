import { useDraggable } from "@dnd-kit/core";
import type { BoardAnswer, Topic } from "./api";
import { ungrouped } from "./api";
import { MoveAnswerControl } from "./MoveAnswerControl";

export const dragControlId = (id: string) => `drag-answer-${id}`;
export function AnswerCard({
  answer,
  number,
  topics,
  busy,
  onMove,
}: {
  answer: BoardAnswer;
  number: number;
  topics: Topic[];
  busy: boolean;
  onMove: (topic: string, control: "move" | "drag") => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: answer.id,
    disabled: busy,
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
        <span className="card-number">{String(number).padStart(2, "0")}</span>
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
          <span aria-hidden="true">⠿</span>
        </button>
      </div>
      <p className="answer-text">{answer.text}</p>
      <div className="card-author">
        <h3>{author}</h3>
        {answer.author?.email && author !== answer.author.email && <p>{answer.author.email}</p>}
      </div>
      <MoveAnswerControl
        answerId={answer.id}
        number={number}
        topicId={answer.assignment?.topicId ?? ungrouped}
        topics={topics}
        busy={busy}
        onMove={(topic) => onMove(topic, "move")}
      />
    </article>
  );
}
