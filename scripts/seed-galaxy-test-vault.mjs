#!/usr/bin/env node
// Seeds a synthetic note vault big enough to judge the galaxy at scale
// (galaxy-note-reachable-by-hand tasks.md 6.3).
//
// The real vault holds three notes, two of them plumbing, so none of the
// anchor's, the rail's or the label budget's behaviour can be judged from a
// working copy. This writes 200-500 notes with a shape that actually exercises
// them: a few high-degree hubs (the entry rail is degree-ordered, which means
// nothing in a flat graph), tag clusters (the rail shows a tag colour), a long
// chain (rail traversal has to go somewhere), some unresolved wikilinks (ghost
// entries must be steppable but not openable), and — the reason the seeder was
// revised — SEVERAL DISCONNECTED CLOUDS with no link between them at all. That
// last one is not decoration: entry-point coverage per region (design.md D7b)
// is unobservable in a vault that happens to be one connected graph, which is
// exactly why the hole survived the first pass.
//
// Everything lands under ONE folder inside the vault so the whole thing is
// removed with a single `rm -rf`. Nothing outside that folder is read, written,
// or deleted.
//
//   node scripts/seed-galaxy-test-vault.mjs [count]     # default 300
//   node scripts/seed-galaxy-test-vault.mjs --clean     # remove the folder

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mirrors NOTES_VAULT_DIR in electron/capabilities/second-brain.mjs, which
// pins the vault to this fixed user-level path with no override.
const VAULT_DIR = path.join(os.homedir(), "iris-second-brain");
const SEED_DIR = path.join(VAULT_DIR, "galaxy-test-vault");

// How many mutually unlinked clouds the vault is split into. Notes never link
// across a cloud boundary, so stepping alone can never leave the one it starts
// in — the rail's entry points are the only route between them.
const CLOUD_COUNT = 4;

const TAGS = ["architecture", "pipeline", "voice", "gestures", "vault", "runtime", "design", "ops"];
const SUBJECTS = [
  "anchor", "orbit", "dolly", "reticle", "rail", "dwell", "palm", "wrist", "spline", "centroid",
  "budget", "spool", "verb", "ceiling", "transcript", "session", "inbox", "review", "parking",
  "waveform", "downsample", "wake", "cadence", "prosody", "latency", "throttle", "cache", "digest",
  "shard", "manifest", "sentinel", "beacon", "ledger", "cursor", "watermark", "checkpoint",
];
const QUALIFIERS = [
  "policy", "drift", "handoff", "fallback", "contract", "boundary", "lifecycle", "invariant",
  "budget", "gate", "seam", "probe", "trace", "replay", "rollup", "tuning",
];

// Deterministic PRNG (mulberry32), so re-running the seeder reproduces the same
// vault — a manual pass that cannot be repeated on the same graph is not a
// comparison.
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function titleFor(index) {
  const subject = SUBJECTS[index % SUBJECTS.length];
  const qualifier = QUALIFIERS[Math.floor(index / SUBJECTS.length) % QUALIFIERS.length];
  return `${subject} ${qualifier} ${String(index).padStart(3, "0")}`;
}

function clean() {
  if (!fs.existsSync(SEED_DIR)) {
    console.log(`[seed-galaxy-test-vault] nothing to remove at ${SEED_DIR}`);
    return;
  }
  fs.rmSync(SEED_DIR, { recursive: true, force: true });
  console.log(`[seed-galaxy-test-vault] removed ${SEED_DIR}`);
}

function seed(count) {
  const random = makeRandom(20260807);
  const titles = Array.from({ length: count }, (_, i) => titleFor(i));
  // Contiguous slices of the title list, each a cloud unto itself.
  const cloudSize = Math.ceil(count / CLOUD_COUNT);
  const cloudOf = (i) => Math.floor(i / cloudSize);
  const cloudRange = (cloud) => {
    const start = cloud * cloudSize;
    return { start, end: Math.min(count, start + cloudSize) };
  };

  fs.mkdirSync(SEED_DIR, { recursive: true });
  for (let i = 0; i < count; i++) {
    const title = titles[i];
    const cloud = cloudOf(i);
    const { start, end } = cloudRange(cloud);
    // Every twelfth note within a cloud is a hub: the entry rail orders by
    // degree, so a graph with no degree spread would make that unobservable.
    const hubs = [];
    for (let h = start; h < end; h += 12) hubs.push(titles[h]);

    const tags = [TAGS[i % TAGS.length]];
    if (random() < 0.3) tags.push(TAGS[(i * 7 + 3) % TAGS.length]);

    const links = new Set();
    // A chain WITHIN the cloud, so a note several hops away is reachable by
    // repeated stepping — and the chain never crosses a cloud boundary.
    if (i > start) links.add(titles[i - 1]);
    // A hub, so most notes sit one hop from something well connected.
    links.add(hubs[Math.floor((i - start) / 12) % hubs.length]);
    // Some cross-links, for a neighbourhood wider than a line. Still inside the
    // cloud — a single stray link across would merge two clouds into one and
    // quietly remove the thing this vault exists to test.
    const extra = Math.floor(random() * 4);
    for (let k = 0; k < extra; k++) links.add(titles[start + Math.floor(random() * (end - start))]);
    // An unresolved target every so often — a ghost the rail must show as
    // steppable but not openable.
    if (i % 17 === 0) links.add(`unwritten ${SUBJECTS[i % SUBJECTS.length]}`);
    links.delete(title);

    const body = [
      "---",
      `tags: [${tags.join(", ")}]`,
      "---",
      "",
      `# ${title}`,
      "",
      "Synthetic note seeded for the galaxy manual pass. Not user content.",
      "",
      ...Array.from(links).map((target) => `- [[${target}]]`),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(SEED_DIR, `${title}.md`), body, "utf8");
  }
  console.log(`[seed-galaxy-test-vault] wrote ${count} notes in ${CLOUD_COUNT} unlinked clouds to ${SEED_DIR}`);
  console.log(`[seed-galaxy-test-vault] remove with: node scripts/seed-galaxy-test-vault.mjs --clean`);
}

const arg = process.argv[2];
if (arg === "--clean") {
  clean();
} else {
  const count = arg ? Number(arg) : 300;
  if (!Number.isInteger(count) || count < 1 || count > 2000) {
    console.error("[seed-galaxy-test-vault] count must be an integer between 1 and 2000");
    process.exit(1);
  }
  seed(count);
}
