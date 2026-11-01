import { type ReactNode, useEffect, useRef } from "react";

export function HeaderMenu({
  className,
  summary,
  children,
}: {
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return (
    <details
      className={`header-menu ${className}`}
      ref={menu}
      onBlur={(event) => {
        // A null target can occur before a pointer click activates a menu link.
        // Keep the link mounted; explicit outside clicks still close the menu.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          event.currentTarget.open = false;
          trigger.current?.focus();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          menu.current.open = false;
          trigger.current?.focus();
        }
      }}
    >
      <summary ref={trigger}>{summary}</summary>
      {children}
    </details>
  );
}
