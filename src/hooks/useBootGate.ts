import { useEffect, useRef } from "react";
import { stepBootGate, type BootGateState } from "../lib/boot-gate";

// The boot intro, and telling main when it is gone.
//
// `stepBootGate` owns the decision (it is tested); this threads the state
// across renders and performs the one side effect: reporting boot-done so Iris
// can speak its welcome (design.md D6) — and **only for an intro that actually
// played**, which is why the report is a return value from the step rather
// than something inferred from `introVisible` going false.

export function useBootGate({
  running,
  connected,
  hasBridge,
  onBootingChange,
}: {
  running: boolean;
  connected: boolean;
  hasBridge: boolean;
  onBootingChange: (booting: boolean) => void;
}): void {
  const gateRef = useRef<BootGateState>({ running: false, introVisible: false });

  useEffect(() => {
    const { introVisible, reportBootDone } = stepBootGate(gateRef.current, { running, connected });
    gateRef.current = { running, introVisible };
    onBootingChange(introVisible);
    if (reportBootDone && hasBridge) window.iris.notifyBootDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, connected, hasBridge]);
}
