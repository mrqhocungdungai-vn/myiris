# Voice → Gemini Live → Claude Agent SDK: bản đồ đường đi (audit, chỉ đọc)

Ngày: sinh tự động. Mọi khẳng định dưới đây đều kèm `file:line` của repo
`/Users/mrq-learn-ai/work_space/myiris`. Không có file nào bị sửa.

---

## 0. Kết luận ngắn (trả lời 5 câu hỏi)

1. **Claude KHÔNG chỉ nhận bản Gemini diễn đạt lại.** Nó nhận *hai* thứ ghép lại:
   (a) một "brief" 100% do Gemini viết ra từ schema tham số của verb, và
   (b) một khối **transcript nguyên văn** của người dùng (input transcription của
   Gemini Live), được fence như dữ liệu untrusted. Xem `electron/run-context.mjs:149-192`.
   Nhưng **Gemini vẫn là người chọn verb và viết brief** — bottleneck bị thu hẹp, không bị xoá
   (`electron/run-context.mjs:5-10`).
2. **Có transcript nguyên văn**, nằm trong ring bộ nhớ ở `electron/renderer-bridge.mjs:72`
   (cap 40 lượt / 10 phút, `renderer-bridge.mjs:17-18`), được cắt lần hai khi đưa vào prompt:
   **12 lượt / 4 000 ký tự**, bỏ *cũ nhất* trước (`run-context.mjs:42-43,119-135`).
3. **Đường về: KHÔNG streaming ra giọng nói.** Gemini chỉ nghe thấy khi run *kết thúc*
   (`SYSTEM_EVENT_CLAUDE_COMPLETE`, `electron/announcements.mjs:160-234`, gọi từ
   `electron/wiring.mjs:117-162` trong `onFinalized`). Trong lúc chạy, tool-call/activity chỉ
   đi tới **renderer (UI)** qua `emitEvent`, không tới Gemini (`electron/run-stream.mjs:220-256`).
   Gemini được **lệnh tóm tắt 1-3 câu** — tức là diễn giải lại, không đọc nguyên văn
   (`announcements.mjs:188`) — **trừ verb `work_on_note`**, verb duy nhất được lệnh đọc
   NGUYÊN VĂN (`announcements.mjs:244-278`, `wiring.mjs:143-152`).
4. `shape_on_canvas`: stateful, park ON_OPEN, model Opus 5, budget `stateful` (150 lượt / $6),
   `skills: SHAPING_SKILLS`, `mcpServers: ["iris-canvas"]`, `disallowedTools: []` (được hỏi
   thoải mái), dùng chung session `stateful` với `shape_requirements`
   (`electron/verbs.mjs:170-194`).
5. Trễ: 6 chặng, **hai chặng chặn thật sự** là *review gate* (park, chờ người duyệt, timeout
   300 s) và *execution slot* (Claude làm một việc tại một thời điểm, xếp hàng FIFO).

---

## 1. Sơ đồ tuần tự bằng chữ (đường đi)

