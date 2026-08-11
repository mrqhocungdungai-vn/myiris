import { useEffect, useState } from "react";

// The effective config and the setup panel it drives.
//
// One domain because the panel's *existence* is decided by the config: a first
// run with no Gemini key opens the wizard automatically (design.md D3/D4), and
// a save from the panel writes back a fresh config, which is what keeps
// dependent toggles — the wake word in particular — in step with what was
// actually saved rather than with what the panel was opened on.

export type SetupMode = { mode: "onboarding" | "settings" };

export type AppConfig = {
  /** The effective config, or null until the first read lands. */
  config: IrisConfig | null;
  /** The open setup panel, or null. */
  setup: SetupMode | null;
  /** A save wrote a new config back. */
  applyConfig: (config: IrisConfig) => void;
  closeSetup: () => void;
  openWizard: () => void;
  /** Re-reads the config first, so Settings never shows a stale value. */
  openSettings: () => Promise<void>;
};

export function useAppConfig({
  hasBridge,
  onConfig,
}: {
  hasBridge: boolean;
  /** Called for every config that lands, so dependent state can follow it. */
  onConfig: (config: IrisConfig) => void;
}): AppConfig {
  const [config, setConfig] = useState<IrisConfig | null>(null);
  const [setup, setSetup] = useState<SetupMode | null>(null);

  // Load the effective config once, and auto-open the wizard if no Gemini key
  // is set yet.
  useEffect(() => {
    if (!hasBridge) return;
    let cancelled = false;
    (async () => {
      const next = await window.iris.getConfig();
      // The panel can be closed, or the bridge gone, before this resolves.
      if (cancelled) return;
      setConfig(next);
      if (!next.configured) setSetup({ mode: "onboarding" });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBridge]);

  // Every config that lands — first read or a panel save — is reported, so a
  // dependent toggle follows what was actually saved.
  useEffect(() => {
    if (config) onConfig(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  return {
    config,
    setup,
    applyConfig: setConfig,
    closeSetup: () => setSetup(null),
    openWizard: () => setSetup({ mode: "onboarding" }),
    async openSettings() {
      if (!hasBridge) return;
      // Re-read first: Settings must not show a value the panel was opened on.
      setConfig(await window.iris.getConfig());
      setSetup({ mode: "settings" });
    },
  };
}
