import type { CSSProperties } from "react";
import { Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { MODEL_CHOICES, VERB_COLORS, VERB_LABELS, modelLabel } from "../lib/verbs";

// Review-gate mode control (prompt-review-gate spec). Three settings, cycled in
// place: `verb` (the default — park what the registry declares as reviewed),
// `always`, and `never`. The middle setting exists because "park everything" is
// what makes people switch the gate off entirely: parking a read-only question,
// or every turn of a live conversation, is friction with no safety gained.
const REVIEW_MODES: ReviewMode[] = ["verb", "always", "never"];

const REVIEW_COPY: Record<ReviewMode, { label: string; title: string }> = {
  verb: {
    label: "Review: Risky",
    title:
      "Requests that write to your project (Build, Finish) and the start of a shaping conversation are parked for Approve/Edit/Cancel. Reading and reviewing dispatch straight away. Click to cycle.",
  },
  always: {
    label: "Review: All",
    title: "Every request is parked for Approve/Edit/Cancel before Claude sees it. Click to cycle.",
  },
  never: {
    label: "Review: Off",
    title: "Nothing is parked — every request dispatches immediately. Click to cycle.",
  },
};

function ReviewModeControl({
  reviewMode,
  onChange,
}: {
  reviewMode: ReviewMode;
  onChange: (next: ReviewMode) => void;
}) {
  const copy = REVIEW_COPY[reviewMode] ?? REVIEW_COPY.verb;
  const next = REVIEW_MODES[(REVIEW_MODES.indexOf(reviewMode) + 1) % REVIEW_MODES.length];
  return (
    <button
      type="button"
      className={`review-mode-toggle ${reviewMode === "never" ? "off" : "on"}`}
      onClick={() => onChange(next)}
      title={copy.title}
    >
      {reviewMode === "never" ? <ShieldOff size={12} /> : reviewMode === "always" ? <ShieldCheck size={12} /> : <Shield size={12} />}
      {copy.label}
    </button>
  );
}

/**
 * What ran last, how far the current change has got, and the review-mode
 * control.
 *
 * There is deliberately **no verb selector here**. Iris chooses a verb per
 * request from what the user said and from the project's state; a chip that set
 * a "current role" was the mechanism by which "Iris, build me X" did the wrong
 * thing whenever the chip happened to be set differently. The model popover
 * stays, attached to whatever last ran, because changing a model is a real
 * preference — but it no longer implies a persistent worker.
 */
export default function PipelineBar({
  verbs,
  lastVerb,
  modelPopoverVerb,
  reviewMode,
  onToggleModelPopover,
  onSetVerbModel,
  onSetReviewMode,
}: {
  verbs: VerbsSnapshot | null;
  lastVerb: Verb | null;
  modelPopoverVerb: Verb | null;
  reviewMode: ReviewMode;
  onToggleModelPopover: (verb: Verb) => void;
  onSetVerbModel: (verb: Verb, model: string) => void;
  onSetReviewMode: (next: ReviewMode) => void;
}) {
  const info = lastVerb ? verbs?.roster.find((entry) => entry.key === lastVerb) : null;
  const change = verbs?.change;

  return (
    <div className="pipeline-bar">
      {lastVerb ? (
        <div
          className="agent-chip active"
          style={{ "--agent-color": VERB_COLORS[lastVerb] } as CSSProperties}
        >
          <span
            className="agent-chip-label"
            title={`${info?.description || VERB_LABELS[lastVerb]} — this is what ran most recently, not a mode you are in. Iris picks the verb for each request.`}
          >
            {VERB_LABELS[lastVerb]}
          </span>
          <button
            type="button"
            className="agent-chip-model"
            onClick={(event) => {
              event.stopPropagation();
              onToggleModelPopover(lastVerb);
            }}
            title={`${VERB_LABELS[lastVerb]} model: ${modelLabel(info?.model) || "…"} — click to change`}
          >
            {modelLabel(info?.model) || "…"}
          </button>
          {modelPopoverVerb === lastVerb ? (
            <div className="model-popover" onClick={(event) => event.stopPropagation()}>
              {MODEL_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className={`model-option ${info?.model === choice.id ? "selected" : ""}`}
                  onClick={() => onSetVerbModel(lastVerb, choice.id)}
                >
                  {choice.label}
                  {info?.model === choice.id ? <span className="model-check">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <span className="agent-chip iris" title="Nothing has run yet in this session. Just say what you want.">
          Iris
        </span>
      )}
      {change?.slug ? (
        <span
          className="pipeline-change"
          title={`Current OpenSpec change: ${change.slug}${change.shaped ? " · shaped" : ""}${change.built ? " · built" : ""}`}
        >
          {change.slug}
          {change.shaped ? <span className="gate-check">✓</span> : null}
          {change.built ? <span className="gate-check">✓</span> : null}
        </span>
      ) : null}
      <ReviewModeControl reviewMode={reviewMode} onChange={onSetReviewMode} />
    </div>
  );
}
