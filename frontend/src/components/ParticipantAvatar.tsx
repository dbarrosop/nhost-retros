export function ParticipantAvatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/);
  const initials = [words[0] ?? "", words.length > 1 ? (words.at(-1) ?? "") : ""]
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();
  const tone = Array.from(name).reduce((sum, letter) => sum + (letter.codePointAt(0) ?? 0), 0) % 5;
  return (
    <span className={`participant-avatar tone-${tone}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}
