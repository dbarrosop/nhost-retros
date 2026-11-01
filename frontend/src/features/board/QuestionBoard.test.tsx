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
function setup() {
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
      const { name, id, topicId, answerId } = body.variables;
      const fields: Record<string, string> = {
        AddTopic: "insertRetroTopics",
        RenameTopic: "updateRetroTopics",
        DeleteTopic: "deleteRetroTopics",
        AssignAnswer: "insertRetroAnswerTopics",
        MoveAnswer: "updateRetroAnswerTopics",
        UngroupAnswer: "deleteRetroAnswerTopics",
      };
      const operation = Object.keys(fields).find((key) =>
        body.query.includes(`mutation ${key}(`),
      ) as string;
      if (affected) {
        if (operation === "AddTopic") board.topics.push({ id: "new", name });
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
      return Response.json({ data: { [field]: { affected_rows: affected } } });
    }),
  );
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={queries}>
      <DraftProvider>
        <BoardWorkspace sessionId="session" questionId="question" />
      </DraftProvider>
    </QueryClientProvider>,
  );
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

describe("facilitator reflection board", () => {
  it("filters responses by author across topics and keeps grouping scoped to a visible card", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Alice");
    const original = app.current();
    const first = original.answers[0];
    if (!first) throw new Error("Missing fixture card");
    app.replace({
      ...original,
      answers: [
        ...original.answers,
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
    await user.selectOptions(screen.getByLabelText("Filter responses by participant"), "bob");
    expect(screen.queryByText("Make room for focused work")).not.toBeInTheDocument();
    expect(screen.getByText("Bob’s reflection")).toBeVisible();
    expect(screen.getByText("1 of 2 cards")).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Keep" })).getAllByRole("article"),
    ).toHaveLength(1);
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 2 to" }), "improve");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Move card 2 to" })).toHaveValue("improve"),
    );
    expect(app.current().answers[0]?.assignment).toBeNull();
    await user.selectOptions(screen.getByLabelText("Filter responses by participant"), "");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("2 of 2 cards")).toBeVisible();
    app.queries.clear();
  });
  it("discards an abandoned rename when its toggle closes the editor", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Alice");
    const toggle = screen.getByRole("button", { name: "Rename topic Keep" });
    await user.click(toggle);
    const input = screen.getByLabelText("Rename topic Keep", { exact: true });
    await user.clear(input);
    await user.type(input, "Abandoned name");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Rename topic Keep", { exact: true })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByLabelText("Rename topic Keep", { exact: true })).toHaveValue("Keep");
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });
  it("removes a held private snapshot immediately when a successful read loses access", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Alice");
    const release = app.hold();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "keep");
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
    expect(await screen.findByText("Alice")).toBeVisible();
    expect(screen.getByText("alice@nhost.io")).toBeVisible();
    const select = () => screen.getByRole("combobox", { name: "Move card 1 to" });
    for (const [destination, operation] of [
      ["keep", "AssignAnswer"],
      ["improve", "MoveAnswer"],
      ["ungrouped", "UngroupAnswer"],
    ] as const) {
      await user.selectOptions(select(), destination);
      await waitFor(() => expect(select()).toHaveValue(destination));
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
    await screen.findByText("Alice");
    await user.type(screen.getByLabelText("New topic"), "  Celebrate  ");
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    await screen.findByRole("region", { name: "Celebrate" });
    await user.click(screen.getByRole("button", { name: "Rename topic Celebrate" }));
    const input = screen.getByLabelText("Rename topic Celebrate", { exact: true });
    await user.clear(input);
    await user.type(input, "Small wins");
    await user.click(screen.getByRole("button", { name: "Save topic name" }));
    await screen.findByRole("region", { name: "Small wins" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "new");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("new"),
    );
    await user.click(screen.getByRole("button", { name: "Delete topic Small wins" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(app.current().topics.some((t) => t.name === "Small wins")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Delete topic Small wins" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete topic Small wins" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Small wins" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("ungrouped");
    expect(screen.getByRole("heading", { name: "Ungrouped" })).toHaveFocus();
    app.queries.clear();
  });
  it("holds polled replacements during pending moves, then refetches and reports zero-row conflicts accurately", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Alice");
    const release = app.hold();
    const snapshot = app.current();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "keep");
    expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    app.replace({
      ...snapshot,
      topics: [...snapshot.topics, { id: "later", name: "Arrived while moving" }],
    });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(screen.queryByRole("heading", { name: "Arrived while moving" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("ungrouped");
    await act(async () => release());
    await screen.findByRole("heading", { name: "Arrived while moving" });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("keep"),
    );
    app.zero();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "improve");
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("keep");
    expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveFocus();
    app.failRead();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    expect(screen.queryByText("secret database detail")).not.toBeInTheDocument();
    app.queries.clear();
  });
  it("does not queue offline movements or discard a failed topic draft", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("Alice");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "keep");
    expect(await screen.findByRole("alert")).toHaveTextContent(groupingFailed);
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    await user.type(screen.getByLabelText("New topic"), "Keep this theme");
    await user.click(screen.getByRole("button", { name: "Add topic" }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    expect(screen.getByLabelText("New topic")).toHaveValue("Keep this theme");
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    // The navigator hint is still false, but Query's online event allows a new intent.
    await user.selectOptions(screen.getByRole("combobox", { name: "Move card 1 to" }), "keep");
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Move card 1 to" })).toHaveValue("keep"),
    );
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(true);
    app.queries.clear();
  });
});
