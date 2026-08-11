import { describe, it, expect } from "vitest";
import { pickChoice, answersComplete, shouldAutoSubmit, answerPayload } from "./claude-answers";

const q = (question: string, multiSelect = false) =>
  ({ question, multiSelect, header: "", options: [] }) as unknown as ClaudeQuestion;

describe("pickChoice", () => {
  it("replaces the answer for a single-select question", () => {
    expect(pickChoice([], "a", false)).toEqual(["a"]);
    expect(pickChoice(["a"], "b", false)).toEqual(["b"]);
  });

  it("adds to the list for a multi-select question", () => {
    expect(pickChoice([], "a", true)).toEqual(["a"]);
    expect(pickChoice(["a"], "b", true)).toEqual(["a", "b"]);
  });

  // Clicking a chosen option removes it, so a pick can be undone.
  it("toggles a chosen option off for a multi-select question", () => {
    expect(pickChoice(["a", "b"], "a", true)).toEqual(["b"]);
    expect(pickChoice(["a"], "a", true)).toEqual([]);
  });

  it("does not mutate the picks it was given", () => {
    const current = ["a"];
    pickChoice(current, "b", true);
    expect(current).toEqual(["a"]);
  });
});

describe("answersComplete", () => {
  it("is false while any question has no pick", () => {
    expect(answersComplete([q("one"), q("two")], { one: ["a"] })).toBe(false);
    expect(answersComplete([q("one")], {})).toBe(false);
    expect(answersComplete([q("one")], { one: [] })).toBe(false);
  });

  it("is true once every question has at least one pick", () => {
    expect(answersComplete([q("one"), q("two")], { one: ["a"], two: ["b"] })).toBe(true);
  });
});

describe("shouldAutoSubmit", () => {
  it("submits a single-select call as soon as every question is answered", () => {
    expect(shouldAutoSubmit([q("one")], { one: ["a"] })).toBe(true);
    expect(shouldAutoSubmit([q("one"), q("two")], { one: ["a"] })).toBe(false);
  });

  // The rule that makes multi-select mean anything: the user says when they
  // are done, via the banner's Send button.
  it("never auto-submits a call containing a multi-select question", () => {
    expect(shouldAutoSubmit([q("one", true)], { one: ["a"] })).toBe(false);
    expect(shouldAutoSubmit([q("one", true)], { one: ["a", "b"] })).toBe(false);
  });

  // Even one multi-select question holds the whole batch back.
  it("holds the batch when only one of several questions is multi-select", () => {
    const questions = [q("one"), q("two", true)];
    expect(shouldAutoSubmit(questions, { one: ["a"], two: ["b"] })).toBe(false);
    expect(answersComplete(questions, { one: ["a"], two: ["b"] })).toBe(true);
  });
});

describe("answerPayload", () => {
  it("names every question, in order, with its picks", () => {
    expect(answerPayload([q("one"), q("two")], { two: ["b"], one: ["a"] })).toEqual([
      { question: "one", choice: ["a"] },
      { question: "two", choice: ["b"] },
    ]);
  });

  it("sends an empty choice rather than dropping an unanswered question", () => {
    expect(answerPayload([q("one")], {})).toEqual([{ question: "one", choice: [] }]);
  });
});
