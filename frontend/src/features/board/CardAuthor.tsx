import { useEffect, useId, useRef, useState } from "react";
import { ParticipantAvatar } from "../../components/ParticipantAvatar";

export function CardAuthor({
  number,
  name,
  email,
}: {
  number: number;
  name: string;
  email?: string;
}) {
  const [open, setOpen] = useState(false);
  const identity = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const showEmail = !!email && email !== name;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!identity.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Hover/blur manage the nested button's tooltip; this container has no action.
    <div
      className="card-identity"
      ref={identity}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        if (!identity.current?.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className="card-number">{String(number).padStart(2, "0")}</span>
      <button
        className="card-author-trigger"
        type="button"
        aria-label={`Author of card ${number}: ${name}${showEmail ? ` (${email})` : ""}`}
        aria-describedby={open ? tooltipId : undefined}
        onFocus={() => setOpen(true)}
        onClick={(event) => {
          // Safari does not focus buttons on pointer activation by default.
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        <ParticipantAvatar name={name} />
      </button>
      {open && (
        <div className="card-author-tooltip" id={tooltipId} role="tooltip">
          <span>{name}</span>
          {showEmail && <span className="card-author-email">{email}</span>}
        </div>
      )}
    </div>
  );
}
