// canvas-claude-mcp design.md D4 / task 7.5: echo-suppression for
// DrawingCanvas.tsx's canvas:apply -> updateScene -> onChange -> canvas:scene
// loop. DrawingCanvas.tsx itself can't be mounted here (it lazy-loads
// @excalidraw/excalidraw and depends on window.iris/Electron IPC), so this
// exercises sceneSignature directly against the two hard cases the guard
// (`sceneSignature(elements) === lastAppliedSignature`) relies on: an
// external apply's echo must be recognized (same signature) and a genuine
// user edit afterwards must NOT be swallowed (different signature, since any
// real excalidraw mutation bumps the touched element's version/versionNonce).
import { describe, it, expect } from "vitest";
import { sceneSignature } from "./DrawingCanvas";

type El = { id: string; version?: number; versionNonce?: number; isDeleted?: boolean };

function applyAndOnChange(applied: El[], onChangeElements: El[]) {
  const lastAppliedSignature = sceneSignature(applied);
  const isEcho = sceneSignature(onChangeElements) === lastAppliedSignature;
  return isEcho;
}

describe("sceneSignature echo suppression", () => {
  it("recognizes onChange firing with exactly the just-applied elements as an echo", () => {
    const applied: El[] = [{ id: "a", version: 3, versionNonce: 111 }, { id: "b", version: 1, versionNonce: 222 }];
    // updateScene's own onChange reports the identical elements it was just given.
    const echoed: El[] = [...applied];
    expect(applyAndOnChange(applied, echoed)).toBe(true);
  });

  it("does not suppress a genuine user edit after the apply (version/versionNonce bumped)", () => {
    const applied: El[] = [{ id: "a", version: 3, versionNonce: 111 }];
    const genuineEdit: El[] = [{ id: "a", version: 4, versionNonce: 333 }]; // user dragged it
    expect(applyAndOnChange(applied, genuineEdit)).toBe(false);
  });

  it("does not suppress a genuine new element added by the user after the apply", () => {
    const applied: El[] = [{ id: "a", version: 3, versionNonce: 111 }];
    const withNewElement: El[] = [...applied, { id: "new-from-user", version: 1, versionNonce: 999 }];
    expect(applyAndOnChange(applied, withNewElement)).toBe(false);
  });

  it("is order-independent (updateScene/onChange element ordering is not guaranteed)", () => {
    const applied: El[] = [{ id: "a", version: 1, versionNonce: 1 }, { id: "b", version: 2, versionNonce: 2 }];
    const reordered: El[] = [applied[1], applied[0]];
    expect(sceneSignature(applied)).toBe(sceneSignature(reordered));
  });

  it("ignores isDeleted tombstones so a prior delete doesn't perturb the signature", () => {
    const withTombstone: El[] = [{ id: "a", version: 1, versionNonce: 1 }, { id: "gone", version: 2, versionNonce: 2, isDeleted: true }];
    const withoutTombstone: El[] = [{ id: "a", version: 1, versionNonce: 1 }];
    expect(sceneSignature(withTombstone)).toBe(sceneSignature(withoutTombstone));
  });
});
