import { MessageSquare } from "lucide-react";

// A question may permit several options (`multiSelect`). Reducing one of those
// to a single pick answers a different question than the run asked, so picks are
// tracked as a list per question.
export default function ClaudeQuestionBanner({
  questions,
  answers,
  onPick,
  onSubmit,
}: {
  questions: ClaudeQuestion[];
  answers: Record<string, string[]>;
  onPick: (question: string, choice: string) => void;
  onSubmit?: () => void;
}) {
  // A single-select question submits the moment the last one is picked, exactly
  // as before. A multi-select one cannot: the user has to be able to say when
  // they have finished choosing, so those get an explicit confirm.
  const hasMultiSelect = questions.some((q) => q.multiSelect);
  const complete = questions.every((q) => (answers[q.question] ?? []).length > 0);

  return (
    <div className="claude-question-banner" role="status">
      <div className="claude-question-banner-head">
        <MessageSquare size={13} />
        <span>Claude is waiting on you</span>
      </div>
      {questions.map((q) => {
        const picked = answers[q.question] ?? [];
        return (
          <div key={q.question} className="claude-question-block">
            {q.header ? <span className="claude-question-header">{q.header}</span> : null}
            <p className="claude-question-text">{q.question}</p>
            {q.multiSelect ? <span className="claude-question-multi">Choose one or more</span> : null}
            <div className="claude-question-options">
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  className={`claude-question-option ${picked.includes(opt.label) ? "picked" : ""}`}
                  title={opt.description}
                  aria-pressed={picked.includes(opt.label)}
                  onClick={() => onPick(q.question, opt.label)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {hasMultiSelect ? (
        <button className="claude-question-submit" disabled={!complete} onClick={onSubmit}>
          Send answers
        </button>
      ) : null}
      <p className="claude-question-hint">
        {hasMultiSelect
          ? "Answer by voice, or pick your options above and send."
          : "Answer by voice, or click an option above."}
      </p>
    </div>
  );
}
