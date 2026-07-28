// Spike v2: same question, but using the activity signals that AAD-disabled mode
// is actually built around.
//
// v1 streamed audio with AAD off and never sent activityStart. Result: the server
// ignored the audio entirely (no inputTranscription, no recall). Hypothesis: with
// AAD off, audio only counts as user input inside an explicitly opened activity.
//
// A. activityStart -> stream clip -> wait. Expect SILENCE (no activityEnd yet).
// B. activityEnd. Expect a reply that recalls the clip's details.
// C. Reconnect with the resumption handle + normal config. Expect recall to survive.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";
const CLIP = path.join(import.meta.dirname, "clip.wav");
const FACTS = ["tháng chín", "tháng 9", "bốn mươi hai", "42", "Hải", "nghỉ phép", "deadline"];

function loadKey() {
  const env = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.trim().startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("GEMINI_API_KEY not found in the repo .env");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

function loadPcm() {
  const buf = fs.readFileSync(CLIP);
  return buf.subarray(buf.indexOf("data") + 8);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SYSTEM = "Bạn là Iris, trợ lý giọng nói. Trả lời bằng tiếng Việt, ngắn gọn.";

function baseConfig(handle) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
    sessionResumption: handle ? { handle } : {},
    contextWindowCompression: { triggerTokens: 104857, slidingWindow: { targetTokens: 52428 } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: SYSTEM }] },
  };
}

function listenConfig() {
  return {
    ...baseConfig(null),
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: true },
      turnCoverage: "TURN_INCLUDES_ALL_INPUT",
      activityHandling: "NO_INTERRUPTION",
    },
  };
}

function newSink() {
  return { input: "", output: "", audioChunks: 0, turnCompletes: 0, handle: null, errors: [] };
}

async function connect(ai, config, sink, label) {
  return ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen: () => console.log(`  [${label}] open`),
      onmessage: (m) => {
        if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
          sink.handle = m.sessionResumptionUpdate.newHandle;
        }
        const c = m.serverContent;
        if (!c) return;
        if (c.inputTranscription?.text) sink.input += c.inputTranscription.text;
        if (c.outputTranscription?.text) sink.output += c.outputTranscription.text;
        for (const part of c.modelTurn?.parts || []) {
          if (part.text) sink.output += part.text;
          if (part.inlineData?.data && (part.inlineData.mimeType || "").startsWith("audio/")) {
            sink.audioChunks += 1;
          }
        }
        if (c.turnComplete) sink.turnCompletes += 1;
      },
      onerror: (e) => {
        sink.errors.push(e?.message || String(e));
        console.log(`  [${label}] ERROR`, e?.message || e);
      },
      onclose: (e) => console.log(`  [${label}] close:`, e?.reason || "closed"),
    },
  });
}

async function streamClip(session, pcm) {
  const CHUNK = 3200;
  for (let off = 0; off < pcm.length; off += CHUNK) {
    session.sendRealtimeInput({
      audio: {
        data: pcm.subarray(off, Math.min(off + CHUNK, pcm.length)).toString("base64"),
        mimeType: "audio/pcm;rate=16000",
      },
    });
    await sleep(100);
  }
}

async function waitForTurn(sink, timeoutMs) {
  const target = sink.turnCompletes + 1;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sink.turnCompletes >= target) return true;
    await sleep(250);
  }
  return false;
}

const hits = (t) => FACTS.filter((f) => t.toLowerCase().includes(f.toLowerCase()));

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const pcm = loadPcm();
  const results = {};

  console.log("PHASE A — AAD off, activityStart, stream, NO activityEnd → expect silence");
  const sink = newSink();
  const listen = await connect(ai, listenConfig(), sink, "listen");

  listen.sendRealtimeInput({ activityStart: {} });
  console.log("  activityStart sent");
  await streamClip(listen, pcm);
  console.log("  streamed; waiting 8s...");
  await sleep(8000);

  results.A = sink.audioChunks === 0 && sink.turnCompletes === 0;
  console.log(`  audioChunks=${sink.audioChunks} turnCompletes=${sink.turnCompletes}`);
  console.log(`  inputTranscription: ${sink.input ? JSON.stringify(sink.input.slice(0, 300)) : "(none)"}`);
  console.log(`  A = ${results.A ? "PASS — silent" : "FAIL — spoke unprompted"}\n`);

  console.log("PHASE B — activityEnd → expect reply that recalls the clip");
  listen.sendRealtimeInput({ activityEnd: {} });
  const gotB = await waitForTurn(sink, 30000);
  const hitsB = hits(sink.output);
  results.B = gotB && hitsB.length > 0;
  console.log(`  replied=${gotB} audioChunks=${sink.audioChunks}`);
  console.log(`  inputTranscription now: ${sink.input ? JSON.stringify(sink.input.slice(0, 300)) : "(none)"}`);
  console.log(`  said: ${JSON.stringify(sink.output.slice(0, 400))}`);
  console.log(`  recalled: [${hitsB.join(", ")}]`);
  console.log(`  B = ${results.B ? "PASS — audio was in context" : "FAIL — no recall"}\n`);

  const handle = sink.handle;
  console.log(`handle: ${handle ? "present" : "MISSING"}`);
  listen.close();
  await sleep(1500);

  console.log("\nPHASE C — reconnect (handle + AAD on) → expect memory to survive");
  const c2 = newSink();
  try {
    const converse = await connect(ai, baseConfig(handle), c2, "converse");
    converse.sendClientContent({
      turns: "Tôi vừa nói gì trước đó? Nhắc lại các con số và tên cụ thể.",
      turnComplete: true,
    });
    const gotC = await waitForTurn(c2, 30000);
    const hitsC = hits(c2.output);
    results.C = gotC && hitsC.length > 0;
    console.log(`  said: ${JSON.stringify(c2.output.slice(0, 400))}`);
    console.log(`  recalled: [${hitsC.join(", ")}]`);
    console.log(`  C = ${results.C ? "PASS" : "FAIL — context lost"}`);
    converse.close();
  } catch (e) {
    results.C = false;
    console.log(`  C = FAIL — threw: ${e?.message || e}`);
  }

  console.log("\n================ RESULT (v2, with activity signals) ================");
  console.log(`A (silent while listening)    : ${results.A ? "PASS" : "FAIL"}`);
  console.log(`B (audio enters context)      : ${results.B ? "PASS" : "FAIL"}`);
  console.log(`C (survives reconnect)        : ${results.C ? "PASS" : "FAIL"}`);
  console.log("====================================================================");
  process.exit(0);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
