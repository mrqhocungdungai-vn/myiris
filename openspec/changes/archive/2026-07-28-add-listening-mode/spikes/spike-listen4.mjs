// Spike v4: the CHUNKED design, forced by the ~10 min Live connection lifetime
// (electron/main.mjs:87). Spike v3 only ran two activityStart/End cycles inside
// ONE session; the real mechanism must survive a reconnect at every boundary.
//
// Per chunk: activityStart -> stream -> activityEnd -> forced turn -> close ->
//            reconnect(listen, handle) -> activityStart ...
//
// F. Does context from chunk 1 survive to the end, across 3 reconnects?
//    This is the load-bearing question. design.md:160-163 recorded it untested.
// G. Can the forced boundary turn be made CHEAP by prompt ("reply exactly ok")?
//    If it insists on a full synthesis every 10 min, option A gets expensive.
// H. Is inputAudioTranscription actually populated per chunk? Option A's RAM
//    record depends on it, and spike v1 saw it empty when the activity was
//    never opened.

import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

// Repo root, four levels up from openspec/changes/<change>/spikes/
const PROJECT = path.resolve(import.meta.dirname, "../../../..");
const MODEL = "models/gemini-3.1-flash-live-preview";

const CHUNKS = [
  { file: "c1.wav", facts: ["tháng chín", "tháng 9", "bốn mươi hai", "42"] },
  { file: "c2.wav", facts: ["Hải", "backend"] },
  { file: "c3.wav", facts: ["thứ năm", "thứ 5", "ba giờ", "3 giờ"] },
];

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

const CONVERSE_SYSTEM = "Bạn là Iris, trợ lý giọng nói. Trả lời bằng tiếng Việt, ngắn gọn.";

// The listen-mode system instruction under test: it must make the boundary turn
// cheap without being load-bearing for silence (silence is structural).
const LISTEN_SYSTEM = `${CONVERSE_SYSTEM}

Bạn đang ở CHẾ ĐỘ LẮNG NGHE. Người dùng đang trình bày kế hoạch của họ trong nhiều đoạn.
Nhiệm vụ của bạn là ghi nhớ toàn bộ nội dung, KHÔNG phân tích, KHÔNG bình luận, KHÔNG tóm tắt.
Khi một đoạn kết thúc, bạn chỉ được trả lời đúng một từ: ok
Tuyệt đối không nói gì thêm cho đến khi người dùng hỏi.`;

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

const newSink = () => ({ input: "", output: "", audioChunks: 0, turnCompletes: 0, handle: null, errors: [] });

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
        if (m.goAway) console.log(`  [${label}] goAway timeLeft=${m.goAway.timeLeft || "?"}`);
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
      onerror: (e) => {
        sink.errors.push(e?.message || String(e));
        console.log(`  [${label}] ERROR`, e?.message || e);
      },
      onclose: (e) => console.log(`  [${label}] close: ${e?.reason || "closed"}`),
    },
  });
}

async function streamPcm(session, pcm) {
  const CHUNK = 3200; // 100 ms @ 16 kHz mono 16-bit
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
    await sleep(200);
  }
  return false;
}

// probe-handle2.mjs measured: the server issues NO resumption checkpoint while
// an activity is open; a resumable handle arrives ~0.6 s AFTER turnComplete
// following activityEnd. Closing at turnComplete (what spike v4 first did)
// throws it away, so the boundary MUST wait for the handle before closing.
async function waitForHandle(sink, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (sink.handle) return true;
    await sleep(200);
  }
  return false;
}

const hits = (t, facts) => facts.filter((f) => t.toLowerCase().includes(f.toLowerCase()));

