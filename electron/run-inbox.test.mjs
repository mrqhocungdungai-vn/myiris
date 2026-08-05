import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendRunRecord, inboxBacklog, inboxFileFor, renderInboxRecord } from "./run-inbox.mjs";

function makeRun(overrides = {}) {
  return {
    run_id: "r1",
    verb: "execute",
    task: "add a login page",
    status: "completed",
    output: "Added it.",
    model: "claude-sonnet-5",
    usage: { cost_usd: 0.42, num_turns: 7 },
    activity: ["Read src/App.tsx", "Edit src/App.tsx", "Read src/App.tsx", "Bash npm test"],
    finished_at: Date.UTC(2026, 7, 4, 12, 0, 0) / 1000,
    ...overrides,
  };
}

function withTempDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iris-inbox-"));
  try {
    return body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("renderInboxRecord", () => {
  it("records the verb, request, result, cost, and tools used", () => {
    const record = renderInboxRecord(makeRun());
    expect(record).toContain("· execute · completed");
    expect(record).toContain("add a login page");
    expect(record).toContain("Added it.");
    expect(record).toContain("$0.4200");
    expect(record).toContain("7 turns");
    // Deduplicated in first-use order: enough to see how it went about the work
    // without copying the whole activity log.
    expect(record).toContain("- tools: Read, Edit, Bash");
  });

  // A failed attempt is at least as worth keeping as a successful one, and a log
  // that quietly drops them teaches the wrong lesson.
  it("records a failure on the same terms as a success", () => {
    const record = renderInboxRecord(makeRun({ status: "failed", output: "npm test exited 1" }));
    expect(record).toContain("· execute · failed");
    expect(record).toContain("npm test exited 1");
  });

  // ask-when-unspecified 4.5/6.9: the record is the third account of an outcome
  // (with the structured result and the spoken announcement), and it is the one
  // the curator later reads back as history. It must not record a decision the
  // user never made.
  it("records an unanswered run as its own outcome, claiming no choice was made", () => {
    const record = renderInboxRecord(
      makeRun({
        status: "unanswered",
        output:
          'This run needed something decided before it could go on, no answer arrived in time, so it stopped ' +
          'without writing anything further. What it needed to know: "Which environment?" Nothing was chosen ' +
          "on your behalf and no default was applied.",
      }),
    );

    expect(record).toContain("· execute · unanswered");
    expect(record).toContain("Which environment?");
    expect(record).not.toMatch(/\b(you|the user|they) (chose|selected|confirmed|approved|picked)\b/i);
    expect(record).not.toMatch(/(?<!no )(default|recommended option) was applied/i);
  });

  it("says so plainly when a run reported no cost", () => {
    expect(renderInboxRecord(makeRun({ usage: null }))).toContain("cost: not reported");
  });

  // Two records must never run together: one long output could otherwise look
  // like the start of the next entry.
  it("folds multi-line text so one record cannot bleed into another", () => {
    const record = renderInboxRecord(makeRun({ output: "line one\n## Not a heading\nline three" }));
    const headings = record.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toHaveLength(1);
  });

  it("truncates a very long result rather than storing it whole", () => {
    const record = renderInboxRecord(makeRun({ output: "x".repeat(5000) }), 100);
    expect(record).toContain("…(truncated)");
    expect(record.length).toBeLessThan(1000);
  });
});

describe("appendRunRecord", () => {
  it("appends to one file per day, accumulating rather than replacing", () => {
    withTempDir((dir) => {
      appendRunRecord({ dir, run: makeRun({ run_id: "a" }) });
      appendRunRecord({ dir, run: makeRun({ run_id: "b" }) });

      const file = path.join(dir, inboxFileFor(new Date()));
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("run: a");
      expect(text).toContain("run: b");
      expect(fs.readdirSync(dir)).toHaveLength(1);
    });
  });

  it("creates the inbox directory on first use", () => {
    withTempDir((dir) => {
      const nested = path.join(dir, "inbox", "runs");
      expect(appendRunRecord({ dir: nested, run: makeRun() }).ok).toBe(true);
      expect(fs.existsSync(nested)).toBe(true);
    });
  });

  // Bookkeeping must never be able to disturb a run that has already finished,
  // and a full disk is not a reason to lose the user's result.
  it("never throws, and reports the failure instead", () => {
    const onError = vi.fn();
    const io = /** @type {any} */ ({
      mkdirSync: () => {
        throw new Error("ENOSPC");
      },
    });
    const result = appendRunRecord({ dir: "/nowhere", run: makeRun(), io, onError });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOSPC");
    expect(onError).toHaveBeenCalled();
  });
});

describe("inboxBacklog", () => {
  // Counts records rather than files: "three days of one run each" and "one day
  // of three runs" are the same amount of material.
  it("counts the records waiting to be synthesized", () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, "2026-08-01.md"), "## a\n- run: 1\n## b\n- run: 2\n");
      fs.writeFileSync(path.join(dir, "2026-08-02.md"), "## c\n- run: 3\n");
      // Not a dated inbox file — ignored rather than counted.
      fs.writeFileSync(path.join(dir, "notes.md"), "## d\n");

      const backlog = inboxBacklog({ dir });
      expect(backlog.records).toBe(3);
      expect(backlog.files).toEqual(["2026-08-01.md", "2026-08-02.md"]);
    });
  });

  it("reports an empty backlog rather than throwing when the inbox does not exist", () => {
    expect(inboxBacklog({ dir: "/definitely/not/here" })).toEqual({ records: 0, files: [] });
  });

  // vault-write-path design D3: the curator's offer threshold must reflect
  // everything waiting, not just finished-run records — a capture sitting
  // unprocessed in the other spool is material too.
  it("sums records across multiple spool directories when dir is an array", () => {
    withTempDir((runDir) => {
      withTempDir((captureDir) => {
        fs.writeFileSync(path.join(runDir, "2026-08-01.md"), "## a\n- run: 1\n");
        fs.writeFileSync(path.join(captureDir, "2026-08-02.md"), "## b\n- note\n## c\n- note\n");

        const backlog = inboxBacklog({ dir: [runDir, captureDir] });
        expect(backlog.records).toBe(3);
        expect(backlog.files.sort()).toEqual(["2026-08-01.md", "2026-08-02.md"]);
      });
    });
  });

  it("tolerates one of several spool directories not existing yet", () => {
    withTempDir((runDir) => {
      fs.writeFileSync(path.join(runDir, "2026-08-01.md"), "## a\n");
      expect(inboxBacklog({ dir: [runDir, "/definitely/not/here"] })).toEqual({ records: 1, files: ["2026-08-01.md"] });
    });
  });
});
