import { createNhostClient } from "@nhost/nhost-js";
import type { Session } from "@nhost/nhost-js/auth";
import { MemoryStorage } from "@nhost/nhost-js/session";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../lib/auth";
import { AuthStore } from "../../lib/auth-store";
import { createQueryClient } from "../../lib/query-client";
import { createAppRouter } from "../../router";

const sessionId = "11111111-1111-4111-8111-111111111111";
const questionId = "22222222-2222-4222-8222-222222222222";
function setup(facilitator: boolean, path: string) {
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
  let name = "October retrospective";
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
        questions: [
          { id: questionId, sessionId, text: "What helped?", createdAt: "2026-10-01T00:00:00Z" },
        ],
      };
      if (body.query.includes("mutation")) {
        if (body.query.includes("RenameSession") && affected) name = body.variables.name;
        const field = body.query.includes("RenameSession")
          ? "updateRetroSessions"
          : body.query.includes("EditQuestion")
            ? "updateRetroQuestions"
            : "insertRetroQuestions";
        return Response.json({ data: { [field]: { affected_rows: affected } } });
      }
      return failedRead
        ? Response.json({ errors: [{ message: "private engine details" }] })
        : Response.json({ data: { retroSessions: [record] } });
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
    roles,
    requests,
    setEnded: () => {
      ended = true;
    },
    zeroRows: () => {
      affected = 0;
    },
    failRead: () => {
      failedRead = true;
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authorized retrospective workspace", () => {
  it("shows participant reads without unfinished controls and redirects facilitator guesses", async () => {
    const app = setup(false, `/facilitate/${sessionId}`);
    expect(
      await screen.findByRole("heading", { name: "Welcome to the team space." }),
    ).toBeVisible();
    await userEvent.click(await screen.findByRole("link", { name: /October retrospective/ }));
    expect(await screen.findByRole("heading", { name: "What helped?" })).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /Create session|End session|Edit question|Move|Answer/,
      }),
    ).not.toBeInTheDocument();
    expect(app.roles.every((role) => role === "user")).toBe(true);
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
