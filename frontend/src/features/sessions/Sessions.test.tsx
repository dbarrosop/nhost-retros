import { createNhostClient } from "@nhost/nhost-js";
import type { Session } from "@nhost/nhost-js/auth";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../lib/auth";
import { AuthStore } from "../../lib/auth-store";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter } from "../../router";
import type { Answer } from "../answers/api";
import type { Question } from "./api";

const sessionId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
const reflectionQuestions: [Question, Question, Question] = [
  { id: questionId, sessionId, text: "What helped?", createdAt: "2026-10-01T00:00:00Z" },
  {
    id: "33333333-3333-4333-8333-333333333333",
    sessionId,
    text: "What got in the way?",
    createdAt: "2026-10-02T00:00:00Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    sessionId,
    text: "What should we try next?",
    createdAt: "2026-10-03T00:00:00Z",
  },
];
function setup(
  facilitator: boolean,
  path: string,
  withCard = false,
  withEndedSession = false,
  initialQuestions = reflectionQuestions.slice(0, 1),
) {
  const client = createNhostClient({ storage: new MemoryStorage(), configure: [] });
  const session: Session = {
    accessToken: `e30.${btoa(JSON.stringify({ sub: "test", exp: Date.now() / 1000 + 900 }))}.test`,
    refreshToken: "unit-test-only",
    refreshTokenId: "unit-test-only",
    accessTokenExpiresIn: 900,
    user: {
      id: "test",
      email: "test@nhost.io",
      emailVerified: true,
      isAnonymous: false,
      defaultRole: "user",
      roles: facilitator ? ["user", "me", "facilitator"] : ["user", "me"],
      displayName: "Test",
      locale: "en",
      avatarUrl: "",
      createdAt: "",
      phoneNumberVerified: false,
      metadata: {},
    },
  };
  client.sessionStorage.set(session);
  vi.spyOn(client.auth, "refreshToken").mockResolvedValue({
    body: session,
    status: 200,
    headers: new Headers(),
  });
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  const store = new AuthStore(client, queries);
  let ended = false;
  let affected = 1;
  let failedRead = false;
  let failedSessionRead = false;
  let name = "October retrospective";
  let questions = initialQuestions;
  let mutationGate: Promise<void> | undefined;
  const answers = new Map<string, Answer[]>();
  if (withCard)
    answers.set(questionId, [
      {
        id: "answer",
        questionId,
        text: "A saved card",
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
      },
    ]);
  const roles: string[] = [];
  const requests: { query: string; variables: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options: RequestInit) => {
      roles.push((options.headers as Record<string, string>)["x-hasura-role"] ?? "");
      const body = JSON.parse(options.body as string);
      requests.push(body);
      const record = {
        id: sessionId,
        name,
        ended,
        createdAt: "2026-10-01T00:00:00Z",
        questions,
      };
      if (body.query.includes("mutation")) {
        await mutationGate;
        if (body.query.includes("RenameSession") && affected) name = body.variables.name;
        if (body.query.includes("AddAnswer") && affected) {
          const saved = answers.get(body.variables.questionId) ?? [];
          answers.set(body.variables.questionId, [
            ...saved,
            {
              id: `answer-${saved.length + 1}`,
              questionId: body.variables.questionId,
              text: body.variables.text,
              createdAt: "2026-10-01",
              updatedAt: "2026-10-01",
            },
          ]);
        }
        const field = body.query.includes("AddAnswer")
          ? "insertRetroAnswers"
          : body.query.includes("CreateSession")
            ? "insertRetroSessions"
            : body.query.includes("RenameSession")
              ? "updateRetroSessions"
              : body.query.includes("EditQuestion")
                ? "updateRetroQuestions"
                : "insertRetroQuestions";
        return Response.json({ data: { [field]: { affected_rows: affected } } });
      }
      return failedRead || (failedSessionRead && body.query.includes("query Session("))
        ? Response.json({ errors: [{ message: "private engine details" }] })
        : Response.json({
            data: body.query.includes("MyAnswers")
              ? {
                  retroAnswers: answers.get(body.variables.questionId) ?? [],
                }
              : body.query.includes("query QuestionBoard(")
                ? {
                    retroQuestions: [
                      {
                        id: questionId,
                        topics: [{ id: "keep", name: "Keep" }],
                        answers: [],
                      },
                    ],
                  }
                : {
                    retroSessions: [
                      record,
                      ...(withEndedSession && body.query.includes("query Sessions")
                        ? [
                            {
                              id: "33333333-3333-4333-8333-333333333333",
                              name: "September retrospective",
                              ended: true,
                              createdAt: "2026-09-01T00:00:00Z",
                            },
                          ]
                        : []),
                    ],
                  },
          });
    }),
  );
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queries}>
      <AuthProvider store={store}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    queries,
    store,
    client,
    session,
    router,
    roles,
    requests,
    setEnded: () => {
      ended = true;
    },
    setQuestions: (value: Question[]) => {
      questions = value;
    },
    holdMutations: () => {
      let release = () => {};
      mutationGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    zeroRows: () => {
      affected = 0;
    },
    failRead: () => {
      failedRead = true;
    },
    setSessionReadError: (failed: boolean) => {
      failedSessionRead = failed;
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authorized retrospective workspace", () => {
  it("keeps account details in a dismissible menu and preserves sign-out", async () => {
    const app = setup(true, "/facilitate");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Retrospectives", level: 1 });
    expect(screen.queryByText("VERIFIED ACCOUNT")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "The approach" })).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.getByText("Facilitator view", { selector: "summary" })).toBeVisible();
    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    expect(signOutButton).not.toBeVisible();
    expect(signOutButton).toHaveClass("popup-item");
    expect(signOutButton).not.toHaveClass("secondary-button");
    expect(signOutButton.closest(".popup-panel")).toHaveClass("header-menu-panel");
    const account = screen.getByText("Account", { exact: true }).closest("summary");
    if (!account) throw new Error("Account disclosure missing");
    expect(account.querySelector(".disclosure-chevron, svg")).toBeNull();
    await user.click(account);
    expect(screen.getByText("test@nhost.io")).toBeVisible();
    await user.tab();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(account).toHaveFocus();
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeVisible();
    await user.click(account);
    await user.click(screen.getByRole("heading", { name: "Retrospectives", level: 1 }));
    expect(screen.getByRole("button", { name: "Sign out" })).not.toBeVisible();
    await user.click(account);
    const signOut = vi.spyOn(app.store, "signOut").mockResolvedValue();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledOnce();
    app.queries.clear();
  });

  it.each([
    ["/workspace", false],
    [`/sessions/${sessionId}`, false],
    ["/facilitate", true],
    [`/facilitate/${sessionId}`, true],
    [`/facilitate/${sessionId}/questions/${questionId}`, true],
  ] as const)("shows the current view and switches safely from %s", async (path, facilitating) => {
    const app = setup(true, path);
    const user = userEvent.setup();
    const current = facilitating ? "Facilitator view" : "Participant view";
    const other = facilitating ? "Participant view" : "Facilitator view";
    const trigger = await screen.findByText(current, { selector: "summary" });
    expect(trigger).toBeVisible();
    expect(trigger.querySelector("svg.disclosure-chevron")).toHaveAttribute("aria-hidden", "true");
    const otherOption = screen.getByRole("link", { name: other });
    expect(otherOption).not.toBeVisible();
    expect(otherOption).toHaveClass("popup-item");
    expect(otherOption.closest(".popup-panel")).toHaveClass("header-menu-panel");
    await user.click(trigger);
    expect(screen.getByRole("link", { name: current })).toHaveAttribute("aria-current");
    const target = screen.getByRole("link", { name: other });
    expect(target).toBeVisible();
    expect(target).not.toHaveAttribute("aria-current");
    expect(target).toHaveAttribute("href", facilitating ? "/workspace" : "/facilitate");
    await user.click(target);
    await screen.findByRole("heading", { name: "Retrospectives", level: 1 });
    const updated = screen.getByText(other, { selector: "summary" });
    expect(updated).toBeVisible();
    expect(updated).toHaveFocus();
    expect(updated.closest("details")).not.toHaveAttribute("open");
    expect(app.router.state.location.pathname).toBe(facilitating ? "/workspace" : "/facilitate");
    expect(
      app.queries
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[2] === (facilitating ? "user" : "facilitator")),
    ).toBe(true);
    app.queries.clear();
  });

  it.each([false, true])(
    "keeps view options clickable through a transient focus loss (facilitating=%s)",
    async (facilitating) => {
      const app = setup(true, facilitating ? "/facilitate" : "/workspace");
      const user = userEvent.setup();
      const trigger = await screen.findByText(
        facilitating ? "Facilitator view" : "Participant view",
        { selector: "summary" },
      );
      await user.click(trigger);
      // A pointer activation can blur the focused control without a new focus target.
      // Hiding the menu here removes the link before the browser dispatches its click.
      fireEvent.blur(trigger, { relatedTarget: null });
      expect(trigger.closest("details")).toHaveAttribute("open");
      const target = screen.getByRole("link", {
        name: facilitating ? "Participant view" : "Facilitator view",
      });
      expect(target).toBeVisible();
      await user.click(target);
      await waitFor(() =>
        expect(app.router.state.location.pathname).toBe(
          facilitating ? "/workspace" : "/facilitate",
        ),
      );
      expect(
        screen.getByText(facilitating ? "Participant view" : "Facilitator view", {
          selector: "summary",
        }),
      ).toBeVisible();
      expect(trigger.closest("details")).not.toHaveAttribute("open");
      app.queries.clear();
    },
  );

  it("dismisses the view menu with Escape, outside clicks and keyboard focus changes", async () => {
    const app = setup(true, "/workspace");
    const user = userEvent.setup();
    const view = await screen.findByText("Participant view", { selector: "summary" });
    const menu = view.closest("details");
    await user.click(view);
    await user.tab();
    expect(screen.getByRole("link", { name: "Participant view" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(view).toHaveFocus();
    expect(menu).not.toHaveAttribute("open");
    // Native summary Enter/Space activation is covered in the browser check.
    await user.click(view);
    expect(menu).toHaveAttribute("open");
    await user.tab();
    await user.tab();
    await user.tab();
    const account = screen.getByText("Account", { exact: true }).closest("summary");
    expect(account).toHaveFocus();
    expect(menu).not.toHaveAttribute("open");
    await user.click(view);
    await user.click(screen.getByRole("heading", { name: "Retrospectives", level: 1 }));
    expect(menu).not.toHaveAttribute("open");
    await user.click(view);
    if (!account) throw new Error("Account disclosure missing");
    await user.click(account);
    expect(menu).not.toHaveAttribute("open");
    expect(account.closest("details")).toHaveAttribute("open");
    app.queries.clear();
  });

  it("labels participant-only accounts without offering a facilitator switch", async () => {
    const app = setup(false, "/workspace");
    await screen.findByRole("heading", { name: "Retrospectives", level: 1 });
    expect(screen.getByText("Participant view", { exact: true })).toBeVisible();
    expect(screen.getByText("Participant view", { exact: true }).closest("details")).toBeNull();
    expect(screen.queryByText("Facilitator view", { exact: true })).not.toBeInTheDocument();
    app.queries.clear();
  });

  it("puts active retrospectives first and reveals ended ones on request", async () => {
    const app = setup(false, "/workspace", false, true);
    const user = userEvent.setup();
    const active = await screen.findByRole("list", { name: "Active retrospectives" });
    expect(within(active).getByRole("link", { name: /October retrospective/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /September retrospective/ })).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "New retrospective" })).not.toBeInTheDocument();
    const endedToggle = screen.getByText("Ended retrospectives", { exact: true });
    expect(endedToggle.closest("summary")?.querySelector("svg.disclosure-chevron")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await user.click(endedToggle);
    expect(screen.getByRole("link", { name: /September retrospective/ })).toBeVisible();
    await user.click(screen.getByText("Ended retrospectives", { exact: true }));
    expect(screen.getByRole("link", { name: /September retrospective/ })).not.toBeVisible();
    app.queries.clear();
  });

  it("opens creation on demand, preserves failed input, and restores trigger focus", async () => {
    const app = setup(true, "/facilitate");
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "New retrospective" });
    expect(screen.queryByLabelText("Retrospective name")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    const input = screen.getByLabelText("Retrospective name");
    expect(input).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.type(input, "  A focused retrospective  ");
    app.zeroRows();
    await user.click(screen.getByRole("button", { name: "Create retrospective" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This change wasn’t saved");
    expect(input).toHaveValue("  A focused retrospective  ");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    expect(screen.queryByLabelText("Retrospective name")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByLabelText("Retrospective name")).toHaveValue("");
    app.queries.clear();
  });

  it("closes the creation form after a successful explicit facilitator operation", async () => {
    const app = setup(true, "/facilitate");
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "New retrospective" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Retrospective name"), "  Weekly reflection  ");
    await user.click(screen.getByRole("button", { name: "Create retrospective" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Retrospective name")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(
      app.requests.find((request) => request.query.includes("mutation CreateSession"))?.variables,
    ).toEqual({ name: "Weekly reflection" });
    expect(app.roles.every((role) => role === "facilitator")).toBe(true);
    app.queries.clear();
  });

  it("restores an unsaved retrospective name after session reconnection", async () => {
    const app = setup(true, "/facilitate");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New retrospective" }));
    await user.type(screen.getByLabelText("Retrospective name"), "Keep this retrospective draft");
    const refresh = vi
      .mocked(app.client.auth.refreshToken)
      .mockRejectedValue(new TypeError("Offline"));
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000_000);
    await act(async () => {
      await app.store.refresh();
    });
    expect(screen.queryByLabelText("Retrospective name")).not.toBeInTheDocument();
    now.mockRestore();
    refresh.mockResolvedValue({ body: app.session, status: 200, headers: new Headers() });
    await act(async () => {
      await app.store.refresh();
    });
    expect(await screen.findByLabelText("Retrospective name")).toHaveValue(
      "Keep this retrospective draft",
    );
    app.queries.clear();
  });

  it.each([
    [false, "/sessions/not-a-uuid", "Session unavailable"],
    [true, "/facilitate/not-a-uuid", "Session unavailable"],
    [true, `/facilitate/not-a-uuid/questions/${questionId}`, "Session unavailable"],
    [true, `/facilitate/${sessionId}/questions/not-a-uuid`, "Question unavailable"],
  ] as const)(
    "does not query or poll malformed route %s %s",
    async (facilitator, path, heading) => {
      vi.useFakeTimers();
      const app = setup(facilitator, path);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
      expect(app.requests).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(app.requests).toHaveLength(0);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      app.queries.clear();
    },
  );
  it.each([false, true])(
    "retains only unsaved same-account text across JWT expiry/recovery (board=%s)",
    async (board) => {
      const app = setup(
        board,
        board ? `/facilitate/${sessionId}/questions/${questionId}` : `/sessions/${sessionId}`,
        !board,
      );
      const user = userEvent.setup();
      const label = board ? "Theme name" : "New card for question 1";
      if (board) await user.click(await screen.findByRole("button", { name: "New theme" }));
      await screen.findByLabelText(label, { exact: true });
      await waitFor(() => expect(screen.getByLabelText(label, { exact: true })).toBeEnabled());
      await user.type(screen.getByLabelText(label, { exact: true }), "Keep this unsaved thought");
      if (board) {
        await user.click(screen.getByRole("button", { name: "Rename theme Keep" }));
        await user.clear(screen.getByLabelText("Rename theme Keep", { exact: true }));
        await user.type(
          screen.getByLabelText("Rename theme Keep", { exact: true }),
          "Retain my rename",
        );
      } else {
        await user.click(screen.getByRole("button", { name: "Edit card 1 for question 1" }));
        await user.clear(screen.getByLabelText("Edit card 1 for question 1", { exact: true }));
        await user.type(
          screen.getByLabelText("Edit card 1 for question 1", { exact: true }),
          "Retain my edited answer",
        );
      }
      const refresh = vi
        .mocked(app.client.auth.refreshToken)
        .mockRejectedValue(new TypeError("Offline"));
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000_000);
      await act(async () => {
        await app.store.refresh();
      });
      expect(screen.getByText(/Workspace data is paused/)).toBeVisible();
      expect(screen.getByRole("status", { name: "Workspace connection" })).toHaveTextContent(
        "Live updates are paused",
      );
      expect(screen.getByRole("status", { name: "Workspace connection" })).not.toHaveTextContent(
        "changes appear automatically",
      );
      expect(app.queries.getQueryCache().getAll()).toHaveLength(0);
      expect(screen.queryByLabelText(label, { exact: true })).not.toBeInTheDocument();
      now.mockRestore();
      refresh.mockResolvedValue({ body: app.session, status: 200, headers: new Headers() });
      await act(async () => {
        await app.store.refresh();
      });
      expect(await screen.findByLabelText(label, { exact: true })).toHaveValue(
        "Keep this unsaved thought",
      );
      expect(screen.getByRole("status", { name: "Workspace connection" })).toHaveTextContent(
        "Live updates · changes appear automatically",
      );
      if (board)
        expect(screen.getByLabelText("Rename theme Keep", { exact: true })).toHaveValue(
          "Retain my rename",
        );
      else
        expect(
          await screen.findByLabelText("Edit card 1 for question 1", { exact: true }),
        ).toHaveValue("Retain my edited answer");
      app.queries.clear();
    },
  );
  it("clears private role caches on route switches and discards drafts on account/role changes", async () => {
    const app = setup(true, `/facilitate/${sessionId}/questions/${questionId}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New theme" }));
    await user.type(await screen.findByLabelText("Theme name"), "Private facilitator draft");
    await act(async () => {
      await app.router.navigate({ to: "/workspace" });
    });
    await screen.findByRole("heading", { name: "Retrospectives" });
    expect(
      app.queries
        .getQueryCache()
        .getAll()
        .every((q) => q.queryKey[2] === "user"),
    ).toBe(true);
    await act(async () => {
      await app.router.navigate({
        to: "/facilitate/$sessionId/questions/$questionId",
        params: { sessionId, questionId },
      });
    });
    await user.click(await screen.findByRole("button", { name: "New theme" }));
    expect(await screen.findByLabelText("Theme name")).toHaveValue("");
    await user.type(screen.getByLabelText("Theme name"), "Never for the next account");
    const other = structuredClone(app.session);
    if (other.user) {
      other.user.id = "second";
      other.user.email = "second@nhost.io";
    }
    await act(async () => {
      app.client.sessionStorage.set(other);
    });
    await user.click(await screen.findByRole("button", { name: "New theme" }));
    expect(await screen.findByLabelText("Theme name")).toHaveValue("");
    expect(
      app.queries
        .getQueryCache()
        .getAll()
        .every((q) => q.queryKey[1] === "second"),
    ).toBe(true);
    if (other.user) other.user.roles = ["user", "me"];
    await act(async () => {
      app.client.sessionStorage.set(other);
    });
    await screen.findByRole("heading", { name: "Retrospectives" });
    expect(screen.queryByLabelText("Theme name")).not.toBeInTheDocument();
    expect(
      app.queries
        .getQueryCache()
        .getAll()
        .every((q) => q.queryKey[2] === "user"),
    ).toBe(true);
    app.queries.clear();
  });
  it("shows private-card participation without management controls and redirects facilitator guesses", async () => {
    const app = setup(false, `/facilitate/${sessionId}`);
    expect(await screen.findByRole("heading", { name: "Retrospectives", level: 1 })).toBeVisible();
    await userEvent.click(await screen.findByRole("link", { name: /October retrospective/ }));
    expect(await screen.findByRole("heading", { name: "What helped?" })).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /Create session|End session|Edit question|Move/,
      }),
    ).not.toBeInTheDocument();
    expect(app.roles.every((role) => role === "user")).toBe(true);
    app.queries.clear();
  });
  it("redirects participant board deep links before issuing any board request", async () => {
    const app = setup(false, `/facilitate/${sessionId}/questions/${questionId}`);
    await screen.findByRole("heading", { name: "Retrospectives", level: 1 });
    expect(app.requests.some((request) => request.query.includes("query QuestionBoard"))).toBe(
      false,
    );
    expect(app.roles.every((role) => role === "user")).toBe(true);
    app.queries.clear();
  });
  it("keeps the mounted board, focused control and topic drafts through session refetch failure and recovery", async () => {
    const app = setup(true, `/facilitate/${sessionId}/questions/${questionId}`);
    const user = userEvent.setup();
    const board = await screen.findByRole("region", { name: "Reflection board" });
    await user.click(screen.getByRole("button", { name: "New theme" }));
    await user.type(screen.getByLabelText("Theme name"), "My new theme draft");
    await user.click(screen.getByRole("button", { name: "Rename theme Keep" }));
    const rename = screen.getByLabelText("Rename theme Keep", { exact: true });
    await user.clear(rename);
    await user.type(rename, "My rename draft");
    expect(rename).toHaveFocus();

    app.setSessionReadError(true);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load this workspace");
    expect(screen.getByRole("region", { name: "Reflection board" })).toBe(board);
    expect(screen.getByLabelText("Theme name")).toHaveValue("My new theme draft");
    expect(rename).toHaveValue("My rename draft");
    expect(rename).toHaveFocus();
    expect(screen.queryByText("private engine details")).not.toBeInTheDocument();

    app.setSessionReadError(false);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Reflection board" })).toBe(board);
    expect(screen.getByLabelText("Theme name")).toHaveValue("My new theme draft");
    expect(rename).toHaveValue("My rename draft");
    expect(rename).toHaveFocus();
    expect(app.roles.every((role) => role === "facilitator")).toBe(true);
    app.queries.clear();
  });
  it("places named icon actions beside titles and keeps editing and confirmation focus predictable", async () => {
    const app = setup(true, `/facilitate/${sessionId}`),
      user = userEvent.setup();
    const heading = await screen.findByRole("heading", { name: "October retrospective", level: 1 });
    const sessionActions = screen.getByRole("group", { name: "Session actions" });
    expect(sessionActions.parentElement).toContainElement(heading);
    for (const name of ["Rename session", "End session"]) {
      const button = within(sessionActions).getByRole("button", { name });
      expect(button).toHaveAttribute("title", name);
      expect(within(button).getByText(name)).toHaveClass("sr-only");
    }
    const questionHeading = screen.getByRole("heading", { name: "What helped?" });
    const questionActions = screen.getByRole("group", { name: "Actions for question 1" });
    expect(questionActions.parentElement).toContainElement(questionHeading);
    expect(
      within(questionActions).getByRole("link", { name: "Open board for question 1" }),
    ).toHaveTextContent("Open board");
    await user.click(within(sessionActions).getByRole("button", { name: "Rename session" }));
    expect(screen.getByLabelText("Rename session", { exact: true })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(heading).toHaveFocus();
    await user.click(within(questionActions).getByRole("button", { name: "Edit question 1" }));
    expect(screen.getByLabelText("Edit question 1", { exact: true })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(questionHeading).toHaveFocus();
    const end = within(sessionActions).getByRole("button", { name: "End session" });
    await user.click(end);
    const dialog = screen.getByRole("dialog", { name: "End this retrospective?" });
    expect(dialog).toHaveTextContent("Ending is permanent");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(end).toHaveFocus();
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });

  it("sends explicit facilitator operations, validates text, and preserves dirty drafts across refetch/closure", async () => {
    const user = userEvent.setup();
    const app = setup(true, `/facilitate/${sessionId}`);
    await screen.findByRole("heading", { name: "October retrospective", level: 1 });
    await user.click(screen.getByRole("button", { name: "Rename session" }));
    await user.clear(screen.getByLabelText("Rename session", { exact: true }));
    await user.type(
      screen.getByLabelText("Rename session", { exact: true }),
      "  New conversation  ",
    );
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(
      await screen.findByRole("heading", { name: "New conversation", level: 1 }),
    ).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "New conversation", level: 1 })).toHaveFocus(),
    );
    expect(
      app.requests.find((request) => request.query.includes("mutation RenameSession"))?.variables,
    ).toEqual({ id: sessionId, name: "New conversation" });
    await user.click(screen.getByRole("button", { name: "Edit question 1" }));
    const editor = screen.getByLabelText("Edit question 1", { exact: true });
    await user.clear(editor);
    await user.type(editor, "My unsaved question");
    await user.type(screen.getByLabelText("New question", { exact: true }), "New unsaved question");
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(editor).toHaveValue("My unsaved question");
    app.zeroRows();
    await user.click(screen.getByRole("button", { name: "Save question" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This change wasn’t saved");
    expect(editor).toHaveValue("My unsaved question");
    app.failRead();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(editor).toHaveValue("My unsaved question");
    expect(screen.queryByText("private engine details")).not.toBeInTheDocument();
    expect(app.roles.every((role) => role === "facilitator")).toBe(true);
    app.queries.clear();
  });
  it("keeps existing and new question drafts read-only when closure arrives", async () => {
    const user = userEvent.setup();
    const app = setup(true, `/facilitate/${sessionId}`);
    await screen.findByRole("heading", { name: "What helped?" });
    await user.click(screen.getByRole("button", { name: "Edit question 1" }));
    await user.type(screen.getByLabelText("Edit question 1", { exact: true }), " unsaved");
    await user.type(screen.getByLabelText("New question", { exact: true }), "New draft");
    app.setEnded();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Edit question 1", { exact: true })).toBeDisabled(),
    );
    expect(screen.getByLabelText("Edit question 1", { exact: true })).toHaveValue(
      "What helped? unsaved",
    );
    expect(screen.getByLabelText("New question", { exact: true })).toHaveValue("New draft");
    expect(screen.getByLabelText("New question", { exact: true })).toBeDisabled();
    expect(screen.getByText(/permanently read-only/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
    app.queries.clear();
  });
});

describe("focused participant questions", () => {
  async function composer(number: number) {
    const input = await screen.findByLabelText(`New card for question ${number}`, { exact: true });
    await waitFor(() => expect(input).toBeEnabled());
    return input;
  }
  it("shows one question at a time and keeps new and edited drafts when navigating", async () => {
    const app = setup(false, `/sessions/${sessionId}`, true, false, reflectionQuestions);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "What helped?", level: 2 });
    expect(screen.queryByRole("heading", { name: "What got in the way?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(
      app.requests
        .filter((r) => r.query.includes("query MyAnswers"))
        .map((r) => r.variables.questionId),
    ).toEqual([questionId]);
    await user.type(await composer(1), "First unsaved thought");
    await user.click(screen.getByRole("button", { name: "Edit card 1 for question 1" }));
    await user.clear(screen.getByLabelText("Edit card 1 for question 1", { exact: true }));
    await user.type(
      screen.getByLabelText("Edit card 1 for question 1", { exact: true }),
      "An unsaved edit",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    const second = await screen.findByRole("heading", { name: "What got in the way?", level: 2 });
    expect(second).toHaveFocus();
    expect(
      screen.queryByRole("heading", { name: "What helped?", level: 2 }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Question 2 of 3", { selector: "summary" })).toBeVisible();
    await user.type(await composer(2), "Second unsaved thought");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByLabelText("New card for question 1", { exact: true })).toHaveValue(
      "First unsaved thought",
    );
    expect(screen.getByLabelText("Edit card 1 for question 1", { exact: true })).toHaveValue(
      "An unsaved edit",
    );
    expect(screen.getByText("A saved card")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("New card for question 2", { exact: true })).toHaveValue(
      "Second unsaved thought",
    );
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });

  it("jumps using the shared question chooser and supports browser history", async () => {
    const app = setup(false, `/sessions/${sessionId}`, false, false, reflectionQuestions);
    const user = userEvent.setup();
    const chooser = await screen.findByText("Question 1 of 3", { selector: "summary" });
    await user.click(chooser);
    fireEvent.blur(chooser, { relatedTarget: null });
    expect(chooser.closest("details")).toHaveAttribute("open");
    const list = screen.getByRole("list", { name: "Questions" });
    expect(list.closest(".popup-panel")).toBeVisible();
    expect(
      within(list)
        .getAllByRole("button")
        .filter((option) => option.hasAttribute("aria-current")),
    ).toHaveLength(1);
    const third = within(list).getByRole("button", { name: /3\.\s*What should we try next/ });
    expect(third).toHaveClass("popup-item");
    await user.click(third);
    expect(
      await screen.findByRole("heading", { name: "What should we try next?", level: 2 }),
    ).toHaveFocus();
    expect(
      screen.getByText("Question 3 of 3", { selector: "summary" }).closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(app.router.state.location.search).toEqual({ question: reflectionQuestions[2].id });
    await act(async () => {
      app.router.history.back();
    });
    expect(await screen.findByRole("heading", { name: "What helped?", level: 2 })).toHaveFocus();
    await act(async () => {
      app.router.history.forward();
    });
    expect(
      await screen.findByRole("heading", { name: "What should we try next?", level: 2 }),
    ).toBeVisible();
    app.queries.clear();
  });

  it("selects every question by clicking its label and retains drafts", async () => {
    const app = setup(false, `/sessions/${sessionId}`, false, false, reflectionQuestions);
    const user = userEvent.setup();
    await user.type(await composer(1), "Retain this chooser draft");
    for (const index of [1, 2, 0]) {
      await user.click(screen.getByText(/Question \d of 3/, { selector: "summary" }));
      const list = screen.getByRole("list", { name: "Questions" });
      const question = reflectionQuestions[index];
      if (!question) throw new Error("Missing test question");
      const label = within(list).getByText(question.text, { exact: true });
      await user.hover(label);
      await user.click(label);
      expect(await screen.findByRole("heading", { name: question.text, level: 2 })).toHaveFocus();
      expect(app.router.state.location.search).toEqual({ question: question.id });
      expect(
        screen.getByText(`Question ${index + 1} of 3`, { selector: "summary" }).closest("details"),
      ).not.toHaveAttribute("open");
    }
    expect(await composer(1)).toHaveValue("Retain this chooser draft");
    app.queries.clear();
  });

  it("selects a question with the keyboard and dismisses when reselecting the current one", async () => {
    const app = setup(false, `/sessions/${sessionId}`, false, false, reflectionQuestions);
    const user = userEvent.setup();
    const chooser = await screen.findByText("Question 1 of 3", { selector: "summary" });
    await user.click(chooser);
    await user.tab();
    await user.tab();
    const second = within(screen.getByRole("list", { name: "Questions" })).getByRole("button", {
      name: /2\.\s*What got in the way/,
    });
    expect(second).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "What got in the way?", level: 2 }),
    ).toHaveFocus();
    const updated = screen.getByText("Question 2 of 3", { selector: "summary" });
    expect(updated.closest("details")).not.toHaveAttribute("open");
    await user.click(updated);
    await user.click(
      within(screen.getByRole("list", { name: "Questions" })).getByRole("button", {
        name: /2\.\s*What got in the way/,
      }),
    );
    expect(updated.closest("details")).not.toHaveAttribute("open");
    expect(updated).toHaveFocus();
    expect(app.router.state.location.search).toEqual({ question: reflectionQuestions[1].id });
    app.queries.clear();
  });

  it("saves individual cards without auto-advancing and blocks navigation during a save", async () => {
    const app = setup(false, `/sessions/${sessionId}`, false, false, reflectionQuestions);
    const user = userEvent.setup();
    const input = await screen.findByLabelText("New card for question 1", { exact: true });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, "One saved thought");
    const release = app.holdMutations();
    await user.click(screen.getByRole("button", { name: "Add card to question 1" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByText("Question 1 of 3", { selector: "summary" }));
    const option = within(screen.getByRole("list", { name: "Questions" })).getByRole("button", {
      name: /2\.\s*What got in the way/,
    });
    expect(option).toBeDisabled();
    await user.click(option);
    expect(app.router.state.location.search).toEqual({});
    await act(async () => {
      release();
    });
    expect(await screen.findByText("One saved thought")).toBeVisible();
    expect(screen.getByRole("heading", { name: "What helped?", level: 2 })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Previous" }));
    expect(await screen.findByText("One saved thought")).toBeVisible();
    expect(app.roles.every((role) => role === "user")).toBe(true);
    app.queries.clear();
  });

  it("restores the selected question and its drafts after reconnection", async () => {
    const app = setup(
      false,
      `/sessions/${sessionId}?question=${reflectionQuestions[1].id}`,
      false,
      false,
      reflectionQuestions,
    );
    const user = userEvent.setup();
    await user.type(await composer(2), "Keep this second-question draft");
    const refresh = vi
      .mocked(app.client.auth.refreshToken)
      .mockRejectedValue(new TypeError("Offline"));
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_000_000);
    await act(async () => {
      await app.store.refresh();
    });
    expect(
      screen.queryByLabelText("New card for question 2", { exact: true }),
    ).not.toBeInTheDocument();
    now.mockRestore();
    refresh.mockResolvedValue({ body: app.session, status: 200, headers: new Headers() });
    await act(async () => {
      await app.store.refresh();
    });
    expect(await screen.findByLabelText("New card for question 2", { exact: true })).toHaveValue(
      "Keep this second-question draft",
    );
    expect(screen.getByText("Question 2 of 3", { selector: "summary" })).toBeVisible();
    app.queries.clear();
  });

  it("keeps question identity through live updates and falls back safely if it is removed", async () => {
    const app = setup(
      false,
      `/sessions/${sessionId}?question=${reflectionQuestions[1].id}`,
      false,
      false,
      reflectionQuestions,
    );
    const user = userEvent.setup();
    const input = await composer(2);
    await user.type(input, "An undisturbed draft");
    app.setQuestions([reflectionQuestions[2], reflectionQuestions[0], reflectionQuestions[1]]);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.getByText("Question 3 of 3", { selector: "summary" })).toBeVisible(),
    );
    expect(input).toHaveValue("An undisturbed draft");
    expect(input).toHaveFocus();
    app.setQuestions([reflectionQuestions[2], reflectionQuestions[0]]);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(
      await screen.findByRole("heading", { name: "What should we try next?", level: 2 }),
    ).toBeVisible();
    expect(screen.getByText(/That question is no longer available/)).toBeVisible();
    expect(screen.getByText("Question 1 of 2", { selector: "summary" })).toBeVisible();
    app.setQuestions([]);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(await screen.findByRole("heading", { name: "No questions yet" })).toHaveFocus();
    expect(
      screen.queryByRole("navigation", { name: "Question navigation" }),
    ).not.toBeInTheDocument();
    app.queries.clear();
  });

  it("retains hidden drafts as read-only when the retrospective ends", async () => {
    const app = setup(false, `/sessions/${sessionId}`, false, false, reflectionQuestions);
    const user = userEvent.setup();
    await user.type(await composer(1), "First draft before closure");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await composer(2), "Second draft before closure");
    app.setEnded();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.getByLabelText("New card for question 2", { exact: true })).toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: "Previous" }));
    const first = await screen.findByLabelText("New card for question 1", { exact: true });
    expect(first).toHaveValue("First draft before closure");
    expect(first).toBeDisabled();
    expect(screen.getByText("Read-only", { exact: true })).toBeVisible();
    app.queries.clear();
  });

  it("never queries an unknown question from a shared URL", async () => {
    const unknown = "99999999-9999-4999-8999-999999999999";
    const app = setup(
      false,
      `/sessions/${sessionId}?question=${unknown}`,
      false,
      false,
      reflectionQuestions,
    );
    await screen.findByRole("heading", { name: "What helped?", level: 2 });
    await screen.findByLabelText("New card for question 1", { exact: true });
    expect(screen.getByText(/That question is no longer available/)).toBeVisible();
    expect(
      app.requests
        .filter((r) => r.query.includes("query MyAnswers"))
        .every((r) => r.variables.questionId === questionId),
    ).toBe(true);
    app.queries.clear();
  });

  it("handles a single question without a misleading next step", async () => {
    const app = setup(false, `/sessions/${sessionId}`);
    await screen.findByText("Question 1 of 1", { selector: "summary" });
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    app.queries.clear();
  });

  it("leaves the facilitator question overview unchanged", async () => {
    const app = setup(true, `/facilitate/${sessionId}`, false, false, reflectionQuestions);
    for (const question of reflectionQuestions)
      expect(await screen.findByRole("heading", { name: question.text })).toBeVisible();
    expect(screen.getAllByRole("link", { name: /Open board for question/ })).toHaveLength(3);
    expect(
      screen.queryByRole("navigation", { name: "Question navigation" }),
    ).not.toBeInTheDocument();
    expect(app.requests.some((r) => r.query.includes("query MyAnswers"))).toBe(false);
    app.queries.clear();
  });
});
