import { describe, it, expect, vi } from "vitest";
import {
  createSystemTelemetry,
  cpuBusyTotals,
  parseGpuUtilization,
  parseNetCounters,
  GPU_MISS_LIMIT,
} from "./system-telemetry.mjs";

// A trimmed but faithful slice of the real `ioreg -r -d 1 -w 0 -c IOAccelerator`
// PerformanceStatistics dictionary, captured on an Apple Silicon machine.
//
// THE DECOY IS THE POINT. `"Device Utilization % at cur p-state"=30` appears
// BEFORE the real `"Device Utilization %"=9`, so a pattern that omits the
// closing quote matches the decoy and reports roughly triple — plausibly, and
// with no other symptom. The per-unit keys are further near-misses. Do not
// "simplify" this fixture.
const IOREG_ONE_GPU = `
  +-o IOAccelerator  <class AGXAccelerator, id 0x100000abc, registered, matched, active, busy 0>
    {
      "PerformanceStatistics" = {"textureCount"=259,"Device Utilization % at cur p-state"=30,"Device Unit 0 Utilization %"=17,"Device Unit 1 Utilization %"=13,"Device Unit 2 Utilization %"=0,"Alloc system memory"=1234,"Device Utilization %"=9,"NewUtilizationAlgorithmEnable"=1,"inUseSystemMemory"=0}
      "IOClass" = "AGXAccelerator"
    }
`;

// An Intel machine with both an integrated and a discrete GPU: two dictionaries,
// two real keys, each with its own decoy.
const IOREG_TWO_GPUS = `
  +-o IOAccelerator  <class IntelAccelerator>
    {
      "PerformanceStatistics" = {"Device Utilization % at cur p-state"=88,"Device Utilization %"=4}
    }
  +-o IOAccelerator  <class AMDRadeonAccelerator>
    {
      "PerformanceStatistics" = {"Device Utilization % at cur p-state"=12,"Device Utilization %"=71}
    }
`;

// Real `netstat -ib` shape. Note the column count VARIES: interfaces with no
// address (lo0, gif0*, stf0*, utun0) print TEN fields, ones with a MAC print
// ELEVEN. Both end with the same seven numerics, so only the trailing fields
// can be indexed. MACs here are synthetic.
function netstat({ en0Rx = 4_721_211_452, en0Tx = 152_897_098, en6Rx = 328_257_753, en6Tx = 370_506_734, extra = "" } = {}) {
  return `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                        481910     0  466453111   481910     0  466453111     0
lo0        16384 127           localhost         481910     -  466453111   481910     -  466453111     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
stf0*      1280  <Link#3>                             0     0          0        0     0          0     0
en6        16000 <Link#4>    aa:bb:cc:00:00:01  4282122     0  ${en6Rx}  2083355   106  ${en6Tx}     0
en0        1500  <Link#6>    aa:bb:cc:00:00:02  4052540     0 ${en0Rx}  1365020     0  ${en0Tx}     0
en0        1500  192.168.1     macbook-pro       4052540     -  ${en0Rx}  1365020     -  ${en0Tx}     -
utun0      1380  <Link#14>                            0     0          0        0     0          0     0
bridge0    1500  <Link#13>   aa:bb:cc:00:00:03        0     0          0        0     0          0     0${extra}
`;
}

/** Lets an in-flight tick's probes resolve and its in-flight guard clear. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function cpus(busyPerCore, idlePerCore, cores = 4) {
  return Array.from({ length: cores }, () => ({
    times: { user: busyPerCore, nice: 0, sys: 0, idle: idlePerCore, irq: 0 },
  }));
}

/**
 * A sampler wired to controllable everything. `clock` advances only when a test
 * says so, and `stdoutFor` decides what each binary returns — a string for
 * output, an Error to fail the spawn.
 *
 * @param {{
 *   stdoutFor?: (bin: string, args: string[]) => string | Error,
 *   cpuReadings?: Array<Array<{ times: any }>>,
 *   platform?: string,
 *   onSample?: any,
 * }} [options]
 */
