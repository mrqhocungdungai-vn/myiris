import { useState } from "react";
import { answerPayload, answersComplete, pickChoice, shouldAutoSubmit, type AnswerPicks } from "../lib/claude-answers";

// A run that has paused to ask the user something, and the picks accumulating
// against it.
//
// Extracted from `App.tsx` under `decompose-app-orchestrator`. The two pieces
// of state are always written together — raising a question resets the picks,
// and answering clears both — which is exactly the coupling that makes them one
// domain rather than two bindings that happen to sit next to each other.
//
// The pick/submit rules themselves are pure and tested in `lib/claude-answers`.

export type PendingQuestion = {
  workstreamId: string;
  questions: ClaudeQuestion[];
};

export type ClaudeQuestionControl = {
  /** The live question, or null when no run is asking. */
  pending: PendingQuestion | null;
  /** Picks for the CURRENT question only. */
  answers: AnswerPicks;
  /** A run raised a question. Picks reset — they belong to this question. */
  raise: (pending: PendingQuestion) => void;
  /** Main reported the question settled (answered elsewhere, or timed out). */
  clear: () => void;
  /** The user clicked an option. */
  pick: (question: string, choice: string) => void;
  /** Send the batch. A no-op unless every question has a pick. */
  submit: (picks?: AnswerPicks) => void;
};

export function useClaudeQuestion({
  hasBridge,
  answer,
}: {
  hasBridge: boolean;
  answer: (payload: ReturnType<typeof answerPayload>) => void;
}): ClaudeQuestionControl {
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const [answers, setAnswers] = useState<AnswerPicks>({});

  function submit(picks: AnswerPicks = answers) {
    if (!hasBridge || !pending) return;
    const { questions } = pending;
    if (!answersComplete(questions, picks)) return;
    setPending(null);
    setAnswers({});
    answer(answerPayload(questions, picks));
  }

  return {
    pending,
    answers,
    raise(next) {
      setPending(next);
      setAnswers({});
    },
    clear() {
      setPending(null);
      setAnswers({});
    },
    // Secondary answer path: a sighted user clicks instead of answering by
    // voice. If the voice path answers first, `submit` is a no-op — main
    // resolves whichever side completes first.
    pick(question, choice) {
      if (!hasBridge || !pending) return;
      const { questions } = pending;
      const multi = Boolean(questions.find((q) => q.question === question)?.multiSelect);
      const next = { ...answers, [question]: pickChoice(answers[question] ?? [], choice, multi) };
      setAnswers(next);
      if (shouldAutoSubmit(questions, next)) submit(next);
    },
    submit,
  };
}