```
[1] Micro (renderer) → PCM 16 kHz base64 → liveSession.sendRealtimeInput({audio})
    electron/live-messages.mjs:266-274

[2] Gemini Live (models/gemini-3.1-flash-live-preview, electron/live-session.mjs:307)
    Config bật CẢ HAI transcription: inputAudioTranscription:{} và outputAudioTranscription:{}
    electron/live-config.mjs:32-33
    System instruction dựng 1 lần mỗi lần connect: electron/live-session.mjs:317
      → electron/gemini-prompts.mjs:85-174

[3a] Nhánh TRANSCRIPT (song song, không đi qua Gemini nữa):
     serverContent.inputTranscription.text
       → appendUserTranscript()               live-messages.mjs:221-225
       → (mảnh vụn, cộng dồn vào buffer)      renderer-bridge.mjs:177-200
       → flushTranscripts() khi turnComplete/interrupted
                                              live-messages.mjs:212-219, 260-263
       → đẩy 1 lượt hoàn chỉnh vào ring       renderer-bridge.mjs:159-166
     Ring: cap 40 lượt & 10 phút              renderer-bridge.mjs:17-18, 74-80
     KHÔNG ghi ra đĩa (trừ khi bật ambient capture, mặc định TẮT:
       electron/session-capture.mjs:45-59)

[3b] Nhánh QUYẾT ĐỊNH: Gemini tự chọn verb và tự viết tham số
     → message.toolCall → handleToolCall()    live-messages.mjs:159-178, 197-207
     → executeClaudeTool(name, args)          electron/run-dispatch.mjs:469-532
     → isVerb(name) → submitVerb()            run-dispatch.mjs:475, 257-285

[4] Dựng BRIEF từ schema của chính verb, theo thứ tự khai báo, không có code định dạng riêng
    composeBrief()                            run-context.mjs:89-97
    (kiểm tra required trước: missingRequired(), run-context.mjs:107-110)

[5] REVIEW GATE (chặn): shouldPark(verb, workstreamId)  run-dispatch.mjs:239-247
    - mode "never" → không park; "always" → park hết; mặc định "verb"
      (electron/user-config.mjs:103-119)
    - PARK.ALWAYS = execute, finish (verbs.mjs:247, 312)
    - PARK.ON_OPEN = 3 verb stateful, chỉ park ở lượt MỞ session (verbs.mjs:156,175,205)
    - PARK.NEVER = investigate, review, capture_learning
    Nếu park → trả về "parked_for_review", KHÔNG có run_id, 0 token
      run-dispatch.mjs:272-282; báo giọng SYSTEM_EVENT_TASK_REVIEW_PARKED
      run-dispatch.mjs:134-144; timeout 300 000 ms → huỷ, không tự duyệt
      user-config.mjs:121-124, run-dispatch.mjs:100-103

[6] EXECUTION SLOT (chặn): runQueue.submit()  electron/run-queue.mjs:231-249
    Nếu đang có run active → xếp hàng FIFO, trả "queued" ngay lập tức
    (tool call của Gemini Live là đồng bộ, không được phép block)

[7] startClaudeRun()                          electron/run-exec.mjs:293-364
    - đọc trạng thái project TẠI ĐÂY (không phải lúc submit): openChangesWithTasks()
      run-exec.mjs:303-306
    - resolveVerb() → cấu hình đầy đủ         electron/verbs.mjs:530-577
    - log "vì sao dispatch" (verb/model/skills/park), CỐ TÌNH KHÔNG log brief
      run-exec.mjs:316-323
    - nạp persona (stateful.md / stateless.md) run-exec.mjs:328-333
    - verb stateful → ensureProjectScaffold (openspec init) run-exec.mjs:340-348

[8a] STATELESS: startStatelessRun()           run-exec.mjs:368-704
     - thu hẹp disallowedTools lần 2 theo canRelayQuestion() (live session có chạy không)
       run-exec.mjs:374-378, 88-92; nguồn predicate: wiring-capabilities.mjs:163
     - systemPrompt = buildSystemPrompt(verb)  electron/role-prompt.mjs:152-158
     - probe session cũ còn sống không TRƯỚC khi chạy  run-exec.mjs:419-427
     - prompt cuối cùng = buildRunPrompt(...)  run-exec.mjs:604-612
     - query() của Agent SDK                   run-exec.mjs:604 (import dòng 14)

[8b] STATEFUL: startStatefulRun()             run-exec.mjs:715-902
     - getOrCreatePoSession() / deliverPoTurn() electron/po-session.mjs:227-291, 401-421
     - brief của lượt = `${verb.clause}\n\n${run.task}` + transcript
       run-exec.mjs:843-848  (clause lặp lại mỗi lượt vì session dùng chung)

[9] ĐƯỜNG VỀ trong lúc chạy: SDK message → handleClaudeStreamMessage()
    run-stream.mjs:261-274 → pushActivity/pushToolStart/pushToolEnd → emitEvent
    → CHỈ tới renderer (UI Work Stream). Gemini KHÔNG nghe gì ở giai đoạn này.
    (activity còn bị throttle gộp: run-stream.mjs:207-210)

[10] Ngoại lệ duy nhất trong lúc chạy: AskUserQuestion
     canUseTool → askUserQuestionViaVoice()   run-exec.mjs:546-585, run-stream.mjs:341-376
     → notifyIris("SYSTEM_EVENT_PO_QUESTION" + câu hỏi + options)  run-stream.mjs:347-373
     → Gemini đọc lên, thu câu trả lời, gọi answer_claude_question
       gemini-tools.mjs:129-161 → run-dispatch.mjs:491-492 → run-stream.mjs:380-390
     Timeout 300 000 ms (po-session.mjs:12,35-38); hết giờ xử lý theo chính sách của
     người gọi: RECOMMENDED_OPTION hoặc DENY (run-stream.mjs:38-41, 126-156)

[11] KẾT THÚC: runQueue.finalize() → onFinalized  run-queue.mjs:251-277, wiring.mjs:117-162
     → announceClaudeCompletion() → notifyIris(SYSTEM_EVENT_CLAUDE_COMPLETE)
       announcements.mjs:160-234, 43-54 → liveSession.sendRealtimeInput({text})
     → Gemini nói ra miệng bản TÓM TẮT của nó.
```

---

## 2. Câu hỏi 1 — Claude nhận được gì? (nguyên văn hay tóm tắt?)

### 2.1 Phần Gemini tự viết (bị diễn đạt lại)

`composeBrief()` chỉ ghép `Humanized_key: value` theo thứ tự khai báo schema:

