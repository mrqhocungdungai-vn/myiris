// How a click on an AskUserQuestion option turns into a set of picks, and when
// that set is complete enough to send.
//
// This is the **secondary** answer path: it lets a sighted user click an option
// instead of answering by voice. It deliberately mirrors the voice path's
// "collect every answer, then resolve" batching rather than resolving each
// question as it is answered — main resolves whichever side completes first,
// so the two must agree on what "complete" means.
//
// Extracted from App.tsx because the rules are easy to state and were
// impossible to test in place: single-select replaces, multi-select toggles,
// and a call containing any multi-select question never auto-submits.

export type AnswerPicks = Record<string, string[]>;

/**
 * The picks for one question after a choice is clicked.
 *
 * Single-select **replaces** — clicking a second option changes the answer
 * rather than adding to it. Multi-select **toggles**, so clicking a chosen
 * option removes it and a user can undo a pick without starting over.
 */
export function pickChoice(current: string[], choice: string, multiSelect: boolean): string[] {
  if (!multiSelect) return [choice];
  return current.includes(choice) ? current.filter((label) => label !== choice) : [...current, choice];
}

/** Whether every question in the call has at least one pick. */
export function answersComplete(questions: ClaudeQuestion[], picks: AnswerPicks): boolean {
  return questions.every((question) => (picks[question.question] ?? []).length > 0);
}

/**
 * Whether the batch should be sent without waiting for the Send button.
 *
 * A call containing **any** multi-select question never auto-submits, even once
 * every question has a pick: the user has to be able to say when they are done
 * choosing, which is what the banner's Send button is for. Auto-submitting on
 * the last pick would end the question the moment a user selected a second
 * option, which is the opposite of what multi-select means.
 */
export function shouldAutoSubmit(questions: ClaudeQuestion[], picks: AnswerPicks): boolean {
  if (questions.some((question) => question.multiSelect)) return false;
  return answersComplete(questions, picks);
}

/** The payload shape main expects, built from the completed picks. */
export function answerPayload(questions: ClaudeQuestion[], picks: AnswerPicks) {
  return questions.map((question) => ({
    question: question.question,
    choice: picks[question.question] ?? [],
  }));
}
