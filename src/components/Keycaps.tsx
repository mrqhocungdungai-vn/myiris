import { acceleratorParts } from "../lib/accelerator-label";

// One cap per key of a chord, so ⌥⇧W reads as three keys held together rather
// than as a word. Shared by every surface that names a shortcut — the deck's
// asleep hint and the setup wizard — because all of them must name the chord
// main actually registered, never a literal (wake-sleep-voice).
//
// Renders nothing when the accelerator can't be parsed: a caller that shows no
// key is honest, one that shows a wrong key is the defect.
export default function Keycaps({ accelerator }: { accelerator: string }) {
  const parts = acceleratorParts(accelerator);
  if (!parts.length) return null;
  return (
    <span className="keycaps">
      {parts.map((part, index) => (
        <kbd className="key" key={`${part}-${index}`}>
          {part}
        </kbd>
      ))}
    </span>
  );
}
