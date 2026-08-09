# Audit: kênh trao đổi thời gian thực (Canvas↔Claude MCP + Gemini Live/relay)

Phạm vi: chỉ ĐỌC, không sửa code. Mọi phát hiện có `file:line`.
Ký hiệu: **BUG** = sai hành vi/mất dữ liệu; **UX-GAP** = đúng logic nhưng người dùng không thấy/không hiểu.
Severity: P0 mất dữ liệu hoặc sai sự thật với người dùng; P1 hỏng luồng chính hoặc im lặng mất năng lực; P2 khó chịu/rủi ro tiềm ẩn.

---

## A. Canvas ↔ Claude qua MCP

### A1. [BUG · P0] Push toàn-scene trễ 500ms của renderer ghi đè (clobber) nét Claude vừa vẽ
- `src/components/DrawingCanvas.tsx:146-168` — mỗi `onChange` serialize **toàn bộ** scene vào `pendingSceneRef` rồi gửi sau `PUSH_DEBOUNCE_MS = 500` (`:30`).
- `electron/capabilities/canvas.mjs:162-168` — handler `canvas:scene` gọi `canvasStore.setScene(scene)` **ghi đè nguyên khối**, không so revision.
- `electron/canvas-mcp.mjs:389-392,406-409,423-427` — tool ghi đọc `getScene()` → `setScene()` cũng nguyên khối.

Kịch bản: user vẽ tại t (push hẹn t+500) → Claude `add_elements` tại t+200 (cache = base+claude, broadcast) → t+500 renderer gửi scene đã serialize **trước** apply → phần Claude vẽ bị xoá khỏi cache và khỏi đĩa. Spec `openspec/specs/canvas-claude-mcp/spec.md:49` chỉ tuyên bố "last-writer-wins" ở mức phần tử, không phải "một push cũ xoá cả write mới".

Hướng sửa: thêm `revision` đơn điệu trong `electron/canvas-store.mjs` (tăng ở mọi `setScene`); renderer gửi kèm revision nó dựa trên, main từ chối/merge push cũ (`electron/capabilities/canvas.mjs:162`). Hoặc renderer đẩy diff theo id thay vì cả scene.

### A2. [BUG · P1] Apply bị vứt trong race lúc mount → mất vĩnh viễn
- `src/components/DrawingCanvas.tsx:88-89` — `if (!excalidrawModule || !apiRef.current) return;` bỏ hẳn payload, không retry, không đọc lại store.
Comment nói "main's cache stays the source of truth", nhưng ngay sau đó bất kỳ nét vẽ nào của user sẽ serialize scene cũ đè lên cache (đường A1) → write của Claude mất thật.

Hướng sửa: xếp hàng payload cho tới khi `apiRef` sẵn sàng, hoặc khi mount xong gọi lại `window.iris.getCanvasScene()` để đồng bộ (`DrawingCanvas.tsx:139-144`).

### A3. [UX-GAP · P1] Không có dấu hiệu "Claude vừa vẽ", không cuộn tới vùng mới
- `electron/capabilities/canvas.mjs:71` `broadcastApply` → `src/components/DrawingCanvas.tsx:92-97` chỉ `updateScene`, không toast, không highlight, không `scrollToContent`.
- Claude tự bịa toạ độ: `electron/canvas-mcp.mjs:90-94` mặc định `x=0,y=0,w/h=100`; `:171-187` neo arrow quanh đó → hình mới rất dễ nằm ngoài viewport hiện tại ⇒ user "không thấy gì xảy ra".

Hướng sửa: kèm ids/số lượng vào payload `canvas:apply` (`capabilities/canvas.mjs:71`), renderer flash các phần tử mới + `scrollToContent(newElements, { fitToViewport: true })` khi nằm ngoài khung, thêm chip "Iris vừa thêm 3 hình".

### A4. [BUG · P1] Ở deck mode canvas không tồn tại ⇒ verb `shape_on_canvas` chạy **không có tool canvas**, im lặng
- `src/components/HudShell.tsx:607` là nơi DUY NHẤT render `<DrawingCanvas />` (grep toàn `src/`), deck mode không có panel.
- Cổng dính `canvasEngaged` chỉ bật khi panel mở lần đầu: `electron/capabilities/canvas.mjs:83-97,103-112`.
- `electron/run-exec.mjs:403,587` và `:741-742`: `ensureCanvasMcpForRun()` trả `null` ⇒ `options.mcpServers` không được set, **không log, không báo user**.
- Nhưng prompt verb vẫn bảo "Read the canvas before answering... draw on it" (`electron/verbs.mjs:186,193`) ⇒ Claude sẽ bịa mô tả canvas.

Hướng sửa: ở `run-exec.mjs:403`, nếu verb khai báo `iris-canvas` mà record null thì finalize run bằng thông báo rõ ("mở bảng vẽ trước") hoặc `notifyIris`; đồng thời cho phép mở DrawingCanvas ở deck mode.

