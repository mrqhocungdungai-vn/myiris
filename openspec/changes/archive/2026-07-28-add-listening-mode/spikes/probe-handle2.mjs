// probe-handle.mjs measured: with an activity held OPEN, the server emits zero
// sessionResumptionUpdate for 160 s. Hypothesis: an open activity is an
// unresumable point (genai.d.ts:8792 — "not possible to resume session at some
// points ... model executing function calls or just generating").
//
// Decisive question for the chunked design: after activityEnd and turnComplete,
// does a resumable handle arrive, and how long does it take? spike-listen4
// closed the session ~0 s after turnComplete and saw none, which would explain
// its FAIL without condemning the design.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";

function loadKey() {
  const env = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.trim().startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("GEMINI_API_KEY not found in the repo .env");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}
const readPcm = (f) => {
  const b = fs.readFileSync(path.join(import.meta.dirname, f));
  return b.subarray(b.indexOf("data") + 8);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LISTEN_SYSTEM = `Bạn là Iris, trợ lý giọng nói. Bạn đang ở CHẾ ĐỘ LẮNG NGHE.
Ghi nhớ toàn bộ nội dung, KHÔNG phân tích, KHÔNG bình luận.
Khi một đoạn kết thúc, chỉ trả lời đúng một từ: ok`;

const CONFIG = {
  responseModalities: ["AUDIO"],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
  sessionResumption: {},
  contextWindowCompression: { triggerTokens: 104857, slidingWindow: { targetTokens: 52428 } },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  systemInstruction: { parts: [{ text: LISTEN_SYSTEM }] },
  realtimeInputConfig: {
    automaticActivityDetection: { disabled: true },
    turnCoverage: "TURN_INCLUDES_ALL_INPUT",
    activityHandling: "NO_INTERRUPTION",
  },
};

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let turnCompletes = 0;
  let turnCompleteAt = null;
  const updates = [];

  const session = await ai.live.connect({
    model: MODEL,
    config: CONFIG,
    callbacks: {
      onopen: () => console.log(`[${at()}] open`),
      onmessage: (m) => {
        if (m.sessionResumptionUpdate) {
          const u = m.sessionResumptionUpdate;
          updates.push({ t: (Date.now() - t0) / 1000, resumable: !!u.resumable, handle: u.newHandle || "" });
          console.log(`[${at()}] resumptionUpdate resumable=${!!u.resumable} handleLen=${(u.newHandle || "").length}`);
        }
        if (m.serverContent?.turnComplete) {
          turnCompletes += 1;
          if (turnCompleteAt === null) turnCompleteAt = Date.now();
          console.log(`[${at()}] turnComplete #${turnCompletes}`);
        }
      },
      onerror: (e) => console.log(`[${at()}] ERROR`, e?.message || e),
      onclose: (e) => console.log(`[${at()}] close: ${e?.reason || "closed"}`),
    },
  });

  session.sendRealtimeInput({ activityStart: {} });
  const pcm = readPcm("c1.wav");
  for (let off = 0; off < pcm.length; off += 3200) {
    session.sendRealtimeInput({
      audio: { data: pcm.subarray(off, off + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
    await sleep(100);
  }
  console.log(`[${at()}] stream done — sending activityEnd`);
  const activityEndAt = Date.now();
  session.sendRealtimeInput({ activityEnd: {} });

  const deadline = Date.now() + 30000;
  while (turnCompletes < 1 && Date.now() < deadline) await sleep(200);
  console.log(`[${at()}] turn done — now watching 90 s for a resumable handle`);
  await sleep(90000);

  const activityEndMs = (activityEndAt - t0) / 1000;
  const before = updates.filter((u) => u.resumable && u.handle && u.t < activityEndMs);
  const resumable = updates.filter((u) => u.resumable && u.handle && u.t >= activityEndMs);
  console.log(`\nupdates total: ${updates.length}, resumable-with-handle after activityEnd: ${resumable.length}`);
  console.log(`resumable-with-handle BEFORE activityEnd: ${before.length}` +
    (before.length ? "  <-- would invalidate the verdict; the activity was not the gate" : ""));
  if (resumable.length) {
    const delay = turnCompleteAt ? ((resumable[0].t * 1000 + t0 - turnCompleteAt) / 1000).toFixed(1) : "?";
    console.log(`first resumable handle at ${resumable[0].t.toFixed(1)}s (${delay}s after turnComplete)`);
    console.log("VERDICT: closing the activity DOES unlock a checkpoint — the boundary must wait for it.");
  } else {
    console.log("VERDICT: no resumable handle even after the activity closed and the turn completed.");
  }
  session.close();
  process.exit(resumable.length && !before.length ? 0 : 1);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
