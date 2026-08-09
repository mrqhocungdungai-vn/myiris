# Vòng đời phiên Claude Agent SDK trong Iris — có thể giữ MỘT phiên online suốt lúc canvas mở không?

Chỉ đọc, không sửa code. Mọi khẳng định kèm `file:line` (đọc tại HEAD hiện tại).
Nguồn nền: `CLAUDE.md`, `docs/PIPELINE_INTERNALS.md`, `docs/REFERENCE.md`,
`openspec/specs/stateful-verb-session/spec.md`.

**Kết luận ngắn:** KHẢ THI, và phần lớn cơ chế ĐÃ TỒN TẠI — phiên thường trú
(`po-session.mjs`) không có idle-teardown, không respawn process mỗi lượt.
Cái cản không phải transport mà là bốn thứ khác: (1) không có trigger nào mở
phiên khi canvas mở, (2) trần budget áp **cho cả vòng đời phiên** chứ không
phải mỗi lượt, (3) một slot thực thi toàn cục xếp hàng mọi lượt, (4) chỉ một
hội thoại được thường trú mỗi workstream nên bị "handoff" đá ra.

---

## 1. "Stateful verb" nghĩa là gì trong code

`stateful` chỉ có **một** nghĩa khai báo: verb này *được phép dừng giữa lượt và
hỏi bằng giọng nói* — `electron/verbs.mjs:8`, và spec
`openspec/specs/stateful-verb-session/spec.md` ("Purpose"). Nó **không** đồng
nghĩa với "có ngữ cảnh liên tục": verb stateless cũng resume hội thoại riêng
(`run-exec.mjs:406-408`, spec "Statefulness is not continuity").

Registry (`electron/verbs.mjs`):

| verb | dòng | stateful | sessionKey | model | budget | park |
| --- | --- | --- | --- | --- | --- | --- |
| `shape_requirements` | 155-159 | true | `stateful` | opus-5 | `stateful` | on_open |
| `shape_on_canvas` | 174-186 | true | `stateful` (dùng chung) | opus-5 | `stateful` | on_open; `mcpServers: ["iris-canvas"]` (verbs.mjs:186) |
| `work_on_note` | 204-212 | true | `note:<id>` (verbs.mjs:73-75) | opus-5 | `stateful` | on_open |
| `execute` | 246-250 | false | `execute` | sonnet-5 | `worker` | always |
| `finish` | 315-319 | false | `finish` | sonnet-5 | `worker` | always |
| `investigate` | 347-351 | false | `investigate` | sonnet-5 | `light` | never |
| `review` | 382-388 | false | `review` | opus-5 | `light` | never |
| `capture_learning` | 415-420 | false | `capture_learning` | haiku-4.5 | `light` | never |

`STATEFUL_SESSION_KEY = "stateful"` (`verbs.mjs:105`) — hai verb shaping (giọng
nói + canvas) **dùng chung một phiên**, đây chính là cái làm "chuyển sang canvas"
giữ nguyên ngữ cảnh (`verbs.mjs:61-64`, `run-exec.mjs:710-714`).

### Phiên thường trú được tạo / giữ / đóng ở đâu

- **Chứa ở:** `const sessions = new Map()` — `electron/po-session.mjs:85`
  (key = `workstream.id`, tức **một phiên thường trú / workstream**).
- **Tạo:** `getOrCreatePoSession()` — `po-session.mjs:227`; gọi từ
  `startStatefulRun()` ở `electron/run-exec.mjs:765-805`. Tạo lười, ở lượt
  stateful đầu tiên.
- **Giữ sống:** transport là một async-iterable **không bao giờ tự kết thúc**
  (`createUserMessageChannel`, `po-session.mjs:44-83`), truyền vào
  `queryFn({ prompt: channel.iterable, options })` — `po-session.mjs:368`.
  `pump()` (`po-session.mjs:170-197`) `for await` liên tục. Mỗi lượt chỉ là một
  `channel.push(...)` — `deliverPoTurn`, `po-session.mjs:401-421`.