### A5. [BUG · P1] Write của Claude không được persist khi scene quá lớn — im lặng
- `electron/canvas-store.mjs:47-54` — nếu JSON > `DEFAULT_MAX_SCENE_BYTES` (8MB, `:11`) thì `return` sớm, `pendingJson` không được set.
- `electron/canvas-mcp.mjs:391` `await flush()` vẫn resolve; `canvas-store.mjs:70` `if (pendingJson === null) return;` ⇒ tool trả `applied` như thể đã bền vững.
- Spec `openspec/specs/canvas-claude-mcp/spec.md:49,56-59` yêu cầu write **không được mất**. Excalidraw `files` nhúng ảnh dataURL nên vượt 8MB rất dễ.

Hướng sửa: `setScene`/`flush` trả trạng thái persist; `canvas-mcp.mjs` đưa vào `results` và `emitEvent` mức warn.

### A6. [UX-GAP · P2] `get_canvas({includeImage})` degrade âm thầm khi timeout 4s
- `electron/canvas-mcp.mjs:342-356` `withTimeout` nuốt cả timeout lẫn reject thành `null`; `:374-376` chỉ `if (image) content.push(...)` — không có dòng text nào nói "ảnh không lấy được", không có log degrade (`:370` chỉ log số phần tử).
- Ngân sách lệch nhau: tool chặn 4s (`DEFAULT_IMAGE_TIMEOUT_MS`, `:16`) trong khi registry dọn dẹp 8s (`electron/capabilities/canvas.mjs:20,56-59`) ⇒ export chậm luôn thua, promise vẫn treo thêm 4s.
- Hệ quả: Claude không phân biệt "panel đóng" với "canvas trống" và có thể nói "tôi đã nhìn hình".

Hướng sửa: luôn push một `{type:"text"}` nêu lý do (`panel closed` / `export timed out`) và log sự kiện degrade; cân lại hai timeout.

### A7. [BUG · P2] Claude vẽ nằm ngoài undo stack, và undo của user xoá luôn nét Claude
- `src/components/DrawingCanvas.tsx:96` `CaptureUpdateAction.NEVER` (cố ý) ⇒ user không undo được nét Claude; ngược lại một `Cmd+Z` của user quay về snapshot trước apply rồi push ngược lên (A1) ⇒ xoá công của Claude mà không ai báo.

Hướng sửa: ghi apply thành một bước undo riêng (`IMMEDIATELY`) hoặc thêm nút "hoàn tác thay đổi của Iris".

### A8. [BUG · P2] Cờ chống-echo không bao giờ được dọn
- `src/components/DrawingCanvas.tsx:72,91,153-155` — `lastAppliedSignatureRef` giữ mãi; bất kỳ trạng thái nào về sau trùng chữ ký (ví dụ undo về đúng trạng thái vừa apply) sẽ **không** được push lên ⇒ main giữ scene khác với màn hình.

Hướng sửa: xoá chữ ký sau lần `onChange` đầu tiên không khớp, hoặc so cả `appState/files`.

### A9. [P2] `get_canvas` trả nguyên scene kể cả `files` dataURL, không giới hạn
- `electron/canvas-mcp.mjs:369-372` `JSON.stringify(scene)` không cắt `files`; một ảnh dán vào có thể đốt hết trần chi phí/lượt của run.
Hướng sửa: lược bỏ/tóm tắt `files`, cap số phần tử, kèm ghi chú đã cắt.

---

## B. Gemini Live + relay tiến độ run

### B1. [BUG · P1] Mất mạng/reconnect vô hình, mọi lời nói trong ~30s bị nuốt
- `electron/live-session.mjs:339-354` `onclose` → `scheduleReconnect`; `:368-405` chỉ phát `gemini_status: connecting`, **không đổi `audio_state`**.
- `src/App.tsx:1814-1815` caption vẫn "Speaking…/Listening…" vì `audioState` không đổi.
- `electron/live-messages.mjs:266-268` `sendAudioChunk` return im lặng khi `liveSession === null` — mic vẫn thu, dữ liệu rơi vào hư không.
- 5 lần thử × ≤8s (`live-session.mjs:102,395`) ≈ 30s người dùng nói vào khoảng không mà UI báo "Listening…".

Hướng sửa: `scheduleReconnect` phát `audio_state: "reconnecting"`; renderer hiển thị caption/orb riêng, cân nhắc mute mic + tiếng báo.