```js
// electron/run-context.mjs:89-97
export function composeBrief(verb, args = {}) {
  const properties = verb?.params?.properties ?? {};
  const lines = [];
  for (const key of Object.keys(properties)) {
    const value = String(args?.[key] ?? "").trim();
    if (value) lines.push(`${humanize(key)}: ${value}`);
  }
  return lines.join("\n");
}
```

Nội dung `value` **hoàn toàn do Gemini sinh**. Có hai kiểu schema:

**(a) Verb stateful — schema "mỏng"**, cố ý yêu cầu gần-nguyên-văn (`verbs.mjs:123-137`):

```js
const THIN_PARAMS = Object.freeze({
  type: "object",
  properties: {
    said: { type: "string", description:
      "What the user just said, in their own words and as close to verbatim as you can manage. " +
      "Do not summarize it, do not tidy it, and do not turn it into a specification — " +
      "that is this verb's job, not yours." },
    reading: { type: "string", description:
      "One line: what you take them to be asking for. A reading, not a brief." },
  },
  required: ["said", "reading"],
});
```

→ Đây là **lời hứa trong prompt/schema, không phải cơ chế**: không có gì kiểm tra `said`
có thực sự trùng transcript hay không. Nó là "gần nguyên văn theo khả năng của Gemini".

**(b) Verb stateless — schema "đặc"**, cố ý bắt liệt kê chi tiết (ví dụ `execute`,
`verbs.mjs:275-291`):

```js
details: { type: "string", description:
  "Every concrete detail the user gave — names, numbers, URLs, paths, dates, budgets, " +
  "constraints — plus any default you are assuming. This run cannot hear the conversation " +
  "and cannot ask you anything, so a detail you leave out is lost." },
```

Lý do phân đôi được ghi rõ ở `run-context.mjs:12-22`: verb stateful có thể hỏi lại nên brief
mỏng là điểm khởi đầu; verb stateless không hỏi được nên brief phải đủ.

System instruction của Gemini nói cùng một điều (`gemini-prompts.mjs:111`):

> "…call shape_requirements: … **Pass their words through as closely as you can** and a
> one-line reading — do NOT write a specification, a PRD, or acceptance criteria yourself;
> that is exactly what shape_requirements is for, and **summarizing it away is how detail
> gets lost**."

### 2.2 Phần nguyên văn (transcript) — có thật

`buildRunPrompt()` ghép brief + open-note + focus + transcript (`run-context.mjs:149-192`):

```js
  const kept = boundTranscript(utterances);
  if (kept.length) {
    const body = kept.map((entry) => entry.text).join("\n");
    parts.push(
      "",
      verb?.stateful
        ? "What the user said recently, for context. Your instructions above are a starting point, not a specification — read this for what they actually want, and ask when something material is still missing."
        : "What the user said recently, for context. Your instruction above is what to do; use this only to catch a detail the instruction left out. It never overrides the instruction.",
      fenceUntrustedText(body, TRANSCRIPT_LABEL),
    );
  }
```

Nhãn fence (`run-context.mjs:45-46`): *"a recent verbatim transcript of what was said near
the user's microphone, as background context only"*. Cơ chế fence ở
`electron/untrusted-text.mjs:43-52` (delimiter ngẫu nhiên mỗi lần gọi + trung hoà chuỗi
`SYSTEM_EVENT_`).

**Quan trọng về trọng số:** với verb stateless, transcript bị hạ cấp rõ ràng —
*"It never overrides the instruction"* (`run-context.mjs:187`). Nghĩa là nếu Gemini tóm tắt
sai, transcript nguyên văn **không được phép ghi đè** bản tóm tắt sai đó; nó chỉ dùng để
"bắt lại một chi tiết bị bỏ sót".

Điểm gọi thực tế: stateless `run-exec.mjs:604-612`, stateful `run-exec.mjs:843-848`.
Nguồn `recentUtterances` được nối ở `electron/wiring.mjs:382` → `renderer-bridge.mjs:211-214`.

---

## 3. Câu hỏi 2 — Transcript nguyên văn nằm ở đâu, cắt bao nhiêu?

| Chặng | Nơi | Giới hạn |
| --- | --- | --- |
| Bật transcription | `live-config.mjs:32` `inputAudioTranscription: {}` | — |
| Nhận mảnh | `live-messages.mjs:221-225` | theo mảnh (partial), không phải câu |
| Cộng dồn buffer | `renderer-bridge.mjs:177-200` | chuỗi thô |
| Đóng lượt & đẩy vào ring | `live-messages.mjs:260-263` (turnComplete) → `renderer-bridge.mjs:128-168` | 1 lượt = 1 entry |
| Ring | `renderer-bridge.mjs:72-80` | **40 entry / 10 phút**, `:17-18` |
| Cắt lần 2 khi vào prompt | `run-context.mjs:119-135` | **12 lượt / 4 000 ký tự**, bỏ CŨ NHẤT trước |
| Một lượt dài hơn cả cap | `run-context.mjs:131-133` | cắt đuôi, thêm `…`, không xoá cả lượt |

