import type { ComponentPropsWithRef } from "react";

const paths = {
  edit: "m12 4 4 4M4 16l3.5-1L17 5.5 14.5 3 5 12.5 4 16Z",
  delete: "M3 6h14M7 6V3h6v3M5 6l1 11h8l1-11M8 9v5m4-5v5",
  end: "M5 5h10v10H5Z",
  close: "m6 6 8 8M14 6l-8 8",
  board: "M3 4h14v12H3ZM8 4v12m4-12v12",
};
export type ActionIconName = keyof typeof paths;

export function ActionIcon({ name }: { name: ActionIconName }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function IconButton({
  label,
  icon,
  danger = false,
  className = "",
  ...props
}: Omit<ComponentPropsWithRef<"button">, "children" | "aria-label" | "title" | "type"> & {
  label: string;
  icon: ActionIconName;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      type="button"
      className={`icon-button${danger ? " icon-button-danger" : ""}${className ? ` ${className}` : ""}`}
      title={label}
    >
      <ActionIcon name={icon} />
      <span className="sr-only">{label}</span>
    </button>
  );
}
