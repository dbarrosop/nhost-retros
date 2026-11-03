import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftProvider } from "../../lib/drafts";
import { createQueryClient } from "../../lib/query-client";
import { type FollowUp, followUpFailed } from "./api";
import { FollowUps } from "./FollowUps";
import { ticketUrl } from "./validation";

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
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const alice = { id: "alice", displayName: "Alice", email: "alice@example.com" };
const bob = { id: "bob", displayName: "Bob", email: "bob@example.com" };
function setup(initial: FollowUp[] = []) {
  let followUps = initial;
  let accounts = [alice, bob];
  let affected = 1,
    readError = false,
    unavailable = false;
  const requests: { query: string; variables: Record<string, string | null>; role: string }[] = [];
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
          ? Response.json({ errors: [{ message: "private engine detail" }] })
          : Response.json({
              data: {
                retroQuestions: unavailable
                  ? []
                  : [
                      {
                        id: "question",
                        followUps: structuredClone(followUps),
                        session: {
                          participants: accounts.map((account) => ({
                            userId: account.id,
                            account,
                          })),
                        },
                      },
                    ],
              },
            });
      const operation = body.query.includes("AddFollowUp(")
        ? "insertRetroFollowUps"
        : body.query.includes("EditFollowUp(")
          ? "updateRetroFollowUps"
          : "deleteRetroFollowUps";
      const { action, ownerId, ticketUrl, id } = body.variables;
      if (affected) {
        if (operation === "insertRetroFollowUps")
          followUps = [
            ...followUps,
            {
              id: `follow-${followUps.length + 1}`,
              action,
              ownerId,
              ticketUrl,
              owner: accounts.find((account) => account.id === ownerId) ?? null,
            },
          ];
        if (operation === "updateRetroFollowUps")
          followUps = followUps.map((item) =>
            item.id === id
              ? {
                  ...item,
                  action,
                  ownerId,
                  ticketUrl,
                  owner: accounts.find((account) => account.id === ownerId) ?? item.owner,
                }
              : item,
          );
        if (operation === "deleteRetroFollowUps")
          followUps = followUps.filter((item) => item.id !== id);
      }
      return Response.json({ data: { [operation]: { affected_rows: affected } } });
    }),
  );
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  const view = render(
    <QueryClientProvider client={queries}>
      <DraftProvider>
        <FollowUps sessionId="session" questionId="question" />
      </DraftProvider>
    </QueryClientProvider>,
  );
  return {
    queries,
    requests,
    remount: () =>
      view.rerender(
        <QueryClientProvider client={queries}>
          <DraftProvider>
            <FollowUps key="recovered" sessionId="session" questionId="question" />
          </DraftProvider>
        </QueryClientProvider>,
      ),
    fail: () => {
      affected = 0;
    },
    recover: () => {
      affected = 1;
      readError = false;
    },
    failRead: () => {
      readError = true;
    },
    revoke: () => {
      unavailable = true;
    },
    removeAlice: () => {
      accounts = [bob];
    },
    updateFollowUp: (id: string, patch: Partial<FollowUp>) => {
      followUps = followUps.map((item) => (item.id === id ? { ...item, ...patch } : item));
    },
  };
}
const saved: FollowUp = {
  id: "follow-1",
  action: "Improve release notes",
  ownerId: alice.id,
  owner: alice,
  ticketUrl: "https://github.com/acme/repo/issues/42",
};

