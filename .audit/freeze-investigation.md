# Bật drawing canvas có làm "treo/đơ toàn máy" không?

*Điều tra đọc-code + đo thực nghiệm. KHÔNG sửa code.*
Ngày: 2026-08-08 · repo `/Users/mrq-learn-ai/work_space/myiris` · HEAD `82e8427` + working tree
đang có thay đổi chưa commit của change `the-canvas-stops-fighting-back` (các file
`src/App.tsx`, `src/components/DrawingCanvas.tsx`, `src/lib/hud-interactivity.ts`,
`src/styles/hud.css`, `electron/capabilities/canvas.mjs`… đều `M`/`??`).
**Cảnh báo:** cây làm việc bị sửa TRONG lúc điều tra (file `DrawingCanvas.tsx` đổi từ 526 → 546
dòng lúc 20:54); mọi `file:line` dưới đây đối chiếu trạng thái tại 20:59 hôm nay.

---

## TRẢ LỜI THẲNG

**Không — bật panel vẽ không làm treo máy (kernel/OS vẫn chạy bình thường, không có deadlock,
không có vòng lặp vô hạn).** Nhưng người dùng RẤT dễ *cảm thấy* như máy bị đơ, vì hai lý do
khác nhau và cả hai đều có thật:

1. **Chiếm chuột toàn màn hình — CÓ THẬT, và là THIẾT KẾ CỐ Ý.** Trong lúc panel vẽ mở, cửa sổ
   HUD (full display bounds, level `screen-saver`, trên cả menu bar) được đặt
   `setIgnoreMouseEvents(false)` suốt vòng đời của panel → **không click được gì khác trên máy**:
   không app khác, không menu bar, không Dock, không cả tray icon của chính Iris.
   Đây đúng là "stuck giao diện" mà người dùng mô tả. Có 3 lối thoát trong renderer + 1 lối thoát
   không cần renderer.
2. **Giật/đơ khung hình khi scene lớn — CÓ THẬT, tỉ lệ thuận với kích thước scene (đã đo).**
   `handleChange` serialize **toàn bộ scene mỗi lần excalidraw `onChange`** (tức mỗi lần
   componentDidUpdate — mỗi pointermove khi đang vẽ), không hề throttle. Đo trên M4:
   scene 4 MB = **35 ms/lần**, 8 MB = **63 ms/lần**. Ở 60 sự kiện/giây thì renderer chỉ còn
   ~10–25 fps → nét vẽ trễ, orb khựng, và (theo spec `main-thread-budget`) lịch phát audio 24 kHz
   bị jitter. Trên Mac Intel nhân thêm ~2.5–3× → 8 MB ≈ 150–190 ms/lần = *đơ thật sự khi vẽ*.

Không có bằng chứng nào cho "treo cả máy". Có bằng chứng chắc chắn cho "không click được gì
ngoài panel" + "renderer chậm dần theo kích thước bản vẽ".

---

# (1) TREO INPUT — máy chạy nhưng không click/thoát được

## 1.1 Panel vẽ nuốt chuột TOÀN màn hình suốt thời gian mở — **CÓ THẬT (cố ý)**

Bằng chứng:
- `electron/window.mjs:230-237` — HUD = `display.bounds`, `setAlwaysOnTop(true,"screen-saver")`,
  `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`, mặc định `setIgnoreMouseEvents(true,{forward:true})`.
- `src/App.tsx:788-797` — `const exclusiveLayerActive = secondBrainActive || drawingActive;`
  → `window.iris.setHudInteractive(true)` **một lần, giữ nguyên cả vòng đời layer**.
- `src/lib/hud-interactivity.ts:47-55` — `resolveHudInteractive`: `if (exclusiveLayerActive) return true;`
- `electron/ipc.mjs:173-178` — `hud:interactive` → `win.setIgnoreMouseEvents(!on,{forward:true})`.
- `src/styles/hud.css:640-647` — `.hud-drawing-panel { position:absolute; inset:0; z-index:1; background:rgba(12,17,28,.94) }`
  → panel phủ kín màn hình và gần như đục.
- Chính spec của change nói thẳng điều này là cái giá phải trả:
  `openspec/changes/the-canvas-stops-fighting-back/specs/hud-drawing-canvas/spec.md:35`
  — *"while the layer is open **nothing else on the machine can be clicked**"*.

