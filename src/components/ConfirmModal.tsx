import { useEffect } from "react";

// Non-blocking replacement for window.confirm: a native confirm() dialog
// halts the renderer event loop (rAF, audio scheduling, gesture tracking)
// until dismissed. This overlay keeps the loop running while the user decides.
export default function ConfirmModal({
  message,
  onResolve,
}: {
  message: string;
  onResolve: (ok: boolean) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onResolve(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return (
    <div
      className="confirm-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <div className="confirm-card">
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="setup-btn ghost" onClick={() => onResolve(false)}>
            Cancel
          </button>
          <button className="setup-btn primary" onClick={() => onResolve(true)}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