Vào prompt của Claude ở **mọi verb**, **mọi lượt** (kể cả session resume) —
`run-exec.mjs:607` và `:845`. Lý do cap chặt: `run-context.mjs:36-41` — block này gắn lại
mỗi lượt nên nếu không cap thì chi phí một hội thoại dài sẽ tăng dần.

**Không ghi đĩa** theo mặc định (`renderer-bridge.mjs:63`: "never persisted to disk").
Ngoại lệ opt-in: ambient session capture (`electron/session-capture.mjs`, mặc định off ở
`:48`, watermark bắt đầu từ lúc bật nên không quét ngược, `:56-59`) và meeting record của
listen-only mode (`electron/meeting-capture.mjs`, dùng **fragment thô**, không dùng ring —
lý do ở `live-messages.mjs:68-75`).

**Loại trừ quan trọng:** lời "nghe lỏm" (listen-only mode, có tiếng hệ thống trộn vào)
**không** vào ring (`renderer-bridge.mjs:151-167`) — để không gửi lời của một video tới Claude
dưới danh nghĩa người dùng.

### 3.1 Race đáng ngờ: lượt nói HIỆN TẠI có thể chưa nằm trong ring

Trong `handleLiveMessage`, `message.toolCall` được xử lý ở `live-messages.mjs:197-207`, còn
`flushTranscripts()` (thứ đẩy lượt vào ring) chỉ chạy ở `:212-219` (interrupted) và
`:260-263` (turnComplete). Tool call của một lượt thường tới **trước** `turnComplete` của
chính lượt đó. Dispatch từ `executeClaudeTool` là đồng bộ tới `runQueue.submit` →
`beginRun` → `startClaudeRun` (`run-queue.mjs:208-217`), và `buildRunPrompt` được gọi sau vài
`await` (probe session `run-exec.mjs:419`, canvas MCP `:403`).

⇒ **Với một verb không park (`investigate`, `review`, `capture_learning`), câu vừa nói ra —
đúng câu tạo ra request — có thể KHÔNG có trong transcript đính kèm**; chỉ có các lượt trước
đó. Với verb park (`execute`, `finish`, và lượt mở của các verb stateful) thì không sao, vì
phê duyệt xảy ra sau khi lượt đã flush. Đây là suy luận từ thứ tự code, không phải từ một
test có sẵn — cần đo thực tế để xác nhận.

---

## 4. Câu hỏi 3 — Đường về: người dùng nghe được gì?

### 4.1 Trong lúc run đang chạy: KHÔNG có gì tới giọng nói

`handleClaudeStreamMessage` (`run-stream.mjs:261-274`) chỉ gọi `pushActivity` /
`pushToolStart` / `pushToolEnd`, tất cả đều kết thúc ở `emitEvent(...)`
(`run-stream.mjs:207-256`) → `emitToRenderer("sidecar:event", …)`
(`renderer-bridge.mjs:102-126`). **Không có `notifyIris` nào trên đường này.**

Kiểm chứng: toàn bộ call site của `notifyIris` trong repo là 9 chỗ và không chỗ nào ở trong
vòng lặp stream:
`announcements.mjs:102,126,233,277`, `run-dispatch.mjs:135,153`, `run-stream.mjs:373`,
`capabilities/second-brain.mjs:445,453,476,497`.

⇒ **Không có streaming từng phần ra loa.** Người dùng thấy tiến trình trên UI, nghe được
duy nhất: (a) câu hỏi giữa chừng, (b) thông báo kết thúc.

### 4.2 Kênh duy nhất tới Gemini: `sendRealtimeInput({ text })`

```js
// electron/announcements.mjs:43-54
function notifyIris(lines, { bufferIfOffline = true } = {}) {
  const text = Array.isArray(lines) ? lines.join("\n") : lines;
  const deliverable = Boolean(getLiveSession());
  if (deliverable) { getLiveSession().sendRealtimeInput({ text }); }
  else if (bufferIfOffline) { pendingClaudeAnnouncements.push(text); … }
}
```

Buffer tối đa 20 thông báo, bỏ cũ nhất (`announcements.mjs:30-31`), drain khi reconnect
(`announcements.mjs:65-69`, gọi ở `live-session.mjs:359`).
Kênh `sendCommand` trong `live-messages.mjs:276-295` là escape hatch của developer
(gõ text hoặc chạy `submit_claude_task`), không nằm trên đường về của run.

### 4.3 Gemini đọc nguyên văn hay tự diễn giải?

**Mặc định: DIỄN GIẢI.** `announceClaudeCompletion` (`announcements.mjs:180-231`) ra lệnh:

```
- Give a concise spoken summary in 1-3 sentences based on the result below.   (:188)
- Ask whether he wants to go through the details before continuing…            (:201)
- Do not say you personally did the work; Claude did.                          (:202)
```

