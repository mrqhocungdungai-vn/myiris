import { describe, it, expect, vi } from "vitest";
import {
  createMeetingCapture,
  renderMeetingHeader,
  renderMeetingBlock,
  renderMeetingFooter,
  formatDuration,
} from "./meeting-capture.mjs";

// A fake `fs` with the async surface vault-write's appendSpoolRecordTo uses, so
// every case here runs with no real disk and no real clock.
function fakeIo({ failWith = null } = {}) {
  const files = new Map();
  return /** @type {any} */ ({
    files,
    promises: {
      async mkdir() {},
      async appendFile(file, content) {
        if (failWith) throw new Error(failWith);
        files.set(file, (files.get(file) ?? "") + content);
      },
    },
  });
}

const DIR = "/vault/inbox/meetings";

function make(io, startAt = new Date(2026, 7, 6, 9, 0, 0)) {
  let clock = startAt.getTime();
  const capture = createMeetingCapture({ io, now: () => new Date(clock) });
  return { capture, tick: (ms) => (clock += ms) };
}

describe("meeting-capture: rendering", () => {
  it("names the wider source in the header — the room AND what the machine played", () => {
    const header = renderMeetingHeader(new Date(2026, 7, 6, 9, 0, 0));
    expect(header).toMatch(/system audio/i);
    expect(header).toMatch(/room/i);
    // Distinguishable from a deliberate capture and from a run outcome, so a
    // later Claude verb can read a meeting on its own terms.
    expect(header).toContain("kind: meeting");
    expect(header).toMatch(/untrusted/i);
    // Local clock with an explicit offset, never UTC — the reader was in the
    // meeting, and a timestamp hours off their own clock is worse than none.
    expect(header).toMatch(/started: 2026-08-06T09:00:00[+-]\d{2}:\d{2}/);
  });

  it("quotes each utterance and renders nothing for an empty flush", () => {
    expect(renderMeetingBlock([])).toBe("");
    expect(renderMeetingBlock([{ text: "hello", at: 0 }, { text: "there", at: 1 }])).toBe("> hello\n> there\n");
  });
});

