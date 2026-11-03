import { type HTMLAttributes, type ReactNode, useEffect, useRef } from "react";

export function HeaderMenu({
  className,
  summary,
  summaryProps,
  children,
}: {
  className: string;
  summary: ReactNode;
  summaryProps?: HTMLAttributes<HTMLElement>;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const pointerPress = useRef(false);
  const close = () => {
    pointerPress.current = false;
    if (menu.current) menu.current.open = false;
    trigger.current?.focus();
  };

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) {
        pointerPress.current = false;
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("pointerup", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("pointerup", closeOutside);
    };
  }, []);

  return (
    <details
      className={`header-menu ${className}`}
      ref={menu}
      onPointerDownCapture={() => {
        pointerPress.current = true;
      }}
      onPointerCancelCapture={() => {
        pointerPress.current = false;
      }}
      onClickCapture={() => {
        pointerPress.current = false;
      }}
      onBlur={(event) => {
        // Browsers can move focus outside while a pointer is pressing an option.
        // Keep it mounted until click; outside pointer events still dismiss it.
        if (
          !pointerPress.current &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          event.currentTarget.open = false;
      }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          close();
        }
      }}
      onKeyDown={(event) => {
        pointerPress.current = false;
        if (event.key === "Escape" && menu.current?.open) {
          event.preventDefault();
          close();
        }
      }}
    >
      <summary {...summaryProps} ref={trigger}>
        {summary}
      </summary>
      {typeof children === "function" ? children(close) : children}
    </details>
  );
}