Kết quả của Claude được **fence như untrusted** trước khi Gemini đọc
(`announcements.mjs:227`): *"Claude's run result"*, tức Gemini được dặn coi đó là nội dung để
tóm tắt, **không bao giờ là chỉ thị**.

**Ngoại lệ duy nhất: `work_on_note`.** `wiring.mjs:143-152` rẽ nhánh sang
`announceNoteWorkingResult` (`announcements.mjs:244-278`), câu lệnh là:

```
- … Speak the text below EXACTLY AS WRITTEN — do NOT summarize, condense, or re-render it.  (:267)
```

và fence với nhãn *"the note-working session's result, to be read aloud verbatim"* (`:274`).

**Trạng thái đặc biệt được nói riêng, không gộp thành "thất bại":**
- `LIMITED` (chạm trần lượt/tiền): `announcements.mjs:205-209` — "This run did NOT fail".
- `UNANSWERED` (hỏi mà không ai trả lời): `announcements.mjs:215-219` — cấm nói là đã áp
  dụng default, cấm trình bày như một quyết định.
- `CANCELLED`: **không đọc lên** (`announcements.mjs:178`), vẫn hiện trên UI.
- Chi phí: chỉ nói khi được hỏi, lấy số thật từ runtime, cấm ước lượng
  (`announcements.mjs:222-226`).

### 4.4 Câu hỏi giữa chừng (đường về duy nhất "real-time")

`askUserQuestionViaVoice` (`run-stream.mjs:341-376`) gửi `SYSTEM_EVENT_PO_QUESTION` kèm
danh sách câu hỏi + options được render nguyên văn (`run-stream.mjs:366-371`), có `header`
và cờ `multi_select`. Gemini đọc lên, thu trả lời, gọi `answer_claude_question`
(`gemini-tools.mjs:129-161`). Trả lời được mã hoá qua **một** hàm `encodeAnswer`
(`run-stream.mjs:281-287`) cho cả 3 đường (voice / click UI / default timeout), nên không
đường nào âm thầm rút gọn multi-select thành một lựa chọn.

Truncation ở đường về: `output` bị cắt **2 500 ký tự** cho verb thường
(`wiring.mjs:157`) và **8 000 ký tự** cho `work_on_note` (`wiring.mjs:148`).

---

## 5. Câu hỏi 4 — Verb `shape_on_canvas`

Khai báo đầy đủ, `electron/verbs.mjs:170-194`:

| Trường | Giá trị | Dòng |
| --- | --- | --- |
| `label` | `"Canvas"` | verbs.mjs:171 |
| `stateful` | `true` | verbs.mjs:174 |
| `park` | `PARK.ON_OPEN` (chỉ park ở lượt mở session) | verbs.mjs:175 |
| `sessionKey` | `STATEFUL_SESSION_KEY` = `"stateful"` — **dùng chung với `shape_requirements`** | verbs.mjs:179, 105 |
| `model` | `STRONGEST` = `"claude-opus-5"` | verbs.mjs:180, 79 |
| `budget` | `"stateful"` → 150 lượt / $6 (docs/PIPELINE_INTERNALS.md, `run-budget.mjs`) | verbs.mjs:181 |
| `skills` | `SHAPING_SKILLS` (từ `run-skills.mjs`) | verbs.mjs:182 |
| `mcpServers` | `["iris-canvas"]` | verbs.mjs:186 |
| `vault` | `false` | verbs.mjs:187 |
| `structuredOutput` | `true` | verbs.mjs:188 |
| `disallowedTools` | `ASKS_FREELY` = `[]` → **được dùng `AskUserQuestion`** | verbs.mjs:189, 94 |
| `params` | `THIN_PARAMS` (`said` + `reading`, cả hai required) | verbs.mjs:190, 123-137 |
| `basePersona` | `STATEFUL` → `resources/personas/stateful.md` | verbs.mjs:191 |
| `guardOpenNoteWrites` | không khai báo → `false` (`resolveVerb` ép Boolean) | verbs.mjs:565 |

**Clause (prompt riêng của verb)**, `verbs.mjs:192-193`:

> "Work on the drawing canvas with the user. Read the canvas before answering about it,
> and draw on it rather than describing what you would draw."

Clause này được ghép vào system prompt qua `role-prompt.mjs:137`
(`PREAMBLE + base statefulness clause + clause + CLOSING`), và **lặp lại trong prompt của
từng lượt** ở `run-exec.mjs:844` (`brief: \`${verb.clause}\n\n${run.task}\``) — vì session
dùng chung nên system prompt bị "đóng đinh" theo verb nào mở session trước
(`run-exec.mjs:786-791`).

