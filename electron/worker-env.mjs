// Shared by both role workers (harden-security-boundaries D12): a worker
// subprocess or SDK session gets an environment derived from the parent by
// subtraction, never the parent environment passed through unchanged. A
// worker runs with `bypassPermissions`, has shell and network access with no
// approval prompt, and routinely processes content it did not author — any
// secret sitting in its environment is one `echo $VAR` away from leaving the
// machine. DEV's spawn (main.mjs) and PO's Agent SDK session
// (po-session.mjs) both route through this so the two cannot drift apart.
export function computeWorkerEnv(baseEnv, excludeKeys) {
  const env = { ...baseEnv };
  for (const key of excludeKeys) delete env[key];
  return env;
}
