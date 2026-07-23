import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

// Deck gets an editable textarea (`editable` default true); the HUD passes
// editable=false — its window is click-through except over `.hud-hit`
// islands, incompatible with sustained textarea focus, so editing there is
// by voice only (design.md D7).
export default function ReviewBanner({
  review,
  editable = true,
  onApprove,
  onCancel,
}: {
  review: PendingTaskReview;
  editable?: boolean;
  onApprove: (editedTask?: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(review.task);

  // A new parked brief (supersede, or a fresh park after the last one
  // resolved) always resets the draft to the new task text.
  useEffect(() => {
    setDraft(review.task);
  }, [review.task, review.workstreamId]);

  const edited = editable && draft.trim() !== review.task.trim();

  return (
    <div className="task-review-banner" role="status">
      <div className="task-review-banner-head">
        <FileText size={13} />
        <span>Review before sending{review.agent ? ` · ${review.agent.toUpperCase()}` : ""}</span>
      </div>
      {editable ? (
        <textarea
          className="task-review-textarea"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
        />
      ) : (
        <p className="task-review-text">{review.task}</p>
      )}
      <div className="task-review-actions">
        <button className="task-review-approve" onClick={() => onApprove(edited ? draft : undefined)}>
          Approve
        </button>
        <button className="task-review-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="task-review-hint">
        {editable ? "Edit the brief above, or approve/cancel by voice." : "Approve/cancel here, or revise by voice."}
      </p>
    </div>
  );
}
