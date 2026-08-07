import { describe, it, expect } from "vitest";

import { matchNotesByName, foldNoteName, NOTE_NAME_MATCH_LIMIT } from "./note-name-match.mjs";

// Ported from `src/lib/galaxy-rail.test.ts`'s `railSearch` block by
// voice-finds-a-note (task 1.2). The assertions are the contract — what
// "matches" means and in what order — and they moved with the code they
// describe rather than being rewritten for it. `personal-knowledge-notes`
// requires the spoken and typed routes to return the same notes in the same
// order; these cases are what that promise rests on, and they now sit beside
// the single implementation both routes call.

const NAMED = [
  { id: "gh", title: "Ghi chú kiến trúc", tags: [] },
  { id: "alpha", title: "Alpha", tags: [] },
  { id: "alphabet", title: "Alphabet soup", tags: [] },
  { id: "sub", title: "The alpha channel", tags: [] },
];
const NAMED_LINKS = [{ source: "sub", target: "alpha" }];

const idsFor = (query, options = {}) =>
  matchNotesByName({ query, nodes: NAMED, links: NAMED_LINKS, ...options }).map((m) => m.id);

describe("matchNotesByName — finding a note by name", () => {
  it("returns nothing for an empty or whitespace query", () => {
    expect(matchNotesByName({ query: "", nodes: NAMED, links: NAMED_LINKS })).toEqual([]);
    expect(matchNotesByName({ query: "   ", nodes: NAMED, links: NAMED_LINKS })).toEqual([]);
  });

  it("ranks exact, then prefix, then substring", () => {
    expect(idsFor("alpha")).toEqual(["alpha", "alphabet", "sub"]);
  });

  it("ignores case", () => {
    expect(idsFor("ALPHABET")).toEqual(["alphabet"]);
  });

  it("ignores diacritics, so a title in Vietnamese is findable without them", () => {
    expect(idsFor("ghi chu")).toEqual(["gh"]);
    expect(idsFor("kien truc")).toEqual(["gh"]);
  });

  it("orders equally-ranked matches by connectedness", () => {
    const nodes = [
      { id: "quiet", title: "Note quiet", tags: [] },
      { id: "busy", title: "Note busy", tags: [] },
      { id: "x", title: "X", tags: [] },
    ];
    const links = [
      { source: "busy", target: "x" },
      { source: "busy", target: "quiet" },
    ];
    expect(matchNotesByName({ query: "note", nodes, links }).map((m) => m.id)).toEqual(["busy", "quiet"]);
  });

  it("caps the result list", () => {
    const nodes = [];
    for (let i = 0; i < 50; i++) nodes.push({ id: `n${i}`, title: `Note ${i}`, tags: [] });
    expect(matchNotesByName({ query: "note", nodes, links: [], limit: 5 })).toHaveLength(5);
  });

  it("caps at NOTE_NAME_MATCH_LIMIT when no limit is given", () => {
    const nodes = [];
    for (let i = 0; i < 50; i++) nodes.push({ id: `n${i}`, title: `Note ${i}`, tags: [] });
    expect(matchNotesByName({ query: "note", nodes, links: [] })).toHaveLength(NOTE_NAME_MATCH_LIMIT);
  });

  it("marks a ghost match as not openable, like every other entry", () => {
    const nodes = [{ id: "g", title: "Ghost note", tags: [], ghost: true }];
    const [match] = matchNotesByName({ query: "ghost", nodes, links: [] });
    expect(match.openable).toBe(false);
    expect(match.ghost).toBe(true);
  });

  // Beyond the ported set: the matcher now feeds a renderer that must colour
  // each entry itself, so what it hands back has to carry enough to do that.
  // Without `tags`/`ghost` travelling, the rail would have to look the node up
  // in a graph copy it may not have — which is the coupling this move removed.
  it("carries what the renderer needs to colour an entry, and nothing about colour", () => {
    const nodes = [{ id: "n", title: "Tagged note", tags: ["arch", "wip"] }];
    const [match] = matchNotesByName({ query: "tagged", nodes, links: [] });
    expect(match).toEqual({
      id: "n",
      title: "Tagged note",
      tags: ["arch", "wip"],
      ghost: false,
      linkCount: 0,
      openable: true,
    });
  });

  it("returns the title as written, not the folded form used to match it", () => {
    expect(matchNotesByName({ query: "ghi chu", nodes: NAMED, links: NAMED_LINKS })[0].title).toBe(
      "Ghi chú kiến trúc",
    );
  });

  it("is total in its ordering, so the same query twice gives the same order", () => {
    const nodes = [
      { id: "b", title: "Same", tags: [] },
      { id: "a", title: "Same", tags: [] },
    ];
    expect(matchNotesByName({ query: "same", nodes, links: [] }).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("tolerates a missing graph rather than throwing at the voice layer", () => {
    expect(matchNotesByName({ query: "anything" })).toEqual([]);
    expect(matchNotesByName()).toEqual([]);
  });

  it("counts a link once per endpoint it touches", () => {
    const nodes = [
      { id: "hub", title: "Hub note", tags: [] },
      { id: "leaf", title: "Leaf note", tags: [] },
    ];
    const links = [
      { source: "hub", target: "leaf" },
      { source: "hub", target: "missing" },
    ];
    const byId = new Map(matchNotesByName({ query: "note", nodes, links }).map((m) => [m.id, m]));
    expect(byId.get("hub").linkCount).toBe(2);
    expect(byId.get("leaf").linkCount).toBe(1);
  });
});

describe("foldNoteName", () => {
  it("lowercases, strips diacritics and trims", () => {
    expect(foldNoteName("  Ghi Chú  ")).toBe("ghi chu");
  });

  it("folds a spoken title the transcription accented differently", () => {
    // The spoken route's actual failure mode: Gemini transcribes the title with
    // whatever accents it chose, which need not be the ones on disk.
    expect(foldNoteName("Kiến trúc")).toBe(foldNoteName("Kien truc"));
  });

  it("survives a null or undefined title without throwing", () => {
    expect(foldNoteName(undefined)).toBe("");
    expect(foldNoteName(null)).toBe("");
  });
});
