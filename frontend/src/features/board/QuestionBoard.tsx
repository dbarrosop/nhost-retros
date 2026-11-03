import {
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { onlineManager } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { ParticipantAvatar } from "../../components/ParticipantAvatar";
import { useDrafts } from "../../lib/drafts";
import {
  type AppRole,
  readFailed,
  requireAffected,
  useRetroApi,
  useRetroQuery,
} from "../../lib/retro-api";
import { FollowUps } from "../follow-ups/FollowUps";
import { useSession } from "../sessions/api";
import { AnswerCard, dragControlId } from "./AnswerCard";
import {
  addTopic,
  assignAnswer,
  type Board,
  type BoardAnswer,
  type BoardResult,
  boardQuery,
  createThemeFromCard,
  deleteTopic,
  groupingFailed,
  moveAnswer,
  renameTopic,
  ungroupAnswer,
  ungrouped,
} from "./api";
import { moveControlId } from "./MoveAnswerControl";
import {
  NewThemeEditor,
  NewThemeStage,
  newThemeButtonId,
  newThemeDropId,
  stagedCardDraftKey,
  themeNameDraftKey,
} from "./NewThemeStage";
import { TopicColumn } from "./TopicColumn";

// One arrow step per column, in DOM order, including a stacked mobile board.
function boardCoordinates(targetId: { current: string | null }): KeyboardCoordinateGetter {
  return (event, { context }) => {
    const direction = ["ArrowRight", "ArrowDown"].includes(event.code)
      ? 1
      : ["ArrowLeft", "ArrowUp"].includes(event.code)
        ? -1
        : 0;
    if (!direction || !context.collisionRect) return;
    event.preventDefault();
    // New themes register after the staging zone, but keyboard navigation must
    // still follow the rendered column order rather than registration order.
    const columns = context.droppableContainers.getEnabled().sort((a, b) => {
      const first = a.node.current,
        second = b.node.current;
      if (!first || !second) return 0;
      const position = first.compareDocumentPosition(second);
      return position & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : position & Node.DOCUMENT_POSITION_PRECEDING
          ? 1
          : 0;
    });
    const current = columns.findIndex((column) => column.id === targetId.current);
    const target = columns[current + direction];
    const rect = target && context.droppableRects.get(target.id);
    if (!target || !rect) return;
    targetId.current = String(target.id);
    return { x: rect.left + 12, y: rect.top + 12 };
  };
}

export function QuestionBoard({
  sessionId,
  questionId,
  role = "facilitator",
}: {
  sessionId: string;
  questionId: string;
  role?: AppRole;
}) {
  const query = useSession(role, sessionId);
  const session = query.data?.retroSessions[0];
  const question = session?.questions.find((q) => q.id === questionId);
  return (
    <>
      <Link
        className="quiet-link"
        to={role === "facilitator" ? "/facilitate/$sessionId" : "/sessions/$sessionId"}
        params={{ sessionId }}
      >
        ← Back to session
      </Link>
      {query.isPending ? (
        <p role="status">Loading the conversation…</p>
      ) : query.isError && !session ? (
        <p role="alert">{readFailed}</p>
      ) : !question || !session || (role === "user" && !session.ended) ? (
        <h1>Question unavailable</h1>
      ) : (
        <>
          {query.isError && (
            <p role="alert">{readFailed} Your board and theme drafts are kept below.</p>
          )}
          <div className="board-intro">
            <p className="eyebrow">
              {role === "facilitator" ? "Facilitator board" : "Reflection board"} · {session.name}
            </p>
            <span className={`session-status ${session.ended ? "ended" : ""}`}>
              {session.ended ? "Ended" : "Active"}
            </span>
            <h1>{question.text}</h1>
            <p className="hero-description">
              {role === "user"
                ? "Explore everyone’s reflections, themes and follow-ups. This board is read-only."
                : "Find the themes in your team’s reflections. Participants can see this board and its authors once the session ends."}
              {role === "facilitator" &&
                session.ended &&
                " Answer content is permanently frozen; facilitators can still manage themes, grouping and follow-ups."}
            </p>
          </div>
          <BoardWorkspace sessionId={sessionId} questionId={questionId} role={role} />
          <FollowUps
            sessionId={sessionId}
            questionId={questionId}
            role={role}
            readOnly={query.isError}
          />
        </>
      )}
    </>
  );
}

export function BoardWorkspace({
  sessionId,
  questionId,
  role = "facilitator",
}: {
  sessionId: string;
  questionId: string;
  role?: AppRole;
}) {
  const readOnly = role === "user";
  const query = useRetroQuery<BoardResult>(role, ["board", questionId, sessionId], boardQuery, {
    questionId,
    sessionId,
  });
  const api = useRetroApi(role);
  const drafts = useDrafts();
  const [stagedId, setStagedId] = useState<string | null>(
    () => drafts?.get(stagedCardDraftKey) ?? (drafts?.has(themeNameDraftKey) ? "" : null),
  );
  const [held, setHeld] = useState<Board | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const keyboardTarget = useRef<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<string[] | null>(null);
  // A successful empty permission result takes precedence even during a drag.
  // Holding geometry must never hold onto an unavailable private board.
  const latest = query.data?.retroQuestions[0];
  const board = query.isSuccess && !latest ? undefined : (held ?? latest);
  const busy = readOnly || pending || query.isError || !api.enabled;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: boardCoordinates(keyboardTarget),
      scrollBehavior: "auto",
    }),
  );
  useLayoutEffect(() => {
    if (!held && focus) {
      (document.getElementById(focus) ?? document.getElementById("board-heading"))?.focus();
      setFocus(null);
    }
  }, [focus, held]);

  type ChangeResult = { affected_rows: number; returning?: { id: string }[] };
  async function change(
    document: string,
    variables: Record<string, unknown>,
    field: string,
    validate: (result: ChangeResult | undefined) => void = requireAffected,
  ) {
    if (locked.current || !board || busy || !onlineManager.isOnline())
      throw new Error(groupingFailed);
    locked.current = true;
    setPending(true);
    setHeld(board);
    try {
      const result = await api.request<Record<string, ChangeResult>>(document, variables);
      validate(result[field]);
      return result[field];
    } finally {
      // Keep the displayed snapshot still until the authoritative replacement is ready.
      if (onlineManager.isOnline()) await api.invalidate();
      else void api.invalidate();
      locked.current = false;
      setPending(false);
      setHeld(null);
    }
  }
  const columnName = (id: string) =>
    id === newThemeDropId
      ? "New theme staging area"
      : id === ungrouped
        ? "Ungrouped"
        : (board?.topics.find((t) => t.id === id)?.name ?? "a theme");
  function stageCard(id: string) {
    if (busy || locked.current || (id && stagedId && stagedId !== id)) return;
    drafts?.set(stagedCardDraftKey, id);
    setStagedId(id);
    setError("");
    setNotice(
      id
        ? "Card staged for a new theme. Enter a name; grouping has not changed."
        : "Name your new theme.",
    );
  }
  function clearStage() {
    drafts?.delete(stagedCardDraftKey);
    drafts?.delete(themeNameDraftKey);
    setStagedId(null);
  }
  function cancelStage() {
    const target = stagedId ? moveControlId(stagedId) : newThemeButtonId;
    clearStage();
    setFocus(target);
    setNotice("Theme creation cancelled. No grouping changed.");
  }
  async function createTheme(name: string) {
    if (stagedId && !board?.answers.some((answer) => answer.id === stagedId))
      throw new Error(groupingFailed);
    const result = await change(
      stagedId ? createThemeFromCard : addTopic,
      { questionId, name, ...(stagedId ? { answerId: stagedId } : {}) },
      stagedId ? "createdTheme" : "insertRetroTopics",
      (created) => {
        // Nested inserts can include the assignment in affected_rows. Verify
        // the single returned parent instead of treating that count as themes.
        if (
          !created ||
          created.affected_rows < 1 ||
          created.returning?.length !== 1 ||
          !created.returning[0]?.id
        )
          throw new Error(groupingFailed);
      },
    );
    clearStage();
    const createdId = result?.returning?.[0]?.id;
    setFocus(createdId ? `topic-title-${createdId}` : newThemeButtonId);
    setNotice(`Theme “${name}” created${stagedId ? " and the card moved into it" : ""}.`);
  }
  async function move(answer: BoardAnswer, target: string, control: "move" | "drag") {
    setError("");
    setNotice("");
    const current = answer.assignment?.topicId ?? ungrouped;
    const number = (board?.answers.findIndex((a) => a.id === answer.id) ?? 0) + 1;
    const focusId = control === "move" ? moveControlId(answer.id) : dragControlId(answer.id);
    try {
      if (target !== current) {
        if (target === ungrouped)
          await change(ungroupAnswer, { answerId: answer.id }, "deleteRetroAnswerTopics");
        else if (answer.assignment)
          await change(
            moveAnswer,
            { answerId: answer.id, topicId: target },
            "updateRetroAnswerTopics",
          );
        else
          await change(
            assignAnswer,
            { answerId: answer.id, questionId, topicId: target },
            "insertRetroAnswerTopics",
          );
        setNotice(`Card ${number} moved to ${columnName(target)}.`);
      } else setNotice(`Card ${number} remains in ${columnName(current)}.`);
    } catch {
      setError(groupingFailed);
      if (onlineManager.isOnline()) await api.invalidate();
    } finally {
      setHeld(null);
      setFocus(focusId);
    }
  }
  function cancelDrag() {
    setFocus(dragging ? dragControlId(dragging) : "board-heading");
    setDragging(null);
    keyboardTarget.current = null;
    setHeld(null);
    setNotice("Move cancelled. No grouping changed.");
    void api.invalidate();
  }
  const dragged = board?.answers.find((a) => a.id === dragging);
  if (query.isPending) return <p role="status">Loading reflection cards…</p>;
  if (!board)
    return (
      <p role="alert">
        {query.isError
          ? readFailed
          : "This board is unavailable. Your access or this question may have changed."}
      </p>
    );
  const columns = [{ id: ungrouped }, ...board.topics];
  // Include retained authors even after their session membership is removed.
  const authors = [
    ...new Map(
      board.answers.flatMap((a) => (a.author ? [[a.author.id, a.author] as const] : [])),
    ).values(),
  ];
  const visibleAnswers =
    selectedParticipants === null
      ? board.answers
      : board.answers.filter(
          (answer) => answer.author && selectedParticipants.includes(answer.author.id),
        );
  return (
    <section className="question-board" aria-labelledby="board-heading" aria-busy={pending}>
      <div className="section-heading">
        <h2 id="board-heading" tabIndex={-1}>
          Reflection board
        </h2>
        <span className="small-label">
          {visibleAnswers.length} of {board.answers.length}{" "}
          {board.answers.length === 1 ? "card" : "cards"}
        </span>
      </div>
      {(authors.length > 0 || selectedParticipants !== null) && (
        <fieldset className="participant-filters">
          <legend>Show cards from · Shift+click for multiple</legend>
          <div className="participant-chips">
            <button
              type="button"
              className="participant-chip participant-chip-all"
              aria-pressed={visibleAnswers.length === board.answers.length}
              disabled={pending || !!dragging}
              onClick={() => setSelectedParticipants(null)}
            >
              Everyone
            </button>
            {authors.map((author) => {
              const name = author.displayName || author.email;
              const selected =
                selectedParticipants === null || selectedParticipants.includes(author.id);
              const count = board.answers.filter(
                (answer) => answer.author?.id === author.id,
              ).length;
              return (
                <button
                  key={author.id}
                  type="button"
                  className="participant-chip"
                  aria-label={author.displayName ? `${name} (${author.email})` : author.email}
                  aria-pressed={selected}
                  title={`${author.email} · Click to select only this person; Shift+click to toggle`}
                  disabled={pending || !!dragging}
                  onClick={(event) => {
                    if (!event.shiftKey) {
                      setSelectedParticipants([author.id]);
                      return;
                    }
                    setSelectedParticipants((current) => {
                      const selection = current ?? authors.map((person) => person.id);
                      return selection.includes(author.id)
                        ? selection.filter((id) => id !== author.id)
                        : [...selection, author.id];
                    });
                  }}
                >
                  <span className="participant-chip-avatar">
                    <ParticipantAvatar name={name} />
                    {selected && (
                      <span className="participant-chip-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </span>
                  <span className="participant-chip-name">{name}</span>
                  <span className="participant-chip-count" aria-hidden="true">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {visibleAnswers.length === 0 && (
        <p className="field-hint">
          {board.answers.length
            ? "All cards are hidden. Select a participant to show their cards."
            : "No reflection cards yet."}
        </p>
      )}
      {!readOnly && (
        <p className="board-help" id="board-help">
          Drag by the grip, or use each card’s Move-to menu. Drop on + to name a new group. On a
          grip, press Space to pick up, arrow keys to choose a column, Space to drop and Escape to
          cancel. On touch, hold the grip to lift.
        </p>
      )}
      {query.isError && (
        <p role="alert">
          {readFailed} {!readOnly && "Grouping is paused until the board reconnects."}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status" aria-label="Board updates" className="form-status">
        {pending ? "Saving grouping…" : notice}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          if (args.pointerCoordinates) return pointerWithin(args);
          // Column centers are unreliable for a 4,000-character card beside an empty
          // column. Keyboard navigation chooses a column explicitly, irrespective of size.
          return keyboardTarget.current ? [{ id: keyboardTarget.current }] : [];
        }}
        accessibility={{
          restoreFocus: false,
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up a card. Use arrow keys to choose a column, Space to drop, or Escape to cancel. You can also use the card’s Move-to menu.",
          },
          announcements: {
            onDragStart: ({ active }) =>
              `Picked up card ${board.answers.findIndex((a) => a.id === active.id) + 1}.`,
            onDragOver: ({ over }) =>
              over ? `Over ${columnName(String(over.id))}.` : "Outside a column. Drop to cancel.",
            onDragEnd: () => "Drag finished. Wait for the grouping result.",
            onDragCancel: () => "Move cancelled.",
          },
        }}
        onDragStart={({ active, activatorEvent }) => {
          keyboardTarget.current =
            activatorEvent instanceof KeyboardEvent
              ? (board.answers.find((answer) => answer.id === active.id)?.assignment?.topicId ??
                ungrouped)
              : null;
          setHeld(board);
          setDragging(String(active.id));
          setError("");
          setNotice("");
        }}
        onDragCancel={cancelDrag}
        onDragEnd={({ active, over }) => {
          keyboardTarget.current = null;
          setDragging(null);
          const answer = board.answers.find((a) => a.id === active.id);
          if (!over || !answer) {
            cancelDrag();
            return;
          }
          if (over.id === newThemeDropId) {
            setHeld(null);
            stageCard(answer.id);
          } else void move(answer, String(over.id), "drag");
        }}
      >
        {!readOnly && (
          <NewThemeEditor
            stagedId={stagedId}
            answer={board.answers.find((answer) => answer.id === stagedId)}
            busy={busy}
            dragging={!!dragging}
            onOpen={() => stageCard("")}
            onCancel={cancelStage}
            onSave={createTheme}
          />
        )}
        <div className="board-layout">
          <div className="board-columns">
            {columns.map((column) => {
              const topic = board.topics.find((t) => t.id === column.id);
              const cards = visibleAnswers.filter(
                (a) => (a.assignment?.topicId ?? ungrouped) === column.id,
              );
              const totalCount = board.answers.filter(
                (a) => (a.assignment?.topicId ?? ungrouped) === column.id,
              ).length;
              return (
                <TopicColumn
                  key={column.id}
                  id={column.id}
                  topic={topic}
                  count={cards.length}
                  totalCount={totalCount}
                  busy={busy || !!dragging}
                  readOnly={readOnly}
                  onRename={(name) =>
                    change(renameTopic, { id: column.id, name }, "updateRetroTopics")
                  }
                  onDelete={() => change(deleteTopic, { id: column.id }, "deleteRetroTopics")}
                >
                  {cards.map((answer) => (
                    <AnswerCard
                      key={answer.id}
                      answer={answer}
                      number={board.answers.findIndex((a) => a.id === answer.id) + 1}
                      topics={board.topics}
                      busy={busy || answer.id === stagedId}
                      readOnly={readOnly}
                      canStage={!stagedId}
                      onNewTheme={() => {
                        if (!dragging) stageCard(answer.id);
                      }}
                      onMove={(target, control) => {
                        if (!dragging) void move(answer, target, control);
                      }}
                    />
                  ))}
                </TopicColumn>
              );
            })}
          </div>
          {!readOnly && (
            <NewThemeStage
              stagedId={stagedId}
              busy={busy}
              dragging={!!dragging}
              onOpen={() => stageCard("")}
            />
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div className="board-card drag-preview" aria-hidden="true">
              <p className="answer-text">{dragged.text}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
