import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ReaderCore from "./ReaderCore";
import type { HandState } from "../hooks/useHandControl";

// Opens a vault note's markdown on a ReaderCore (second-brain-galaxy-view
// design.md D6/D9): no headerSlot (no run id / agent / status chrome — just
// the note's own content), and — matching ReaderOverlay exactly — no
// `rehype-raw`/`dangerouslySetInnerHTML`, so raw HTML in an untrusted note
// (wiki-ingest pulls web content into the vault) stays escaped rather than
// executing in the privileged renderer. `hand` is gated by the caller
// (`hand={handControl ? hand : null}`, mirroring ReaderOverlay — design.md
// D6 of second-brain-gesture-nav) so the reader's gesture bindings and footer
// hint light up only with hand control on.
export default function NoteReader({
  title,
  markdown,
  hand,
  handRef,
  onClose,
}: {
  title: string;
  markdown: string;
  hand: HandState | null;
  /** Per-frame hand data (useHandControl's stateRef) — read every rAF, not React state. */
  handRef: { current: HandState | null };
  onClose: () => void;
}) {
  return (
    <ReaderCore
      title={title}
      hand={hand}
      handRef={handRef}
      gesturesEnabled={hand != null}
      onClose={onClose}
      footerHint={
        hand
          ? "Open palm — hold high/low to scroll · Two open palms resize · Fist to close"
          : "Scroll to read · Esc or × to close"
      }
      body={
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      }
    />
  );
}