function make({ stdoutFor = () => "", cpuReadings = [], platform = "darwin", onSample = vi.fn() } = {}) {
  let clock = 1_000_000;
  let cpuIndex = 0;
  const calls = [];
  const telemetry = createSystemTelemetry({
    onSample,
    platform,
    now: () => clock,
    readCpus: () => cpuReadings[Math.min(cpuIndex++, cpuReadings.length - 1)] ?? cpus(0, 100),
    execFileImpl: (bin, args, _opts, cb) => {
      calls.push(bin);
      const out = stdoutFor(bin, args);
      // Asynchronous, like the real one — a synchronous callback would hide
      // every ordering bug the in-flight and generation guards exist for.
      queueMicrotask(() => (out instanceof Error ? cb(out) : cb(null, out)));
    },
    setIntervalImpl: () => ({ unref: () => {} }),
    clearIntervalImpl: () => {},
  });
  return {
    telemetry,
    onSample,
    calls,
    tick: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}

describe("parseGpuUtilization", () => {
  it("reads the real key, not the p-state decoy that precedes it", () => {
    expect(parseGpuUtilization(IOREG_ONE_GPU)).toBeCloseTo(0.09, 10);
  });

  it("takes the highest device when several report", () => {
    // 0.71, not 0.375 — averaging against a present-but-idle device would
    // understate how busy the graphics hardware actually is.
    expect(parseGpuUtilization(IOREG_TWO_GPUS)).toBeCloseTo(0.71, 10);
  });

  it("returns null when the host reports no such counter", () => {
    expect(parseGpuUtilization(`"PerformanceStatistics" = {"textureCount"=259}`)).toBeNull();
    expect(parseGpuUtilization("")).toBeNull();
    expect(parseGpuUtilization(null)).toBeNull();
  });

  it("clamps a nonsense reading into range rather than propagating it", () => {
    expect(parseGpuUtilization(`"Device Utilization %"=140`)).toBe(1);
  });

  it("does not carry regex state between calls", () => {
    // A module-level /g regex would make every other call miss.
    expect(parseGpuUtilization(IOREG_ONE_GPU)).toBeCloseTo(0.09, 10);
    expect(parseGpuUtilization(IOREG_ONE_GPU)).toBeCloseTo(0.09, 10);
    expect(parseGpuUtilization(IOREG_ONE_GPU)).toBeCloseTo(0.09, 10);
  });
});

describe("parseNetCounters", () => {
  it("reads both the ten-field and eleven-field Link rows", () => {
    const totals = parseNetCounters(netstat());
    expect(totals.get("en0")).toEqual({ rx: 4_721_211_452, tx: 152_897_098 });
    expect(totals.get("en6")).toEqual({ rx: 328_257_753, tx: 370_506_734 });
  });

  it("counts each interface once, ignoring its repeated address rows", () => {
    const totals = parseNetCounters(netstat());
    // en0 has a Link row and a 192.168.1 row carrying identical counters.
    expect(totals.get("en0").rx).toBe(4_721_211_452);
  });

  it("excludes loopback, tunnel and bridge interfaces", () => {
    const totals = parseNetCounters(netstat());
    expect(totals.has("lo0")).toBe(false);
    expect(totals.has("utun0")).toBe(false);
    expect(totals.has("bridge0")).toBe(false);
    expect(totals.has("gif0")).toBe(false);
    expect(totals.has("stf0")).toBe(false);
  });

  it("strips the down marker, so an interface coming up is not a new interface", () => {
    const down = parseNetCounters(
      `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
en5*  1500 <Link#9> aa:bb:cc:00:00:09 1 0 100 1 0 200 0`,
    );
    expect(down.has("en5")).toBe(true);
  });

  it("returns an empty map for junk", () => {
    expect(parseNetCounters("").size).toBe(0);
    expect(parseNetCounters(null).size).toBe(0);
    expect(parseNetCounters("not a table at all").size).toBe(0);
  });
});

describe("cpuBusyTotals", () => {
  it("counts nice and irq as busy", () => {
    const totals = cpuBusyTotals([{ times: { user: 10, nice: 5, sys: 3, idle: 82, irq: 2 } }]);
    expect(totals).toEqual({ busy: 20, total: 102 });
  });

  it("sums across cores", () => {
    expect(cpuBusyTotals(cpus(10, 90, 4))).toEqual({ busy: 40, total: 400 });
  });
});

describe("createSystemTelemetry", () => {
  const darwinStdout = (bin) => (bin === "ioreg" ? IOREG_ONE_GPU : netstat());

  it("reports absence, not zero, on the first sample of every delta-derived value", async () => {
    const h = make({ stdoutFor: darwinStdout, cpuReadings: [cpus(100, 900)] });
    const first = await h.telemetry.sampleOnce();
    expect(first.cpu).toBeNull();
    expect(first.netRx).toBeNull();
    expect(first.netTx).toBeNull();
    // The graphics probe needs no baseline, so it reports on the first tick.
    expect(first.gpu).toBeCloseTo(0.09, 10);
  });

  it("computes utilization and rates from the second sample onward", async () => {
    const h = make({
      stdoutFor: (bin) =>
        bin === "ioreg" ? IOREG_ONE_GPU : netstat(h.now() > 1_000_000 ? { en0Rx: 4_721_211_452 + 2_000_000 } : {}),
      // 40 busy of 400 total, then 140 of 600 => 100/200 = 50% over the interval.
      cpuReadings: [cpus(10, 90), cpus(35, 115)],
    });
    await h.telemetry.sampleOnce();
    h.tick(1000);
    const second = await h.telemetry.sampleOnce();
    expect(second.cpu).toBeCloseTo(0.5, 10);
    expect(second.netRx).toBeCloseTo(2_000_000, 6);
    expect(second.netTx).toBe(0);
  });

  it("reports absence rather than a negative rate when a counter goes backwards", async () => {
    const h = make({
      stdoutFor: (bin) => (bin === "ioreg" ? IOREG_ONE_GPU : netstat(h.now() > 1_000_000 ? { en0Rx: 1000 } : {})),
      cpuReadings: [cpus(10, 90), cpus(20, 180)],
    });
    await h.telemetry.sampleOnce();
    h.tick(1000);
    const second = await h.telemetry.sampleOnce();
    expect(second.netRx).toBeNull();
    expect(second.netTx).toBeNull();
  });

  it("re-baselines after a counter reset, so the tick after it reports normally", async () => {
    let phase = 0;
    const h = make({
      stdoutFor: (bin) => {
        if (bin === "ioreg") return IOREG_ONE_GPU;
        if (phase === 0) return netstat();
        if (phase === 1) return netstat({ en0Rx: 1000 });
        return netstat({ en0Rx: 1000 + 500_000 });
      },
      cpuReadings: [cpus(10, 90)],
    });
    await h.telemetry.sampleOnce();
    phase = 1;
    h.tick(1000);
    await h.telemetry.sampleOnce();
    phase = 2;
    h.tick(1000);
    const third = await h.telemetry.sampleOnce();
    expect(third.netRx).toBeCloseTo(500_000, 6);
  });

  it("gives an interface that appeared since the last reading no lifetime spike", async () => {
    const vpnUp = `
en9        1500  <Link#20>   aa:bb:cc:00:00:20        0     0  999999999        0     0  888888888     0`;
    let phase = 0;
    const h = make({
      stdoutFor: (bin) => (bin === "ioreg" ? IOREG_ONE_GPU : netstat(phase === 0 ? {} : { extra: vpnUp })),
      cpuReadings: [cpus(10, 90)],
    });
    await h.telemetry.sampleOnce();
    phase = 1;
    h.tick(1000);
    const second = await h.telemetry.sampleOnce();
    // en9 contributes nothing on the tick it appeared; en0/en6 were flat.
    expect(second.netRx).toBe(0);
    expect(second.netTx).toBe(0);
  });

  it("stops spawning the graphics probe after repeated absences", async () => {
    const h = make({
      stdoutFor: (bin) => (bin === "ioreg" ? "no counter here" : netstat()),
      cpuReadings: [cpus(10, 90)],
    });
    for (let i = 0; i < GPU_MISS_LIMIT + 3; i += 1) {
      h.tick(1000);
      const sample = await h.telemetry.sampleOnce();
      expect(sample.gpu).toBeNull();
    }
    expect(h.calls.filter((bin) => bin === "ioreg")).toHaveLength(GPU_MISS_LIMIT);
    // The network probe is unaffected — the disable is per measurement.
    expect(h.calls.filter((bin) => bin === "netstat").length).toBeGreaterThan(GPU_MISS_LIMIT);
  });

  it("reports absence, and no error, when a probe fails outright", async () => {
    const h = make({
      stdoutFor: () => new Error("spawn ENOENT"),
      cpuReadings: [cpus(10, 90)],
    });
    const sample = await h.telemetry.sampleOnce();
    expect(sample.gpu).toBeNull();
    expect(sample.netRx).toBeNull();
  });

  it("survives a probe that throws synchronously", async () => {
    const telemetry = createSystemTelemetry({
      platform: "darwin",
      readCpus: () => cpus(10, 90),
      execFileImpl: () => {
        throw new Error("no such binary");
      },
      setIntervalImpl: () => ({ unref: () => {} }),
      clearIntervalImpl: () => {},
    });
    await expect(telemetry.sampleOnce()).resolves.toMatchObject({ gpu: null, netRx: null });
  });

  it("measures the processor only, and spawns nothing, off darwin", async () => {
    const h = make({ platform: "linux", cpuReadings: [cpus(10, 90), cpus(20, 180)] });
    await h.telemetry.sampleOnce();
    h.tick(1000);
    const second = await h.telemetry.sampleOnce();
    expect(second.cpu).toBeCloseTo(0.1, 10);
    expect(second.gpu).toBeNull();
    expect(second.netRx).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it("skips an overlapping tick rather than queueing it", async () => {
    /** @type {Array<() => void>} */
    const pending = [];
    const telemetry = createSystemTelemetry({
      platform: "darwin",
      readCpus: () => cpus(10, 90),
      now: () => 1_000_000,
      execFileImpl: (bin, _args, _opts, cb) => {
        pending.push(() => cb(null, bin === "ioreg" ? IOREG_ONE_GPU : netstat()));
      },
      setIntervalImpl: () => ({ unref: () => {} }),
      clearIntervalImpl: () => {},
    });
    const first = telemetry.sampleOnce();
    // Still in flight — the interval fires again and must not stack a second run.
    expect(await telemetry.sampleOnce()).toBeNull();
    expect(pending).toHaveLength(2);
    for (const resolve of pending) resolve();
    expect(await first).not.toBeNull();
  });

  it("never emits a sample that was in flight when it stopped", async () => {
    /** @type {Array<() => void>} */
    const pending = [];
    const onSample = vi.fn();
    const telemetry = createSystemTelemetry({
      onSample,
      platform: "darwin",
      readCpus: () => cpus(10, 90),
      execFileImpl: (bin, _args, _opts, cb) => {
        pending.push(() => cb(null, bin === "ioreg" ? IOREG_ONE_GPU : netstat()));
      },
      setIntervalImpl: () => ({ unref: () => {} }),
      clearIntervalImpl: () => {},
    });
    telemetry.start();
    expect(pending.length).toBeGreaterThan(0);
    telemetry.stop();
    for (const resolve of pending) resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onSample).not.toHaveBeenCalled();
  });

  it("start and stop are idempotent, and stop is safe having never started", () => {
    let intervals = 0;
    let cleared = 0;
    const telemetry = createSystemTelemetry({
      platform: "linux",
      readCpus: () => cpus(10, 90),
      setIntervalImpl: () => {
        intervals += 1;
        return { unref: () => {} };
      },
      clearIntervalImpl: () => {
        cleared += 1;
      },
    });
    telemetry.stop();
    expect(cleared).toBe(0);
    telemetry.start();
    telemetry.start();
    expect(intervals).toBe(1);
    expect(telemetry.isRunning()).toBe(true);
    telemetry.stop();
    telemetry.stop();
    expect(cleared).toBe(1);
    expect(telemetry.isRunning()).toBe(false);
  });

  it("clears every baseline on start, so the first rate after a pause is not the pause", async () => {
    let phase = 0;
    const h = make({
      stdoutFor: (bin) => (bin === "ioreg" ? IOREG_ONE_GPU : netstat(phase === 0 ? {} : { en0Rx: 4_721_211_452 + 9e9 })),
      cpuReadings: [cpus(10, 90), cpus(20, 180), cpus(30, 270)],
    });
    await h.telemetry.sampleOnce();
    h.telemetry.start();
    h.telemetry.stop();
    await settle();
    // start() ran a tick of its own against a cleared baseline; the long gap
    // that follows must not turn into a rate.
    phase = 1;
    h.tick(600_000);
    const afterPause = await h.telemetry.sampleOnce();
    expect(afterPause.netRx).toBeLessThan(1e9);
  });

  it("re-probes graphics after a restart, so hardware attached mid-session is noticed", async () => {
    let hasGpu = false;
    const h = make({
      stdoutFor: (bin) => (bin === "ioreg" ? (hasGpu ? IOREG_ONE_GPU : "nothing") : netstat()),
      cpuReadings: [cpus(10, 90)],
    });
    for (let i = 0; i < GPU_MISS_LIMIT; i += 1) await h.telemetry.sampleOnce();
    expect((await h.telemetry.sampleOnce()).gpu).toBeNull();
    const beforeRestart = h.calls.filter((bin) => bin === "ioreg").length;

    hasGpu = true;
    h.telemetry.start();
    h.telemetry.stop();
    await settle();
    const resumed = await h.telemetry.sampleOnce();
    expect(resumed.gpu).toBeCloseTo(0.09, 10);
    expect(h.calls.filter((bin) => bin === "ioreg").length).toBeGreaterThan(beforeRestart);
  });

  it("hands every sample to onSample with the full five-field shape", async () => {
    const h = make({ stdoutFor: darwinStdout, cpuReadings: [cpus(10, 90)] });
    await h.telemetry.sampleOnce();
    expect(h.onSample).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.onSample.mock.calls[0][0]).sort()).toEqual(["at", "cpu", "gpu", "netRx", "netTx"]);
  });
});
