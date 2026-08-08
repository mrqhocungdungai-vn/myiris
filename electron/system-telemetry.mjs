// Host telemetry sampling for the eye-tracking HUD's readout panel: processor,
// graphics and network, once a second, while the camera is on. Electron-free —
// the child process, the clock, the CPU reader and the timers are all injected,
// on the same seam pipeline-probes.mjs already uses, so the parsers below can be
// driven with captured fixture strings and no real subprocess.
//
// This module measures; electron/capabilities/hud-telemetry.mjs owns the
// lifecycle and the push to the renderer (hud-readout-shows-real-telemetry D2).
//
// EVERY absence is `null` — no delta yet, probe failed, probe timed out, no
// counter on this host, not macOS. One rule downstream instead of four, and one
// spec requirement instead of a list of cases (D5). Nothing here ever throws or
// rejects: a probe that fails resolves to a status, like checkClaudeStatus.
import os from "node:os";
import { execFile as nodeExecFile } from "node:child_process";

/**
 * One second, and the number is load-bearing (D3). Measured: the graphics probe
 * costs ~0.03s of CPU per call and the network probe ~0.01s, so 1 Hz is ~0.35%
 * of a twelve-core machine. At 500ms the sampler starts visibly moving the very
 * number it displays — a readout that measures its own overhead is worse than
 * one that is slightly slow, and the failure is invisible because the number
 * stays *correct*, it is just partly about the panel.
 */
export const SAMPLE_INTERVAL_MS = 1000;

const PROBE_TIMEOUT_MS = 2000;
const PROBE_MAX_BUFFER = 1 << 20;

/** Consecutive absences after which the graphics probe stops being spawned (D5). */
export const GPU_MISS_LIMIT = 3;

// `-c IOAccelerator` matches AGXAccelerator by subclass, so one command covers
// both Apple Silicon and Intel.
const IOREG_ARGS = ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"];
const NETSTAT_ARGS = ["-ib"];

/**
 * THE CLOSING QUOTE IS LOAD-BEARING. The same one-line PerformanceStatistics
 * dictionary also carries `"Device Utilization % at cur p-state"=30` — and that
 * decoy appears BEFORE the real `"Device Utilization %"=9`. A pattern without
 * the closing quote matches the decoy first and reports roughly triple,
 * silently and plausibly (D4). The fixture in the test file keeps the decoy.
 */
const GPU_UTILIZATION_SOURCE = String.raw`"Device Utilization %"\s*=\s*(\d+)`;

/**
 * Interfaces whose bytes are already counted on a physical interface, so
 * including them double-counts: loopback, the IPv4/IPv6 tunnel pseudo-devices,
 * VPN tunnels (which carry the same payload as whatever they ride on), and the
 * Thunderbolt bridge (which aggregates its member interfaces).
 *
 * Deliberately a heuristic, not a routing-table read: this feeds a decorative
 * overlay, and an exotic interface set mis-counting is not worth more machinery
 * than one regex (D4).
 */
const AGGREGATED_INTERFACE = /^(lo|gif|stf|utun|ipsec|bridge)\d/;

/**
 * Highest `Device Utilization %` in the output, as a 0..1 fraction, or null if
 * the host reports none. Several devices — an integrated and a discrete GPU —
 * take the MAX: for a single "how busy is the graphics hardware" figure,
 * averaging against a present-but-idle device understates it.
 *
 * @param {string | null} stdout
 * @returns {number | null}
 */
export function parseGpuUtilization(stdout) {
  if (!stdout) return null;
  let best = null;
  // A fresh RegExp per call: a module-level /g regex carries lastIndex between
  // calls, which would make every other call skip matches.
  for (const match of String(stdout).matchAll(new RegExp(GPU_UTILIZATION_SOURCE, "g"))) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    if (best === null || value > best) best = value;
  }
  if (best === null) return null;
  return Math.max(0, Math.min(100, best)) / 100;
}

/**
 * Cumulative received/sent byte counters per interface, from `netstat -ib`.
 *
 * Only the `<Link#N>` rows are read — netstat prints one further row per
 * address, repeating the same counters, so summing every row would multiply
 * them by however many addresses each interface happens to hold.
 *
 * THE COLUMN COUNT VARIES: a Link row has ELEVEN fields when the Address column
 * is present and TEN when it is not (down and virtual interfaces have no
 * address). Both shapes end with the same seven numerics —
 * Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll — so only the trailing fields can
 * be indexed. Both widths are in the test fixture (D4).
 *
 * @param {string | null} stdout
 * @returns {Map<string, { rx: number, tx: number }>}
 */
