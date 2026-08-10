// The run inbox: one appended record per finished run, in the second-brain
// vault.
//
// Before this, nothing was learned from what happened. Runs succeeded and failed
// and the second brain — which ships six `wiki-*` skills and exists precisely to
// accumulate knowledge — never saw any of it.
//
// **This is a file append, not a run** (design.md D5). Spawning a synthesis run
// after every run would double the run count, double cost, and — because the run
// queue holds a single global execution slot — block the user's next request
// behind bookkeeping. So capture is free and unconditional; synthesis is a
// deliberate verb (`capture_learning`) that reads what accumulated here.
//
// Raw capture is a log; synthesis is the learning. Separating them means the log
// can never be lost to a busy queue, and the expensive step happens when there
// is enough material to be worth it.
//
// Failures are recorded on exactly the same terms as successes. A failed attempt
// is at least as worth keeping as a successful one, and a log that quietly drops
// them teaches the wrong lesson.
//
// Electron-free; `fs` is injected so this is testable without touching disk.
import fs from "node:fs";
import path from "node:path";
import { appendSpoolRecordSync, spoolFileFor } from "./vault-write.mjs";

// This module owns what a run record looks like; electron/vault-write.mjs
// owns writing it (vault-write-path design D1) — so the date-derived filename
// is that module's helper, kept under this name here rather than duplicated.
export const inboxFileFor = spoolFileFor;

// Multi-line values (a run's output) are folded into a blockquote so one record
// can never be mistaken for the start of the next.
function block(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .split("\n")
    .map((line) => `  > ${line}`)
    .join("\n");
}

/**
 * The markdown for one run's record. Pure, so its shape is assertable without a
 * filesystem.
 * @param {{
 *   verb?: string, task?: string, status?: string, output?: string,
 *   model?: string|null, usage?: any, activity?: string[],
 *   finished_at?: number, run_id?: string,
 * }} run
 * @param {number} [maxOutputChars]
 * @returns {string}
 */
export function renderInboxRecord(run, maxOutputChars = 2000) {
  const when = new Date((run.finished_at ?? Date.now() / 1000) * 1000).toISOString();
  const output = String(run.output ?? "").trim();
  const truncated = output.length > maxOutputChars ? `${output.slice(0, maxOutputChars)}\n…(truncated)` : output;
  // The tools a run used, deduplicated in first-use order — enough to see how it
  // went about the work without copying the whole activity log.
  const tools = [...new Set((run.activity ?? []).map((line) => /^\s*([A-Za-z_][\w-]*)/.exec(String(line))?.[1]).filter(Boolean))];
  const cost = run.usage?.cost_usd;
  const lines = [
    `## ${when} · ${run.verb ?? "unknown"} · ${run.status ?? "unknown"}`,
    `- run: ${run.run_id ?? "?"}`,
    `- model: ${run.model ?? "default"}`,
    Number.isFinite(cost) ? `- cost: $${Number(cost).toFixed(4)} over ${run.usage?.num_turns ?? "?"} turns` : "- cost: not reported",
    tools.length ? `- tools: ${tools.join(", ")}` : "- tools: none recorded",
    "- request:",
    block(run.task) || "  > (empty)",
    "- result:",
    block(truncated) || "  > (no output)",
    "",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/**
 * Appends one record. Never throws: bookkeeping must not be able to disturb a
 * run that has already finished, and a full disk is not a reason to lose the
 * user's result. Reports the failure through `onError` instead. The write
 * itself is `vault-write.mjs`'s job (design D1); this keeps only the record's
 * shape and this function's existing synchronous, never-throws signature.
 *
 * @param {{ dir: string, run: any, now?: () => Date, io?: typeof fs, onError?: (error: Error) => void }} input
 * @returns {{ ok: boolean, file?: string, error?: string }}
 */
export function appendRunRecord({ dir, run, now, io, onError }) {
  return appendSpoolRecordSync({ dir, content: renderInboxRecord(run), now, io, onError });
}

/**
 * How much is waiting to be synthesized, so Iris can OFFER `capture_learning`
 * when there is enough to be worth it — and never run it unprompted. Counts
 * records rather than files, because "three days of one run each" and "one day
 * of three runs" are the same amount of material. `dir` may be one spool
 * directory or several (design D3: the capture spool counts toward the offer
 * threshold too, not just the run-outcome spool).
 * @param {{ dir: string | string[], io?: typeof fs }} input
 * @returns {{ records: number, files: string[] }}
 */
export function inboxBacklog({ dir, io = fs }) {
  const dirs = Array.isArray(dir) ? dir : [dir];
  let records = 0;
  const files = [];
  for (const oneDir of dirs) {
    try {
      const names = io
        .readdirSync(oneDir)
        // Per-day spool files only — every spool this counts writes one file per
        // day, so anything else under the directory is not a spooled record.
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
        .sort();
      for (const name of names) {
        const text = io.readFileSync(path.join(oneDir, name), "utf8");
        records += (String(text).match(/^## /gm) ?? []).length;
        files.push(name);
      }
    } catch {
      // That spool directory does not exist yet — contributes nothing.
    }
  }
  return { records, files };
}
