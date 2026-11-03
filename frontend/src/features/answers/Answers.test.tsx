import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/query-client";
import { Answers } from "./Answers";
import type { Answer } from "./api";

vi.mock("../../lib/auth", () => ({
  useAuth: () => ({
    generation: 1,
    session: { user: { id: "alice" } },
    canQuery: true,
    store: {
      getSnapshot: () => ({
        generation: 1,
        canQuery: true,
        session: { accessToken: "unit-only", user: { id: "alice", roles: ["user"] } },
      }),
    },
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const card = (id: string, text: string): Answer => ({
  id,
  text,
  questionId: "question",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});
function setup(initial = [card("a1", "A quiet place to focus")]) {
  let cards = initial;
  let affected = 1;
  let readError = false;
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
          ? Response.json({ errors: [{ message: "private DB details" }] })
          : Response.json({ data: { retroAnswers: cards } });
      const field = body.query.includes("AddAnswer")
        ? "insertRetroAnswers"
        : body.query.includes("EditAnswer")
          ? "updateRetroAnswers"
          : "deleteRetroAnswers";
      if (affected) {
        if (field === "insertRetroAnswers")
          cards = [...cards, card(`a${cards.length + 1}`, body.variables.text)];
        if (field === "updateRetroAnswers")
          cards = cards.map((c) =>
            c.id === body.variables.id ? { ...c, text: body.variables.text } : c,
          );
        if (field === "deleteRetroAnswers") cards = cards.filter((c) => c.id !== body.variables.id);
      }
      return Response.json({ data: { [field]: { affected_rows: affected } } });
    }),
  );
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  const view = (ended: boolean, readOnly = false) => (
    <QueryClientProvider client={queries}>
      <Answers questionId="question" number={1} ended={ended} readOnly={readOnly} />
    </QueryClientProvider>
  );
  const rendered = render(view(false));
  return {
    requests,
    queries,
    close: () => rendered.rerender(view(true)),
    failRead: () => {
      readError = true;
    },
    zeroRows: () => {
      affected = 0;
    },
    replace: (value: Answer[]) => {
      cards = value;
    },
  };
}

describe("private reflection cards", () => {
  it("adds several trimmed cards, edits only text, and deletes only after confirmation", async () => {
    const app = setup([]),
      user = userEvent.setup();
    const input = await screen.findByLabelText("New card for question 1", { exact: true });
    await waitFor(() => expect(input).toBeEnabled());
    expect(
      app.requests.find((request) => request.query.includes("query MyAnswers"))?.variables,
    ).toEqual({
      questionId: "question",
      authorId: "alice",
    });
    for (const text of ["  First thought  ", "A second thought"]) {
      await user.type(input, text);
      await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
      await waitFor(() => expect(input).toHaveValue(""));
    }
    expect(await screen.findByText("First thought")).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Your reflection cards for question 1" }),
    ).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(app.requests.find((r) => r.query.includes("mutation AddAnswer"))?.variables).toEqual({
      questionId: "question",
      text: "First thought",
    });
    const firstCard = screen.getByRole("article", { name: "Card 1" });
    const actions = within(firstCard).getByRole("group", {
      name: "Actions for card 1 for question 1",
    });
    expect(actions.parentElement).toContainElement(
      within(firstCard).getByRole("heading", { name: "Card 1" }),
    );
    const edit = within(actions).getByRole("button", { name: "Edit card 1 for question 1" });
    expect(edit).toHaveAttribute("title", "Edit card 1 for question 1");
    expect(within(edit).getByText("Edit card 1 for question 1")).toHaveClass("sr-only");
    await user.click(edit);
    expect(screen.getByLabelText("Edit card 1 for question 1", { exact: true })).toHaveFocus();
    await user.clear(screen.getByLabelText("Edit card 1 for question 1", { exact: true }));
    await user.type(
      screen.getByLabelText("Edit card 1 for question 1", { exact: true }),
      "Revised thought",
    );
    await user.click(screen.getByRole("button", { name: "Save card" }));
    expect(await screen.findByText("Revised thought")).toBeVisible();
    await waitFor(() =>
      expect(within(firstCard).getByRole("heading", { name: "Card 1" })).toHaveFocus(),
    );
    expect(app.requests.find((r) => r.query.includes("mutation EditAnswer"))?.variables).toEqual({
      id: "a1",
      text: "Revised thought",
    });
    await user.click(screen.getByRole("button", { name: "Delete card 1 for question 1" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Delete card 1 for question 1" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete card 1 for question 1",
      }),
    );
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(screen.getByText("A second thought")).toBeVisible();
    expect(app.requests.every((r) => r.role === "user")).toBe(true);
    app.queries.clear();
  });
  it("preserves new and edited drafts through refetch, rejected stale writes, read failures and closure", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("A quiet place to focus");
    await user.click(screen.getByRole("button", { name: "Edit card 1 for question 1" }));
    const editor = screen.getByLabelText("Edit card 1 for question 1", { exact: true });
    await user.clear(editor);
    await user.type(editor, "My unsaved card");
    const composer = screen.getByLabelText("New card for question 1", { exact: true });
    await user.type(composer, "Another unsaved observation");
    app.replace([card("a1", "Updated in another tab")]);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(editor).toHaveValue("My unsaved card");
    app.zeroRows();
    await user.click(screen.getByRole("button", { name: "Save card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This change wasn’t saved");
    expect(editor).toHaveValue("My unsaved card");
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    app.failRead();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() => expect(editor).toBeDisabled());
    expect(screen.queryByText("private DB details")).not.toBeInTheDocument();
    app.close();
    expect(editor).toHaveValue("My unsaved card");
    expect(composer).toHaveValue("Another unsaved observation");
    expect(composer).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Delete card 1 for question 1" }),
    ).not.toBeInTheDocument();
    app.queries.clear();
  });
  it("validates whitespace, Unicode code-point boundaries and refuses offline queued writes", async () => {
    const app = setup([]),
      user = userEvent.setup();
    const input = await screen.findByLabelText("New card for question 1", { exact: true });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, " \uFEFF\u3000 ");
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("1–4000");
    const mutations = () => app.requests.filter((r) => r.query.includes("mutation"));
    expect(mutations()).toHaveLength(0);
    // Paste-like input avoids thousands of keyboard events, while exercising the real form.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "😀".repeat(4001) } });
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    expect(mutations()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "😀".repeat(4000) } });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await act(async () => window.dispatchEvent(new Event("offline")));
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This change wasn’t saved");
    expect(mutations()).toHaveLength(0);
    expect(input).toHaveValue("😀".repeat(4000));
    // The event, not navigator's false LAN hint, enables a fresh explicit write.
    await act(async () => window.dispatchEvent(new Event("online")));
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    await waitFor(() => expect(mutations()).toHaveLength(1));
    await waitFor(() => expect(input).toHaveValue(""));
    app.close();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.queryByLabelText("New card for question 1", { exact: true }),
    ).not.toBeInTheDocument();
    app.queries.clear();
  });
});
