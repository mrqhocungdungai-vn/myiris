import { useMemo, useState } from "react";
import type { TaskCard } from "../types";
import { applyTaskUpdate, closeRunningSteps, latestWithResult, sortTasks } from "../lib/tasks";

// The work stream: the run cards, which one is expanded/focused, which
// timelines are unfolded, and the disambiguation chooser.
//
// The ordering and the step rules are pure and tested in `lib/tasks`. This owns
// the state and the derivations that every consumer reads, so that "the sorted
// list" is computed once rather than at each call site.

export type TaskStream = {
  /** Raw cards, newest write last. Prefer `sorted` for display. */
  tasks: TaskCard[];
  /** Active runs first, then newest — what every surface shows. */
  sorted: TaskCard[];
  /** The most recent run with something to read, or null. */
  latestResult: TaskCard | null;
  /** The card the hand is hovering, so "this one" can resolve to it. */
  focusedId: string | null;
  /** Which run timelines are unfolded. */
  stepsOpen: Record<string, boolean>;
  /** An ambiguous "open the X task" awaiting the user's choice. */
  chooser: { query: string; matches: TaskCard[] } | null;
  showHistory: boolean;
  apply: (event: SidecarEvent) => void;
  /** A run finished: close any step the runtime never closed. */
  finishRun: (runId: string) => void;
  focus: (id: string | null) => void;
  setStepsOpen: (id: string, open: boolean) => void;
  toggleSteps: (id: string) => void;
  setChooser: (chooser: { query: string; matches: TaskCard[] } | null) => void;
  setShowHistory: (open: boolean) => void;
};

export function useTaskStream(): TaskStream {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [stepsOpen, setStepsOpenState] = useState<Record<string, boolean>>({});
  const [chooser, setChooser] = useState<{ query: string; matches: TaskCard[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const sorted = useMemo(() => sortTasks(tasks), [tasks]);
  const latestResult = useMemo(() => latestWithResult(sorted), [sorted]);

  return {
    tasks,
    sorted,
    latestResult,
    focusedId,
    stepsOpen,
    chooser,
    showHistory,
    apply: (event) => setTasks((current) => applyTaskUpdate(current, event)),
    finishRun: (runId) => setTasks((current) => closeRunningSteps(current, runId)),
    // Compared before writing so hovering the same card frame after frame does
    // not re-render the tree — this is driven from a rAF loop.
    focus: (id) => setFocusedId((current) => (current === id ? current : id)),
    setStepsOpen: (id, open) => setStepsOpenState((current) => ({ ...current, [id]: open })),
    toggleSteps: (id) => setStepsOpenState((current) => ({ ...current, [id]: !current[id] })),
    setChooser,
    setShowHistory,
  };
}