**Gemini gọi nó ra sao:**
- Declaration sinh tự động từ registry, không viết tay: `gemini-tools.mjs:48-54`.
- `description` mà Gemini đọc (`verbs.mjs:172-173`): *"Shape something on the drawing canvas …
  **You cannot see the canvas; this verb can.** It continues the SAME conversation as
  shape_requirements…"*
- Thêm một đoạn prose từ capability canvas, chỉ khi pipeline available
  (`electron/capabilities/canvas.mjs:143-144`): *"CANVAS — … a drawing canvas/whiteboard in
  the app that YOU cannot see … call shape_on_canvas … **Never guess at what is drawn
  yourself.**"*
- Capability **không** khai báo tool riêng (`canvas.mjs:298`: `toolDeclarations: []`) — cố ý,
  để registry là nơi duy nhất định nghĩa verb.
- MCP server `iris-canvas` được nối theo `verb.mcpServers`, chỉ khi canvas đã từng được mở
  (`canvas.mjs:121-130` `ensureCanvasMcpForRun`, gate `canvasEngaged` ở `:110-115`), và với
  session đã sống thì nối *lười* qua `setPoSessionMcpServers` (`run-exec.mjs:833-837`).
  Token đi trong tiến trình, không qua file tạm/argv (`run-exec.mjs:398-402`).

---

## 6. Câu hỏi 5 — Độ trễ: các chặng từ "nói xong" tới "Claude bắt đầu chạy"

| # | Chặng | Ở đâu | Có chặn không? |
| --- | --- | --- | --- |
| 1 | Gemini Live phát hiện hết lượt (VAD) rồi mới sinh tool call | phía server Gemini; boundary logic chỉ tồn tại cho listen-only ở `live-messages.mjs:22-39` | Chặn (độ trễ mạng + VAD), Iris không điều khiển |
| 2 | Availability gate | `getPipelineAvailable()` — verb chỉ được **khai báo** khi true (`gemini-tools.mjs:241`), và chặn lại lần nữa lúc gọi (`run-dispatch.mjs:470-472`) | Không trễ (đọc cờ trong bộ nhớ). Cờ này chỉ refresh lúc (re)connect: `live-session.mjs:302-305` |
| 3 | Validate + dựng brief | `run-dispatch.mjs:258-268`, `run-context.mjs:89-110` | Không (đồng bộ, thuần CPU) |
| 4 | **REVIEW GATE (park)** | `run-dispatch.mjs:239-247, 272-282` | **CHẶN VÔ HẠN ĐỊNH** tới khi người dùng duyệt; timeout 300 000 ms rồi **huỷ** (`user-config.mjs:121-124`, `run-dispatch.mjs:100-103`). Áp dụng cho `execute`/`finish` **mọi lần gọi** |
| 5 | **EXECUTION SLOT (queue)** | `run-queue.mjs:231-249` | **CHẶN** nếu đang có run khác. FIFO, 1 run toàn hệ thống. Trả `queued` ngay cho Gemini nên giọng nói không treo |
| 6a | Đọc project state + nạp persona + `openspec init` | `run-exec.mjs:303-348` | Chặn ngắn, đồng bộ I/O (`ensureProjectScaffold` chỉ cho verb stateful) |
| 6b | Probe session cũ còn sống (stateless) | `run-exec.mjs:419-427` (`isSessionAlive`) | Chặn — một round-trip `getSessionInfo()` **trước** mỗi run có session lưu |
| 6c | Khởi động canvas MCP (nếu verb khai báo) | `run-exec.mjs:403` / `:741` → `canvas.mjs:121-130` | Chặn — `await canvasMcp.start()` |
| 6d | Spawn (stateless) hoặc resume/create session (stateful) | `run-exec.mjs:604` / `po-session.mjs:227-291` | Chặn — stateless spawn tiến trình `claude` mỗi run; stateful chỉ trả giá này ở lượt ĐẦU, các lượt sau chỉ push vào channel (`po-session.mjs:401-421`) |
| 6e | (stateful) đổi model / nối MCP nếu session đã sống | `run-exec.mjs:823-839` | Chặn ngắn, `Promise.all` trước khi giao lượt |
| 7 | Billing gate (chỉ stateful) | `run-exec.mjs:721-730` `poBillingStatus()` | Không trễ, nhưng **fail cứng** nếu thiếu `CLAUDE_CODE_OAUTH_TOKEN` |

Ngoài ra, watchdog nhàn rỗi 30 phút giết run im lặng (`run-queue.mjs:85`,
`:194-206`), và được **tạm ngưng** trong lúc chờ người trả lời câu hỏi
(`run-stream.mjs:90` `runQueue.suspend()` / `:114` `resume()`), đúng ở một funnel duy nhất.

**Tóm lại hai chặng chặn thật:** *review gate* (do người) và *execution slot* (do thiết kế
"Claude làm một việc một lúc"). Các chặng còn lại là hàng chục–hàng trăm ms.

---

