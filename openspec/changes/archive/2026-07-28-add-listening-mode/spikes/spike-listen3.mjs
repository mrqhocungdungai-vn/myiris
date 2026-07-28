// Spike v3: two remaining unknowns that decide the exit behavior.
//
// D. Exit listening WITHOUT sending activityEnd (so Iris never speaks), then
//    reconnect with the handle. Does the un-closed activity's audio still reach
//    the resumed session's context? If yes: turning the ear off can be silent.
//    If no: the only way to keep the memory is to let Iris speak on exit.
//
// E. Can one listen session serve several asks? activityStart/End, then
//    activityStart/End again — does the second reply still know the first part?
//    If yes, the user can stay in listening mode and ask repeatedly, no reconnect.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";
const FACTS = ["tháng chín", "tháng 9", "bốn mươi hai", "42", "Hải", "test", "nghỉ phép", "deadline"];
const FACTS2 = ["cà phê", "ba giờ", "3 giờ", "thứ năm", "thứ 5"];

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

const listenConfig = (handle) => ({
  ...baseConfig(handle),
  realtimeInputConfig: {
    automaticActivityDetection: { disabled: true },
    turnCoverage: "TURN_INCLUDES_ALL_INPUT",
    activityHandling: "NO_INTERRUPTION",
  },
});

const newSink = () => ({ input: "", output: "", audioChunks: 0, turnCompletes: 0, handle: null });

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
        for (const p of c.modelTurn?.parts || []) {
          if (p.text) sink.output += p.text;
          if (p.inlineData?.data && (p.inlineData.mimeType || "").startsWith("audio/")) sink.audioChunks += 1;
        }
        if (c.turnComplete) sink.turnCompletes += 1;
      },
      onerror: (e) => console.log(`  [${label}] ERROR`, e?.message || e),
      onclose: (e) => console.log(`  [${label}] close:`, e?.reason || "closed"),
    },
  });
}

async function streamPcm(session, pcm) {
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

async function waitForTurn(sink, ms) {
  const target = sink.turnCompletes + 1;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (sink.turnCompletes >= target) return true;
    await sleep(250);
  }
  return false;
}

const hits = (t, facts) => facts.filter((f) => t.toLowerCase().includes(f.toLowerCase()));

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const clip1 = readPcm("clip.wav");
  const clip2 = readPcm("clip2.wav");
  const results = {};

  // ---------------- D ----------------
  console.log("TEST D — exit WITHOUT activityEnd, then reconnect with handle");
  const dSink = newSink();
  const dListen = await connect(ai, listenConfig(null), dSink, "listen-D");
  dListen.sendRealtimeInput({ activityStart: {} });
  await streamPcm(dListen, clip1);
  await sleep(2000);
  console.log(`  streamed. spoke? audioChunks=${dSink.audioChunks} turnCompletes=${dSink.turnCompletes}`);
  console.log("  closing WITHOUT activityEnd...");
  const dHandle = dSink.handle;
  dListen.close();
  await sleep(1500);

  const dConv = newSink();
  const converseD = await connect(ai, baseConfig(dHandle), dConv, "converse-D");
  converseD.sendClientContent({
    turns: "Tôi vừa nói gì trước đó? Nhắc lại các con số và tên cụ thể.",
    turnComplete: true,
  });
  await waitForTurn(dConv, 30000);
  const dHits = hits(dConv.output, FACTS);
  results.D = dHits.length > 0;
  console.log(`  said: ${JSON.stringify(dConv.output.slice(0, 350))}`);
  console.log(`  recalled: [${dHits.join(", ")}]`);
  console.log(`  D = ${results.D ? "PASS — silent exit keeps the memory" : "FAIL — memory needs activityEnd"}\n`);
  converseD.close();
  await sleep(1000);

  // ---------------- E ----------------
  console.log("TEST E — two ask cycles in ONE listen session");
  const eSink = newSink();
  const eListen = await connect(ai, listenConfig(null), eSink, "listen-E");

  eListen.sendRealtimeInput({ activityStart: {} });
  await streamPcm(eListen, clip1);
  eListen.sendRealtimeInput({ activityEnd: {} });
  const e1 = await waitForTurn(eSink, 30000);
  console.log(`  ask #1 replied=${e1}: ${JSON.stringify(eSink.output.slice(0, 200))}`);

  eSink.output = "";
  eListen.sendRealtimeInput({ activityStart: {} });
  await streamPcm(eListen, clip2);
  eListen.sendRealtimeInput({ activityEnd: {} });
  const e2 = await waitForTurn(eSink, 30000);
  const eHits1 = hits(eSink.output, FACTS);
  const eHits2 = hits(eSink.output, FACTS2);
  results.E = e2 && eHits2.length > 0;
  results.E_remembers_first = eHits1.length > 0;
  console.log(`  ask #2 replied=${e2}: ${JSON.stringify(eSink.output.slice(0, 350))}`);
  console.log(`  recalled from clip2: [${eHits2.join(", ")}]`);
  console.log(`  recalled from clip1: [${eHits1.join(", ")}]`);
  console.log(`  E = ${results.E ? "PASS — can ask repeatedly in one session" : "FAIL"}`);
  console.log(`  E(first part still known) = ${results.E_remembers_first ? "PASS" : "not referenced"}`);
  eListen.close();

  console.log("\n================ RESULT (v3) ================");
  console.log(`D (silent exit keeps memory)     : ${results.D ? "PASS" : "FAIL"}`);
  console.log(`E (repeat asks, one session)     : ${results.E ? "PASS" : "FAIL"}`);
  console.log("=============================================");
  process.exit(0);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