describe("question follow-ups", () => {
  it("restores all unsaved fields and edit mode after a same-account query subtree remount", async () => {
    const app = setup([saved]),
      user = userEvent.setup();
    await screen.findByText(saved.action);
    const compose = within(screen.getByRole("form", { name: "New follow-up" }));
    await user.type(compose.getByLabelText("Action"), "New unsaved action");
    await user.selectOptions(compose.getByLabelText("Owner"), "bob");
    await user.type(
      compose.getByLabelText("Ticket link (optional)"),
      "https://tickets.example.com/43",
    );
    await user.click(screen.getByRole("button", { name: "Edit follow-up 1" }));
    const edit = within(screen.getByRole("form", { name: "Edit follow-up" }));
    await user.type(edit.getByLabelText("Action"), " tomorrow");
    await user.selectOptions(edit.getByLabelText("Owner"), "bob");
    const latestTicket = "https://tickets.example.com/44";
    app.updateFollowUp(saved.id, { action: "Changed elsewhere", ticketUrl: latestTicket });
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    app.remount();
    const restored = within(screen.getByRole("form", { name: "New follow-up" }));
    expect(restored.getByLabelText("Action")).toHaveValue("New unsaved action");
    expect(restored.getByLabelText("Owner")).toHaveValue("bob");
    expect(restored.getByLabelText("Ticket link (optional)")).toHaveValue(
      "https://tickets.example.com/43",
    );
    const restoredEdit = within(screen.getByRole("form", { name: "Edit follow-up" }));
    expect(restoredEdit.getByLabelText("Action")).toHaveValue("Improve release notes tomorrow");
    expect(restoredEdit.getByLabelText("Owner")).toHaveValue("bob");
    expect(restoredEdit.getByLabelText("Ticket link (optional)")).toHaveValue(latestTicket);
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    app.queries.clear();
  });
  it.each(["before", "after"])(
    "preserves concurrent owner and ticket changes when action is edited %s a refetch",
    async (timing) => {
      const app = setup([{ ...saved, ticketUrl: null }]),
        user = userEvent.setup();
      await screen.findByText(saved.action);
      await user.click(screen.getByRole("button", { name: "Edit follow-up 1" }));
      const edit = within(screen.getByRole("form", { name: "Edit follow-up" }));
      if (timing === "before") await user.type(edit.getByLabelText("Action"), " tomorrow");
      const latestTicket = "https://linear.app/acme/issue/ACME-42";
      app.updateFollowUp(saved.id, { ownerId: bob.id, owner: bob, ticketUrl: latestTicket });
      await act(async () => {
        await app.queries.invalidateQueries();
      });
      await waitFor(() => expect(edit.getByLabelText("Owner")).toHaveValue("bob"));
      expect(edit.getByLabelText("Ticket link (optional)")).toHaveValue(latestTicket);
      if (timing === "after") await user.type(edit.getByLabelText("Action"), " tomorrow");
      expect(edit.getByLabelText("Action")).toHaveValue("Improve release notes tomorrow");
      await user.click(edit.getByRole("button", { name: "Save follow-up" }));
      await screen.findByText("Improve release notes tomorrow");
      expect(
        app.requests.find((request) => request.query.includes("mutation EditFollowUp("))?.variables,
      ).toEqual({
        id: saved.id,
        action: "Improve release notes tomorrow",
        ownerId: "bob",
        ticketUrl: latestTicket,
      });
      app.queries.clear();
    },
  );
  it("creates multiple actions, edits/reassigns them and confirms deletion without changing tickets", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No follow-ups yet.");
    const form = within(screen.getByRole("form", { name: "New follow-up" }));
    await user.type(form.getByLabelText("Action"), "  Improve release notes  ");
    await user.selectOptions(form.getByLabelText("Owner"), "alice");
    await user.type(
      form.getByLabelText("Ticket link (optional)"),
      "https://github.com/acme/repo/issues/42",
    );
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    await screen.findByText("Improve release notes");
    expect(
      app.requests.find((request) => request.query.includes("mutation AddFollowUp("))?.variables,
    ).toEqual({
      questionId: "question",
      action: "Improve release notes",
      ownerId: "alice",
      ticketUrl: saved.ticketUrl,
    });
    expect(form.getByLabelText("Action")).toHaveValue("");
    const ticket = screen.getByRole("link", { name: /Open ticket/ });
    expect(ticket).toHaveAttribute("href", saved.ticketUrl);
    expect(ticket).toHaveAttribute("rel", "noopener noreferrer");
    await user.type(form.getByLabelText("Action"), "Document the rollout");
    await user.selectOptions(form.getByLabelText("Owner"), "bob");
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    await screen.findByText("Document the rollout");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Edit follow-up 1" }));
    const edit = within(screen.getByRole("form", { name: "Edit follow-up" }));
    expect(edit.getByLabelText("Action")).toHaveFocus();
    await user.clear(edit.getByLabelText("Action"));
    await user.type(edit.getByLabelText("Action"), "Publish release notes");
    await user.selectOptions(edit.getByLabelText("Owner"), "bob");
    await user.clear(edit.getByLabelText("Ticket link (optional)"));
    await user.click(edit.getByRole("button", { name: "Save follow-up" }));
    await screen.findByText("Publish release notes");
    expect(
      within(screen.getByRole("article", { name: "Follow-up 1" })).getByText(
        "Owner: Bob (bob@example.com)",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /Open ticket/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete follow-up 1" }));
    let dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/external ticket is left unchanged/)).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Publish release notes")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Delete follow-up 1" }));
    dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "Delete follow-up 1" }));
    await waitFor(() =>
      expect(screen.queryByText("Publish release notes")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Follow-ups" })).toHaveFocus();
    expect(app.requests.every((request) => request.role === "facilitator")).toBe(true);
    app.queries.clear();
  });

  it("validates before writing and preserves drafts after zero rows, refetch, offline and read failures", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No follow-ups yet.");
    const form = within(screen.getByRole("form", { name: "New follow-up" }));
    await user.type(form.getByLabelText("Action"), "Next action");
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a current session participant");
    await user.selectOptions(form.getByLabelText("Owner"), "alice");
    await user.type(form.getByLabelText("Ticket link (optional)"), "javascript:alert(1)");
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use an absolute");
    expect(app.requests.some((request) => request.query.includes("mutation"))).toBe(false);
    await user.clear(form.getByLabelText("Ticket link (optional)"));
    app.fail();
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(followUpFailed);
    expect(form.getByLabelText("Action")).toHaveValue("Next action");
    app.recover();
    const count = app.requests.length;
    onlineManager.setOnline(false);
    await user.click(form.getByRole("button", { name: "Add follow-up" }));
    expect(app.requests).toHaveLength(count);
    expect(form.getByLabelText("Owner")).toHaveValue("alice");
    onlineManager.setOnline(true);
    app.failRead();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(form.getByLabelText("Action")).toHaveValue("Next action");
    await waitFor(() =>
      expect(form.getByRole("button", { name: "Add follow-up" })).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    expect(screen.queryByText("private engine detail")).not.toBeInTheDocument();
    app.queries.clear();
  });

  it("retains removed owners, keeps dirty edits across polls and hides revoked question data", async () => {
    const app = setup([saved]),
      user = userEvent.setup();
    await screen.findByText(saved.action);
    app.removeAlice();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(screen.getByText("Owner: Alice (alice@example.com)")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit follow-up 1" }));
    const edit = within(screen.getByRole("form", { name: "Edit follow-up" }));
    await user.type(edit.getByLabelText("Action"), " tomorrow");
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(edit.getByLabelText("Action")).toHaveValue("Improve release notes tomorrow");
    await user.click(edit.getByRole("button", { name: "Save follow-up" }));
    await screen.findByText("Improve release notes tomorrow");
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.queryByText("Improve release notes tomorrow")).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    app.queries.clear();
  });
});