Lưu ý lịch sử: bản trước dùng "gesture latch" theo vị trí con trỏ, nhưng vì panel là fullscreen
nên rect = cả màn hình → kết quả y hệt. Change hiện tại chỉ nói thật ra điều đó thay vì giả vờ
còn click-through.

**Mức nghiêm trọng: CAO về trải nghiệm (không phải lỗi kỹ thuật).** Người dùng bật thử nút bút
chì rồi thấy "cả máy không bấm được gì" là kịch bản hoàn toàn thực tế.

**Sửa (nếu muốn):** (a) cho panel co lại thành vùng có biên + trả `resolveHudInteractive` về chế
độ theo vị trí (bản cũ), hoặc (b) giữ fullscreen nhưng hạ `alwaysOnTop` xuống level dưới menu bar
khi layer mở, hoặc (c) tối thiểu: thêm HUD toast một lần đầu tiên khi mở panel — "Esc hoặc nút
Close để trả lại màn hình; ⌥Space thoát HUD".

## 1.2 Lối thoát khỏi panel — **ĐỦ, nhưng có một khẳng định SAI trong comment**

| Lối thoát | Bằng chứng | Còn hoạt động khi… |
|---|---|---|
| Phím **Esc** (capture phase) | `src/App.tsx:851-860` — `addEventListener("keydown", onKey, {capture:true})`, bỏ qua khi có `.excalidraw-modal-container` | renderer sống + cửa sổ Iris đang giữ focus |
| Nút **Close** hiện ngay trong UI excalidraw | `src/components/DrawingCanvas.tsx:487-495` (`renderTopRightUI`, class `hud-drawing-close hud-hit`), CSS `src/styles/hud.css:671-687` | renderer sống |
| Nút bút chì ở orb cluster | `src/components/HudShell.tsx:567-573`; chrome ở `z-index:2` nằm TRÊN panel (`hud.css:94-96`) | renderer sống — **nhưng `.hud-controls` mặc định `opacity:0`, chỉ hiện khi hover** (`hud.css:169-182`) → không phải lối thoát "nhìn thấy được" |
| **Global hotkey ⌥Space** | `electron/main.mjs:274-277` → `toggleHud()` → `electron/window.mjs:241-244` gọi `setIgnoreMouseEvents(false)` **ngay lập tức** | **kể cả khi renderer treo/chết** — đây là lối thoát cuối cùng thực sự |
| Tray menu | `electron/window.mjs:269-300` | ❌ **KHÔNG** — menu bar/tray bị cửa sổ level screen-saver phủ lên và nuốt click |

**Bug tài liệu:** `src/App.tsx:782-784` viết "…the OS-level HUD hotkey **and the tray item**, neither
of which needs the renderer to be alive". Tray **không** dùng được khi layer đang mở, vì đúng cái
dòng ngay trên đó đã nói cửa sổ nằm trên menu bar và nuốt mọi click. Chỉ hotkey là thật.
→ **Sửa:** bỏ "and the tray item" khỏi comment, hoặc thực sự làm tray khả dụng (ví dụ tạm hạ
`alwaysOnTop` khi layer mở).

**Rủi ro còn lại:** nếu `⌥Space` đăng ký thất bại (bị app khác chiếm) thì `registerHotkey` chỉ log
(`electron/main.mjs:256-272`) — **không có UI nào báo**, và người dùng mất lối thoát duy nhất
không phụ thuộc renderer. Còn lại chỉ ⌘Q / ⌘⌥Esc.
→ **Sửa:** khi hotkey HUD đăng ký hỏng, phải cảnh báo trên màn hình (không chỉ log), vì nó là
escape hatch load-bearing.

## 1.3 Esc có thực sự tới renderer không — **CÓ, với 2 điều kiện**

- Excalidraw mặc định `handleKeyboardGlobally=false` → `onKeyDown` là handler React trên container
  (`node_modules/@excalidraw/excalidraw/dist/prod/index.js`, `onKeyDown:this.props.handleKeyboardGlobally?void 0:this.onKeyDown`).
  Đọc thân `onKeyDown`: **không có `stopPropagation` nào trên nhánh Escape**.
