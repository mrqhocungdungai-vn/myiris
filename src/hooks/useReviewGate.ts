import { useEffect, useState } from "react";

// The prompt-review gate: a run parked for the user's approval, the mode that
// decides when parking happens, and the per-verb model popover.
//
// The one rule worth stating, because it is a deliberate *absence*: approving
// or cancelling does **not** optimistically clear `pending`. An edit main
// rejects — empty or whitespace-only — must leave the banner up so the user can
// fix it. The `task_review` sidecar event is the single source of truth for
// when a review actually resolves, and this hook only ever asks.

export type ReviewGate = {
  /** A request a verb parked for Approve/Edit/Cancel, or null. */
  pending: PendingTaskReview | null;
  /** When parking happens: per-verb, always, or never. */
  mode: ReviewMode;
  /** Which verb's model popover is open, or null. */
  modelPopoverVerb: Verb | null;
  /** Main reported a review raised or resolved — the only writer of `pending`. */
  setPending: (review: PendingTaskReview | null) => void;
  /** Main reported the mode, at boot or after a change elsewhere. */
  applyMode: (mode: ReviewMode) => void;
  approve: (editedTask?: string) => Promise<void>;
  cancel: () => Promise<void>;
  setMode: (next: ReviewMode) => Promise<void>;
  openModelPopover: (verb: Verb | null) => void;
  /** Clicking the chip of the verb already showing closes the popover. */
  toggleModelPopover: (verb: Verb) => void;
};

export function useReviewGate({
  hasBridge,
  onError,
}: {
  hasBridge: boolean;
  onError: (message: string) => void;
}): ReviewGate {
  const [pending, setPending] = useState<PendingTaskReview | null>(null);
  const [mode, setModeState] = useState<ReviewMode>("verb");
  const [modelPopoverVerb, setModelPopoverVerb] = useState<Verb | null>(null);

  // A click anywhere but the chip or the popover itself dismisses it.
  useEffect(() => {
    if (!modelPopoverVerb) return;
    function onDocPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".agent-chip-model") || target?.closest(".model-popover")) return;
      setModelPopoverVerb(null);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [modelPopoverVerb]);

  return {
    pending,
    mode,
    modelPopoverVerb,
    setPending,
    applyMode: setModeState,
    openModelPopover: setModelPopoverVerb,
    toggleModelPopover: (verb) => setModelPopoverVerb((current) => (current === verb ? null : verb)),

    async approve(editedTask) {
      if (!hasBridge || !pending) return;
      const result = await window.iris.resolvePromptReview({ action: "approve", editedTask });
      if (result.status === "error") onError(result.error ?? "Could not approve the brief.");
    },

    async cancel() {
      if (!hasBridge || !pending) return;
      const result = await window.iris.resolvePromptReview({ action: "cancel" });
      if (result.status === "error") onError(result.error ?? "Could not cancel the brief.");
    },

    async setMode(next) {
      if (!hasBridge) return;
      const result = await window.iris.setPromptReviewMode(next);
      if (result.status === "error") {
        onError(result.error ?? "Could not change review mode.");
        return;
      }
      setModeState(result.reviewMode);
    },
  };
}