## 7. Bảng: cái gì được truyền NGUYÊN VĂN / cái gì bị MẤT

| Thông tin | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Âm thanh giọng nói của người dùng | **Không bao giờ** tới Claude — chỉ tới Gemini | `live-messages.mjs:266-274` là kênh audio duy nhất |
| Transcript nguyên văn 12 lượt gần nhất | **Nguyên văn**, có fence, có nhãn "background context only" | `run-context.mjs:180-189`, `run-exec.mjs:607` |
| Lượt thứ 13 trở về trước | **MẤT** (bỏ cũ nhất trước) | `run-context.mjs:120-128` |
| Ký tự vượt 4 000 trong khối transcript | **MẤT** (bỏ lượt cũ; nếu chỉ còn 1 lượt thì cắt đuôi) | `run-context.mjs:125-133` |
| Lượt cũ hơn 10 phút / quá 40 lượt | **MẤT** trước cả khi tới `boundTranscript` | `renderer-bridge.mjs:17-18, 74-80` |
| Ngữ điệu, ngập ngừng, nhấn giọng, im lặng, ngắt lời | **MẤT** — chỉ có text | `live-config.mjs:32` chỉ trả text |
| Ai đang nói (định danh người nói) | **MẤT** — mic không phân biệt; đó là lý do phải fence | `renderer-bridge.mjs:63-67`, `untrusted-text.mjs:5-8` |
| Lời "nghe lỏm" trong listen-only mode | **CỐ TÌNH bỏ** khỏi ring (không gán nhầm cho người dùng) | `renderer-bridge.mjs:151-167` |
| Ý định của người dùng (chọn verb nào) | **Do Gemini quyết**, Claude không thấy các verb khác | `gemini-prompts.mjs:110`, `run-dispatch.mjs:475` |
| Brief / tham số verb | **Gemini viết lại 100%** | `run-context.mjs:89-97` |
| `said` của verb stateful | Gemini *được yêu cầu* gần-nguyên-văn, **không có gì kiểm chứng** | `verbs.mjs:126-130` |
| Ghi chú đang focus trong galaxy | id/title/tags **nguyên văn**, **không có nội dung note** | `run-context.mjs:57-60, 172-178` |
| Note đang mở trong reader | id/title/tags/đường dẫn tương đối, **không có body** | `run-context.mjs:67-72, 160-166` |
| Trạng thái project (open changes) | Đọc trực tiếp từ đĩa lúc run start, **không qua Gemini** | `run-exec.mjs:303-306` |
| Lịch sử hội thoại trước với Claude | **Giữ nguyên** — mọi verb đều `resume` session riêng của nó | `run-exec.mjs:413-418, 588` |
| Câu hỏi của Claude (text + options + header + multiSelect) | **Nguyên văn** tới Gemini | `run-stream.mjs:363-371` |
| Câu trả lời của người dùng | Gemini gửi lại **label của option**, phải trùng verbatim câu hỏi | `gemini-tools.mjs:145-155` |
| Kết quả run tới Gemini | **Nguyên văn** (đã fence), nhưng **cắt 2 500 ký tự** | `announcements.mjs:227`, `wiring.mjs:157` |
| Kết quả run tới TAI người dùng | **Bị Gemini tóm tắt 1-3 câu** | `announcements.mjs:188` |
| Kết quả của `work_on_note` tới tai người dùng | **Nguyên văn**, cắt 8 000 ký tự | `announcements.mjs:267`, `wiring.mjs:148` |
| Danh sách "decisions" cuối run | Render thành list đánh số **trong main**, không để Gemini tự dò heading | `announcements.mjs:133-144, 196` |
| Tiến trình từng bước (tool calls) | **KHÔNG tới Gemini**; chỉ tới UI, còn bị throttle gộp | `run-stream.mjs:207-256` |
| Chi phí thật ($, số lượt) | **Ghi lại từ runtime**, cấm ước lượng | `announcements.mjs:222-226`, `run-queue.mjs:116-120` |
| Brief trong log chẩn đoán | **CỐ TÌNH không log** (nội dung của người dùng, không phải diagnostics) | `run-exec.mjs:313-315` |

---

## 8. Danh sách điểm mất thông tin (information loss points)

Xếp theo mức nghiêm trọng của hậu quả.

**L1 — Gemini là người chọn verb, và lựa chọn đó không thể phục hồi.**
`run-dispatch.mjs:475` dispatch thẳng theo tên tool. Chọn `execute` thay vì
`shape_requirements` sẽ đổi hoàn toàn model, skills, quyền hỏi lại, và việc có park hay không.
Chính tài liệu thừa nhận: *"This narrows the bottleneck; it does not remove it. Gemini still
picks the verb and writes the summary line."* (`docs/PIPELINE_INTERNALS.md`, mục "The user's
own words reach the run"). Giảm nhẹ: mọi dispatch đều log cấu hình đã resolve
(`run-exec.mjs:316-323`).

