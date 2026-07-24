import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ReaderCore from "./ReaderCore";

// Opens a vault note's markdown on a ReaderCore (second-brain-galaxy-view
// design.md D6/D9): no headerSlot (no run id / agent / status chrome — just
// the note's own content), and — matching ReaderOverlay exactly — no
// `rehype-raw`/`dangerouslySetInnerHTML`, so raw HTML in an untrusted note
// (wiki-ingest pulls web content into the vault) stays escaped rather than
// executing in the privileged renderer. Gesture bindings are deferred to
// second-brain-gesture-nav — `hand={null}` here (ReaderCore's rAF loop is
// null-safe: `h?.hands … ?? []`).
export default function NoteReader({ title, markdown, onClose }: { title: string; markdown: string; onClose: () => void }) {
  return (
    <ReaderCore
      title={title}
      hand={null}
      handRef={{ current: null }}
      onClose={onClose}
      footerHint="Scroll to read · Esc or × to close"
      body={
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </div>
      }
    />
  );
}