- App.tsx nghe ở **capture phase** trên `window` → chạy TRƯỚC mọi handler của excalidraw (React
  gắn ở root container, tức bubble/target phase). ⇒ excalidraw không thể nuốt Esc.
- Ngoại lệ hợp lý: dropdown/eye-dropper của excalidraw đăng ký capture trên `document` với
  `stopImmediatePropagation` — nhưng `document` capture chạy SAU `window` capture, nên App.tsx vẫn
  thắng. Còn dialog thì App.tsx tự nhường qua kiểm tra `.excalidraw-modal-container` (App.tsx:855).
- **Điều kiện 1:** cửa sổ phải đang giữ focus bàn phím. `canvas:activate` gọi `getMainWindow()?.focus()`
  (`electron/capabilities/canvas.mjs`, handler `canvas:activate`), phát từ `DrawingCanvas.tsx` khi mount.
  Cửa sổ frameless+transparent nhưng vẫn focusable → OK.
- **Điều kiện 2 (kịch bản xấu nhất):** người dùng **⌘Tab sang app khác**. ⌘Tab do WindowServer xử lý
  nên vẫn chạy, nhưng cửa sổ HUD level screen-saver **vẫn nằm trên và vẫn nuốt chuột**, trong khi
  bàn phím giờ thuộc app kia ⇒ **Esc không còn đóng panel**. Đây chính là trạng thái "máy như bị
  treo" nhất, và chỉ ⌥Space cứu được.

## 1.4 Nếu excalidraw crash / không load được chunk — **KHÔNG treo**

- `DrawingErrorBoundary` (`DrawingCanvas.tsx:520-537`) `getDerivedStateFromError` → `onCrash` →
  `HudShell.tsx:613` truyền `onForceClose={onToggleDrawing}` → `drawingActive=false` →
  effect cleanup `App.tsx:796` gọi `setHudInteractive(false)` ⇒ trả lại chuột ngay.
- `React.lazy` reject (chunk lỗi) cũng ném vào chính boundary đó ⇒ tự đóng.
- Trong lúc đang tải, `Suspense` hiện "Loading canvas…" và Esc vẫn sống ⇒ không kẹt.

## 1.5 Nếu renderer treo hẳn — **vẫn cứu được**

Không ai gọi lại `setIgnoreMouseEvents` từ renderer nữa, nhưng main process vẫn sống:
`⌥Space` → `exitHud()` → `window.mjs:244` `setIgnoreMouseEvents(false)` + khôi phục bounds deck.
Ngoài ra `webContents.on("unresponsive")` chỉ ghi log (`window.mjs:184-186`) — **không tự cứu**.
→ **Sửa gợi ý (rẻ, đáng làm):** trong handler `unresponsive`, nếu đang ở HUD thì tự động
`setIgnoreMouseEvents(true)` (hoặc `exitHud()`), để renderer chết không giữ con chuột làm con tin.

---

# (2) TREO MAIN PROCESS — I/O đồng bộ trên đường đi

## 2.1 `JSON.stringify` toàn scene trong `setScene` — **CÓ THẬT, tối đa ~2 lần/giây**

`electron/canvas-store.mjs:148-149` — mỗi `setScene` đều `JSON.stringify(scene)` rồi
`Buffer.byteLength` để kiểm tra size guard, **kể cả khi scene vượt ngưỡng và bị bỏ không ghi đĩa**
(tức size guard KHÔNG cắt được chi phí, chỉ cắt việc ghi đĩa).
Cộng thêm chi phí giải mã structured-clone của IPC `invoke` (`preload.cjs:29`, handler
`canvas:scene` ở `capabilities/canvas.mjs`).

**Đo thật** (`/tmp/iris-canvas-bench.cjs`, Node v24.19.0, Apple M4, scene excalidraw giả gồm
freedraw có `points`):

| Scene | #elements | `JSON.stringify` | `JSON.parse` | `structuredClone` | `writeFileSync` |
|---|---|---|---|---|---|
| 1.1 MB | 800 | 3.4 ms | 2.7 ms | 5.5 ms | 0.4 ms |
| 4.2 MB | 3 000 | 13.1 ms | 10.1 ms | 23.2 ms | 1.7 ms |
| 8.2 MB | 5 800 | 23.4 ms | 21.2 ms | 43.4 ms | 3.9 ms |
| 16.1 MB | 11 400 | 45.1 ms | 43.5 ms | 104.7 ms | 6.7 ms |