export function parseNetCounters(stdout) {
  /** @type {Map<string, { rx: number, tx: number }>} */
  const totals = new Map();
  if (!stdout) return totals;
  for (const line of String(stdout).split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    if (!fields[2].startsWith("<Link#")) continue;
    // A trailing `*` marks the interface down; it is part of the display, not
    // of the name, and an interface that goes up mid-session must match the
    // baseline it had while down rather than reading as a new interface.
    const name = fields[0].replace(/\*$/, "");
    if (AGGREGATED_INTERFACE.test(name)) continue;
    const tail = fields.slice(-7);
    const rx = Number(tail[2]);
    const tx = Number(tail[5]);
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    totals.set(name, { rx, tx });
  }
  return totals;
}

/**
 * Summed busy and total jiffies across cores. `nice` and `irq` count as busy:
 * a machine pinned by a niced build is not idle, and the panel exists to show
 * that it isn't.
 *
 * @param {Array<{ times: { user: number, nice: number, sys: number, idle: number, irq: number } }>} cpus
 * @returns {{ busy: number, total: number }}
 */
export function cpuBusyTotals(cpus) {
  let busy = 0;
  let total = 0;
  for (const cpu of cpus || []) {
    const times = cpu.times;
    const active = times.user + times.nice + times.sys + times.irq;
    busy += active;
    total += active + times.idle;
  }
  return { busy, total };
}

/**
 * @typedef {{
 *   at: number,
 *   cpu: number | null,
 *   gpu: number | null,
 *   netRx: number | null,
 *   netTx: number | null,
 * }} TelemetrySample
 *
 * `cpu`/`gpu` are 0..1 fractions; `netRx`/`netTx` are bytes per second. Five
 * flat scalars — no nesting, no strings, no arrays — so the renderer reads
 * fields without allocating and the structured-clone across IPC is trivial.
 * Rates are deliberately NOT normalized here: bytes per second is the truth,
 * and mapping a rate onto a meter is display policy that belongs in src/lib.
 */

/**
 * @param {{
 *   onSample?: (sample: TelemetrySample) => void,
 *   execFileImpl?: (bin: string, args: string[], opts: any, cb: (error: any, stdout?: any, stderr?: any) => void) => any,
 *   readCpus?: () => Array<{ times: { user: number, nice: number, sys: number, idle: number, irq: number } }>,
 *   now?: () => number,
 *   platform?: string,
 *   intervalMs?: number,
 *   setIntervalImpl?: (fn: () => void, ms: number) => any,
 *   clearIntervalImpl?: (handle: any) => void,
 * }} [deps]
 */