### B2. [UX-GAP · P1] Cạn lượt reconnect ⇒ trạng thái chết gần như câm
- `electron/live-session.mjs:371-390` phát `fatal` → `src/App.tsx:1344` `pushLog("error", ...)`.
- Nhưng log CHỈ hiển thị bên trong khung camera: `src/components/CameraDock.tsx:149-156`, `src/components/HudShell.tsx:99`, và chỉ khi bật camera; bản production còn lọc dưới mức warn (`src/lib/activity-log.ts:51-53`).
- Không có auto-retry sau đó, không có nút "kết nối lại".

Hướng sửa: đưa `fatal`/`error` ra banner độc lập với camera; thêm nút reconnect gọi `startLive`.

### B3. [BUG · P1] Chỉ báo "đang nói / đang nghe" tính theo lượt, không theo playback
- `electron/live-messages.mjs:257` đặt `speaking` theo từng part; `:260-263` đặt `listening` ngay tại `turnComplete`.
- `src/hooks/useAudioPipeline.ts:437-445` lại **lịch phát về tương lai** (`playbackTimeRef`) ⇒ UI chuyển "Listening…" trong khi Iris còn đang nói vài giây; barge-in trong khoảng đó trông như ngắt lời một sự im lặng.

Hướng sửa: suy ra chỉ báo speaking từ `playbackSourcesRef`/`outputLevelRef` phía renderer thay vì `turnComplete`.

### B4. [BUG · P2] Thứ tự transcript cố định, không theo thời gian; không chống trùng
- `electron/renderer-bridge.mjs:128-175` mỗi lần flush luôn phát dòng "you" trước rồi mới "gemini" — khi barge-in (`live-messages.mjs:212-218` gọi `closeUtterance`) câu ngắt lời của user hiện TRƯỚC phần Iris đang nói dở.
- `src/App.tsx:1209` gán `crypto.randomUUID()` cho mọi dòng ⇒ nếu phiên resume phát lại đoạn transcript, sẽ nhân đôi mà không ai phát hiện.

Hướng sửa: đánh dấu thời điểm fragment đầu tiên của mỗi buffer, phát theo thứ tự thời gian; dedupe theo (speaker, hash text, cửa sổ thời gian).

### B5. [UX-GAP · P2] Lịch sử hội thoại cứng 40 dòng, không cuộn lại được
- `src/App.tsx:1209` `.slice(-40)`; `src/components/CommsPanel.tsx:24-38` không có nút tải thêm. Phiên dài mất sạch phần đầu.

### B6. [BUG · P1] UI báo SAI kết cục cho câu hỏi không được trả lời
- `src/App.tsx:1288-1290`: mọi `timed_out` đều log "…applied its recommended option."
- Nhưng `electron/run-stream.mjs:118-136` có nhánh `QUESTION_EXPIRY.DENY`: **không** áp mặc định, run dừng (`electron/run-exec.mjs:560-574`, finalize `UNANSWERED` tại `:628-629`).
- Vi phạm trực tiếp `openspec/specs/voice-decision-relay/spec.md:57-60` ("nothing … claims the user chose anything").

Hướng sửa: đưa `onExpiry` vào sự kiện `po_question` (`run-stream.mjs:310-312`) và render đúng câu; hiển thị bằng banner chứ không phải log ẩn.

### B7. [UX-GAP · P1] Câu hỏi treo: không đếm ngược, không nhắc lại, có thể đọc muộn
- Timeout 5 phút (`electron/po-session.mjs:12,35-38`) đặt tại `electron/run-stream.mjs:330-333`; chỉ đọc MỘT lần lúc raise (`:361`).
- Nếu Live đang rớt, `notifyIris` **buffer** (`electron/announcements.mjs:43-53`, cap 20 `:30`) trong khi đồng hồ vẫn chạy ⇒ câu hỏi có thể được đọc rất muộn hoặc bị đẩy khỏi hàng đợi, còn run thì hết giờ.
- `PoQuestionBanner` (dùng ở `src/App.tsx:2043-2050`) không có deadline.

Hướng sửa: thêm `expires_at` vào sự kiện, hiển thị đếm ngược, nhắc lại một lần ở 50%; nếu phải buffer thì gia hạn hoặc settle rõ ràng.

### B8. [BUG · P2] `canRelayQuestion` kiểm tra sai đối tượng
- `electron/wiring-capabilities.mjs:163`: `Boolean(getLiveStatus()?.running)`. `liveStatus.running` vẫn `true` suốt cửa sổ reconnect (chỉ hạ ở `electron/live-session.mjs:372` sau khi cạn lượt) trong khi `liveSession === null`.
- Vậy điều kiện bảo vệ ở `electron/run-exec.mjs:557` vẫn cho phép hỏi khi thực tế không ai nghe được ⇒ câu hỏi bị buffer và hết giờ. Đúng cảnh spec `voice-decision-relay/spec.md:106-109` muốn tránh.

Hướng sửa: `canRelayQuestion: () => Boolean(getLiveSession())`.

