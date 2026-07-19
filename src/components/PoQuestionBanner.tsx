import { MessageSquare } from "lucide-react";

export default function PoQuestionBanner({
  questions,
  answers,
  onPick,
}: {
  questions: PoQuestion[];
  answers: Record<string, string>;
  onPick: (question: string, choice: string) => void;
}) {
  return (
    <div className="po-question-banner" role="status">
      <div className="po-question-banner-head">
        <MessageSquare size={13} />
        <span>PO is waiting on you</span>
      </div>
      {questions.map((q) => (
        <div key={q.question} className="po-question-block">
          <p className="po-question-text">{q.question}</p>
          <div className="po-question-options">
            {q.options.map((opt) => (
              <button
                key={opt.label}
                className={`po-question-option ${answers[q.question] === opt.label ? "picked" : ""}`}
                title={opt.description}
                onClick={() => onPick(q.question, opt.label)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="po-question-hint">Answer by voice, or click an option above.</p>
    </div>
  );
}
