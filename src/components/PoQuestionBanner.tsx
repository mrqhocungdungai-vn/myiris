import { MessageSquare } from "lucide-react";

// A question may permit several options (`multiSelect`). Reducing one of those
// to a single pick answers a different question than the PO asked, so picks are
// tracked as a list per question.
export default function PoQuestionBanner({
  questions,
  answers,
  onPick,
  onSubmit,
}: {
  questions: PoQuestion[];
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
    <div className="po-question-banner" role="status">
      <div className="po-question-banner-head">
        <MessageSquare size={13} />
        <span>PO is waiting on you</span>
      </div>
      {questions.map((q) => {
        const picked = answers[q.question] ?? [];
        return (
          <div key={q.question} className="po-question-block">
            {q.header ? <span className="po-question-header">{q.header}</span> : null}
            <p className="po-question-text">{q.question}</p>
            {q.multiSelect ? <span className="po-question-multi">Choose one or more</span> : null}
            <div className="po-question-options">
              {q.options.map((opt) => (
                <button
                  key={opt.label}
                  className={`po-question-option ${picked.includes(opt.label) ? "picked" : ""}`}
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
        <button className="po-question-submit" disabled={!complete} onClick={onSubmit}>
          Send answers
        </button>
      ) : null}
      <p className="po-question-hint">
        {hasMultiSelect
          ? "Answer by voice, or pick your options above and send."
          : "Answer by voice, or click an option above."}
      </p>
    </div>
  );
}
