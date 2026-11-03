import type { FollowUp } from "./api";
import { ticketUrl } from "./validation";

export function FollowUpDetails({ followUp }: { followUp: FollowUp }) {
  let href: string | null = null;
  try {
    href = ticketUrl(followUp.ticketUrl ?? "");
  } catch {
    // Never render an unsafe external link, even from an unexpected response.
  }
  const owner = followUp.owner;
  return (
    <>
      <p className="follow-up-action">{followUp.action}</p>
      <p className="field-hint">
        Owner:{" "}
        {owner?.displayName
          ? `${owner.displayName} (${owner.email})`
          : owner?.email || "Unavailable account"}
      </p>
      {href ? (
        <a
          className="quiet-link follow-up-ticket"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open ticket ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <p className="field-hint">No ticket linked yet.</p>
      )}
    </>
  );
}