⇒ **Ngân sách main-process mỗi lần push** (push tối thiểu cách nhau 500 ms — `PUSH_DEBOUNCE_MS`,
`DrawingCanvas.tsx:30`): ~65–70 ms ở scene 8 MB (clone 43 + stringify 23), ~150 ms ở 16 MB.
Tức **~13% main thread ở 8 MB, ~30% ở 16 MB**, dạng spike chứ không rải đều → đủ để jitter
đường IPC audio 24 kHz mà spec `main-thread-budget` bảo vệ, nhưng **không phải "treo"**.

**Mức nghiêm trọng: TRUNG BÌNH.**
**Sửa:** (a) tính size từ `Buffer.byteLength` của chuỗi renderer *đã* serialize (đẩy chuỗi thay vì
object qua IPC → main khỏi stringify lại và khỏi structured-clone object lớn); (b) ước lượng size
bằng số phần tử/độ dài chuỗi thay vì stringify thật; (c) đẩy stringify+ghi sang `worker_threads`.

## 2.2 Ghi đĩa — **ĐÃ async, KHÔNG chặn**

`canvas-store.mjs:172-179` `flush()` dùng `writeFileAtomicAsync`
(`electron/atomic-file.mjs:26-38`, `fs.promises.writeFile` + `rename`), debounce 2 s
(`DEFAULT_DEBOUNCE_MS`). Chỉ có `fs.mkdirSync` một dòng (rẻ). **KHÔNG phải nguồn treo.**

## 2.3 `fs.readFileSync` khi nạp scene lần đầu — **CÓ, một lần**

`canvas-store.mjs:99-106` `loadFromDisk()` → `JSON.parse(fs.readFileSync(file))` **trên main thread**,
kích hoạt bởi `canvas:get-scene` lúc mở panel. Ở file 8 MB ≈ 21 ms parse + đọc đĩa.
Cộng structured-clone khi trả về renderer (~43 ms @ 8 MB) ⇒ **~60–70 ms đơ một lần lúc mở panel**.
**Mức nghiêm trọng: THẤP.** Sửa: đọc bằng `fs.promises` và trả chuỗi thô cho renderer tự parse.

## 2.4 `log-sink.mjs` ghi `writeSync` mỗi record — **CÓ, nhưng KHÔNG đáng kể trên đường canvas**

`electron/log-sink.mjs:249` `io.writeSync(fd, chunk)` (+ `existsSync/statSync` lúc mở,
`renameSync` khi xoay vòng, dòng 168-208). Mỗi `emitEvent` đều ghi (`renderer-bridge.mjs:102-114`).
Trên đường canvas chỉ có **một** dòng log mỗi push, và chỉ khi scene bị drop vì oversized
(`capabilities/canvas.mjs`, nhánh `!outcome.persisted`) ⇒ ≤2 dòng ngắn/giây. Rủi ro thật chỉ là
event stream chung (transcript…) khi đĩa chậm/FileVault + rotate.
**Mức nghiêm trọng: THẤP.** Sửa (nếu cần): buffer + `fs.write` async, hoặc chỉ `writeSync` cho level `error`.

## 2.5 Native open/save/export dùng `readFileSync`/`writeFileSync` — **CÓ, nhưng chỉ khi bấm nút**

`electron/capabilities/canvas.mjs` — handler `canvas:native-open-file` (`fs.readFileSync`),
`canvas:native-save-file`, `canvas:native-export-image` (`fs.writeFileSync`). Chạy trên main thread,
một lần mỗi thao tác người dùng, sau một dialog vốn đã chặn. **Mức nghiêm trọng: THẤP.**

## 2.6 Không có vòng lặp ghi nào ở main — **XÁC NHẬN**

`broadcastApply` chỉ được gọi từ `commitWrite` của MCP (`electron/canvas-mcp.mjs:427-438`), tức chỉ
khi **Claude** vẽ. Push của renderer (`canvas:scene`) **không bao giờ** phát ngược `canvas:apply`
⇒ không có chu trình main↔renderer.

---

# (3) TREO RENDERER / GPU

