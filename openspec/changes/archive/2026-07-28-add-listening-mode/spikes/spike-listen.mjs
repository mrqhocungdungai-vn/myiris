// Spike: does Gemini Live "listen silently then answer on demand" actually work?
//
// A. AAD off + TURN_INCLUDES_ALL_INPUT: stream audio, expect NO response at all.
// B. sendClientContent({turnComplete:true}): expect an answer that proves the
//    streamed audio entered context (must recall details from the clip).
// C. Reconnect with the resumption handle + a normal (AAD on) config: expect it
//    to still remember what was said before the reconnect.
//
// Faithful to electron/main.mjs: same model, AUDIO modality, Zephyr, the same
// compression settings, and outputAudioTranscription so replies are readable.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";
const CLIP = path.join(import.meta.dirname, "clip.wav");

// Details spoken in the clip. Recalling any of these proves the audio landed in
// context; the clip is never sent as text, so there is no other way to know them.
const FACTS = ["tháng chín", "tháng 9", "bốn mươi hai", "42", "Hải", "nghỉ phép"];

function loadKey() {
  const env = fs.readFileSync(path.join(PROJECT, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.trim().startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("GEMINI_API_KEY not found in .env");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

function loadPcm() {
  const buf = fs.readFileSync(CLIP);
  const i = buf.indexOf("data");
  if (i < 0) throw new Error("no data chunk in wav");
  return buf.subarray(i + 8); // 16-bit LE mono @ 16 kHz
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = "Bạn là Iris, trợ lý giọng nói. Trả lời bằng tiếng Việt, ngắn gọn.";

function baseConfig(handle) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
    sessionResumption: handle ? { handle } : {},
    contextWindowCompression: {
      triggerTokens: 104857,
      slidingWindow: { targetTokens: 52428 },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: SYSTEM }] },
  };
}

function listenConfig(handle) {
  return {
    ...baseConfig(handle),
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: true },
      turnCoverage: "TURN_INCLUDES_ALL_INPUT",
      activityHandling: "NO_INTERRUPTION",
    },
  };
}

// Normal converse config == exactly what main.mjs builds today (no realtimeInputConfig).
const converseConfig = (handle) => baseConfig(handle);

// One mutable record per connection, so each phase can assert on what arrived.
function newSink() {
  return { input: "", output: "", audioChunks: 0, turnCompletes: 0, handle: null, closed: null, errors: [] };
}

async function connect(ai, config, sink, label) {
  const session = await ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen: () => console.log(`  [${label}] open`),
      onmessage: (message) => {
        if (message.sessionResumptionUpdate) {
          const { resumable, newHandle } = message.sessionResumptionUpdate;
          if (resumable && newHandle) sink.handle = newHandle;
        }
        if (message.goAway) console.log(`  [${label}] goAway`, message.goAway.timeLeft || "");
        const c = message.serverContent;
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
      onclose: (e) => {
        sink.closed = e?.reason || "closed";
        console.log(`  [${label}] close:`, sink.closed);
      },
    },
  });
  return session;
}

// Stream the clip at ~real time, 100 ms per chunk, as the renderer does.
async function streamClip(session, pcm) {
  const CHUNK = 3200; // 100 ms @ 16 kHz 16-bit mono
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

const hits = (text) => FACTS.filter((f) => text.toLowerCase().includes(f.toLowerCase()));

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const pcm = loadPcm();
  console.log(`clip: ${(pcm.length / 32000).toFixed(1)}s of 16 kHz mono PCM\n`);

  const results = {};

  // ---------- A + B: one listen-mode session ----------
  console.log("PHASE A — AAD off + ALL_INPUT, stream audio, expect silence");
  const listenSink = newSink();
  const listen = await connect(ai, listenConfig(null), listenSink, "listen");

  await streamClip(listen, pcm);
  console.log("  streamed; waiting 8s to see if it speaks unprompted...");
  await sleep(8000);

  const spokeUnprompted = listenSink.audioChunks > 0 || listenSink.turnCompletes > 0;
  results.A = !spokeUnprompted;
  console.log(`  audioChunks=${listenSink.audioChunks} turnCompletes=${listenSink.turnCompletes}`);
  console.log(`  inputTranscription: ${listenSink.input ? JSON.stringify(listenSink.input.slice(0, 200)) : "(none)"}`);
  console.log(`  A = ${results.A ? "PASS — stayed silent" : "FAIL — spoke without being asked"}\n`);

  console.log("PHASE B — sendClientContent({turnComplete:true}), expect recall");
  listenSink.output = "";
  listen.sendClientContent({
    turns: "Tôi vừa trình bày xong. Bạn nghĩ gì? Nhắc lại các con số và tên cụ thể tôi đã nói.",
    turnComplete: true,
  });
  const gotB = await waitForTurn(listenSink, 30000);
  const hitsB = hits(listenSink.output);
  results.B = gotB && hitsB.length > 0;
  console.log(`  replied=${gotB} audioChunks=${listenSink.audioChunks}`);
  console.log(`  said: ${JSON.stringify(listenSink.output.slice(0, 400))}`);
  console.log(`  recalled: [${hitsB.join(", ")}]`);
  console.log(`  B = ${results.B ? "PASS — audio entered context" : "FAIL — no recall of the clip"}\n`);

  const handle = listenSink.handle;
  console.log(`resumption handle from listen session: ${handle ? "present" : "MISSING"}`);
  listen.close();
  await sleep(1500);

  // ---------- C: reconnect with the handle, normal config ----------
  console.log("\nPHASE C — reconnect (handle + AAD on), expect memory to survive");
  const conSink = newSink();
  let cError = null;
  try {
    const converse = await connect(ai, converseConfig(handle), conSink, "converse");
    converse.sendClientContent({
      turns: "Tôi vừa nói gì trước đó? Nhắc lại các con số và tên cụ thể.",
      turnComplete: true,
    });
    const gotC = await waitForTurn(conSink, 30000);
    const hitsC = hits(conSink.output);
    results.C = gotC && hitsC.length > 0;
    console.log(`  replied=${gotC}`);
    console.log(`  said: ${JSON.stringify(conSink.output.slice(0, 400))}`);
    console.log(`  recalled: [${hitsC.join(", ")}]`);
    console.log(`  C = ${results.C ? "PASS — memory survived reconnect" : "FAIL — context lost"}`);
    converse.close();
  } catch (e) {
    cError = e?.message || String(e);
    results.C = false;
    console.log(`  C = FAIL — reconnect threw: ${cError}`);
  }

  console.log("\n================ RESULT ================");
  console.log(`A (stays silent while listening) : ${results.A ? "PASS" : "FAIL"}`);
  console.log(`B (audio enters context)         : ${results.B ? "PASS" : "FAIL"}`);
  console.log(`C (memory survives reconnect)    : ${results.C ? "PASS" : "FAIL"}`);
  if (cError) console.log(`C error: ${cError}`);
  console.log("========================================");
  process.exit(0);
}

main().catch((e) => {
  console.error("SPIKE CRASHED:", e);
  process.exit(1);
});