- **Đóng — CHỈ do 5 nguyên nhân, không có cái nào là hết giờ:**
  1. Handoff sang sessionKey khác trong cùng workstream — `po-session.mjs:254-263`
     (khác conversation → `closePoSession(workstream.id)` rồi mở phiên mới).
  2. Đổi workstream / tạo workstream mới — `session-store.mjs:338`, `:358`.
  3. Đổi thư mục project (cwd) — `session-store.mjs:378` (và xoá `agent_sessions`).
  4. Đổi credential Claude — `user-config.mjs:363` (`closeAllPoSessions()`).
  5. Thoát app — `main.mjs:315` trong `shutdownTeardown()`.
- **Timeout / idle teardown: KHÔNG CÓ.** Spec nói thẳng: "Time passing,
  unrelated activity, and a stateless run executing in between SHALL NOT end
  residency" (`stateful-verb-session/spec.md`, mục "The live session's lifecycle
  is user-controlled"). Watchdog 30 phút (`run-queue.mjs:85`
  `DEFAULT_RUN_IDLE_TIMEOUT_MS = 1_800_000`) chỉ gắn với **run đang active**
  (`run-queue.mjs:134-146, 208-212`), không đụng vào phiên thường trú.
- **Huỷ lượt ≠ đóng phiên:** `cancelPoTurn()` gọi `query.interrupt()` và **giữ
  phiên sống** — `po-session.mjs:439-484`, ưu tiên giữ context window.

## 2. Cơ chế resume — có phải trả giá spawn process mỗi run không?

| đường | resume bằng gì | spawn process? |
| --- | --- | --- |
| stateful (resident) | `options.resume = resumeSessionId` chỉ **khi mở phiên** — `po-session.mjs:365`; id lấy từ `workstream.agent_sessions[sessionKey]` — `run-exec.mjs:771` | **Không** cho mỗi lượt. Lượt = `channel.push` (`po-session.mjs:417`). Spawn chỉ ở `po-session.mjs:368` khi tạo phiên. |
| stateless (one-shot) | `if (previousSession) options.resume = previousSession` — `run-exec.mjs:588` | **Có** — một `query()` mới mỗi run, teardown khi finalize (`run-exec.mjs:366-368`, `abortController` ở `:446`, `:590`) |

- Không dùng `--resume` CLI hay `continue`; chỉ dùng option `resume` của SDK
  (`REFERENCE.md`, bảng "Unused": `continue` bị từ chối có lý do).
- Id resume được **kiểm tra sống trước khi chạy**: `isSessionAlive()` —
  `run-sessions.mjs:52-60`, gọi ở `run-exec.mjs:419`. Chỉ bỏ id khi SDK khẳng
  định chết; probe mập mờ thì giữ (`run-sessions.mjs:38-47`).
- `CLAUDE_CONFIG_DIR` được ghim/khôi phục quanh mọi lời gọi
  (`run-sessions.mjs:27-36`) — đo được: không ghim thì `listSessions()` trả về
  32 phiên của chính người dùng ở `~/.claude` (`run-sessions.mjs:13-19`).
- Đổi model **không** cần đóng phiên: `setPoSessionModel` → `query.setModel()`
  (`po-session.mjs:378-384`, gọi ở `run-exec.mjs:824`).
- Bộ option của phiên thường trú được khoá chốt trong test:
  `PO_KEYS` (20 field) — `electron/sdk-options.test.mjs:287-309`, assert
  `Object.keys(poOptions()).sort()` ở `:340`. Stateless: `EXECUTE_KEYS` (21) —
  `:98-120`, assert `:150`.

## 3. Hàng đợi và trần

- **Một slot toàn cục.** `let active = null` — `run-queue.mjs:82`; `submit()`
  đẩy vào `queue` khi có run active — `run-queue.mjs:231-236`. Lượt stateful và
  run stateless **dùng chung slot đó** (`run-exec.mjs:302-306`,
  `PIPELINE_INTERNALS.md` §"delegation model" mục 5). Nghĩa là **một lượt canvas
  ngắn vẫn phải xếp hàng sau một `execute` chạy 20 phút**.
