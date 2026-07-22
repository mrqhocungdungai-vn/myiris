// Trailing throttle: coalesces bursts of `schedule` calls into at most one
// `fn` call per `ms`, firing on the trailing edge with the latest args. See
// design.md D1/D4 of coalesce-activity-updates.
export function createTrailingThrottle(fn, ms) {
  let timer = null;
  let latestArgs = null;

  function schedule(...args) {
    latestArgs = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const args = latestArgs;
      latestArgs = null;
      fn(...args);
    }, ms);
  }

  function cancel() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    latestArgs = null;
  }

  return { schedule, cancel };
}
