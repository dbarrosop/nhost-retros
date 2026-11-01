import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/query-client";
import { changeFailed } from "../../lib/retro-api";
import { Participants } from "./Participants";

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
  const account = { id: "alice", displayName: "Alice", email: "alice@example.com" };
  let enrolled = false,
    fail = false,
    revoked = false;
  const requests: { query: string; variables: Record<string, string>; role: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      requests.push({
        ...body,
        role: (options.headers as Record<string, string>)["x-hasura-role"],
      });
      if (body.query.includes("mutation")) {
        if (fail) return Response.json({ errors: [{ message: "private database detail" }] });
        const adding = body.query.includes("mutation AddParticipant");
        enrolled = adding;
        return Response.json({
          data: {
            [adding ? "insertRetroSessionParticipants" : "deleteRetroSessionParticipants"]: {
              affected_rows: 1,
            },
          },
        });
      }
      return Response.json({
        data: {
          retroSessions: revoked
            ? []
            : [{ id: "session", participants: enrolled ? [{ userId: account.id, account }] : [] }],
          retroParticipantAccounts: revoked ? [] : [account],
        },
      });
    }),
  );
  const queries = createQueryClient();
  queries.setDefaultOptions({ queries: { retry: false } });
  render(
    <QueryClientProvider client={queries}>
      <Participants sessionId="session" />
    </QueryClientProvider>,
  );
  return {
    queries,
    requests,
    fail: () => {
      fail = true;
    },
    revoke: () => {
      revoked = true;
    },
  };
}

describe("facilitator participant controls", () => {
  it("adds existing accounts and confirms removal without deleting their answers", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.selectOptions(screen.getByLabelText("Add participant"), "alice");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    const remove = await screen.findByRole("button", { name: "Remove alice@example.com" });
    expect(screen.queryByRole("option", { name: /Alice/ })).not.toBeInTheDocument();
    await user.click(remove);
    expect(screen.getByRole("dialog")).toHaveTextContent("saved responses will remain");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(remove).toHaveFocus();
    await user.click(remove);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove alice@example.com" }),
    );
    await screen.findByText("No participants yet.");
    expect(app.requests.every((r) => r.role === "facilitator")).toBe(true);
    const mutations = app.requests.filter((r) => r.query.includes("mutation"));
    expect(mutations.map((r) => r.variables)).toEqual([
      { sessionId: "session", userId: "alice" },
      { sessionId: "session", userId: "alice" },
    ]);
    expect(mutations.some((r) => /RetroAnswers/.test(r.query))).toBe(false);
    app.queries.clear();
  });
  it("retains a failed selection, sanitizes errors and clears a revoked roster", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    app.fail();
    await user.selectOptions(screen.getByLabelText("Add participant"), "alice");
    await user.click(screen.getByRole("button", { name: "Add participant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(changeFailed);
    expect(screen.getByLabelText("Add participant")).toHaveValue("alice");
    expect(screen.queryByText("private database detail")).not.toBeInTheDocument();
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() => expect(screen.queryByLabelText("Add participant")).not.toBeInTheDocument());
    expect(screen.queryByText(/alice@example.com/)).not.toBeInTheDocument();
    app.queries.clear();
  });
});
