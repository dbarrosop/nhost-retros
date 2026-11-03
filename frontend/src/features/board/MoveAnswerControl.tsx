import { useId } from "react";
import { HeaderMenu } from "../../components/HeaderMenu";
import { type Topic, ungrouped } from "./api";

export const moveControlId = (id: string) => `move-answer-${id}`;
export function MoveAnswerControl({
  answerId,
  number,
  topicId,
  topics,
  busy,
  onMove,
  onNewTheme,
  canStage = true,
}: {
  answerId: string;
  number: number;
  topicId: string;
  topics: Topic[];
  busy: boolean;
  onMove: (topic: string) => void;
  onNewTheme?: () => void;
  canStage?: boolean;
}) {
  const labelId = useId();
  const valueId = useId();
  const destinations = [{ id: ungrouped, name: "Ungrouped" }, ...topics];
  const current = destinations.find((topic) => topic.id === topicId)?.name ?? "Unavailable theme";
  return (
    <div className="move-control">
      <span className="sr-only" id={labelId}>
        Move card {number} to
      </span>
      <HeaderMenu
        className="card-move-menu"
        summaryProps={{
          id: moveControlId(answerId),
          "aria-labelledby": `${labelId} ${valueId}`,
          "aria-disabled": busy,
          title: `Move card ${number} (currently ${current})`,
          onClick: (event) => {
            if (busy) event.preventDefault();
          },
        }}
        summary={
          <>
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M7 4H3v12h4M9 10h8m-3-3 3 3-3 3" />
            </svg>
            <span className="sr-only" id={valueId}>
              {current}
            </span>
          </>
        }
      >
        {(close) => (
          <div className="popup-panel card-move-options">
            <p className="small-label popup-label">Move to theme</p>
            {destinations.map((topic) => (
              <button
                key={topic.id}
                className="popup-item"
                type="button"
                aria-current={topic.id === topicId ? "true" : undefined}
                disabled={busy}
                onClick={() => {
                  close();
                  onMove(topic.id);
                }}
              >
                <span>{topic.name}</span>
                {topic.id === topicId && <span aria-hidden="true">✓</span>}
              </button>
            ))}
            {onNewTheme && (
              <button
                className="popup-item new-theme-option"
                type="button"
                disabled={busy || !canStage}
                onClick={() => {
                  close();
                  onNewTheme();
                }}
              >
                New theme… <span aria-hidden="true">+</span>
              </button>
            )}
          </div>
        )}
      </HeaderMenu>
    </div>
  );
}