describe("meeting-capture: the record's span", () => {
  it("formats a duration for a person to read", () => {
    expect(formatDuration(47_000)).toBe("47s");
    expect(formatDuration(18 * 60_000 + 42_000)).toBe("18m 42s");
    expect(formatDuration(3_600_000 + 4 * 60_000 + 12_000)).toBe("1h 04m 12s");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("closes the record with an end time and how long it ran", () => {
    const footer = renderMeetingFooter(new Date(2026, 7, 6, 9, 0, 0), new Date(2026, 7, 6, 9, 18, 42));
    expect(footer).toMatch(/_Ended · 2026-08-06T09:18:42[+-]\d{2}:\d{2} · 18m 42s_/);
    // Never a `## ` heading: inboxBacklog counts records by that marker, and a
    // meeting is one record, not two.
    expect(footer).not.toMatch(/^## /m);
  });

  it("writes the span on disengage, so coverage is answerable at a glance", async () => {
    const io = fakeIo();
    const { capture, tick } = make(io);
    capture.engage();
    capture.appendFragment("twenty minutes of video");
    capture.closeUtterance();
    tick(20 * 60_000);
    await capture.disengage({ dir: DIR });

    const written = [...io.files.values()][0];
    // Both ends present: the header's start and the footer's end, so "did this
    // actually cover the whole meeting?" needs no comparison against memory.
    expect(written).toMatch(/started: 2026-08-06T09:00:00/);
    expect(written).toMatch(/_Ended · 2026-08-06T09:20:00[+-]\d{2}:\d{2} · 20m 00s_/);
  });

  it("measures the span from the ENGAGE moment, not from the first thing heard", async () => {
    const io = fakeIo();
    const { capture, tick } = make(io);
    capture.engage();
    // Two minutes of nobody saying anything still belongs to the meeting.
    tick(2 * 60_000);
    capture.appendFragment("finally, someone speaks");
    capture.closeUtterance();
    tick(60_000);
    await capture.disengage({ dir: DIR });

    const written = [...io.files.values()][0];
    expect(written).toMatch(/started: 2026-08-06T09:00:00/);
    expect(written).toMatch(/· 3m 00s_/);
  });

  it("leaves no closing line on a record that heard nothing at all", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.engage();
    await capture.disengage({ dir: DIR });
    // No file rather than a file holding only an "Ended" line, which would be
    // noise in the curation backlog.
    expect(io.files.size).toBe(0);
  });
});

describe("meeting-capture: retention over an engagement", () => {
  it("writes nothing until it is engaged", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.appendFragment("before the mode");
    expect(await capture.flush({ dir: DIR })).toEqual({ ok: true, skipped: true });
    expect(io.files.size).toBe(0);
  });

  it("accumulates raw fragments into whole utterances rather than writing half-words", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.engage();
    capture.appendFragment("the deploy ");
    capture.appendFragment("goes out on Friday");
    // Nothing yet: an utterance is only writable once it is closed.
    expect(await capture.flush({ dir: DIR })).toEqual({ ok: true, skipped: true });
    capture.closeUtterance();
    await capture.flush({ dir: DIR });
    expect([...io.files.values()][0]).toContain("> the deploy goes out on Friday");
  });

  it("still produces a record when no turn boundary was ever reached", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.engage();
    capture.appendFragment("a monologue nobody interrupted");
    // No closeUtterance() at all — the final flush closes what is open, so
    // speech that never reached a turn boundary is retained rather than lost.
    await capture.disengage({ dir: DIR });
    expect([...io.files.values()][0]).toContain("> a monologue nobody interrupted");
  });

  it("writes each utterance exactly once however many flushes occur", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.engage();
    capture.appendFragment("first");
    capture.closeUtterance();
    await capture.flush({ dir: DIR });
    await capture.flush({ dir: DIR });
    capture.appendFragment("second");
    capture.closeUtterance();
    await capture.flush({ dir: DIR });
    await capture.disengage({ dir: DIR });

    const written = [...io.files.values()][0];
    expect(written.match(/> first/g)).toHaveLength(1);
    expect(written.match(/> second/g)).toHaveLength(1);
    // And the header is written once, on the first flush that carries content.
    expect(written.match(/kind: meeting/g)).toHaveLength(1);
  });

  it("gives two engagements in one day two separate, separately deletable records", async () => {
    const io = fakeIo();
    const { capture, tick } = make(io);

    capture.engage();
    capture.appendFragment("standup");
    capture.closeUtterance();
    await capture.disengage({ dir: DIR });

    tick(4 * 60 * 60 * 1000);
    capture.engage();
    capture.appendFragment("retro");
    capture.closeUtterance();
    await capture.disengage({ dir: DIR });

    expect(io.files.size).toBe(2);
    const contents = [...io.files.values()].join("");
    expect(contents).toContain("> standup");
    expect(contents).toContain("> retro");
  });

  it("reports a failed write instead of raising, and retries it on the next flush", async () => {
    const failing = fakeIo({ failWith: "no space left on device" });
    const { capture } = make(failing);
    const onError = vi.fn();
    capture.engage();
    capture.appendFragment("something worth keeping");
    capture.closeUtterance();

    const result = await capture.flush({ dir: DIR, onError });
    expect(result.ok).toBe(false);
    expect(onError).toHaveBeenCalled();

    // The queue was NOT advanced, so the next flush still carries it — a
    // failed write must not silently lose the span it was holding.
    const io = fakeIo();
    const recovered = createMeetingCapture({ io });
    recovered.engage();
    recovered.appendFragment("something worth keeping");
    recovered.closeUtterance();
    await recovered.flush({ dir: DIR });
    expect([...io.files.values()][0]).toContain("> something worth keeping");
  });

  it("stops retaining once disengaged", async () => {
    const io = fakeIo();
    const { capture } = make(io);
    capture.engage();
    capture.appendFragment("during");
    capture.closeUtterance();
    await capture.disengage({ dir: DIR });
    const afterDisengage = [...io.files.values()][0];

    capture.appendFragment("after the mode ended");
    capture.closeUtterance();
    await capture.flush({ dir: DIR });

    expect([...io.files.values()][0]).toBe(afterDisengage);
    expect(capture.isEngaged()).toBe(false);
  });
});
