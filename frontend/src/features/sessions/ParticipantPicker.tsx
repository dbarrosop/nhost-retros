import { useEffect, useId, useRef, useState } from "react";
import { DisclosureChevron } from "../../components/DisclosureChevron";
import { ParticipantAvatar } from "../../components/ParticipantAvatar";
import { changeFailed } from "../../lib/retro-api";
import type { ParticipantAccount } from "./participants-api";

export function ParticipantPicker({
  accounts,
  disabled,
  onAdd,
}: {
  accounts: ParticipantAccount[];
  disabled: boolean;
  onAdd: (account: ParticipantAccount) => Promise<unknown>;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const matches = accounts.filter((account) =>
    `${account.displayName} ${account.email}`.toLocaleLowerCase().includes(needle),
  );
  const active = open ? matches[activeIndex] : undefined;
  const activeId = active ? `${id}-option-${active.id}` : undefined;
  const busy = disabled || pending;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  async function add(account: ParticipantAccount) {
    if (busy || locked.current) return;
    locked.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await onAdd(account);
      setSearch("");
      setOpen(false);
      setActiveIndex(-1);
      setNotice(`${account.displayName || account.email} added.`);
    } catch {
      setError(changeFailed);
      setOpen(true);
    } finally {
      locked.current = false;
      setPending(false);
      input.current?.focus();
    }
  }

  return (
    <div className="text-form participant-picker-field">
      <label htmlFor={id}>Add participant</label>
      <div className="participant-picker" ref={container}>
        <div className="participant-search">
          <svg
            className="participant-search-icon"
            viewBox="0 0 20 20"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            ref={input}
            id={id}
            role="combobox"
            type="text"
            autoComplete="off"
            placeholder="Search by name or email…"
            value={search}
            readOnly={busy}
            aria-disabled={busy}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls={`${id}-options`}
            aria-activedescendant={activeId}
            aria-describedby={`${id}-hint`}
            aria-busy={pending}
            onBlur={(event) => {
              if (!container.current?.contains(event.relatedTarget)) setOpen(false);
            }}
            onFocus={() => {
              if (!busy) setOpen(true);
            }}
            onClick={() => {
              if (!busy) setOpen(true);
            }}
            onChange={(event) => {
              setSearch(event.target.value);
              setActiveIndex(-1);
              setOpen(true);
              setError("");
              setNotice("");
            }}
            onKeyDown={(event) => {
              if (busy) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setActiveIndex(-1);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((current) =>
                  matches.length === 0
                    ? -1
                    : current < 0
                      ? direction > 0
                        ? 0
                        : matches.length - 1
                      : (current + direction + matches.length) % matches.length,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                const choice = active ?? (matches.length === 1 ? matches[0] : undefined);
                if (open && choice) void add(choice);
                else setOpen(true);
              }
            }}
          />
          <DisclosureChevron className="participant-search-chevron" />
        </div>
        {open && (
          <div className="popup-panel participant-options-panel">
            <div
              id={`${id}-options`}
              className="participant-options"
              role="listbox"
              tabIndex={-1}
              aria-label="Available participants"
              aria-busy={pending}
            >
              {matches.map((account, index) => (
                <button
                  className="popup-item"
                  key={account.id}
                  id={`${id}-option-${account.id}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={activeIndex === index}
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void add(account)}
                >
                  <ParticipantAvatar name={account.displayName || account.email} />
                  <span className="participant-label">
                    <span className="participant-name">{account.displayName || account.email}</span>
                    <span className="participant-email">{account.email}</span>
                  </span>
                  <span className="participant-option-add" aria-hidden="true">
                    +
                  </span>
                </button>
              ))}
            </div>
            {matches.length === 0 && (
              <p className="participant-no-options">
                {accounts.length === 0
                  ? "No more verified accounts available."
                  : "No matching participants."}
              </p>
            )}
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className="field-hint">
        Choose an account to add them. New participants need a verified account.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p role="status" aria-label="Participant updates" className="form-status">
        {pending ? "Adding participant…" : notice}
      </p>
    </div>
  );
}
