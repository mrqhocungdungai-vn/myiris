import fs from "node:fs";

// Atomic replace: write to a pid-suffixed temp file, then rename onto the
// target. rename is atomic within a filesystem, so a crash mid-write can
// never leave the target truncated — see design.md D1 of
// harden-config-persistence.
export function writeFileAtomicSync(file, data, opts) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, data, opts);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

// Move an unreadable/corrupt file aside so its bytes survive rather than
// being silently discarded by the next overwrite — see design.md D2.
export function quarantineFile(file) {
  const quarantined = `${file}.corrupt-${Date.now()}`;
  fs.renameSync(file, quarantined);
  return quarantined;
}
