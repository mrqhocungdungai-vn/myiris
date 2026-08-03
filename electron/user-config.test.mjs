import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUserConfig, envFlag, envNumber, parseEnvFile } from "./user-config.mjs";

let repoRoot;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iris-user-config-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

function make(overrides = {}) {
  return createUserConfig({
    repoRoot,
    getIsPackaged: () => false,
    emitEvent: vi.fn(),
    emitToRenderer: vi.fn(),
    getLiveSession: () => null,
    runQueue: { list: () => [] },
    ...overrides,
  });
}

describe("user-config: env parsing", () => {
  it("envFlag treats common truthy strings as true, everything else as fallback", () => {
    process.env.TEST_FLAG = "yes";
    expect(envFlag("TEST_FLAG", false)).toBe(true);
    process.env.TEST_FLAG = "nope";
    expect(envFlag("TEST_FLAG", false)).toBe(false);
    delete process.env.TEST_FLAG;
    expect(envFlag("TEST_FLAG", true)).toBe(true);
  });

  it("envNumber falls back on missing, non-numeric, non-integer, or out-of-range values", () => {
    delete process.env.TEST_NUM;
    expect(envNumber("TEST_NUM", 5)).toBe(5);
    process.env.TEST_NUM = "not-a-number";
    expect(envNumber("TEST_NUM", 5)).toBe(5);
    process.env.TEST_NUM = "3.5";
    expect(envNumber("TEST_NUM", 5, { integer: true })).toBe(5);
    process.env.TEST_NUM = "42";
    expect(envNumber("TEST_NUM", 5, { min: 0, max: 10 })).toBe(5);
    process.env.TEST_NUM = "7";
    expect(envNumber("TEST_NUM", 5, { min: 0, max: 10 })).toBe(7);
  });

  it("parseEnvFile does not override an already-set process.env value", () => {
    const file = path.join(repoRoot, ".env");
    fs.writeFileSync(file, "SOME_KEY=from_file\n");
    process.env.SOME_KEY = "from_process";
    parseEnvFile(file);
    expect(process.env.SOME_KEY).toBe("from_process");
    delete process.env.SOME_KEY;
  });
});

describe("user-config: assertConfigValueIsSafe", () => {
  it("rejects values containing control characters or line breaks", () => {
    const config = make();
    expect(() => config.assertConfigValueIsSafe("IRIS_USER_NAME", "line1\nline2")).toThrow(/line break/);
    expect(() => config.assertConfigValueIsSafe("IRIS_USER_NAME", "bad\x00char")).toThrow(/line break/);
  });

  it("accepts an ordinary value", () => {
    const config = make();
    expect(() => config.assertConfigValueIsSafe("IRIS_USER_NAME", "Alex")).not.toThrow();
  });
});

describe("user-config: savePoToken", () => {
  it("writes the token to the resolved config path and never leaves it out of that file", () => {
    const config = make();
    const result = config.savePoToken("sk-test-token-123");
    expect(result.ok).toBe(true);

    const written = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
    expect(written).toContain("CLAUDE_CODE_OAUTH_TOKEN=sk-test-token-123");
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-test-token-123");
  });

  it("removes the token line entirely rather than writing an empty value", () => {
    const config = make();
    config.savePoToken("sk-test-token-123");
    const result = config.savePoToken(null, { remove: true });
    expect(result.ok).toBe(true);

    const written = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
    expect(written).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("refuses to save while a PO turn is running", () => {
    const config = make({ runQueue: { list: () => [{ agent: "po", status: "running" }] } });
    const result = config.savePoToken("sk-test-token-123");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PO turn is running/);
  });

  it("rejects an empty token when not removing", () => {
    const config = make();
    const result = config.savePoToken("   ");
    expect(result.ok).toBe(false);
  });

  it("writes the metered API key when that credential is selected", () => {
    const config = make();
    const result = config.savePoToken("sk-ant-api-key", { key: "ANTHROPIC_API_KEY" });
    expect(result.ok).toBe(true);

    const written = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
    expect(written).toContain("ANTHROPIC_API_KEY=sk-ant-api-key");
    expect(written).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(result.config.anthropicApiKeySet).toBe(true);
    expect(result.config.poTokenSet).toBe(false);
  });

  it("removes only the credential it was asked to remove", () => {
    const config = make();
    config.savePoToken("sk-test-token-123");
    config.savePoToken("sk-ant-api-key", { key: "ANTHROPIC_API_KEY" });

    const result = config.savePoToken(null, { remove: true, key: "ANTHROPIC_API_KEY" });
    expect(result.ok).toBe(true);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-test-token-123");
  });

  it("refuses a key that is not a Claude credential", () => {
    // The IPC payload is renderer-controlled, so an arbitrary key must not
    // become a write primitive into the user's .env.
    const config = make();
    const result = config.savePoToken("value", { key: "GEMINI_API_KEY" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a Claude credential/);
  });

  it("re-probes pipeline availability after a credential changes", () => {
    // The gate is a credential check now, so the UI would otherwise stay in
    // chat-only mode until the user hit "Test" or restarted.
    const probePipelineAvailability = vi.fn(async () => ({ available: true }));
    const config = make({ probePipelineAvailability });
    config.savePoToken("sk-test-token-123");
    expect(probePipelineAvailability).toHaveBeenCalledTimes(1);
  });
});

describe("user-config: writeUserConfig", () => {
  it("rejects keys outside the allowlist silently (no-op)", () => {
    const config = make();
    const before = fs.existsSync(path.join(repoRoot, ".env"));
    config.writeUserConfig({ NOT_ALLOWED: "value" });
    expect(fs.existsSync(path.join(repoRoot, ".env"))).toBe(before);
  });

  it("round-trips an allowed key through getFullConfig", () => {
    const config = make();
    config.writeUserConfig({ IRIS_USER_NAME: "Alex" });
    expect(config.getFullConfig().userName).toBe("Alex");
  });
});

describe("user-config: userConfigPath", () => {
  it("uses the repo .env in dev and ~/.iris/.env when packaged", () => {
    const devConfig = make({ getIsPackaged: () => false });
    expect(devConfig.userConfigPath()).toBe(path.join(repoRoot, ".env"));

    const packagedConfig = make({ getIsPackaged: () => true });
    expect(packagedConfig.userConfigPath()).toBe(path.join(os.homedir(), ".iris", ".env"));
  });
});
