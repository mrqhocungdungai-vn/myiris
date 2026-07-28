// The last unknown: the real chunk boundary is triggered by the server's goAway
// (electron/main.mjs:3208). probe-handle2 measured the boundary sequence
// (activityEnd -> turnComplete -> resumable handle) at ~2.5 s. Does goAway's
// timeLeft leave room for it, or does the connection die mid-sequence and lose
// the chunk?
//
// Holds ONE activity open for a realistic ~10 min with speech separated by long
// silences (TURN_INCLUDES_ALL_INPUT counts the silence, as in production), then
// on goAway runs the boundary and verifies chunk-1 recall after the reconnect.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";
const SILENCE = Buffer.alloc(3200); // 100 ms of 16 kHz mono 16-bit silence

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
const CONVERSE_SYSTEM = "Bạn là Iris, trợ lý giọng nói. Trả lời bằng tiếng Việt, ngắn gọn.";

function baseConfig(handle, system) {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } } },
    sessionResumption: handle ? { handle } : {},
    contextWindowCompression: { triggerTokens: 104857, slidingWindow: { targetTokens: 52428 } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: system }] },
  };
}
const listenConfig = (handle) => ({
  ...baseConfig(handle, LISTEN_SYSTEM),
  realtimeInputConfig: {
    automaticActivityDetection: { disabled: true },
    turnCoverage: "TURN_INCLUDES_ALL_INPUT",
    activityHandling: "NO_INTERRUPTION",
  },
});

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const st = {
    goAwayAt: null, goAwayTimeLeft: null, turnCompletes: 0, handle: null,
    input: "", output: "", audioChunks: 0, closed: false, closeAt: null,
  };

  const session = await ai.live.connect({
    model: MODEL,
    config: listenConfig(null),
    callbacks: {
      onopen: () => console.log(`[${at()}] listen open`),
      onmessage: (m) => {
        if (m.goAway) {
          st.goAwayAt = Date.now();
          st.goAwayTimeLeft = m.goAway.timeLeft;
          console.log(`[${at()}] *** goAway timeLeft=${JSON.stringify(m.goAway.timeLeft)}`);
        }
        if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
          st.handle = m.sessionResumptionUpdate.newHandle;
          console.log(`[${at()}] resumable handle received`);
        }
        const c = m.serverContent;
        if (!c) return;
        if (c.inputTranscription?.text) st.input += c.inputTranscription.text;
        if (c.outputTranscription?.text) st.output += c.outputTranscription.text;
        for (const p of c.modelTurn?.parts || []) {
          if (p.inlineData?.data && (p.inlineData.mimeType || "").startsWith("audio/")) st.audioChunks += 1;
        }
        if (c.turnComplete) { st.turnCompletes += 1; console.log(`[${at()}] turnComplete #${st.turnCompletes}`); }
      },
      onerror: (e) => console.log(`[${at()}] ERROR ${e?.message || e}`),
      onclose: (e) => { st.closed = true; st.closeAt = Date.now(); console.log(`[${at()}] listen close: ${e?.reason || "closed"}`); },
    },
  });

  session.sendRealtimeInput({ activityStart: {} });
  console.log(`[${at()}] activityStart — holding one activity open across a ~10 min monologue`);

  // Speech at ~10 s, ~5 min, ~8.5 min; silence otherwise. Stop at goAway.
  const speech = [
    { at: 10, pcm: readPcm("c1.wav"), tag: "c1" },
    { at: 300, pcm: readPcm("c2.wav"), tag: "c2" },
    { at: 510, pcm: readPcm("c3.wav"), tag: "c3" },
  ];
  let next = 0;
  let lastLoggedMinute = 0;
  const LIMIT_MS = 13 * 60 * 1000;

  while (!st.closed && !st.goAwayAt && Date.now() - t0 < LIMIT_MS) {
    const elapsed = (Date.now() - t0) / 1000;
    if (next < speech.length && elapsed >= speech[next].at) {
      const { pcm, tag } = speech[next];
      console.log(`[${at()}] streaming ${tag}`);
      for (let off = 0; off < pcm.length && !st.closed && !st.goAwayAt; off += 3200) {
        session.sendRealtimeInput({
          audio: { data: pcm.subarray(off, off + 3200).toString("base64"), mimeType: "audio/pcm;rate=16000" },
        });
        await sleep(100);
      }
      next += 1;
      continue;
    }
    session.sendRealtimeInput({ audio: { data: SILENCE.toString("base64"), mimeType: "audio/pcm;rate=16000" } });
    await sleep(100);
    const minute = Math.floor(elapsed / 60);
    if (minute > lastLoggedMinute) {
      lastLoggedMinute = minute;
      console.log(`[${at()}] ...still open, silent=${st.audioChunks === 0}, handles=${st.handle ? "some" : "none"}`);
    }
  }

  if (!st.goAwayAt) {
    console.log(`\n[${at()}] no goAway within ${LIMIT_MS / 60000} min (closed=${st.closed}). Inconclusive.`);
    process.exit(0);
  }

  // ---- the real boundary, under goAway pressure ----
  console.log(`[${at()}] boundary: sending activityEnd`);
  const bStart = Date.now();
  session.sendRealtimeInput({ activityEnd: {} });
  const targetTurn = st.turnCompletes + 1;
  let deadline = Date.now() + 20000;
  while (st.turnCompletes < targetTurn && !st.closed && Date.now() < deadline) await sleep(100);
  const turnOk = st.turnCompletes >= targetTurn;
  deadline = Date.now() + 15000;
  while (!st.handle && !st.closed && Date.now() < deadline) await sleep(100);
  const handleOk = !!st.handle;
  const bMs = Date.now() - bStart;
  console.log(`[${at()}] boundary done in ${bMs}ms turn=${turnOk} handle=${handleOk} closedDuring=${st.closed}`);
  console.log(`[${at()}] transcript captured: ${st.input.length} chars`);
  const preClose = st.closed;
  if (!st.closed) session.close();
  await sleep(2000);

  // ---- reconnect into converse and check chunk-1 recall ----
  const conv = { output: "", turnCompletes: 0 };
  const converse = await ai.live.connect({
    model: MODEL,
    config: baseConfig(st.handle, CONVERSE_SYSTEM),
    callbacks: {
      onopen: () => console.log(`[${at()}] converse open`),
      onmessage: (m) => {
        const c = m.serverContent;
        if (!c) return;
        if (c.outputTranscription?.text) conv.output += c.outputTranscription.text;
        for (const p of c.modelTurn?.parts || []) if (p.text) conv.output += p.text;
        if (c.turnComplete) conv.turnCompletes += 1;
      },
      onerror: (e) => console.log(`[${at()}] converse ERROR ${e?.message || e}`),
      onclose: () => {},
    },
  });
  converse.sendClientContent({
    turns: "Ngân sách được duyệt là bao nhiêu, hạn hoàn thành khi nào, và ai phụ trách backend?",
    turnComplete: true,
  });
  deadline = Date.now() + 40000;
  while (conv.turnCompletes < 1 && Date.now() < deadline) await sleep(200);
  const facts = ["42", "bốn mươi hai", "tháng 9", "tháng chín", "Hải"];
  const got = facts.filter((f) => conv.output.toLowerCase().includes(f.toLowerCase()));
  console.log(`[${at()}] answer: ${JSON.stringify(conv.output.slice(0, 400))}`);

  console.log("\n================ RESULT (goAway) ================");
  console.log(`goAway fired at            : ${((st.goAwayAt - t0) / 1000).toFixed(1)}s`);
  console.log(`goAway timeLeft            : ${JSON.stringify(st.goAwayTimeLeft)}`);
  console.log(`connection closed pre-boundary : ${preClose ? "YES — boundary lost the race" : "no"}`);
  console.log(`boundary sequence duration : ${bMs}ms (turn=${turnOk}, handle=${handleOk})`);
  const livedSec = ((st.goAwayAt - t0) / 1000).toFixed(0);
  console.log(`silence held for the whole ${livedSec}s : ${st.audioChunks === 0 ? "PASS" : `FAIL (${st.audioChunks} audio chunks)`}`);
  console.log(`chunk-1 recall after reconnect : ${got.length ? `PASS [${got.join(", ")}]` : "FAIL"}`);
  console.log("=================================================");
  converse.close();
  process.exit(got.length && !preClose ? 0 : 1);
}

main().catch((e) => { console.error("CRASHED:", e); process.exit(1); });
