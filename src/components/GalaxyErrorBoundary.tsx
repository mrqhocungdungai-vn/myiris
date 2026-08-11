import { Component, type ReactNode } from "react";

// Catches a crash in the WebGL galaxy layer and force-closes it.
//
// This is a **safety mechanism, not error cosmetics**. The galaxy is a
// fullscreen layer that disables click-through, so a crashed layer left mounted
// would sit over the whole desktop trapping every click with no way out
// (design.md D9/L3). Force-closing is the same exit Esc provides.
//
// The error is logged rather than swallowed, so a regression surfaces in
// devtools instead of as "the galaxy closed for no apparent reason".

export default class GalaxyErrorBoundary extends Component<{ onCrash: () => void; children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: unknown) {
    // A crashed WebGL layer must not leave the fullscreen click-through-
    // disabled overlay trapping desktop clicks (design.md D9/L3) — force the
    // whole galaxy closed, same as Esc. Logged (not swallowed silently) so a
    // regression like the d3AlphaTarget bug above is visible in devtools
    // instead of just "the galaxy closed for no apparent reason".
    console.error("[second-brain-galaxy-view] galaxy layer crashed, force-closing:", error);
    this.props.onCrash();
  }
  render() {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}