async function main() {
  const ai = new GoogleGenAI({ apiKey: loadKey() });
  const results = { boundaries: [], ramRecord: [] };
  let handle = null;

  console.log("=== CHUNKED LISTENING: 3 chunks, reconnect at every boundary ===\n");

  for (let i = 0; i < CHUNKS.length; i += 1) {
    const { file, facts } = CHUNKS[i];
    const sink = newSink();
    console.log(`--- chunk ${i + 1} (${file}) ---`);
    const session = await connect(ai, listenConfig(handle), sink, `listen-${i + 1}`);

    session.sendRealtimeInput({ activityStart: {} });
    await streamPcm(session, readPcm(file));

    // Mid-chunk silence check: must stay quiet with the activity still open.
    // 8 s to match spike-listen2's window — 2.5 s is too short to call it silence.
    await sleep(8000);
    const quietMid = sink.audioChunks === 0 && sink.turnCompletes === 0;
    console.log(`  silent while open: ${quietMid ? "yes" : `NO (audio=${sink.audioChunks} turns=${sink.turnCompletes})`}`);

    // Boundary: commit the chunk. The turn is forced; we would drop its audio.
    // Clear any handle first: probe-handle2 measured that the resumable checkpoint
    // arrives AFTER turnComplete, so a handle still held from before activityEnd
    // would make the wait below vacuous — the exact false-pass this asserts against.
    sink.handle = null;
    session.sendRealtimeInput({ activityEnd: {} });
    const replied = await waitForTurn(sink, 30000);
    const reply = sink.output.trim();
    const transcript = sink.input.trim();

    results.boundaries.push({ i: i + 1, quietMid, replied, reply, audioChunks: sink.audioChunks, errors: [...sink.errors] });
    results.ramRecord.push({ i: i + 1, transcript, recalled: hits(transcript, facts) });

    console.log(`  boundary turn: replied=${replied} words=${reply.split(/\s+/).filter(Boolean).length} text=${JSON.stringify(reply.slice(0, 160))}`);
    console.log(`  inputTranscription: ${JSON.stringify(transcript.slice(0, 160))}`);
    console.log(`  facts in transcript: [${hits(transcript, facts).join(", ")}]`);

    const gotHandle = await waitForHandle(sink, 15000);
    console.log(`  resumable handle after boundary: ${gotHandle ? "yes" : "NO (timed out)"}`);
    results.boundaries[results.boundaries.length - 1].gotHandle = gotHandle;
    if (!gotHandle) {
      console.log("  ABORT — without a fresh handle the next chunk cannot resume this one.");
      session.close();
      process.exit(1);
    }
    handle = sink.handle;
    session.close();
    await sleep(1500);
    console.log("");
  }

  // ---- final: reconnect into CONVERSE and ask about chunk 1 specifically ----
  console.log("--- exit: reconnect into converse, ask about CHUNK 1 only ---");
  const conv = newSink();
  const converse = await connect(ai, baseConfig(handle, CONVERSE_SYSTEM), conv, "converse");
  converse.sendClientContent({
    turns: "Dựa trên tất cả những gì tôi vừa trình bày: ngân sách được duyệt là bao nhiêu, và hạn hoàn thành là khi nào?",
    turnComplete: true,
  });
  await waitForTurn(conv, 40000);
  const q1 = conv.output.trim();
  const h1 = hits(q1, CHUNKS[0].facts);
  console.log(`  answer: ${JSON.stringify(q1.slice(0, 400))}`);
  console.log(`  chunk-1 facts recalled: [${h1.join(", ")}]`);

  // second ask: all three chunks at once
  conv.output = "";
  converse.sendClientContent({
    turns: "Tóm tắt lại toàn bộ kế hoạch: ai làm gì, và buổi nghiệm thu khi nào?",
    turnComplete: true,
  });
  await waitForTurn(conv, 40000);
  const q2 = conv.output.trim();
  const hAll = CHUNKS.map((c, i) => ({ chunk: i + 1, got: hits(q2, c.facts) }));
  console.log(`  answer: ${JSON.stringify(q2.slice(0, 400))}`);
  for (const r of hAll) console.log(`  chunk ${r.chunk} facts in summary: [${r.got.join(", ")}]`);
  converse.close();

  // ------------------------------- verdict -------------------------------
  const F = h1.length > 0;
  const allHandles = results.boundaries.every((b) => b.gotHandle);
  const errors = results.boundaries.flatMap((b) => b.errors || []);
  const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
  const cheap = results.boundaries.every((b) => b.replied && wordCount(b.reply) >= 1 && wordCount(b.reply) <= 4);
  const H = results.ramRecord.every((r) => r.recalled.length > 0);
  const allQuiet = results.boundaries.every((b) => b.quietMid);

  console.log("\n================ RESULT (v4) ================");
  console.log(`F  chunk-1 context survives 3 reconnects : ${F ? "PASS" : "FAIL"}`);
  console.log(`   all chunks present in full summary    : ${hAll.every((r) => r.got.length > 0) ? "PASS" : `partial — missing chunk(s) ${hAll.filter((r) => !r.got.length).map((r) => r.chunk).join(",") || "none"}`}`);
  console.log(`G  boundary turn kept short by prompt    : ${cheap ? "PASS" : "FAIL"}`);
  console.log(`   boundary reply word counts            : ${results.boundaries.map((b) => wordCount(b.reply)).join(", ")}`);
  console.log(`H  inputTranscription usable as RAM rec  : ${H ? "PASS" : "FAIL"}`);
  console.log(`   silence held while activity open      : ${allQuiet ? "PASS" : "FAIL"}`);
  console.log(`   fresh handle at every boundary        : ${allHandles ? "PASS" : "FAIL"}`);
  if (errors.length) console.log(`   transport errors                     : ${errors.length} — ${errors.join("; ")}`);
  console.log("=============================================");
  const pass = F && cheap && H && allQuiet && allHandles && errors.length === 0;
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("CRASHED:", e);
  process.exit(1);
});
