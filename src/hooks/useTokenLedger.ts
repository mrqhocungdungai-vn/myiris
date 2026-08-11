import { useEffect, useRef } from "react";

// token-accounting: the renderer's end of the token channel. Main counts; this
// asks for the session's figures once and then follows the changes, parking the
// latest snapshot in a ref (the same seam useSystemTelemetry gives the overlays
// for host measurements).
//
// Deliberately publishes NO React state. Nothing in the tree branches on a
// token figure, so a change re-renders nothing at all — the overlays read
// `ledgerRef` inside the rAF loops they already run.
//
// Unlike useSystemTelemetry, this does NOT start or stop anything in main.
// Counting runs from app start regardless of the camera (design D6), so there
// is nothing here to gate: the subscribe is a "the renderer is watching now"
// marker and the snapshot is what makes opening late harmless.

// `TokenUsageSnapshot` is the global declared alongside IrisApi in
// vite-env.d.ts — the same convention every other IPC payload type follows, so
// the shape has one definition and it is the one the preload surface is typed
// against.

/** Absent everywhere: nothing has been reported, which is not the same as zero. */
export const EMPTY_LEDGER: TokenUsageSnapshot = {
  gemini: { total: null, last: null, at: null },
  claude: { total: null, last: null, cacheRead: null, at: null },
};

export type TokenLedgerRef = { current: TokenUsageSnapshot };

/**
 * What the ring's alert watches. Kept beside the snapshot rather than derived
 * from it, because "has this run already been announced" is renderer state that
 * main knows nothing about.
 */
export type TokenAlertSeenRef = { current: number | null };

/**
 * Call ONCE, at App level, for the same reason useSystemTelemetry states: the
 * overlays mount in BOTH camera surfaces and unmount on every face loss, so
 * subscribing inside one would open two subscriptions and thrash them on every
 * blink.
 *
 * Not gated on the camera. The account exists whether or not anything is
 * displaying it, and a hook that only subscribed while the camera was on would
 * show a panel opened late an apparent fresh start — which the snapshot below
 * exists to prevent.
 */
export function useTokenLedger(): { ledgerRef: TokenLedgerRef; alertSeenRef: TokenAlertSeenRef } {
  const ledgerRef = useRef<TokenUsageSnapshot>(EMPTY_LEDGER);
  const alertSeenRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window.iris === "undefined") return;
    let live = true;
    const unsubscribe = window.iris.onTokenUsage((snapshot) => {
      ledgerRef.current = snapshot;
    });
    window.iris
      .getTokenUsage()
      .then((snapshot) => {
        if (!live) return;
        // THE FIRST SNAPSHOT'S `claude.at` IS ALREADY SEEN (design D14). It
        // carries whatever ran last — possibly an hour ago, possibly before
        // this window existed. Without this line, every camera-on flashes a
        // badge for old work, and an alert is a notification rather than a
        // record.
        //
        // Recorded even if a pushed update raced ahead of the reply: the seen
        // mark is about what predates this subscription, and the newer
        // timestamp is the safer one to treat as already announced. A run
        // finishing in that millisecond loses its badge, not its tokens.
        alertSeenRef.current = ledgerRef.current.claude.at ?? snapshot.claude.at;
        // The push may have landed first and be newer; never overwrite it with
        // a staler pull.
        if (ledgerRef.current === EMPTY_LEDGER) ledgerRef.current = snapshot;
      })
      .catch(() => {
        // A snapshot that never arrives leaves the panel absent rather than
        // wrong, and nothing here surfaces an error to the user — the same
        // rule the readout applies to a measurement that could not be taken.
      });
    window.iris.subscribeTokenUsage();
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return { ledgerRef, alertSeenRef };
}