## 3.1 ⭐ Serialize toàn scene mỗi `onChange` — **CÓ THẬT, đây là nguyên nhân "đơ khi vẽ" số 1**

`src/components/DrawingCanvas.tsx:410-435`:
```
const echo = echoGuard(lastAppliedSignatureRef.current, sceneSignature(elements)); // O(n log n) MỖI LẦN
...
const scene = JSON.parse(excalidrawModule.serializeAsJSON(elements, appState, files, "local"));
pendingSceneRef.current = scene;
if (pushTimerRef.current) return;   // <- chỉ debounce việc GỬI, không debounce việc SERIALIZE
```
Tần suất `onChange`: excalidraw gọi `this.props.onChange?.(...)` trong `componentDidUpdate`, chỉ chặn
bởi `this.state.isLoading` (xem `node_modules/@excalidraw/excalidraw/dist/prod/index.js`,
`this.store.commit(i,this.state),this.state.isLoading||(this.props.onChange?.(n,this.state,this.files)...`).
⇒ **mỗi pointermove khi đang vẽ, mỗi scroll/zoom/hover** đều kích hoạt → thực tế 60–120 lần/giây.

**Đo thật** — vòng `JSON.parse(JSON.stringify(scene, null, 2))` (tương đương serializeAsJSON + parse,
chưa tính pass `clearElementsForExport` của excalidraw):

| Scene | mỗi onChange | ở 60 onChange/s | `sceneSignature` |
|---|---|---|---|
| 1.1 MB | **8.7 ms** | ~52% main thread | 0.1 ms |
| 4.2 MB | **35.2 ms** | quá tải (~15–25 fps) | 0.4 ms |
| 8.2 MB | **63.1 ms** | ~10 fps | 0.7 ms |
| 16.1 MB | **131.5 ms** | thực tế đơ | 1.5 ms |

Trên Mac Intel (không phải M4) nhân ~2.5–3× ⇒ scene 4 MB đã đủ "đơ". Và vì `sceneSignature` được
tính như **tham số** của `echoGuard`, nó chạy kể cả khi không cần (khi `lastAppliedSignature===null`).

**Mức nghiêm trọng: CAO** (là thứ duy nhất thực sự tạo cảm giác "đơ" khi đang dùng bình thường).
**Sửa:**
1. Chuyển serialize vào trong `setTimeout` của debounce — chỉ giữ tham chiếu `elements/appState/files`
   trong ref, serialize **một lần mỗi 500 ms** thay vì mỗi frame. (Sửa ~10 dòng, thay đổi hành vi
   duy nhất: push dùng snapshot tại thời điểm hết debounce — vốn là điều mong muốn.)
2. Chỉ tính `sceneSignature` khi `lastAppliedSignatureRef.current !== null`.
3. Gửi thẳng **chuỗi JSON** qua IPC (bỏ `JSON.parse` ở renderer và `JSON.stringify` ở main).
Ba việc này cắt bỏ ~95% chi phí ở cả hai process.

## 3.2 Vòng lặp onChange → push → apply → onChange — **KHÔNG**

- Main không bao giờ phát `canvas:apply` để đáp lại `canvas:scene` (§2.6) ⇒ không có vòng.
- Với apply từ Claude: `applyIncoming` đặt `lastAppliedSignatureRef` = chữ ký của scene đã merge
  **trước** `updateScene` (`DrawingCanvas.tsx:267-305`), `onChange` kế tiếp khớp chữ ký →
  `echoGuard` nuốt; nhánh `suppress` giữ nguyên chữ ký nên nhiều `onChange` liên tiếp đều bị nuốt;
  một thay đổi thật (đổi `version`/`versionNonce`) nhả guard ra. Có test:
  `src/components/DrawingCanvas.echo.test.ts` (5 tests) + `DrawingCanvas.merge.test.ts` (18) — đã chạy, **pass**.
- Xấu nhất nếu guard trượt: **một** push thừa, không phải vòng lặp.

## 3.3 `exportToBlob` khi Claude gọi `get_canvas({includeImage:true})` — **TUỲ ĐIỀU KIỆN**