export function createSystemTelemetry({
  onSample,
  execFileImpl = nodeExecFile,
  readCpus = () => os.cpus(),
  now = () => Date.now(),
  platform = process.platform,
  intervalMs = SAMPLE_INTERVAL_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  /** @type {any} */
  let timer = null;
  /** Bumped by stop(), so a probe still in flight can never emit into a stopped
   * sampler — vault-graph.mjs's scanGeneration, for the same reason. */
  let generation = 0;
  /** Skips an overlapping tick rather than queueing it (D6). */
  let inFlight = false;

  /** @type {{ busy: number, total: number } | null} */
  let cpuBaseline = null;
  /** @type {Map<string, { rx: number, tx: number }> | null} */
  let netBaseline = null;
  let netBaselineAt = 0;

  let gpuMisses = 0;
  let gpuSupported = true;

  /**
   * Resolves stdout, or null for any failure at all — missing binary, nonzero
   * exit, timeout, a synchronous throw from the spawn itself. Never rejects.
   * @returns {Promise<string | null>}
   */
  function run(binary, args) {
    return new Promise((resolve) => {
      try {
        execFileImpl(binary, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER }, (error, stdout) => {
          resolve(error ? null : String(stdout ?? ""));
        });
      } catch {
        resolve(null);
      }
    });
  }

  /** @returns {number | null} */
  function sampleCpu() {
    /** @type {{ busy: number, total: number }} */
    let totals;
    try {
      totals = cpuBusyTotals(readCpus());
    } catch {
      return null;
    }
    const previous = cpuBaseline;
    cpuBaseline = totals;
    if (!previous) return null;
    const busy = totals.busy - previous.busy;
    const total = totals.total - previous.total;
    // A counter that went backwards or stood still says nothing about the
    // interval; reporting 0 would say the machine was idle through it.
    if (!(total > 0) || busy < 0) return null;
    return Math.max(0, Math.min(1, busy / total));
  }

  /** @returns {Promise<number | null>} */
  async function sampleGpu() {
    if (platform !== "darwin" || !gpuSupported) return null;
    const stdout = await run("ioreg", IOREG_ARGS);
    const value = parseGpuUtilization(stdout);
    if (value === null) {
      gpuMisses += 1;
      // A host without this counter will not grow one, and paying 30ms a second
      // forever to receive a guaranteed null is the wrong trade. start() clears
      // this, so toggling the camera re-probes a machine whose hardware changed.
      if (gpuMisses >= GPU_MISS_LIMIT) gpuSupported = false;
      return null;
    }
    gpuMisses = 0;
    return value;
  }

  /** @returns {Promise<{ rx: number | null, tx: number | null }>} */
  async function sampleNet() {
    if (platform !== "darwin") return { rx: null, tx: null };
    const stdout = await run("netstat", NETSTAT_ARGS);
    if (stdout === null) return { rx: null, tx: null };
    const totals = parseNetCounters(stdout);
    // Timestamped where the reading actually landed, not at tick entry: the
    // probe resolves some milliseconds in, and using tick entry would bias
    // every rate. It is also why a skipped tick self-corrects — the next one
    // computes a correct two-second rate rather than a wrong one-second rate.
    const at = now();
    const previous = netBaseline;
    const previousAt = netBaselineAt;
    netBaseline = totals;
    netBaselineAt = at;
    if (!previous || !(at > previousAt)) return { rx: null, tx: null };

    const seconds = (at - previousAt) / 1000;
    let rx = 0;
    let tx = 0;
    let matched = 0;
    for (const [name, counters] of totals) {
      const before = previous.get(name);
      // Appeared since the last reading — a VPN coming up contributes 0 for one
      // tick rather than a spike of its whole lifetime total.
      if (!before) continue;
      const deltaRx = counters.rx - before.rx;
      const deltaTx = counters.tx - before.tx;
      // Counter wrap, or an interface bouncing and resetting: the baseline is
      // already replaced above, so reporting absence for this one tick
      // re-synchronizes without ever emitting a negative or absurd rate.
      if (deltaRx < 0 || deltaTx < 0) return { rx: null, tx: null };
      rx += deltaRx;
      tx += deltaTx;
      matched += 1;
    }
    if (matched === 0) return { rx: null, tx: null };
    return { rx: rx / seconds, tx: tx / seconds };
  }

  /**
   * One tick. Exported as sampleOnce so tests drive it directly and never need
   * fake timers.
   * @returns {Promise<TelemetrySample | null>}
   */
  async function sampleOnce() {
    if (inFlight) return null;
    const entered = generation;
    inFlight = true;
    try {
      const cpu = sampleCpu();
      const [gpu, net] = await Promise.all([sampleGpu(), sampleNet()]);
      if (entered !== generation) return null;
      /** @type {TelemetrySample} */
      const sample = { at: now(), cpu, gpu, netRx: net.rx, netTx: net.tx };
      onSample?.(sample);
      return sample;
    } finally {
      inFlight = false;
    }
  }

  /**
   * Idempotent, so camera toggling and deck/HUD churn cost nothing.
   *
   * Every baseline is cleared first: reusing one from before a pause would make
   * the first delta describe the whole pause. The first tick therefore reports
   * absence for everything derived from a delta — the honest answer, and it
   * lands in the same moment as the ring's convergence, so it reads as
   * acquisition rather than as failure (D6).
   */
  function start() {
    if (timer) return;
    cpuBaseline = null;
    netBaseline = null;
    netBaselineAt = 0;
    gpuMisses = 0;
    gpuSupported = true;
    timer = setIntervalImpl(() => {
      void sampleOnce();
    }, intervalMs);
    timer?.unref?.();
    void sampleOnce();
  }

  /** Idempotent, and safe to call having never started. */
  function stop() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
    generation += 1;
  }

  return {
    start,
    stop,
    sampleOnce,
    isRunning: () => timer !== null,
  };
}
