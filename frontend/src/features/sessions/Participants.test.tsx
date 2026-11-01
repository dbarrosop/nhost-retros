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
  const accounts = [
    { id: "alice", displayName: "Alice Morgan", email: "alice@example.com" },
    { id: "bob", displayName: "Bob Lee", email: "bob@example.com" },
  ];
  const enrolled = new Set<string>();
  let fail = false,
    revoked = false;
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
      if (body.query.includes("mutation")) {
        await gate;
        if (fail) return Response.json({ errors: [{ message: "private database detail" }] });
        const adding = body.query.includes("mutation AddParticipant");
        if (adding) enrolled.add(body.variables.userId);
        else enrolled.delete(body.variables.userId);
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
            : [
                {
                  id: "session",
                  participants: accounts
                    .filter((a) => enrolled.has(a.id))
                    .map((account) => ({ userId: account.id, account })),
                },
              ],
          retroParticipantAccounts: revoked ? [] : accounts,
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
    hold: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

describe("facilitator participant controls", () => {
  it("starts collapsed and keeps a search and live count through toggles", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    const toggle = screen.getByRole("button", { name: /^Participants/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.querySelector("svg.disclosure-chevron")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("combobox", { name: "Add participant" })).not.toBeInTheDocument();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.type(input, "Alice");
    await user.click(toggle);
    expect(screen.queryByRole("combobox", { name: "Add participant" })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(input).toHaveValue("Alice");
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /Alice Morgan/ }));
    await screen.findByRole("button", { name: "Remove alice@example.com" });
    expect(toggle).toHaveTextContent("· 1");
    await user.click(toggle);
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("· 1");
    app.queries.clear();
  });

  it("opens searchable options, adds on selection and removes through an accessible X button", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.click(screen.getByRole("button", { name: /^Participants/ }));
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.click(input);
    expect(input.parentElement?.querySelector("svg.participant-search-chevron")).toHaveClass(
      "disclosure-chevron",
    );
    expect(screen.getAllByRole("option")).toHaveLength(2);
    const option = screen.getByRole("option", { name: /Alice Morgan/ });
    expect(option).toHaveClass("popup-item");
    expect(option.closest(".popup-panel")).toHaveClass("participant-options-panel");
    expect(
      within(screen.getByRole("option", { name: /Alice Morgan/ })).getByText("AM"),
    ).toHaveAttribute("aria-hidden", "true");
    await user.type(input, "mOrGaN");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.click(screen.getByRole("option", { name: /Alice Morgan/ }));
    const remove = await screen.findByRole("button", { name: "Remove alice@example.com" });
    expect(within(remove).getByText("Remove alice@example.com")).toHaveClass("sr-only");
    expect(remove.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(remove).toHaveAttribute("title", "Remove alice@example.com");
    expect(
      within(screen.getByRole("list", { name: "Session participants" })).getByText("AM"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    await user.click(input);
    expect(screen.queryByRole("option", { name: /Alice Morgan/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bob Lee/ })).toBeVisible();
    await user.click(remove);
    expect(screen.getByRole("dialog")).toHaveTextContent("saved responses will remain");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(remove).toHaveFocus();
    await user.click(remove);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Remove alice@example.com" }),
    );
    await screen.findByText("No participants yet.");
    expect(screen.getByRole("button", { name: /^Participants/ })).toHaveFocus();
    expect(app.requests.every((r) => r.role === "facilitator")).toBe(true);
    const mutations = app.requests.filter((r) => r.query.includes("mutation"));
    expect(mutations.map((r) => r.variables)).toEqual([
      { sessionId: "session", userId: "alice" },
      { sessionId: "session", userId: "alice" },
    ]);
    expect(mutations.some((r) => /RetroAnswers/.test(r.query))).toBe(false);
    app.queries.clear();
  });

  it("filters by email and supports arrow keys, Escape and Enter without leaving the input", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.click(screen.getByRole("button", { name: /^Participants/ }));
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.click(input);
    await user.keyboard("{ArrowDown}");
    const first = screen.getByRole("option", { name: /Alice Morgan/ });
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /Bob Lee/ }).id,
    );
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveFocus();
    await user.type(input, "BOB@");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{ArrowUp}{Enter}");
    await screen.findByRole("button", { name: "Remove bob@example.com" });
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(app.requests.filter((r) => r.query.includes("mutation"))).toHaveLength(1);
    app.queries.clear();
  });

  it("does not submit arbitrary text and closes when focus leaves the picker", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.click(screen.getByRole("button", { name: /^Participants/ }));
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.type(input, "not-an-account");
    expect(screen.getByText("No matching participants.")).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await user.keyboard("{Enter}");
    expect(app.requests.some((r) => r.query.includes("mutation"))).toBe(false);
    await user.tab();
    expect(input).toHaveAttribute("aria-expanded", "false");
    app.queries.clear();
  });

  it("guards duplicate selection while an add is pending", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.click(screen.getByRole("button", { name: /^Participants/ }));
    const release = app.hold();
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.click(input);
    await user.click(screen.getByRole("option", { name: /Alice Morgan/ }));
    expect(input).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: /Alice Morgan/ })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(app.requests.filter((r) => r.query.includes("mutation"))).toHaveLength(1);
    await act(async () => release());
    await screen.findByRole("button", { name: "Remove alice@example.com" });
    app.queries.clear();
  });

  it("retains a failed search, sanitizes errors and clears a revoked roster", async () => {
    const app = setup(),
      user = userEvent.setup();
    await screen.findByText("No participants yet.");
    await user.click(screen.getByRole("button", { name: /^Participants/ }));
    app.fail();
    const input = screen.getByRole("combobox", { name: "Add participant" });
    await user.type(input, "Alice");
    await user.click(screen.getByRole("option", { name: /Alice Morgan/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(changeFailed);
    expect(input).toHaveValue("Alice");
    expect(screen.queryByText("private database detail")).not.toBeInTheDocument();
    app.revoke();
    await act(async () => {
      await app.queries.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Add participant" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/alice@example.com/)).not.toBeInTheDocument();
    app.queries.clear();
  });
});
