// Diagnostic: when does the server actually send sessionResumptionUpdate, and
// with resumable=true? spike-listen4 saw zero handles in ~15 s chunks, which
// would make the chunked design untestable at that length. Real chunks are
// ~10 min, so the question is only whether the cadence is short enough that a
// boundary always has a fresh handle in hand.

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

const CONFIG = {
  responseModalities: ["AUDIO"],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
  sessionResumption: {},
  contextWindowCompression: { triggerTokens: 104857, slidingWindow: { targetTokens: 52428 } },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  systemInstruction: { parts: [{ text: "Bạn là Iris. Trả lời ngắn gọn bằng tiếng Việt." }] },
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
  const updates = [];

  const session = await ai.live.connect({
    model: MODEL,
    config: CONFIG,
    callbacks: {
      onopen: () => console.log(`[${at()}] open`),
      onmessage: (m) => {
        if (m.setupComplete) console.log(`[${at()}] setupComplete`);
        if (m.sessionResumptionUpdate) {
          const u = m.sessionResumptionUpdate;
          updates.push({ t: (Date.now() - t0) / 1000, resumable: !!u.resumable, len: (u.newHandle || "").length });
          console.log(`[${at()}] resumptionUpdate resumable=${!!u.resumable} handleLen=${(u.newHandle || "").length}`);
        }
        if (m.goAway) console.log(`[${at()}] goAway timeLeft=${m.goAway.timeLeft}`);
      },
      onerror: (e) => console.log(`[${at()}] ERROR`, e?.message || e),
      onclose: (e) => console.log(`[${at()}] close: ${e?.reason || "closed"}`),
    },
  });

  console.log(`[${at()}] activityStart + stream c1`);
  session.sendRealtimeInput({ activityStart: {} });
  const pcm = readPcm("c1.wav");
  for (let off = 0; off < pcm.length; off += 3200) {
    session.sendRealtimeInput({
      audio: { data: pcm.subarray(off, off + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" },
    });
    await sleep(100);
  }
  console.log(`[${at()}] stream done — holding activity open, watching for 150 s`);
  await sleep(150000);

  console.log(`\nupdates: ${updates.length}`);
  const resumable = updates.filter((u) => u.resumable);
  console.log(`first resumable at: ${resumable.length ? `${resumable[0].t.toFixed(1)}s` : "NEVER"}`);
  if (resumable.length > 1) {
    const gaps = resumable.slice(1).map((u, i) => (u.t - resumable[i].t).toFixed(1));
    console.log(`gaps between resumable updates: ${gaps.join(", ")}s`);
  }
  session.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