describe("ticket links", () => {
  it.each([
    "javascript:alert(1)",
    "//example.com/1",
    "https://",
    "https://user:password@example.com/1",
    "https://example.com/a b",
    "https://example.com/a\u00A0b",
    "https://example.com/a\uFEFFb",
    "https://example.com/a\u202Fb",
    "https://example.com/a\u2007b",
    "https://example.com/a\u3000b",
    "https://example.com/a\u2028b",
    "https://example.com/a\u0085b",
    "https://example.com/a\u0080b",
    "https://\u017F.com/1",
    "https://\u212A.com/1",
    "https://example.com/\\bad",
    "https://example.com/a\nb",
    `https://example.com/${"a".repeat(2048)}`,
  ])("rejects unsafe or malformed link %s", (value) => expect(() => ticketUrl(value)).toThrow());
  it.each([
    "HTTP://Tickets.Example.COM:8080/42",
    "hTtPs://Tickets.Example.COM/42",
    "https://example.com/café/😀?issue=K#details",
  ])("allows ordinary hosts and Unicode paths in %s", (value) =>
    expect(ticketUrl(value)).toBe(value),
  );
  it("trims optional links and allows platform-independent HTTP(S)", () => {
    expect(ticketUrl(" \uFEFF\u3000")).toBeNull();
    expect(ticketUrl(" https://linear.app/acme/issue/ACME-42?view=all#details ")).toBe(
      "https://linear.app/acme/issue/ACME-42?view=all#details",
    );
    expect(ticketUrl("http://tickets.internal:8080/42")).toBe("http://tickets.internal:8080/42");
  });
});
