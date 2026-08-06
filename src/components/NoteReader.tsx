import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Pencil } from "lucide-react";
import ReaderCore from "./ReaderCore";
import type { HandState } from "../hooks/useHandControl";

// Opens a vault note's markdown on a ReaderCore (second-brain-galaxy-view
// design.md D6/D9): no headerSlot chrome of the run reader (no run id / agent /
// status — just the note's own content), and — matching ReaderOverlay exactly —
// no `rehype-raw`/`dangerouslySetInnerHTML`, so raw HTML in an untrusted note
// (wiki-ingest pulls web content into the vault) stays escaped rather than
// executing in the privileged renderer. `hand` is gated by the caller
// (`hand={handControl ? hand : null}`, mirroring ReaderOverlay — design.md
// D6 of second-brain-gesture-nav) so the reader's gesture bindings and footer
// hint light up only with hand control on.
//
// add-manual-note-editing: the reader also EDITS. Three states — read, edit,
// and confirm-discard — because a close route that would throw away typing has
// to ask, and `window.confirm` is unavailable (`main-thread-budget` forbids
// blocking the renderer on a synchronous modal dialog).
type Mode = "read" | "edit" | "confirm-discard";

// A stable stand-in for the hand ref while editing — a fresh `{ current: null }`
// per render would be a new prop identity every keystroke. Nothing writes to it;
// ReaderCore's loop is not even scheduled while `gesturesEnabled` is false.
const NULL_HAND_REF: { current: HandState | null } = { current: null };

export default function NoteReader({
  noteId,
  title,
  markdown,
  revision,
  hand,
  handRef,
  onClose,
  onSaved,
}: {
  noteId: string;
  title: string;
  markdown: string;
  /** Token for the content `markdown` came from — handed back on save so main can refuse a write when the file has since changed. */
  revision: string;
  hand: HandState | null;
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState | null };
  onClose: () => void;
  onSaved: (content: string, revision: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("read");
  const [draft, setDraft] = useState(markdown);
  const [saving, setSaving] = useState(false);
  // Set when main refused the save because the file changed underneath. The
  // draft is deliberately kept: the user's text is the thing that would be lost,
  // and overwriting is theirs to choose, not ours to do (design.md D2).
  const [staleConflict, setStaleConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = mode !== "read" && draft !== markdown;

  // A note reopened, or reloaded under the same reader, must not keep the
  // previous note's draft.
  useEffect(() => {
    setMode("read");
    setDraft(markdown);
    setStaleConflict(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    if (mode === "edit") textareaRef.current?.focus();
  }, [mode]);

  function beginEdit() {
    setDraft(markdown);
    setStaleConflict(false);
    setError(null);
    setMode("edit");
  }

  function discard() {
    setDraft(markdown);
    setStaleConflict(false);
    setError(null);
    setMode("read");
  }

  async function save(force = false) {
    setSaving(true);
    setError(null);
    try {
      const result = await window.iris.writeSecondBrainNote(noteId, draft, revision, force);
      if (result.ok) {
        setStaleConflict(false);
        setMode("read");
        onSaved(draft, result.revision);
        return;
      }
      if (result.reason === "stale") {
        setStaleConflict(true);
        setError("This note changed on disk since you opened it. Your text is kept below.");
        return;
      }
      setError("Iris could not write this note.");
    } catch {
      setError("Iris could not write this note.");
    } finally {
      setSaving(false);
    }
  }

  // Every close route funnels through ReaderCore's closeWithSnap, so this one
  // guard covers Esc, the × control, the backdrop click, and the
  // fist-closes-reader gesture together (design.md D4).
  function closeGuard() {
    if (!dirty) return true;
    // A close attempt made while the prompt is already up IS an answer to it —
    // pressing Esc twice discards and closes rather than dead-ending against a
    // prompt that only a mouse can dismiss. The first attempt is what warned.
    if (mode === "confirm-discard") {
      setDraft(markdown);
      return true;
    }
    setMode("confirm-discard");
    return false;
  }

  // Gestures are suspended outright while editing (design.md D4): a
  // `Closed_Fist` closes the reader and an open palm scrolls it, either of which
  // would act on work in progress. Passing null down is the same mechanism that
  // already turns the reader's bindings off when hand control is off, so nothing
  // in ReaderCore needs to know about editing.
  const editing = mode !== "read";
  const gestureHand = editing ? null : hand;
  const gestureHandRef = editing ? NULL_HAND_REF : handRef;

  return (
    <ReaderCore
      title={title}
      hand={gestureHand}
      handRef={gestureHandRef}
      gesturesEnabled={gestureHand != null}
      onClose={onClose}
      closeGuard={closeGuard}
      headerSlot={
        mode === "read" ? (
          <div className="note-reader-actions">
            <button className="note-reader-action" onPointerDown={(e) => e.stopPropagation()} onClick={beginEdit} title="Edit this note">
              <Pencil size={14} /> Edit
            </button>
            <button
              className="note-reader-action"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => window.iris.openSecondBrainNoteExternally(noteId)}
              title="Open in the default app for markdown"
            >
              <ExternalLink size={14} /> Open externally
            </button>
          </div>
        ) : (
          <div className="note-reader-actions">
            <button
              className="note-reader-action primary"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => save()}
              disabled={saving || mode === "confirm-discard"}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="note-reader-action"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => (dirty ? setMode("confirm-discard") : discard())}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        )
      }
      footerHint={
        editing
          ? "Editing — Save writes to the vault · Esc asks before discarding · gestures are off while editing"
          : hand
            ? "Open palm — hold high/low to scroll · Two open palms resize · Fist to close"
            : "Scroll to read · Esc or × to close"
      }
      body={
        <>
          {mode === "confirm-discard" && (
            <div className="note-reader-confirm">
              <span>Discard unsaved changes?</span>
              <button className="note-reader-action" onClick={discard}>
                Discard
              </button>
              <button className="note-reader-action primary" onClick={() => setMode("edit")}>
                Keep editing
              </button>
            </div>
          )}
          {error && (
            <div className="note-reader-error">
              <span>{error}</span>
              {staleConflict && (
                <button className="note-reader-action" onClick={() => save(true)} disabled={saving}>
                  Overwrite anyway
                </button>
              )}
            </div>
          )}
          {editing ? (
            // The note's RAW text, frontmatter included (spec: "The editor shows
            // raw markdown") — what the vault actually stores is markdown with
            // frontmatter, and hiding either would put the note's own structure
            // out of reach of the person who owns it.
            <textarea
              ref={textareaRef}
              className="note-reader-editor"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            </div>
          )}
        </>
      }
    />
  );
}