### B9. [UX-GAP · P1] `limited` / `unanswered` chỉ là một chữ trên badge
- `src/lib/tasks.ts:7-15` coi là terminal; `src/components/WorkCard.tsx:83,99` render `<span className={"badge " + status}>` — CSS chỉ đổi màu (`src/styles/claude.css:585,592`). Không có dòng giải thích "chạm trần lượt/chi phí" hay "thiếu câu trả lời nào".
- Giải thích chỉ nằm trong lời nói (`electron/announcements.mjs:205-219`) — mất nếu Iris offline lâu (buffer drop-oldest tại `:30,49-53`), và trong text output phải mở thẻ mới thấy.

Hướng sửa: rút một dòng lý do từ `run.output` hiển thị ngay dưới badge trong `WorkCard.tsx`.

### B10. [UX-GAP · P2] Review bị timeout/abandon chỉ để lại log ẩn
- `src/App.tsx:1311-1313` `pushLog("warn", ...)` — vẫn là log camera-strip (xem B2); banner biến mất không lời giải thích (`src/App.tsx:2051-2053`).
Hướng sửa: giữ banner ở trạng thái "đã hết hạn, chưa gửi cho Claude" vài giây.

---

## C. Backpressure / nghẽn main thread

### C1. [BUG · P2] Mỗi event = một lần ghi đĩa ĐỒNG BỘ
- `electron/renderer-bridge.mjs:102-125` gọi `recordLog` cho **mọi** event → `electron/main.mjs:91` `logSink.write` → `electron/log-sink.mjs` ghi sync (nêu rõ ở header `:8-13`), kèm kiểm tra rotate.
- Activity có throttle 150ms (`electron/run-stream.mjs:195-198`, `electron/user-config.mjs:87-90`) nhưng `tool_start`/`tool_end` (`run-stream.mjs:221-244`), `transcript`, `audio_state` thì không.
- Phía renderer mỗi update lại `setTasks` copy cả mảng (`src/App.tsx:1232-1266`).

Hướng sửa: đệm ghi log bất đồng bộ (chỉ sync với `fatal`), throttle/gộp tool_start/tool_end giống activity.

### C2. [BUG · P2] `canvas:apply` gửi toàn bộ mảng element mỗi lần ghi
- `electron/capabilities/canvas.mjs:71` + `electron/canvas-mcp.mjs:392,409,427` — một lượt vẽ nhiều tool sẽ serialize + `updateScene` cả scene N lần, mỗi lần ép excalidraw re-render.
Hướng sửa: gộp broadcast bằng trailing-throttle (`electron/coalesce.mjs` đã có) hoặc chỉ gửi id thay đổi.

### C3. [BUG · P2] Playback không có chính sách bỏ mẫu khi trễ
- `src/hooks/useAudioPipeline.ts:437-445`: `startAt = max(currentTime+0.03, playbackTimeRef)`; máy khựng một nhịp là `playbackTimeRef` trôi mãi về tương lai, Iris nói chậm hơn hội thoại và chỉ reset khi có barge-in (`:381-394`).
Hướng sửa: nếu `playbackTimeRef - currentTime > ~1s` thì nhảy về hiện tại (bỏ phần trễ).

---

## D. Khác (liên quan realtime)

### D1. [BUG · P2] Lời chào có thể rơi vào phiên đã reconnect
- `electron/live-session.mjs:259-279`: `sendWelcomeGreeting` `await checkClaudeStatus()` rồi mới kiểm tra `if (!liveSession) return;` — trong lúc chờ, phiên có thể đã đóng/mở lại ⇒ chào giữa cuộc trò chuyện đang tiếp diễn.
Hướng sửa: chụp tham chiếu session trước khi await và so sánh identity sau await.

### D2. [UX-GAP · P2] Meeting mode không có phản hồi khi tắt system-audio
- `electron/live-session.mjs:135-136,167` — `sendInBandNote`/`announceMeetingRecord` return sớm nếu `systemAudioEnabled()` false ⇒ không có dòng transcript "Listened for … saved to …" (`:175-181`), người dùng không biết chế độ có ghi gì không.

---

## Tổng hợp ưu tiên
- **P0**: A1.
- **P1**: A2, A3, A4, A5, B1, B2, B3, B6, B7, B9.
- **P2**: A6, A7, A8, A9, B4, B5, B8, B10, C1, C2, C3, D1, D2.

Chủ đề xuyên suốt: (1) không có **revision/versioning** cho scene nên hai người ghi đè nhau; (2) rất nhiều sự thật thời gian thực chỉ đi vào `pushLog`, mà log chỉ hiện trong khung camera của bản DEV — nên "im lặng" là chế độ mặc định khi có sự cố; (3) trạng thái hiển thị (nghe/nói/kết nối) suy ra từ sự kiện giao thức thay vì trạng thái thực của audio/transport.
