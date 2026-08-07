// The SetupPanel's shared presentational controls, split out so more than one
// panel step can render them without importing the panel itself
// (setup-panel-reports-real-permissions D7 — the Permissions step moved to
// PermissionsStep.tsx, and a step importing back from SetupPanel.tsx would be
// a cycle).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export type Option = { value: string; label: string };

// Fully themed dropdown (native <select> popups can't be styled to match on macOS).
// The menu is position:fixed off the trigger rect so the panel's scroll/overflow
// never clips it.
export function ThemedSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (btnRef.current?.contains(target) || target.closest(".ts-menu")) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Close when the page/panel scrolls, but NOT when scrolling inside the menu.
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === "function" && target.closest(".ts-menu")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuMax = 260;
    const dropUp = rect.bottom + menuMax > window.innerHeight && rect.top > window.innerHeight - rect.bottom;
    setPos({
      left: rect.left,
      width: rect.width,
      ...(dropUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    setOpen(true);
  }

  return (
    <div className={`ts ${disabled ? "disabled" : ""}`}>
      <button
        ref={btnRef}
        type="button"
        className={`ts-trigger ${open ? "open" : ""}`}
        onClick={toggle}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="ts-value">{current?.label ?? value}</span>
        <ChevronDown size={14} className="ts-chev" />
      </button>
      {open && pos ? (
        <div
          className="ts-menu"
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            top: pos.top,
            bottom: pos.bottom,
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`ts-option ${option.value === value ? "sel" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="setup-section">
      <h3>{title}</h3>
      {hint ? <p className="setup-hint">{hint}</p> : null}
      {children}
    </section>
  );
}