`DrawingCanvas.tsx:333-348` (effect `onCanvasImageRequest`, `exportToBlob` ở :342) → `mod.exportToBlob({elements, appState, files})`
chạy **trên main thread của renderer**; scene lớn/có ảnh nhúng có thể mất hàng trăm ms → vài giây.
Có trần: `CANVAS_IMAGE_DEFAULT_BUDGET_MS = 4000` + grace 500 ms (`electron/capabilities/canvas.mjs:27-28`)
và `withTimeout` phía MCP (`canvas-mcp.mjs:405-419`) ⇒ tool không treo, nhưng **renderer vẫn khựng
đúng khoảng thời gian rasterize** vì timeout không huỷ được công việc đã bắt đầu.
**Mức nghiêm trọng: TRUNG BÌNH, chỉ khi dùng verb `shape_on_canvas`.**
**Sửa:** giới hạn `exportToBlob` bằng `maxWidthOrHeight` (excalidraw hỗ trợ) để chi phí không phụ
thuộc kích thước scene.

## 3.4 Bundle excalidraw nạp lúc bật panel — **CÓ, nhưng KHÔNG chặn (lazy)**

Đo trên `dist/` đã build:

| Chunk | Bytes |
|---|---|
| `assets/prod-DxXdfVAQ.js` (entry excalidraw) | 585 227 (gzip 177 376) |
| `assets/chunk-EIO257PC-Dt-y2JKs.js` | 1 821 043 |
| `assets/chunk-K2UTITRG-BqOklwpP.js` | 533 765 |
| `assets/chunk-6U3AYISY-C6-Mtja1.js` | 22 446 |
| `assets/prod-D_O2bRP1.css` | 141 996 |
| **Tổng nạp lần đầu** | **≈ 3.10 MB** (chưa gzip) |
| `dist/excalidraw-assets/` (fonts, nạp theo nhu cầu) | 16 MB / 251 file |

Nạp qua `React.lazy` + `Suspense` (`DrawingCanvas.tsx:23-29`) từ `file://` (đĩa cục bộ, không mạng)
⇒ parse/compile ~0.2–0.5 s, có fallback "Loading canvas…", Esc vẫn sống. **Không phải nguyên nhân treo.**
(Chỉ tốn RAM: excalidraw + MediaPipe + WebGL cùng lúc.)

## 3.5 Nhiều lớp cùng chạy khi panel mở — **CÓ THẬT (camera + MediaPipe vẫn chạy nguyên)**

- `useHandControl(handControl, cameraDeviceId)` — `src/App.tsx:1444`, gate **chỉ** là
  `handControl` (`src/hooks/useHandControl.ts:120,131,353`), **không** hề tắt khi `drawingActive`.
- `useEyeTracking(handStream, handControl)` — `src/App.tsx:1456` — cùng gate.
- `useSystemTelemetry(handControl)` — `src/App.tsx:1464`.
- Vòng dwell "point-and-hold" vẫn chạy `requestAnimationFrame` + `document.elementFromPoint(...)`
  **mỗi frame** trong lúc vẽ (`src/App.tsx:1470-1537`) — mỗi lần là một forced layout, cộng thêm
  vào cùng main thread renderer đang phải serialize scene.
- Vòng xoay orb cũng chạy rAF, chỉ *bỏ qua công việc* khi `drawingActive` (`App.tsx:1590-1631`) —
  vẫn tiêu tốn một rAF/khung.

⇒ Khi bật hand control + panel vẽ: MediaPipe (2 model trên GPU) + canvas excalidraw + WebGL orb +
2–3 vòng rAF + serialize scene, tất cả trên **một** renderer main thread + một GPU process, phía
trên một cửa sổ transparent cỡ nguyên màn hình (compositing đắt).
**Mức nghiêm trọng: TRUNG BÌNH.** **Sửa:** tạm dừng eye-tracking + vòng dwell + vòng orb khi
`drawingActive` (chúng vốn đã bị vô hiệu hoá về mặt logic — chỉ còn tốn CPU), giống cách galaxy làm.

---

## Bảng tổng kết

