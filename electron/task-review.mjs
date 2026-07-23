// Pure validation for the edited brief text on the prompt-review-gate's
// approve path (review #9) — no electron/DOM dependency, so it stays covered
// by Vitest even though the gate itself (main.mjs) is out of the harness.
export const MAX_REVIEW_TASK_LENGTH = 20000;

// `editedTaskRaw == null` means "no edit was made" (voice approve, or a
// deck approve where the textarea was never touched) — fall back to the
// parked brief as-is. An explicitly provided empty/whitespace-only edit is
// refused rather than silently falling back, so a cleared textarea can never
// dispatch a brief the user didn't actually write.
export function resolveApprovedTask(editedTaskRaw, parkedTask, maxLength = MAX_REVIEW_TASK_LENGTH) {
  if (editedTaskRaw == null) return String(parkedTask);
  const trimmed = String(editedTaskRaw).trim();
  if (!trimmed) {
    throw new Error("Edited brief cannot be empty.");
  }
  return trimmed.slice(0, maxLength);
}
