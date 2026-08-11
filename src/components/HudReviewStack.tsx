import ClaudeQuestionBanner from "./ClaudeQuestionBanner";
import ReviewBanner from "./ReviewBanner";
import { HUD_CHROME_CLASS } from "../lib/hudChrome";

// The HUD's top island: a pending Claude question, with a parked review
// stacked beneath it when both are live.
//
// A pending question outranks everything else in the HUD — it stays a lit,
// always-visible island rather than tucked behind a toggle, because it blocks a
// token-burning run. A parked review stacks beneath it for the same reason
// (design.md D3). HUD editing is voice-only (D7), so ReviewBanner renders with
// `editable={false}` here.
//
// Split out of HudShell.tsx: `claudeQuestion` and `taskReview` are used
// nowhere else in that component, so this takes them as its own props rather
// than adding to the shell's surface.

export type HudReviewStackProps = {
  pipelineAvailable: boolean;
  claudeQuestion: {
    questions: ClaudeQuestion[];
    answers: Record<string, string[]>;
    onPick: (question: string, choice: string) => void;
    onSubmit?: () => void;
  } | null;
  taskReview: {
    review: PendingTaskReview;
    onApprove: (editedTask?: string) => void;
    onCancel: () => void;
  } | null;
};

export default function HudReviewStack({ pipelineAvailable, claudeQuestion, taskReview }: HudReviewStackProps) {
  if (!pipelineAvailable || (!claudeQuestion && !taskReview)) return null;
  return (
    <div className={`hud-review-stack hud-hit ${HUD_CHROME_CLASS}`}>
      {claudeQuestion ? (
        <ClaudeQuestionBanner
          questions={claudeQuestion.questions}
          answers={claudeQuestion.answers}
          onPick={claudeQuestion.onPick}
          onSubmit={claudeQuestion.onSubmit}
        />
      ) : null}
      {taskReview ? (
        <ReviewBanner
          review={taskReview.review}
          editable={false}
          onApprove={taskReview.onApprove}
          onCancel={taskReview.onCancel}
        />
      ) : null}
    </div>
  );
}
