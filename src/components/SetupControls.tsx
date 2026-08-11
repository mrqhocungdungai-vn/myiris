// The SetupPanel's shared presentational controls, split out so more than one
// panel step can render them without importing the panel itself
// (setup-panel-reports-real-permissions D7 — the Permissions step moved to
// PermissionsStep.tsx, and a step importing back from SetupPanel.tsx would be
// a cycle).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";

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

/**
 * An On/Off setting: a labelled switch over `ThemedSelect` with an explanatory
 * note under it.
 *
 * Six settings in `SetupPanel` were the same ~16 lines of JSX differing only in
 * label, note and where the boolean lived — enough that the *order of the
 * options* had already drifted: five rendered Off-then-On and "Interface
 * sounds" alone rendered On-then-Off, with nothing recording why.
 *
 * Unifying them fixes the order at Off-then-On everywhere, which is a small
 * **user-visible change** to that one control's dropdown — the only behavioral
 * change in this extraction, made deliberately rather than preserved with an
 * ordering flag that would have kept an unexplained inconsistency alive.
 *
 * Takes a real `boolean`, not the `"true"`/`"false"` strings the `.env` draft
 * stores, so a caller cannot pass `"false"` and get a truthy switch. The two
 * draft-backed callers convert at the boundary.
 */
export function BooleanSetting({
  label,
  ariaLabel,
  value,
  onChange,
  note,
  disabled = false,
  onLabel = "On",
  offLabel = "Off",
}: {
  label: ReactNode;
  /** Defaults to `label` when it is a plain string. */
  ariaLabel?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  note?: ReactNode;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <label className="setup-field">
      <span>{label}</span>
      <ThemedSelect
        ariaLabel={ariaLabel ?? (typeof label === "string" ? label : "")}
        value={value ? "true" : "false"}
        options={[
          { value: "false", label: offLabel },
          { value: "true", label: onLabel },
        ]}
        onChange={(next) => onChange(next === "true")}
        disabled={disabled}
      />
      {note ? <small className="setup-note">{note}</small> : null}
    </label>
  );
}

/** The result of a connection/credential check, as the two badges render it. */
export type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };

export function TestBadge({ state, okLabel }: { state: TestState; okLabel: string }) {
  if (state.status === "ok") {
    return (
      <span className="setup-result ok">
        <Check size={13} />
        {state.message || okLabel}
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="setup-result err" title={state.message}>
        <X size={13} />
        {state.message || "Failed"}
      </span>
    );
  }
  return null;
}

// Status row for anything that ships *inside* the app — which is now everything
// this panel reports except the credential. There is no command the user could
// run to fix a failure here, so the row never offers one: a copyable "install"
// hint for a bundled component would be actively misleading. A failure means a
// damaged bundle, and the row says exactly that (Bundled / Damaged).
//
// This used to be one of two row components. The other reported the same
// `skillsOk` field under a "Global skills" label and offered a "Copy install
// command" button, from when skills really did live in the user's ~/.claude — so
// the panel showed one state twice, once saying "install these" and once saying
// "Bundled". This row is the only one now.
export function BundledRow({
  label,
  ok,
  detail,
  brokenHint,
}: {
  label: string;
  ok: boolean;
  detail?: string;
  brokenHint?: string;
}) {
  return (
    <div className={`setup-perm ${ok ? "granted" : "denied"}`}>
      <span className="perm-label">
        {label}
        {ok && detail ? <em>{detail}</em> : null}
        {!ok && brokenHint ? <em>{brokenHint}</em> : null}
      </span>
      <span className={`setup-result ${ok ? "ok" : "err"}`}>
        {ok ? <Check size={13} /> : <X size={13} />}
        {ok ? "Bundled" : "Damaged"}
      </span>
    </div>
  );
}