**L2 — Với verb stateless, transcript bị cấm ghi đè brief.**
`run-context.mjs:187`: *"It never overrides the instruction."* Nếu Gemini hiểu sai yêu cầu,
việc có transcript nguyên văn kề bên **không** sửa được lỗi đó về mặt cơ chế. Đây là điểm mất
mát nghiêm trọng nhất còn lại trên đường đi, vì `execute` là verb ghi vào repo.

**L3 — `said` "gần nguyên văn" là lời hứa trong schema, không có cơ chế bảo đảm.**
`verbs.mjs:126-130`. Không có đối chiếu nào giữa `said` và ring transcript.

**L4 — Câu nói tạo ra request có thể chưa kịp vào ring** (xem §3.1):
`live-messages.mjs:197-207` (toolCall) chạy trước `:260-263` (turnComplete → flush).
Ảnh hưởng các verb không park.

**L5 — Cắt transcript hai tầng.** 40/10 phút (`renderer-bridge.mjs:17-18`) rồi 12/4 000
(`run-context.mjs:42-43`). Một cuộc trò chuyện dài, hoặc một đoạn đọc dài, sẽ mất phần đầu.
Đây là đánh đổi có chủ đích (chi phí token mỗi lượt), ghi rõ ở `run-context.mjs:36-41`.

**L6 — Kết quả của Claude bị cắt 2 500 ký tự trước khi tới Gemini** (`wiring.mjs:157`),
rồi lại bị Gemini nén thành 1-3 câu (`announcements.mjs:188`). Người dùng chỉ nghe bản nén
của một bản đã cắt. Bù lại: bản đầy đủ nằm trên UI card và trong `inbox/runs`
(`wiring.mjs:139` `captureRunOutcome`).

**L7 — Không có tiến trình bằng giọng nói.** Trong lúc run chạy (có thể tới 30 phút,
`run-queue.mjs:85`), tai người dùng không nhận được gì. Chỉ có UI.

**L8 — Prompt hệ thống của Gemini chỉ dựng 1 lần mỗi lần connect**
(`live-session.mjs:317`), nên tool surface và ngữ cảnh workspace bị đóng băng cả phiên. Đã có
hai đường bù: `SYSTEM_EVENT_WORKSPACE_UPDATE` (`announcements.mjs:101-107`) và
`SYSTEM_EVENT_FOCUS_UPDATE`. Nhưng một thay đổi `pipelineAvailable` giữa phiên **không** làm
xuất hiện thêm verb cho tới lần reconnect (`live-session.mjs:302-305`).

**L9 — Context window compression của Gemini** (`live-config.mjs:28-31`: trigger 104 857
tokens, sliding window về 52 428) sẽ **đuổi** phần đầu của hội thoại thoại. Các
`SYSTEM_EVENT_*` in-band cũng có thể bị đuổi (`gemini-prompts.mjs:9-13` nói rõ điều này cho
listen-only mode).

**L10 — Câu hỏi hết giờ.** 300 s (`po-session.mjs:12`). Với `RECOMMENDED_OPTION`, option đầu
tiên được áp dụng thay người dùng (`run-stream.mjs:294-301`); với `DENY`, run dừng và
finalize là `unanswered` (`run-stream.mjs:126-148`, `run-exec.mjs:628-631`). Cả hai đều là
mất thông tin về ý định người dùng, nhưng cả hai đều được **báo cáo trung thực**
(`announcements.mjs:215-219`).

**L11 — Review park hết giờ thì HUỶ, không tự duyệt** (`run-dispatch.mjs:100-103`):
brief mất, phải nói lại. Đây là hướng an toàn có chủ đích.

**L12 — Chỉ có 1 pending question và 1 pending review toàn hệ thống.**
`run-stream.mjs:71` và `run-dispatch.mjs:77-86` (`raise()` gọi `this.clear()` — một submit mới
**âm thầm** thay thế review đang chờ).

---

## 9. Ghi chú xác thực

- Đã đọc: `CLAUDE.md`, `docs/PIPELINE_INTERNALS.md` (549 dòng), và trực tiếp các file
  `electron/{verbs,gemini-tools,gemini-prompts,run-context,run-exec,run-dispatch,run-stream,
  run-queue,role-prompt,announcements,live-config,live-messages,live-session,renderer-bridge,
  untrusted-text,po-session,user-config,session-capture,wiring,wiring-capabilities}.mjs`
  và `electron/capabilities/canvas.mjs`.
- **Không** chạy app, **không** chạy test, **không** sửa file nào.
- Mọi số dòng lấy từ trạng thái working tree tại thời điểm audit.
- Điểm §3.1 (race transcript) là **suy luận từ thứ tự code**, chưa được đo bằng thực nghiệm —
  đã đánh dấu rõ như vậy.