| # | Giả thuyết | Kết luận | Mức | Bằng chứng |
|---|---|---|---|---|
| 1 | Panel vẽ nuốt chuột toàn màn hình (cả menu bar) | **CÓ THẬT — cố ý** | Cao (UX) | `App.tsx:788-797`, `hud-interactivity.ts:47-55`, `ipc.mjs:176`, `window.mjs:230-237`, `hud.css:640-647` |
| 2 | Không có lối thoát | **KHÔNG** — 4 lối, trong đó ⌥Space không cần renderer | — | `App.tsx:851-860`, `DrawingCanvas.tsx:487-495`, `HudShell.tsx:567-573`, `main.mjs:274`, `window.mjs:244` |
| 3 | Tray là lối thoát dự phòng | **SAI** (comment `App.tsx:782-784` nói sai) | Trung bình (tài liệu) | tray bị cửa sổ screen-saver level phủ + nuốt click |
| 4 | Excalidraw nuốt mất Esc | **KHÔNG** — App nghe capture phase, excalidraw không `stopPropagation` trên Escape | — | `App.tsx:858`, thân `onKeyDown` trong bundle excalidraw |
| 5 | ⌘Tab sang app khác rồi kẹt | **CÓ THẬT** — bàn phím đi nơi khác, overlay vẫn nuốt chuột; chỉ ⌥Space cứu | Cao | tổng hợp #1 + #4 |
| 6 | Hotkey ⌥Space đăng ký hỏng thì mất lối thoát cuối, chỉ log | **CÓ THẬT** | Trung bình | `main.mjs:256-272` |
| 7 | Excalidraw crash để lại panel không đóng được | **KHÔNG** — error boundary force-close | — | `DrawingCanvas.tsx:520-537`, `HudShell.tsx:613` |
| 8 | Renderer treo thì chuột kẹt vĩnh viễn | **KHÔNG** — ⌥Space vẫn giải phóng; nhưng `unresponsive` chỉ log | Trung bình | `window.mjs:184-186`, `window.mjs:244` |
| 9 | I/O đồng bộ chặn main process | **TUỲ** — `JSON.stringify` ~23 ms @8 MB, ≤2×/giây; ghi đĩa đã async | Trung bình | `canvas-store.mjs:148-149,172-179`, số đo §2.1 |
| 10 | `readFileSync` khi mở panel | **CÓ, một lần** ~60 ms @8 MB | Thấp | `canvas-store.mjs:99-106` |
| 11 | `log-sink` `writeSync` mỗi record | **CÓ, không đáng kể trên đường canvas** | Thấp | `log-sink.mjs:249` |
| 12 | Vòng lặp onChange↔apply | **KHÔNG** — echo guard đủ, main không phát ngược | — | `canvas-mcp.mjs:427-438`, echo tests pass |
| 13 | Serialize toàn scene mỗi onChange | **CÓ THẬT — nguyên nhân đơ chính** 63 ms/lần @8 MB | **Cao** | `DrawingCanvas.tsx:410-435`, số đo §3.1 |
| 14 | `exportToBlob` scene lớn | **TUỲ ĐIỀU KIỆN** (chỉ khi Claude xin ảnh) | Trung bình | `DrawingCanvas.tsx:333-348`, `capabilities/canvas.mjs:27-28` |
| 15 | Bundle 500 KB+ nạp đồng bộ | **KHÔNG** — lazy, ~3.1 MB từ đĩa cục bộ, có fallback | Thấp | đo `dist/assets/*` |
| 16 | MediaPipe/eye/dwell vẫn chạy khi vẽ | **CÓ THẬT** | Trung bình | `App.tsx:1444,1456,1464,1470-1537` |

## Ba việc nên sửa trước (xếp theo lợi ích/chi phí)

1. **Đẩy serialize vào trong debounce** (`DrawingCanvas.tsx:410-435`) — xoá bỏ 8–130 ms mỗi frame.
   Rẻ nhất, tác động lớn nhất.
2. **Tạm dừng eye-tracking + vòng dwell + vòng orb khi `drawingActive`** — trả GPU/CPU về cho canvas.
3. **Sửa comment sai về tray** (`App.tsx:782-784`) và **báo lên màn hình khi hotkey HUD đăng ký hỏng**
   (`main.mjs:256-272`) — vì ⌥Space là lối thoát duy nhất không phụ thuộc renderer.

*(Script đo: `/tmp/iris-canvas-bench.cjs`, `/tmp/iris-canvas-bench2.cjs` — nằm ngoài repo, không thêm file nào vào repo ngoài báo cáo này.)*
