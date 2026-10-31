import { useId } from "react";
import { type Topic, ungrouped } from "./api";

export const moveControlId = (id: string) => `move-answer-${id}`;
export function MoveAnswerControl({
  answerId,
  number,
  topicId,
  topics,
  busy,
  onMove,
}: {
  answerId: string;
  number: number;
  topicId: string;
  topics: Topic[];
  busy: boolean;
  onMove: (topic: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="move-control">
      <label id={labelId} htmlFor={moveControlId(answerId)}>
        Move card {number} to
      </label>
      <select
        id={moveControlId(answerId)}
        value={topicId}
        aria-disabled={busy}
        onChange={(event) => {
          if (!busy) onMove(event.target.value);
        }}
      >
        <option value={ungrouped}>Ungrouped</option>
        {topics.map((topic) => (
          <option key={topic.id} value={topic.id}>
            {topic.name}
          </option>
        ))}
      </select>
    </div>
  );
}
