import { plainText } from "../../lib/text";

export function ticketUrl(value: string): string | null {
  if (!value.trim()) return null;
  const text = plainText(value, 2048);
  // Deliberately accept ordinary HTTP(S) ticket hosts, not credentials,
  // whitespace, backslashes or executable protocols. The database checks too.
  // Explicit ASCII case pairs avoid Unicode case folding widening the host.
  if (
    !/^[hH][tT][tT][pP][sS]?:\/\/[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?(:[0-9]{1,5})?([/?#][^\s\p{Cc}\\]*)?$/u.test(
      text,
    )
  )
    throw new Error("Use an absolute http:// or https:// ticket link, or leave it empty.");
  return text;
}
