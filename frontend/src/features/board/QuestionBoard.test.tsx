import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftProvider } from "../../lib/drafts";
import { createQueryClient } from "../../lib/query-client";
import { type Board, groupingFailed } from "./api";
import { BoardWorkspace } from "./QuestionBoard";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    generation: 1,
    session: { user: { id: "manager" } },
    canQuery: true,
    store: {
      getSnapshot: () => ({
        generation: 1,
        canQuery: true,
        session: {
          accessToken: "unit-only",
          user: { id: "manager", roles: ["user", "facilitator"] },
        },
      }),
    },
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(role: "user" | "facilitator" = "facilitator") {
  let board: Board = {
    id: "question",
    topics: [
      { id: "keep", name: "Keep" },
      { id: "improve", name: "Improve" },
    ],
    answers: [
      {
        id: "answer",
        questionId: "question",
        text: "Make room for focused work",
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
        author: { id: "alice", displayName: "Alice", email: "alice@nhost.io" },
        assignment: null,
      },
    ],
  };
  let affected = 1;
  let writeError = false;
  let createdCount = 0;
  let readError = false;
  let unavailable = false;
  let gate: Promise<void> | undefined;
  const requests: { query: string; variables: Record<string, string>; role: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      requests.push({
        ...body,
        role: (options.headers as Record<string, string>)["x-hasura-role"],
      });
      if (!body.query.includes("mutation"))
        return readError
          ? Response.json({ errors: [{ message: "secret database detail" }] })
          : Response.json({
              data: { retroQuestions: unavailable ? [] : [structuredClone(board)] },
            });
      await gate;
      if (writeError)
        return Response.json({ errors: [{ message: "private nested assignment failure" }] });
      const { name, id, topicId, answerId } = body.variables;
      const fields: Record<string, string> = {
        AddTopic: "insertRetroTopics",
        CreateThemeFromCard: "createdTheme",
        RenameTopic: "updateRetroTopics",
        DeleteTopic: "deleteRetroTopics",
        AssignAnswer: "insertRetroAnswerTopics",
        MoveAnswer: "updateRetroAnswerTopics",
        UngroupAnswer: "deleteRetroAnswerTopics",
      };
      const operation = Object.keys(fields).find((key) =>
        body.query.includes(`mutation ${key}(`),
      ) as string;
      let createdId = "";
      if (affected) {
        if (["AddTopic", "CreateThemeFromCard"].includes(operation)) {
          createdId = createdCount++ === 0 ? "new" : `new-${createdCount}`;
          board.topics.push({ id: createdId, name });
          if (operation === "CreateThemeFromCard")
            board.answers = board.answers.map((answer) =>
              answer.id === answerId ? { ...answer, assignment: { topicId: createdId } } : answer,
            );
        }
        if (operation === "RenameTopic")
          board.topics = board.topics.map((t) => (t.id === id ? { ...t, name } : t));
        if (operation === "DeleteTopic") {
          board.topics = board.topics.filter((t) => t.id !== id);
          board.answers = board.answers.map((a) =>
            a.assignment?.topicId === id ? { ...a, assignment: null } : a,
          );
        }
        if (["AssignAnswer", "MoveAnswer", "UngroupAnswer"].includes(operation))
          board.answers = board.answers.map((answer) =>
            answer.id === answerId
              ? {
                  ...answer,
                  assignment: operation === "UngroupAnswer" ? null : { topicId },
                }
              : answer,
          );
      }
      const field = fields[operation];
      if (!field) throw new Error("Unexpected test mutation");
      return Response.json({
        data: {
          [field]: {
            affected_rows: operation === "CreateThemeFromCard" ? affected * 2 : affected,
            returning: createdId ? [{ id: createdId }] : [],
          },
        },
      });
    }),
  );
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  const view = (visible: boolean) => (
    <QueryClientProvider client={queries}>
      <DraftProvider>
        {visible && <BoardWorkspace sessionId="session" questionId="question" role={role} />}
      </DraftProvider>
    </QueryClientProvider>
  );
  const rendered = render(view(true));
  return {
    queries,
    requests,
    replace: (value: Board) => {
      board = value;
    },
    current: () => structuredClone(board),
    zero: () => {
      affected = 0;
    },
    failWrite: () => {
      writeError = true;
    },
    restoreWrites: () => {
      writeError = false;
    },
    pause: () => rendered.rerender(view(false)),
    resume: () => rendered.rerender(view(true)),
    failRead: () => {
      readError = true;
    },
    revoke: () => {
      unavailable = true;
    },
    hold: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

function moveControl(number: number) {
  return screen.getByLabelText(new RegExp(`^Move card ${number} to `));
}
function destinationName(id: string) {
  return (
    (
      { keep: "Keep", improve: "Improve", ungrouped: "Ungrouped", new: "Small wins" } as Record<
        string,
        string
      >
    )[id] ?? id
  );
}
async function moveCard(
  user: ReturnType<typeof userEvent.setup>,
  number: number,
  destination: string,
) {
  const trigger = moveControl(number);
  await user.click(trigger);
  const menu = trigger.closest("details");
  if (!menu) throw new Error("Move menu missing");
  await user.click(within(menu).getByRole("button", { name: destinationName(destination) }));
}

describe("facilitator reflection board", () => {
  it("renders a participant board without mutation controls and removes it on access loss", async () => {
    const app = setup("user"),
      user = userEvent.setup();
    expect(await screen.findByRole("article", { name: "Card 1 by Alice" })).toHaveTextContent(
      "Make room for focused work",
    );
    expect(screen.getByRole("heading", { name: "Keep" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Drag card|Rename theme|Delete theme|New theme/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Move card/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Alice (alice@nhost.io)" }));
    expect(screen.getByRole("article", { name: "Card 1 by Alice" })).toBeVisible();
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() => expect(screen.queryByRole("article")).not.toBeInTheDocument());
    expect(
      app.requests.every(
        (request) => request.role === "user" && !request.query.includes("mutation"),
      ),
    ).toBe(true);
    app.queries.clear();
  });
  it("filters responses by author across topics and keeps grouping scoped to a visible card", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    const original = app.current();
    const first = original.answers[0];
    if (!first) throw new Error("Missing fixture card");
    app.replace({
      ...original,
      answers: [
        ...original.answers,
        {
          ...first,
          id: "alice-topic-answer",
          text: "Alice’s topic reflection",
          assignment: { topicId: "keep" },
        },
        {
          ...first,
          id: "bob-answer",
          text: "Bob’s reflection",
          author: { id: "bob", displayName: "Bob", email: "bob@example.com" },
          assignment: { topicId: "keep" },
        },
      ],
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await screen.findByText("Bob’s reflection");
    await user.click(screen.getByRole("button", { name: "Bob (bob@example.com)" }));
    expect(screen.queryByText("Make room for focused work")).not.toBeInTheDocument();
    expect(screen.getByText("Bob’s reflection")).toBeVisible();
    expect(screen.queryByText("Alice’s topic reflection")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 cards")).toBeVisible();
    const keep = within(screen.getByRole("region", { name: "Keep" }));
    const ungrouped = within(screen.getByRole("region", { name: "Ungrouped" }));
    const improve = within(screen.getByRole("region", { name: "Improve" }));
    expect(keep.getAllByRole("article")).toHaveLength(1);
    const count = keep.getByText("1 of 2");
    expect(count).toHaveTextContent("1 of 2 cards");
    expect(count.parentElement).toContainElement(keep.getByRole("heading", { name: "Keep" }));
    expect(count.closest(".title-actions")).toBeNull();
    expect(ungrouped.getByText("0 of 1")).toHaveTextContent("0 of 1 card");
    expect(
      ungrouped.getByText("No cards from the selected participants here (1 hidden by the filter)."),
    ).toBeVisible();
    expect(ungrouped.queryByText("All reflections have a place.")).not.toBeInTheDocument();
    expect(improve.getByText("0", { exact: true })).toHaveTextContent("0 cards");
    expect(improve.getByText("Move a card here to start a theme.")).toBeVisible();
    expect(keep.getByRole("button", { name: "Rename theme Keep" })).toBeEnabled();
    await user.click(keep.getByRole("button", { name: "Delete theme Keep" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 cards will move to Ungrouped.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await moveCard(user, 3, "improve");
    await waitFor(() => expect(moveControl(3)).toHaveTextContent(destinationName("improve")));
    expect(keep.getByText("0 of 1")).toHaveTextContent("0 of 1 card");
    expect(
      keep.getByText("No cards from the selected participants here (1 hidden by the filter)."),
    ).toBeVisible();
    expect(keep.queryByText("Move a card here to start a theme.")).not.toBeInTheDocument();
    expect(app.current().answers[0]?.assignment).toBeNull();
    expect(app.current().answers[1]?.assignment?.topicId).toBe("keep");
    await user.click(screen.getByRole("button", { name: "Everyone" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByText("3 of 3 cards")).toBeVisible();
    for (const column of [keep, ungrouped, improve]) {
      const count = column.getByText("1", { exact: true });
      expect(count).toHaveTextContent("1 card");
      expect(count.parentElement).toContainElement(column.getByRole("heading", { level: 2 }));
      expect(column.queryByText(/hidden by the filter/)).not.toBeInTheDocument();
    }
    app.queries.clear();
  });
  it("selects exclusively on click, toggles with Shift and restores everyone without writing data", async () => {
    const app = setup(),
      user = userEvent.setup();
    const shiftClick = async (chip: HTMLElement) => {
      await user.keyboard("{Shift>}");
      await user.click(chip);
      await user.keyboard("{/Shift}");
    };
    await screen.findByText("Make room for focused work");
    const original = app.current();
    const first = original.answers[0];
    if (!first) throw new Error("Missing fixture card");
    app.replace({
      ...original,
      answers: [
        first,
        {
          ...first,
          id: "bob",
          text: "Bob’s card",
          author: { id: "bob", displayName: "Bob", email: "bob@example.com" },
        },
        {
          ...first,
          id: "cara",
          text: "Cara’s card",
          author: { id: "cara", displayName: "Cara", email: "cara@example.com" },
        },
      ],
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    const alice = screen.getByRole("button", { name: "Alice (alice@nhost.io)" });
    const bob = await screen.findByRole("button", { name: "Bob (bob@example.com)" });
    const cara = screen.getByRole("button", { name: "Cara (cara@example.com)" });
    const everyone = screen.getByRole("button", { name: "Everyone" });
    for (const chip of [alice, bob, cara, everyone])
      expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(within(alice).getByText("A")).toHaveAttribute("aria-hidden", "true");
    await shiftClick(cara);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(cara).toHaveAttribute("aria-pressed", "false");
    expect(everyone).toHaveAttribute("aria-pressed", "false");
    await user.click(alice);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Make room for focused work")).toBeVisible();
    expect(bob).toHaveAttribute("aria-pressed", "false");
    await user.click(alice);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(alice).toHaveAttribute("aria-pressed", "true");
    await user.click(bob);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Bob’s card")).toBeVisible();
    expect(alice).toHaveAttribute("aria-pressed", "false");
    await shiftClick(alice);
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(alice).toHaveAttribute("aria-pressed", "true");
    expect(bob).toHaveAttribute("aria-pressed", "true");
    expect(cara).toHaveAttribute("aria-pressed", "false");
    await shiftClick(bob);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Make room for focused work")).toBeVisible();
    await shiftClick(alice);
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText(/All cards are hidden/)).toBeVisible();
    await shiftClick(cara);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Cara’s card")).toBeVisible();
    await user.click(everyone);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    alice.focus();
    await user.keyboard(" ");
    expect(alice).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 of 3 cards")).toBeVisible();
    bob.focus();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(screen.getByText("2 of 3 cards")).toBeVisible();
    await user.click(cara);
    expect(screen.getByText("1 of 3 cards")).toBeVisible();
    expect(screen.getByText("Cara’s card")).toBeVisible();
    const current = app.current();
    app.replace({
      ...current,
      answers: [
        ...current.answers,
        {
          ...first,
          id: "dave",
          text: "Dave’s new card",
          author: { id: "dave", displayName: "Dave", email: "dave@example.com" },
        },
      ],
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("button", { name: "Dave (dave@example.com)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("1 of 4 cards")).toBeVisible();
    await user.click(everyone);
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });

  it("keeps Everyone available if the selected author becomes unavailable", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await user.click(screen.getByRole("button", { name: "Alice (alice@nhost.io)" }));
    const current = app.current();
    app.replace({
      ...current,
      answers: current.answers.map((answer) => ({ ...answer, author: null })),
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Alice (alice@nhost.io)" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    const everyone = screen.getByRole("button", { name: "Everyone" });
    expect(everyone).toHaveAttribute("aria-pressed", "false");
    await user.click(everyone);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Make room for focused work")).toBeVisible();
    app.queries.clear();
  });

  it("discards an abandoned rename when its toggle closes the editor", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    const toggle = screen.getByRole("button", { name: "Rename theme Keep" });
    await user.click(toggle);
    const input = screen.getByLabelText("Rename theme Keep", { exact: true });
    await user.clear(input);
    await user.type(input, "Abandoned name");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Rename theme Keep", { exact: true })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByLabelText("Rename theme Keep", { exact: true })).toHaveValue("Keep");
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });
  it("removes a held private snapshot immediately when a successful read loses access", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    const release = app.hold();
    await moveCard(user, 1, "keep");
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This board is unavailable");
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Make room for focused work")).not.toBeInTheDocument();
    await act(async () => release());
    app.queries.clear();
  });
  it("shows authors and explicitly assigns, moves and ungroups without any content write", async () => {
    const app = setup(),
      user = userEvent.setup();
    const card = within(await screen.findByRole("article"));
    expect(card.queryByText("alice@nhost.io")).not.toBeInTheDocument();
    await user.click(card.getByRole("button", { name: /^Author of card 1:/ }));
    expect(within(screen.getByRole("tooltip")).getByText("Alice")).toBeVisible();
    expect(screen.getByText("alice@nhost.io")).toBeVisible();
    await user.keyboard("{Escape}");
    const select = () => moveControl(1);
    expect(select().closest(".card-actions")?.lastElementChild).toBe(
      card.getByRole("button", { name: "Drag card 1" }),
    );
    for (const [destination, operation] of [
      ["keep", "AssignAnswer"],
      ["improve", "MoveAnswer"],
      ["ungrouped", "UngroupAnswer"],
    ] as const) {
      await moveCard(user, 1, destination);
      await waitFor(() => expect(select()).toHaveTextContent(destinationName(destination)));
      await waitFor(() => expect(select()).toHaveFocus());
      expect(app.requests.some((r) => r.query.includes(`mutation ${operation}`))).toBe(true);
    }
    expect(screen.getByRole("status", { name: "Board updates" })).toHaveTextContent(
      "Card 1 moved to Ungrouped",
    );
    expect(app.requests.every((r) => r.role === "facilitator")).toBe(true);
    const writes = app.requests.filter((r) => r.query.includes("mutation"));
    expect(writes.every((r) => !/text|authorId|updatedAt/.test(JSON.stringify(r.variables)))).toBe(
      true,
    );
    expect(app.current().answers[0]?.text).toBe("Make room for focused work");
    app.queries.clear();
  });
  it("creates/renames themes and confirms deletion that returns cards to Ungrouped", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await user.click(screen.getByRole("button", { name: "New theme" }));
    await user.type(screen.getByLabelText("Theme name"), "  Celebrate  ");
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    await screen.findByRole("region", { name: "Celebrate" });
    await user.click(screen.getByRole("button", { name: "Rename theme Celebrate" }));
    const input = screen.getByLabelText("Rename theme Celebrate", { exact: true });
    await user.clear(input);
    await user.type(input, "Small wins");
    await user.click(screen.getByRole("button", { name: "Save theme name" }));
    await screen.findByRole("region", { name: "Small wins" });
    await moveCard(user, 1, "new");
    await waitFor(() => expect(moveControl(1)).toHaveTextContent(destinationName("new")));
    await user.click(screen.getByRole("button", { name: "Delete theme Small wins" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("1 card will move to Ungrouped.");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(app.current().topics.some((t) => t.name === "Small wins")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Delete theme Small wins" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete theme Small wins" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Small wins" })).not.toBeInTheDocument(),
    );
    expect(moveControl(1)).toHaveTextContent(destinationName("ungrouped"));
    expect(screen.getByRole("heading", { name: "Ungrouped" })).toHaveFocus();
    app.queries.clear();
  });
  it("holds polled replacements during pending moves, then refetches and reports zero-row conflicts accurately", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    const release = app.hold();
    const snapshot = app.current();
    await moveCard(user, 1, "keep");
    expect(moveControl(1)).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Everyone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Alice (alice@nhost.io)" })).toBeDisabled();
    app.replace({
      ...snapshot,
      topics: [...snapshot.topics, { id: "later", name: "Arrived while moving" }],
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(screen.queryByRole("heading", { name: "Arrived while moving" })).not.toBeInTheDocument();
    expect(moveControl(1)).toHaveTextContent(destinationName("ungrouped"));
    await act(async () => release());
    await screen.findByRole("heading", { name: "Arrived while moving" });
    await waitFor(() => expect(moveControl(1)).toHaveTextContent(destinationName("keep")));
    app.zero();
    await moveCard(user, 1, "improve");
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(moveControl(1)).toHaveTextContent(destinationName("keep"));
    expect(moveControl(1)).toHaveFocus();
    app.failRead();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() => expect(moveControl(1)).toHaveAttribute("aria-disabled", "true"));
    expect(screen.queryByText("secret database detail")).not.toBeInTheDocument();
    app.queries.clear();
  });
  it("does not queue offline movements or discard a failed topic draft", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    await moveCard(user, 1, "keep");
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "New theme" }));
    await user.type(screen.getByLabelText("Theme name"), "Keep this theme");
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(screen.getByLabelText("Theme name")).toHaveValue("Keep this theme");
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    // The navigator hint is still false, but Query's online event allows a new intent.
    await moveCard(user, 1, "keep");
    await waitFor(() => expect(moveControl(1)).toHaveTextContent(destinationName("keep")));
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(true);
    app.queries.clear();
  });
});

async function stageFromMenu(user: ReturnType<typeof userEvent.setup>, number = 1) {
  const trigger = moveControl(number);
  await user.click(trigger);
  const menu = trigger.closest("details");
  if (!menu) throw new Error("Move menu missing");
  await user.click(within(menu).getByRole("button", { name: "New theme…" }));
}

describe("new theme staging", () => {
  it("uses a plus-only rail and expands the editor before, not inside, the card grid", async () => {
    const app = setup(),
      user = userEvent.setup();
    const rail = await screen.findByRole("region", { name: "New theme staging area" });
    const add = within(rail).getByRole("button", { name: "New theme" });
    expect(add.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(within(rail).queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Theme name")).not.toBeInTheDocument();
    await user.click(add);
    const editor = screen.getByRole("region", { name: "New theme" });
    const layout = rail.parentElement;
    expect(layout).toHaveClass("board-layout");
    expect(layout).not.toContainElement(editor);
    expect(
      editor.compareDocumentPosition(layout as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Theme name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(add).toHaveFocus();
    app.queries.clear();
  });

  it("keeps the staged card and name when the plus is activated again", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "Keep this staged card");
    await user.click(screen.getByRole("button", { name: "New theme" }));
    expect(screen.getByLabelText("Theme name")).toHaveFocus();
    expect(screen.getByLabelText("Theme name")).toHaveValue("Keep this staged card");
    expect(screen.getByRole("button", { name: "Drag card 1" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    await screen.findByRole("region", { name: "Keep this staged card" });
    expect(
      app.requests.find((request) => request.query.includes("mutation CreateThemeFromCard"))
        ?.variables.answerId,
    ).toBe("answer");
    app.queries.clear();
  });

  it("uses a centered decorative SVG grip and a shared move popup", async () => {
    const app = setup(),
      user = userEvent.setup();
    const grip = await screen.findByRole("button", { name: "Drag card 1" });
    const icon = grip.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("viewBox", "0 0 20 20");
    const dots = [...grip.querySelectorAll("circle")];
    expect(dots).toHaveLength(6);
    expect(dots.reduce((sum, dot) => sum + Number(dot.getAttribute("cx")), 0) / 6).toBe(10);
    expect(dots.reduce((sum, dot) => sum + Number(dot.getAttribute("cy")), 0) / 6).toBe(10);
    await user.click(moveControl(1));
    const menu = moveControl(1).closest("details");
    if (!menu) throw new Error("Move menu missing");
    expect(within(menu).getByRole("button", { name: "Keep" })).toHaveClass("popup-item");
    expect(menu.querySelector(".popup-panel")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(moveControl(1)).toHaveFocus();
    app.queries.clear();
  });

  it("stages without writing, then creates and groups in one operation", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    const original = app.current().answers[0];
    await stageFromMenu(user);
    const input = screen.getByLabelText("Theme name");
    expect(input).toHaveFocus();
    expect(
      within(screen.getByRole("region", { name: "Ungrouped" })).getByRole("article"),
    ).toBeVisible();
    expect(app.current().answers[0]?.assignment).toBeNull();
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    expect(screen.getByRole("button", { name: "Drag card 1" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.type(input, "  Focus time  ");
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    const theme = await screen.findByRole("region", { name: "Focus time" });
    expect(within(theme).getByRole("article")).toBeVisible();
    expect(within(theme).getByRole("heading", { name: "Focus time" })).toHaveFocus();
    expect(screen.queryByLabelText("Theme name")).not.toBeInTheDocument();
    const writes = app.requests.filter((r) => r.query.includes("mutation"));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.query).toContain("mutation CreateThemeFromCard");
    expect(writes[0]?.variables).toEqual({
      questionId: "question",
      answerId: "answer",
      name: "Focus time",
    });
    expect(app.current().answers[0]).toEqual({ ...original, assignment: { topicId: "new" } });
    app.queries.clear();
  });

  it("cancels without changing grouping and discards the abandoned theme name", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "Abandoned theme");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    expect(app.current().answers[0]?.assignment).toBeNull();
    expect(moveControl(1)).toHaveFocus();
    expect(screen.getByRole("button", { name: "Drag card 1" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "New theme" }));
    expect(screen.getByLabelText("Theme name")).toHaveValue("");
    app.queries.clear();
  });

  it("keeps the original assignment and name when creation fails, then supports an explicit retry", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await moveCard(user, 1, "keep");
    await waitFor(() => expect(moveControl(1)).toHaveTextContent("Keep"));
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "Retry this theme");
    app.failWrite();
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(screen.getByLabelText("Theme name")).toHaveValue("Retry this theme");
    expect(app.current().answers[0]?.assignment?.topicId).toBe("keep");
    expect(app.current().topics.some((topic) => topic.name === "Retry this theme")).toBe(false);
    expect(screen.queryByText("private nested assignment failure")).not.toBeInTheDocument();
    app.restoreWrites();
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    expect(await screen.findByRole("region", { name: "Retry this theme" })).toBeVisible();
    expect(app.current().answers[0]?.assignment?.topicId).toBe("new");
    app.queries.clear();
  });

  it("restores the staged target and name across a temporary query-subtree remount", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "Keep the staging draft");
    app.pause();
    expect(screen.queryByLabelText("Theme name")).not.toBeInTheDocument();
    app.resume();
    expect(await screen.findByLabelText("Theme name")).toHaveValue("Keep the staging draft");
    expect(screen.getByRole("button", { name: "Drag card 1" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    await screen.findByRole("region", { name: "Keep the staging draft" });
    expect(
      app.requests.find((r) => r.query.includes("mutation CreateThemeFromCard"))?.variables
        .answerId,
    ).toBe("answer");
    app.queries.clear();
  });

  it("does not silently create an empty theme if the staged card disappears", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "A retained name");
    app.replace({ ...app.current(), answers: [] });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "staged card is no longer available",
    );
    expect(screen.getByLabelText("Theme name")).toHaveValue("A retained name");
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Continue without the card" }));
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    await screen.findByRole("region", { name: "A retained name" });
    expect(app.requests.find((r) => r.query.includes("mutation"))?.query).toContain(
      "mutation AddTopic",
    );
    app.queries.clear();
  });

  it("hides staged private content immediately when access disappears during creation", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Make room for focused work");
    await stageFromMenu(user);
    await user.type(screen.getByLabelText("Theme name"), "Private theme draft");
    const release = app.hold();
    await user.click(screen.getByRole("button", { name: "Create theme" }));
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("This board is unavailable");
    expect(screen.queryByText("Make room for focused work")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    await act(async () => {
      release();
    });
    app.queries.clear();
  });
});