- **Trần** (`run-budget.mjs:33-43`): `stateful` 150 turns / $6; `worker` 150 / $5;
  `light` 60 / $2. Override toàn cục `IRIS_CLAUDE_MAX_TURNS` /
  `IRIS_CLAUDE_MAX_BUDGET_USD` (`run-budget.mjs:50-51, 68-76`).
- **Với phiên thường trú, trần áp cho CẢ VÒNG ĐỜI PHIÊN, không phải mỗi lượt** —
  `po-session.mjs:334-339` ("A resident session applies them per `query()`, i.e.
  across the session's whole lifetime"), lặp lại ở `run-exec.mjs:750-752` và
  `run-budget.mjs:33-36`. **Đây là ràng buộc nặng nhất cho ý tưởng "luôn online".**
- **Chạm trần:** `isCeilingSubtype()` → finalize `LIMITED` (không phải `failed`)
  — `run-exec.mjs:862-864` (stateful), `:687-689` (stateless);
  thông điệp từ `describeCeiling()` (`run-budget.mjs:113-125`).
- **Cảnh báo giữa chừng:** hook `PreToolUse` báo một lần khi vượt 0.75 trần chi
  (`run-budget.mjs:45-46`, `budgetWarning` `:134-142`), số liệu lấy từ API
  experimental của SDK, không có số thì im lặng (`PIPELINE_INTERNALS.md` §Hooks).
- **Hệ quả cho hội thoại nhiều lượt ngắn liên tục:** mỗi câu trao đổi tiêu ít
  nhất 1 turn của quota 150 dùng chung; 150 turn Opus-5 với transcript + focus
  block đính kèm mỗi lượt (`run-context.mjs` qua `buildRunPrompt`,
  `run-exec.mjs:843-848`) sẽ chạm $6 rất sớm. Khi chạm, lượt đó báo `limited`,
  stream `query()` kết thúc → `pump` đặt `state.ended = true`
  (`po-session.mjs:178`) → lượt kế tiếp `getOrCreatePoSession` thấy `ended` nên
  **mở phiên hoàn toàn mới** (`po-session.mjs:255`) resume theo id đã lưu. Tức là
  hệ thống *tự lành* nhưng người dùng thấy một lượt hỏng và trả lại giá spawn +
  replay transcript.

## 4. Canvas MCP

- Server: `createCanvasMcp()` — HTTP loopback, cổng ephemeral, bearer token
  (`canvas-mcp.mjs:544-627`, record `buildMcpServerRecord` `:23-25` với
  `alwaysLoad: true`).
- **Bật khi nào:** hai cổng AND — `pipelineAvailable` **và** `canvasEngaged`
  (`capabilities/canvas.mjs:110-115`). `canvasEngaged` là cờ **sticky per app
  session**, bật lần đầu panel vẽ mount (`canvas.mjs:101-105`, IPC
  `canvas:activate` `:154-162`; renderer bắn ở
  `src/components/DrawingCanvas.tsx:300` trong `useEffect` mount-once).
- **Tắt khi nào:** chỉ ở `teardown()` lúc thoát app — `canvas.mjs:282-289`.
  **Đóng panel vẽ KHÔNG tắt server và KHÔNG reset `canvasEngaged`**
  (`canvas.mjs:96-101` ghi rõ "never reset except by an app restart").
- **Gắn vào run:** `ensureCanvasMcpForRun()` — `canvas.mjs:121-130`; gọi ở
  `run-exec.mjs:741` (stateful) và `:403` (stateless), **chỉ khi verb khai báo
  `iris-canvas`** — hôm nay chỉ `shape_on_canvas` (`verbs.mjs:186`).
- **Sống xuyên nhiều run:** CÓ. `canvasMcp.start()` idempotent, trả cùng
  `{url, token}`, không mở listener thứ hai (`canvas-mcp.mjs:597-599`). Với phiên
  thường trú, MCP được nối **lười, tối đa một lần** qua
  `setPoSessionMcpServers` → `query.setMcpServers()` (`po-session.mjs:390-396`,
  gọi ở `run-exec.mjs:833-837`, cờ `state.currentMcp` `po-session.mjs:285`) — nên
  một phiên mở bằng giọng nói vẫn nối được canvas ở lượt canvas đầu tiên mà
  không phải mở lại phiên.
- **Quan trọng:** mở canvas **chỉ khởi động MCP server**, KHÔNG khởi động phiên
  Claude nào. Phiên chỉ sinh ra khi Gemini quyết định gọi `shape_on_canvas`.

## 5. Agent SDK có gì cho phiên dài — Iris dùng / không dùng

`docs/REFERENCE.md` §"Agent SDK `Options`": SDK khai báo **63** field, Iris dùng **23**.

**Đang dùng, phục vụ phiên dài:**

| option | ở đâu | ghi chú |
| --- | --- | --- |
| streaming input mode (`prompt` = async iterable) | `po-session.mjs:368` | **đã có** cho stateful; đây chính là cái giữ phiên sống |
| `canUseTool` | `po-session.mjs:112-128`, khai `sdk-options.test.mjs:296` | relay `AskUserQuestion` bằng giọng nói; timeout 5' (`po-session.mjs:12,35-38`) |
| `hooks` (5 callback) | `run-hooks.mjs`, gắn `po-session.mjs:355-361` | có `PreCompact` → compaction hiện ra thay vì treo im |
| `abortController` | `po-session.mjs:92`, dùng ở `:502-511` (close) | hard stop cấp phiên |
| `resume`, `model`(+`setModel`), `mcpServers`(+`setMcpServers`), `maxTurns`/`maxBudgetUsd`, `skills`, `settingSources:["project"]`, `outputFormat`, `title`, `stderr`, `plugins`, `agents`/`agent`, `env` | `po-session.mjs:329-366` | bộ 20 field khoá bởi `sdk-options.test.mjs:287-340` |
| `interrupt()` | `po-session.mjs:254` | huỷ lượt, giữ context |

**CÓ SẴN mà Iris chưa dùng — liên quan hội thoại liên tục** (lý do trong
`REFERENCE.md` §"Unused, with reasons"):

| option | trạng thái hôm nay | có thể dùng cho phiên canvas liên tục |
| --- | --- | --- |
| `includePartialMessages` | *"Evaluated and declined"* — voice chỉ nói ở cuối run | **Rất đáng xét lại** cho canvas: hội thoại liên tục cần phản hồi tăng dần, không phải một khối cuối lượt |
| `enableFileCheckpointing` / `rewindFiles()` | declined vì shape stateless bị teardown | Với phiên **thường trú** thì `Query` còn sống → undo là khả thi, lý do từ chối không áp cho canvas |
| `forkSession`, `sessionId`, `resumeSessionAt` | declined — "one linear conversation per role per workstream" | Cho phép fork nhánh canvas mà không mất phiên gốc |
| `agentProgressSummaries`, `forwardSubagentText` | declined — không có UI | Canvas *có* UI |
| `effort`, `thinking`, `taskBudget` | declined vì mọi số đều đo được | Đòn bẩy giảm chi phí cho lượt ngắn |
| `toolConfig` (`askUserQuestion.previewFormat`) | declined — hỏi bằng giọng nói | Canvas là bề mặt render được |
| `sessionStore`/`sessionStoreFlush`, `continue`, `fallbackModel`, `sandbox`, `strictMcpConfig`, `settings`, `extraArgs`, ... | declined, lý do vẫn đứng vững | không liên quan |

Hai sự thật đo được cần nhớ (`REFERENCE.md`): run có `agent` **không** nhận
preset `claude_code` (persona body *là* base prompt), và `AskUserQuestion` chỉ
hiện khi có `canUseTool` — `disallowedTools` là cơ chế đảm bảo thật sự.

## 6. Chi phí / rủi ro khi giữ phiên mở lâu

1. **Budget là ràng buộc cứng nhất** — 150 turns / $6 tính dồn cho cả phiên
   (`run-budget.mjs:35`, `po-session.mjs:334-339`). Phiên "luôn online" cả buổi
   vẽ gần như chắc chắn chạm trần → `limited` → mở lại phiên.
2. **Context tăng không giới hạn** — mỗi lượt còn đính thêm transcript verbatim
   và focus block (`run-exec.mjs:843-848`). Transcript có chặn hai lớp
   (12 utterance / 4 000 ký tự, `PIPELINE_INTERNALS.md` §"The user's own words"),
   nhưng chính context window của hội thoại thì không — sẽ dẫn tới auto-compact
   (chỉ được *nhìn thấy* qua hook `PreCompact`, không được điều khiển).
3. **Process sống dai** — một subprocess `claude` native/workstream nằm suốt
   phiên; chỉ được thu hồi bởi 5 nguyên nhân ở §1. Có backstop
   `abortController.abort()` trong `finally` của `closePoSession`
   (`po-session.mjs:502-511`) và teardown lúc quit (`main.mjs:315`).
4. **Main thread**: bản thân phiên là I/O, `pump()` async
   (`po-session.mjs:170`); watchdog dùng `unref()` (`run-queue.mjs:96-98`), timer
   review/ảnh canvas cũng `unref` (`run-dispatch.mjs:83`, `canvas.mjs:69`). Rủi
   ro chính không phải CPU mà là **slot đơn bị chiếm**: một lượt treo giữ slot
   tới 30 phút (`run-queue.mjs:85`), và một câu hỏi treo còn **tạm ngưng cả
   watchdog** (`run-stream.mjs:90` `runQueue.suspend()`, hồi ở `:114`).
5. **Handoff âm thầm**: chỉ một hội thoại thường trú/workstream
   (`po-session.mjs:254-263`). Người dùng mở một note (`work_on_note`, key
   `note:<id>`) giữa buổi vẽ sẽ **đá phiên canvas ra khỏi residency**; hội thoại
   không mất (id vẫn lưu) nhưng lượt canvas kế tiếp phải spawn + resume lại.
6. **Park chỉ ở lần mở** (`run-dispatch.mjs:239-246`, `verbs.mjs:50-62`): phiên
   càng sống lâu thì càng lâu không có điểm chấp thuận nào nữa — đúng chủ ý,
   nhưng là rủi ro chi tiêu cần nêu.

---

## Bảng "hiện có / còn thiếu"

| Năng lực cần cho "một phiên Claude luôn online suốt lúc canvas mở" | Hiện có? | Bằng chứng / cái cản |
| --- | --- | --- |
| Phiên thường trú, một context window, không replay | ✅ | `po-session.mjs:44-83, 227, 368, 401-421` |
| Không respawn process mỗi lượt | ✅ | `deliverPoTurn` chỉ `channel.push` — `po-session.mjs:417` |
| Không có idle timeout / tự teardown theo thời gian | ✅ | spec `stateful-verb-session`; watchdog chỉ gắn run active `run-queue.mjs:134-146` |
| Sống sót qua run stateless xen giữa | ✅ | spec "Session survives across unrelated activity" |
| Canvas MCP sống xuyên nhiều run | ✅ | `canvas.mjs:110-130`, `canvas-mcp.mjs:597-599`, tắt chỉ ở `canvas.mjs:288` |
| Nối MCP vào phiên đang sống, không cần mở lại | ✅ | `setPoSessionMcpServers` `po-session.mjs:390-396` ← `run-exec.mjs:833-837` |
| Đổi model không cần đóng phiên | ✅ | `setPoSessionModel` `po-session.mjs:378-384` |
| Huỷ lượt mà giữ phiên | ✅ | `interrupt()` `po-session.mjs:253-266` |
| Hỏi giữa lượt bằng giọng nói | ✅ | `canUseTool` `po-session.mjs:112-128`, `run-stream.mjs:83-121` |
| **Mở canvas ⇒ mở/hâm phiên Claude** | ❌ | `canvas:activate` chỉ `markCanvasEngaged` + `maybeStartCanvasMcp` (`canvas.mjs:154-162`). Phiên chỉ sinh khi Gemini gọi verb (`run-exec.mjs:765`) |
| **Trần theo lượt thay vì theo cả phiên** | ❌ | 150 turns/$6 áp cho cả `query()` — `po-session.mjs:334-339`, `run-budget.mjs:33-36` |
| **Tự mở lại phiên sau `limited` một cách tường minh** | ⚠️ ngầm | `state.ended` (`po-session.mjs:178`) → lần sau tạo mới (`po-session.mjs:255`); người dùng vẫn thấy một lượt `limited` (`run-exec.mjs:862`) |
| **Lượt canvas không bị xếp hàng sau run dài** | ❌ | slot đơn toàn cục `run-queue.mjs:82, 231-236` |
| **Nhiều hội thoại cùng thường trú (canvas + note)** | ❌ | handoff đóng phiên cũ `po-session.mjs:254-263` |
| **Phản hồi tăng dần trong lượt (partial)** | ❌ | `includePartialMessages` bị từ chối — `REFERENCE.md` §Unused |
| **Quản lý chủ động context growth / compaction** | ❌ | chỉ *quan sát* qua hook `PreCompact` |
| **Chỉ báo cho người dùng "phiên đang mở & đã tiêu bao nhiêu"** | ⚠️ một phần | cảnh báo 0.75 trần một lần (`run-budget.mjs:45-46`), usage trên run card |

---

## Kết luận

**Giữ một phiên Claude online liên tục suốt lúc canvas mở là KHẢ THI, và không
đòi hỏi transport mới.** `po-session.mjs` đã đúng là "một phiên thường trú, một
context window, không teardown theo thời gian", và canvas MCP đã sống độc lập
xuyên nhiều run. Cái thiếu nằm ở **chính sách và cách nối dây**, không ở SDK.

Bốn thay đổi ở mức kiến trúc (theo thứ tự chặn):

1. **Tách trần lượt khỏi trần phiên.** Hôm nay `maxTurns`/`maxBudgetUsd` là một
   con số duy nhất áp cho cả `query()` — với phiên thường trú "luôn online" nó
   trở thành đồng hồ đếm ngược tới `limited`. Cần một profile budget riêng cho
   phiên dài (ví dụ trần *phiên* rộng + trần *lượt* hẹp), hoặc một chính sách
   re-open có tuyên bố khi chạm trần, thay vì hành vi tự-lành-âm-thầm hiện tại
   (`run-budget.mjs:33-43`, `po-session.mjs:334-339`, `run-exec.mjs:862-864`).
2. **Cho canvas một trigger vòng đời phiên.** `canvas:activate` hiện chỉ bật MCP
   (`canvas.mjs:154-162`). Muốn "luôn online" phải có một đường mở/hâm phiên
   stateful khi panel vẽ mount — và đi kèm nó là câu hỏi review gate:
   `PARK.ON_OPEN` (`verbs.mjs:50-62`) hôm nay là điểm chấp thuận duy nhất, mở
   phiên tự động sẽ bỏ qua nó nếu không thiết kế lại.
3. **Nới ràng buộc slot đơn cho lượt thường trú.** Một câu trao đổi canvas 5 giây
   không nên xếp hàng sau một `execute` 20 phút (`run-queue.mjs:82, 231-236`).
   Hoặc slot riêng cho phiên thường trú, hoặc ưu tiên chen ngang — cả hai đều là
   thay đổi hợp đồng của `run-execution-queue` spec, không phải sửa vặt.
4. **Xử lý residency đa hội thoại và context growth.** Một phiên/workstream
   (`po-session.mjs:85, 254-263`) nghĩa là mở một note sẽ đá phiên canvas ra.
   Và một phiên sống hàng giờ sẽ auto-compact mà Iris chỉ *nhìn thấy* chứ không
   điều khiển. Ứng viên option sẵn có, hiện đang từ chối có lý do nhưng lý do
   không còn đúng cho canvas: `includePartialMessages`, `enableFileCheckpointing`
   (lý do từ chối là "shape stateless bị teardown" — không áp cho phiên thường
   trú), `forkSession`/`resumeSessionAt`, `agentProgressSummaries`
   (`docs/REFERENCE.md` §"Unused, with reasons").

Lưu ý bắt buộc nếu thực hiện: `electron/sdk-options.test.mjs` khoá chốt **toàn bộ
tập key** của mỗi run shape (`:98`, `:124`, `:287`) — thêm bất kỳ option nào phải
thêm ở đó; và mọi thay đổi hành vi phải đi qua OpenSpec
(`openspec/specs/stateful-verb-session/spec.md` là spec bị đụng trực tiếp).
