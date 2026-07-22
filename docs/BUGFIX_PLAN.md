# Bugfix Plan — Iris

> Trạng thái: **đang mở**. Nguồn gốc: architecture review (2026-07-21) + phản biện độc lập từ agent `Backend Architect` và `Senior Developer`, mọi claim đã được xác minh lại trực tiếp trên code.
>
> Nhánh làm việc: **`develop`**. Không fix trực tiếp trên `main`.
>
> Nguyên tắc: **mỗi bug một commit riêng.** Không gộp bugfix vào refactor — nếu gộp, khi có hồi quy sẽ không biết dòng nào gây ra.

---

## Bối cảnh: vì sao plan này thay thế slate refactor

Architecture review ban đầu đề xuất một slate refactor (deepen module, tách seam, gom state). Sau khi hai agent phản biện và tôi tự đọc lại code, kết luận đảo chiều:

- Codebase **khỏe hơn về cấu trúc** so với report ban đầu tưởng — `run-queue.mjs` đã đóng gói kín, `startClaudeRun` đã hoist phần chung của PO/DEV (chỉ còn ~6 dòng trùng), `src/lib/` đã tồn tại.
- Codebase **yếu hơn nhiều về lifecycle** — có ít nhất 2 lỗi khiến app chết hẳn hoặc im lặng nuốt kết quả, và cả hai đều **type-check hoàn hảo**.

Bài học then chốt: **BUG A không thể bị bắt bởi TypeScript, cũng không bị ngăn bởi cấu trúc tốt.** `po-session.mjs` chỉ 251 dòng, biên giới sạch, đã tách module đúng bài — và vẫn chứa một promise không bao giờ settle. Đó là lý do phần "thêm test runner" nằm trong plan này chứ không phải trong plan refactor.

---

## Bất biến bị thiếu — và codebase đã tự tìm ra nó một lần rồi

BUG A và BUG I **không phải hai lỗi độc lập**. Chúng là hai thể hiện của cùng một khiếm khuyết. Hệ thống có **ba ô nghĩa vụ** (obligation slot), nhưng chỉ một ô được xây có phễu settle:

| Ô | Chủ sở hữu | Một đường settle duy nhất | Settle **nhiều nhất** một lần | Settle **ít nhất** một lần, có chặn |
|---|---|---|---|---|
| Câu hỏi đang chờ | `PendingQuestion` (`main.mjs:125-163`) | ✅ `settle()` | ✅ (`main.mjs:137`) | ✅ **`setTimeout` ở `main.mjs:130`** |
| PO turn | `state.currentTurn` (`po-session.mjs:212`) | ❌ ba nơi ghi: `:112`, `:135`, `:212` | ~ tình cờ | ❌ → **BUG A** |
| Slot thực thi | `active` (`run-queue.mjs:85`) | ✅ `finalize()` | ✅ (`run-queue.mjs:128`) | ❌ → **BUG I** |

Và đây là comment có sẵn ở `main.mjs:121-124`:

> *"every settlement path (answer, expire, abandon) funnels through one settle() so nothing can resolve the same question twice or hang it forever — see … design.md decision 2 (**an earlier bare-global version already caused exactly that bug**)."*

**Codebase đã phát hiện đúng lớp lỗi này, đã sửa nó một lần, đã viết lại lý do — rồi không tổng quát hóa sang hai ô còn lại.** `PendingQuestion` chính là hình mẫu mà A và I lẽ ra phải theo.

### Bất biến, phát biểu chính xác

> **Mọi ô đang giữ một nghĩa vụ chưa hoàn tất phải có đúng một đường settle, và đường đó phải tới được từ một bộ đếm có chặn.**

Hai vế: **settle-nhiều-nhất-một-lần** (cả ba ô đều có, đại khái) và **settle-ít-nhất-một-lần-trong-giới-hạn** (chỉ `PendingQuestion` có). **Vế thứ hai chính là toàn bộ cái lỗ.**

Bất biến này sống **tại từng ô**, không phải ở một lifecycle manager trung tâm — manager sẽ ghép `run-queue.mjs` với `po-session.mjs` và phá vỡ đúng cái module split mà design D1 đã cố ý tạo ra.

**Ưu tiên:** slot thực thi là ô **singleton toàn cục** duy nhất, và là ô mà mất nó thì brick cả app. Chặn nó trước → BUG A tự động hạ cấp từ "phải restart" xuống "một run treo, báo lỗi rõ ràng".

### Hai bug KHÔNG thuộc lớp này

- **BUG B không phải nghĩa vụ chưa settle.** Buffer không được drain vì **vị từ đã chết**, không phải vì callback không bắn. Gốc: `liveSession` (`main.mjs:2211`) làm hai việc cùng lúc — vừa là handle để gửi, vừa là vị từ sẵn-sàng — và phép gán nó **không atomic với trạng thái sẵn sàng**. Bất biến khác: *sẵn-sàng phải là một trạng thái tường minh, không phải là "handle khác null"*. `notifyIris` (`main.mjs:546`) mắc đúng lỗi ghép này ở phía gửi, và `previewSession` (`main.mjs:1010-1013`) là thể hiện thứ hai của cùng hình dạng.
- **BUG E là reentrancy.** `beginRun` (`run-queue.mjs:87-94`) gọi `startRun` **đồng bộ**; `submit` (`:108-118`) báo cáo một giá trị tính **trước** khi lời gọi đó kịp đổi state. Tác giả **đã thấy** vấn đề reentrancy — comment ở `:88-93` lý luận rõ về nó — nhưng chỉ xét once-guard, không xét giá trị trả về. Bất biến: *hàm gọi callback được inject phải đọc lại state trước khi báo cáo về nó.*

**Kết luận: hai lớp cộng một ca lẻ, không phải một.** Nhưng lớp chứa A và I là lớp đáng đặt tên và cưỡng chế — và nó có sẵn một implementation tham chiếu đang chạy tốt, cách đó 1.700 dòng trong cùng file.

---

## Bảng tổng quan

| # | Bug | Mức | File | Ước lượng | Trạng thái |
|---|---|---|---|---|---|
| A | PO turn không settle → kẹt slot vĩnh viễn | 🔴 Critical | `po-session.mjs` | ~5 dòng | [x] |
| A' | `announceClaudeCompletion` không phân biệt status → đọc to lỗi cho run người dùng tự hủy | 🟠 Medium | `main.mjs`, `run-queue.mjs` | ~6 dòng | [x] |
| B | Buffer thông báo không bao giờ được drain | 🔴 High | `main.mjs` | ~6 dòng | [x] |
| C | Ghi file không atomic → mất sạch dữ liệu | 🟠 Medium | `main.mjs` | ~15 dòng | [ ] |
| D | Card hiển thị activity log như thể là kết quả | 🟡 Low | `App.tsx` | 1 dòng | [ ] |
| E | Gemini được báo "started" cho run đã fail | 🟡 Low | `run-queue.mjs` **+ `main.mjs:1649`** | ~6 dòng | [x] |
| J | `abandon` trả lời hộ người dùng rồi phá session ngay câu lệnh sau → SDK có thể ghi file vào cwd cũ | 🟠 Medium | `main.mjs:159-162, 477-486` | ~4 dòng | [ ] |
| K | Spec/code lệch nhau: hủy run đang queued **không** finalize → `run.finalized` không set → once-guard không bảo vệ | 🟡 Low | spec hoặc `run-queue.mjs:142-151` | quyết định | [ ] |
| F | `useHandControl` setState 60fps → re-render toàn cây | 🟠 Perf | `useHandControl.ts` | vừa | [ ] |
| G | Orb trong Glass HUD không bao giờ dừng render | 🟠 Perf | `HudShell.tsx` | 1-3 dòng | [ ] |
| H | `pushActivity` gửi ~17KB mỗi dòng activity | 🟡 Perf | `main.mjs` | vừa | [ ] |
| I | Không có watchdog / PO không hủy được / subprocess mồ côi | 🟠 Design | `run-queue.mjs`, `main.mjs` | lớn | [~] I.1 xong, I.2-I.5 còn |

Ký hiệu trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong, đã verify.

---

## ĐỢT 0 — Vá bug (~25 dòng, 5 commit)

### BUG A — PO turn không settle, kẹt slot thực thi vĩnh viễn 🔴

**Vị trí:** `electron/po-session.mjs:128-141`

**Cơ chế:**

```
async function pump(state) {
  try {
    for await (const message of state.query) { routeMessage(state, message); }
  } catch (error) {                    // ← chỉ đường THROW mới settle
    if (state.currentTurn) { state.currentTurn.reject(error); state.currentTurn = null; }
    state.error = error;
  } finally {
    state.ended = true;                // ← đường KẾT THÚC BÌNH THƯỜNG: currentTurn treo
  }
}
```

`closePoSession` (`po-session.mjs:233-247`) gọi `state.channel.close()` (238) rồi `state.query?.return?.()` (243). `channel.close()` khiến `iterate()` trả `done` → SDK query kết thúc → `for await` **thoát bình thường, không throw** → `catch` không chạy → promise mà `deliverPoTurn` trả về (`po-session.mjs:206-226`) **treo vĩnh viễn**.

Chuỗi hệ quả:

```
deliverPoTurn promise không settle
   └─▶ main.mjs:1611-1612  startPoRun chỉ finalize qua .then/.catch của promise đó
         └─▶ runQueue.finalize() không bao giờ chạy
               └─▶ run-queue.mjs:136  active không bao giờ được clear
                     └─▶ MỌI PO turn + DEV run sau đó xếp hàng sau một run đã chết
                           └─▶ chỉ restart app mới thoát
```

**Đường kích hoạt** — 3 chỗ gọi `closePoSession` mà **không** kiểm tra PO turn đang chạy:

| Vị trí | Hành động người dùng |
|---|---|
| `main.mjs:440` `createWorkstream` | bấm nút "New", hoặc voice "new session" |
| `main.mjs:459` `selectWorkstream` | đổi workstream ở switcher |
| `main.mjs:478` `setWorkstreamCwd` | chọn thư mục dự án khác |

Đối chiếu: `savePoToken` **có** kiểm tra, qua `poTurnRunning()` (`main.mjs:936`, dùng ở 948). Tức là ai đó đã nhận ra "đóng session giữa turn là không an toàn" và vá đúng 1 trong 4 chỗ.

**Trigger có khả năng xảy ra cao hơn:** không phải đổi workstream, mà là **subprocess `claude` chết lặng lẽ** hoặc stream kết thúc mà không phát message `result`. Cùng một đường thoát bình thường → cùng một cái treo. Đổi workstream chỉ là repro tất định.

**Tình trạng sau khi kẹt — không có đường thoát nào từ UI:**
- `stop_claude_task` → `run-queue.mjs:160-163`, PO stop là no-op có chủ đích → không giải phóng gì
- `poTurnRunning()` trả `true` vĩnh viễn → **`savePoToken` cũng bị brick** ("A PO turn is running right now")

**Yếu tố làm nặng thêm:** cả 3 call site đều gọi `PendingQuestion.abandon` ngay trước `closePoSession`. `abandon` resolve promise của `canUseTool` bằng câu trả lời mặc định → SDK tiếp tục turn vào một query đang bị tear down ngay câu lệnh sau. Đây là cửa sổ hẹp dễ tạo ra kết cục "kết thúc mà không throw" nhất.

**Hướng fix** — chuyển settle từ `catch` xuống `finally`. Vá cả đường `closePoSession` lẫn đường "stream kết thúc sạch" cùng lúc:

```js
} catch (error) {
  state.error = error;
} finally {
  state.ended = true;
  const turn = state.currentTurn;
  state.currentTurn = null;
  turn?.reject(state.error || new Error("PO session ended before the turn completed"));
}
```

`.catch` sẵn có ở `main.mjs:1612` sẽ finalize run là `ERROR`, `dequeueNext()` giải phóng slot. **Không cần thêm plumbing nào.**

#### Quyết định: `reject` hay `resolve({status:"failed"})`? → **Cả hai đều sai nếu không gắn nhãn lý do**

Câu hỏi ban đầu tưởng là lựa chọn hai chiều. Không phải.

- `RUN_STATUS.CANCELLED` **đã tồn tại** (`run-queue.mjs:39`) và **đã là terminal** (`run-queue.mjs:54`) → `finalize` chấp nhận nó và nó giải phóng slot. Không thiếu state.
- Nhưng `announceClaudeCompletion` (`main.mjs:1861-1886`) **không hề phân biệt theo status** — cùng một khối chỉ thị cho mọi terminal status: *"Proactively tell X Claude has returned"*, *"Give a concise spoken summary."* Status chỉ được nhét vào như một dòng văn xuôi `status: ${status}` và hy vọng Gemini tự suy ra giọng điệu.

Hai hệ quả quyết định vấn đề:

1. **Phương án (b) không mua được gì.** `FAILED` và `ERROR` **được đọc to y hệt nhau**. "Thông điệp hiền hơn" không lấy ra được từ status. (b) chỉ đổi nhãn trên card.
2. **Tình thế khó xử này đã tồn tại sẵn hôm nay, với DEV.** Bấm stop một DEV run → `main.mjs:1524-1527` finalize `CANCELLED` → `onFinalized` (`main.mjs:218`) → Iris thông báo Claude đã trở về với kết quả, cho một run mà **chính người dùng vừa giết**.

**Vì sao nhãn lý do là bắt buộc:** trigger *nhiều khả năng hơn* của BUG A là **subprocess chết lặng lẽ** — cái đó **phải** kêu to. Nếu không phân biệt, cả (a) lẫn (b) đều gộp "người dùng cố ý tear down" với "chết âm thầm" vào một rọ. **Chính sự gộp đó mới là khiếm khuyết thật trong cách đặt câu hỏi hai chiều.**

**Cách làm:**
1. `closePoSession` ghi ý định lên state **trước** `state.channel.close()` (`po-session.mjs:238`).
2. `finally` của `pump` reject có mang theo lý do đó.
3. `.catch` ở `main.mjs:1612` ánh xạ: lý do teardown → `CANCELLED`, mọi thứ khác → `ERROR`.

→ phần còn lại tách thành **BUG A'** bên dưới.

**Cách verify:**
1. Submit một PO turn dài (ví dụ lệnh grilling).
2. Trong lúc đang chạy, bấm "New".
3. Submit một DEV run mới → phải chạy được ngay, không xếp hàng.
4. Kiểm tra Work Stream: PO run cũ phải hiện `ERROR`, không kẹt `RUNNING`.
5. Mở SetupPanel → Save PO token phải hoạt động (không báo "A PO turn is running").

**Ghi chú:** fix này chỉ xử lý session **kết thúc**. Session **treo** (SDK còn sống nhưng không phát gì) vẫn giữ slot — đó là BUG I (watchdog), làm riêng ở Đợt 2.

---

### BUG A' — `announceClaudeCompletion` không phân biệt status 🟠

**Vị trí:** `electron/main.mjs:1861-1886`, `electron/run-queue.mjs:135, 148-150`

Xem phân tích ở BUG A. Một quy tắc duy nhất sửa được **ba** thứ cùng lúc:

> **Gate `onFinalized` theo `run.started_at` đã được set. Một run chưa từng chạy thì không cần thông báo "Claude đã trở về".**

Đây **chính xác** là quy tắc mà `run-queue.mjs:148-150` đã áp cho trường hợp hủy-khi-đang-queued:

> *"Deliberately NOT finalize(): a queued run never started, so there is no announcement to make."*

Tổng quát hóa nó tốn **một dòng**, và đồng thời:
- vá phần UX của **BUG A** (teardown cố ý không bị đọc to như lỗi),
- tháo ngòi phần "nói hai lần" của **BUG E** (xem dưới),
- sửa luôn cái wart đang tồn tại hôm nay khi stop một DEV run.

Ngoài ra, cho `CANCELLED`: giữ nguyên sự kiện sidecar `claude_completion` (card trên UI là đúng), nhưng bỏ `notifyIris` hoặc gửi một sự kiện ngắn khác biệt.

---

### BUG J — `abandon` trả lời hộ người dùng rồi phá session ngay sau đó 🟠

**Vị trí:** `electron/main.mjs:159-162` (`PendingQuestion.abandon`), gọi ở `440`, `459`, `477`

```js
abandon(workstreamId) {
  if (!this.current || this.current.workstreamId !== workstreamId) return;
  this.settle("timed_out", defaultPoAnswers(this.current.questions));   // ← 161
},
```

`abandon` settle bằng status `"timed_out"` và **câu trả lời mặc định**, kể cả khi người dùng **cố ý** reset. Đó là cùng một lỗi phạm trù với A', chỉ ở tầng dưới.

Nhưng tệ hơn: nó **trả lời** câu hỏi, rồi câu lệnh **ngay sau** phá hủy session. Ở `main.mjs:477-486` trình tự là:

```
abandon()            → SDK nhận câu trả lời mặc định, TIẾP TỤC turn
closePoSession()     → tear down
workstream.cwd = cwd → đổi thư mục
```

Giữa bước 1 và bước 2, SDK **có thể hành động theo câu trả lời đó**, bao gồm gọi tool ghi file — **vào đúng thư mục người dùng vừa rời khỏi**.

`{behavior: "deny"}` mới là settlement đúng cho teardown; trả lời mặc định chỉ đúng cho đường timeout mà `voice-decision-relay` thực sự đặc tả. Chú ý chính spec đó dùng từ *"torn down"* cho trường hợp reset, không phải *"fails"* — nó đã hàm ý ngữ nghĩa thứ ba này rồi.

---

### BUG K — Spec và code mâu thuẫn về hủy run đang queued 🟡

**Vị trí:** `openspec/specs/run-execution-queue/spec.md:56` vs `electron/run-queue.mjs:142-151`

Spec nói:

> *"Stopping a queued run SHALL remove it from the queue and **finalize it as `cancelled` immediately**."*

Code làm ngược lại, và ghi rõ là cố ý:

```js
// Deliberately NOT finalize(): a queued run never started, so there is
// no announcement to make. Preserves today's silent queued-cancel —
// see design.md Risks.
```

**Vì sao phải xử lý trước Đợt 2:** vì không gọi `finalize`, cờ `run.finalized` **không bao giờ được set** cho lớp run này → once-guard ở `run-queue.mjs:128` **không bảo vệ chúng**. Watchdog ở BUG I sẽ được xây trên giả định *cờ finalized ⇔ terminal* — giả định đó **hiện đang sai** với một lớp run.

**Đề xuất:** sửa **spec** cho khớp code, vì hành vi của code mới là hành vi ta muốn (im lặng khi hủy run chưa chạy). Nhưng nếu chọn hướng đó thì phải set `run.finalized` bằng cách khác, hoặc đổi once-guard sang kiểm tra `TERMINAL_STATUSES.includes(run.status)`.

**Đã xem lại khi làm I.1 (`add-run-idle-watchdog`, 2026-07-22), KHÔNG chặn watchdog:** giả định gốc — watchdog sẽ dựa trên "`run.finalized` ⇔ terminal" — không đúng với thực tế triển khai. Watchdog dùng **một timer duy nhất do slot sở hữu** (arm ở `beginRun`, clear ở `finalize`), không phải `Map<runId, timer>`; một run bị hủy lúc còn queued không bao giờ chạm `beginRun` nên không có timer nào được arm cho nó. Cái bẫy chỉ có thật nếu timer được arm theo từng run (xem design.md D2 của change này). BUG K **vẫn còn treo, vẫn là mâu thuẫn thật** — chỉ là nó không còn là điều kiện tiên quyết của I.1 nữa.

*(Ghi chú nhỏ: `voice-decision-relay/spec.md` có requirement "Voice answer resumes the same turn" **hai lần** — một bản phrasing "SDK-role", một bản "PO". Sẽ gây rối khi viết delta.)*

---

### BUG B — Buffer thông báo offline không bao giờ được drain 🔴 — ✅ **XONG** (`drain-offline-announcements`, 2026-07-22)

Vá đúng theo hướng fix bên dưới: `drainPendingAnnouncements()` được tách ra và gọi ngay sau khi `liveSession = await ai.live.connect(...)` resolve (`main.mjs:2251` cũ, mirror `previewVoice`); vòng `while` chết trong `onopen` đã bị xóa. Buffer được chặn ở chỗ push (`notifyIris`) bằng hằng số module `MAX_PENDING_ANNOUNCEMENTS = 20`, drop-oldest khi vượt ngưỡng. `npm run build` + `npm test` sạch; `openspec validate drain-offline-announcements` pass. Nghi thức verify thủ công (ngắt mạng giữa một DEV run dài, xác nhận Iris đọc kết quả sau reconnect) còn cần chạy tay — xem `openspec/changes/drain-offline-announcements/tasks.md` mục 4.

**Vị trí:** `electron/main.mjs:80, 544-551, 2211, 2222-2224`

**Cơ chế:**

```js
// main.mjs:544-551 — buffer khi socket chưa sẵn sàng
function notifyIris(lines, { bufferIfOffline = true } = {}) {
  if (liveSession) { liveSession.sendRealtimeInput({ text }); }
  else if (bufferIfOffline) { pendingClaudeAnnouncements.push(text); }   // ← 549
}

// main.mjs:2211 — liveSession CHỈ được gán sau khi await resolve
liveSession = await ai.live.connect({
  callbacks: {
    onopen() {                                        // ← chạy TRƯỚC dòng 2211 gán xong
      while (pendingClaudeAnnouncements.length > 0 && liveSession) {   // ← 2222, luôn false
        liveSession.sendRealtimeInput({ text: pendingClaudeAnnouncements.shift() });
      }
    },
```

`liveSession` là `null` tại **mọi** `onopen` có thể xảy ra:
- connect lần đầu: `startLive` early-return nếu khác null (`main.mjs:2182`)
- reconnect: `onclose` set null trước khi gọi `scheduleReconnect` (2238); catch của reconnect cũng set null (2277)

→ điều kiện `&& liveSession` **luôn sai** → vòng `while` là **dead code** → `pendingClaudeAnnouncements` chỉ có push, không bao giờ shift.

**Chính file này đã ghi chú đúng cạm bẫy đó, cách 1200 dòng, ở `main.mjs:1020-1021`:**

> *"Send AFTER connect resolves: onopen can fire before the session variable is assigned, so triggering inside onopen would no-op (silent preview)."*

Đường `previewVoice` đã vá đúng (gửi sau khi await resolve, dòng 1022). Đường chính thì chưa.

**Mất cái gì:** toàn bộ `SYSTEM_EVENT_*` rơi vào lúc offline —
`SYSTEM_EVENT_CLAUDE_COMPLETE` (`announceClaudeCompletion`, 1861-1886), `SYSTEM_EVENT_AGENT_SELECT` (589), `SYSTEM_EVENT_WORKSPACE_UPDATE` (634), `SYSTEM_EVENT_SESSION_START` (1823).

**Vì sao nghiêm trọng:** Gemini Live **rớt socket khoảng mỗi ~10 phút** (reconnect định kỳ, xem `main.mjs:67-70`), và DEV run thường kéo dài nhiều phút. Một run kết thúc rơi vào cửa sổ reconnect → **Iris không bao giờ đọc kết quả**. Không log, không lỗi, không dấu hiệu. Người dùng thấy pipeline "nuốt" mất kết quả.

Ngoài ra mảng này **append-only suốt đời tiến trình** → rò rỉ bộ nhớ chậm.

**Hướng fix:**
1. Tách vòng drain thành hàm `drainPendingAnnouncements()`.
2. Xóa vòng `while` khỏi `onopen` (2222-2224).
3. Gọi `drainPendingAnnouncements()` **ngay sau** khi `liveSession = await ai.live.connect({...})` resolve — đúng pattern `previewVoice:1022` đã dùng.
4. Chặn buffer ở chỗ push (549): ring buffer ~20 phần tử, để một đợt offline dài không phình vô hạn.

**Lưu ý thứ tự:** sau khi hoist, drain sẽ chạy **sau** `GreetGate.arm()` thay vì trước. Đây là thứ tự đúng hơn (cập nhật trạng thái xong rồi mới chào).

**Cách verify:**
1. Submit một DEV run dài.
2. Trong lúc chạy, ép rớt Live session (ngắt mạng vài giây, hoặc chờ reconnect định kỳ).
3. Để run kết thúc trong cửa sổ đó.
4. Sau khi reconnect: Iris **phải** chủ động đọc kết quả.
5. Thêm log tạm để xác nhận `pendingClaudeAnnouncements.length` về 0.

---

### BUG C — Ghi file không atomic → mất sạch workstream hoặc credentials 🟠

**Vị trí:** `electron/main.mjs:360-365` (session store), `main.mjs:925` (`.env`), `main.mjs:297-357` (load)

**Cơ chế:**

```js
// main.mjs:360-365
function persistSessionStore() {
  try {
    fs.mkdirSync(path.dirname(SESSION_STORE), { recursive: true });
    fs.writeFileSync(SESSION_STORE, JSON.stringify(sessionStore, null, 2));   // ← O_TRUNC
  } catch { /* non-fatal */ }
}
```

`writeFileSync` mở file với `O_TRUNC`. Giữa lúc truncate và lúc ghi xong, file **rỗng hoặc dở dang**. Không temp+rename, không backup, không fsync.

Rồi phía đọc, `loadSessionStore` (`main.mjs:297-357`) kết thúc bằng:

```js
} catch { /* first run or unreadable store */ }    // ← 357
```

Một `catch` trống không phân biệt được "chạy lần đầu" với "file hỏng".

**Chuỗi hậu quả — tệ hơn là chỉ "reset rỗng":**

```
file hỏng ──▶ loadSessionStore nuốt lỗi
   └─▶ sessionStore giữ giá trị khởi tạo { active: null, sessions: [] }  (main.mjs:210)
         └─▶ activeWorkstream() (445-447) thấy rỗng → tạo workstream mới
               └─▶ createWorkstream gọi persistSessionStore() (432)
                     └─▶ GHI ĐÈ file hỏng bằng 1 session trắng
                           └─▶ MẤT VĨNH VIỄN, không cứu được
```

Mất gì: toàn bộ workstream, mọi `agent_sessions` id (= **toàn bộ lịch sử hội thoại PO và DEV**), mọi lựa chọn `agent_models`. Không thông báo, không log, không backup. Người dùng chỉ thấy "Iris quên hết".

**Cửa sổ rủi ro rộng:** `persistSessionStore` được gọi từ **8 chỗ** (336, 356, 432, 454, 485, 508, 534, 1045) — trong đó 1045 là `rememberClaudeSessionId`, chạy **nhiều lần mỗi run** từ trong hot path parse NDJSON. Thêm nữa `before-quit` (`main.mjs:2640`) không `await` gì cả, nên SIGKILL lúc thoát rơi vào cửa sổ này thường xuyên hơn kích thước file gợi ý.

**Cùng lỗi ở file quan trọng hơn:** `writeUserConfig` (`main.mjs:891-929`) đọc-sửa-ghi toàn bộ `.env` rồi `fs.writeFileSync` ở **dòng 925** — file chứa `GEMINI_API_KEY` **và** `CLAUDE_CODE_OAUTH_TOKEN`. Crash giữa chừng = **mất credentials, app không chạy được**.

**Hướng fix:**

```js
function writeFileAtomicSync(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);   // atomic trên cùng filesystem
}
```

1. Dùng ở `main.mjs:363` và `main.mjs:925`.
2. Ở `catch` của `loadSessionStore` (357): tách 2 trường hợp. `ENOENT` = chạy lần đầu, hợp lệ, im lặng. Lỗi khác = **đổi tên file thành `${SESSION_STORE}.corrupt-${Date.now()}` và log ra**, để `persistSessionStore` tự động sau đó không ghi đè mất dữ liệu còn cứu được.
3. **Thêm `schemaVersion` vào file ngay trong commit này** — không để tới Đợt 3. Đây là một trường ở phía ghi. Hoãn nó đồng nghĩa mọi file store ghi ra từ giờ tới Đợt 3 đều không có version — mà đó **chính là tập dữ liệu** mà lần migration thứ ba sẽ phải đoán mò. Hoãn tức là đẩy fix vào đúng cửa sổ thời gian sản sinh ra dữ liệu mà nó sinh ra để xử lý.

Khác biệt: "người dùng mất sạch trong im lặng" → "người dùng có một file để đưa cho ta xem".

**Cách verify:**
1. Tạo vài workstream, đặt cwd, chọn model.
2. Làm hỏng `~/.iris/claude-sessions.json` thủ công (cắt còn nửa file).
3. Khởi động lại → app phải log lỗi, đổi tên file thành `.corrupt-*`, và **không** ghi đè.
4. Kiểm tra `~/.iris/` không còn file `.tmp` sót lại sau khi ghi bình thường.

---

### BUG D — Card hiển thị activity log như thể là kết quả của Claude 🟡

**Vị trí:** `src/App.tsx:668`

```js
output: output || existing?.output,
```

`pushActivity` (`main.mjs:1049-1055`) phát **activity buffer đã join** vào trường `output` trên mỗi lần update trạng thái `RUNNING`. Khi run kết thúc, `main.mjs:1532` gọi `finalize(run.run_id, COMPLETED, String(result.result ?? ""))`.

Nếu kết quả cuối rỗng → `output === ""` → **falsy** → toán tử `||` giữ lại `existing?.output`, tức là **activity log**.

Hậu quả: card hiển thị, và `ReaderOverlay` mở ra, một đống log gọi tool thô — được trình bày như thể đó là câu trả lời của Claude.

**Hướng fix:** phân biệt "rỗng" với "không có". Dùng `??` với giá trị đã chuẩn hóa, hoặc kiểm tra `output !== undefined` thay vì kiểm tra truthy.

**Cách verify:** chạy một task mà Claude trả về kết quả rỗng → card phải hiện rỗng/placeholder, không hiện activity log.

**Ghi chú:** đây là chỗ duy nhất trong reducer đáng đụng vào lúc này. Claim ban đầu rằng `&& steps` ở `App.tsx:657` làm rơi `tool_end` là **sai** — `tool_start` và `tool_end` đến từ cùng một nguồn có thứ tự (`claude-stream.mjs:37-48` → một kênh IPC), nên `tool_end` không thể tới trước. Guard đó là phòng thủ, không phải bug.

---

### BUG E — Gemini được báo "started" cho run đã fail đồng bộ 🟡 — ✅ **XONG**

**Vị trí:** `electron/run-queue.mjs:115-117`, `electron/main.mjs:1432-1439, 1649-1665`

`submit` phát `STARTING`, gọi `beginRun(run)` — chạy `startClaudeRun` **đồng bộ** — rồi `return { status: "started" }`. Nhưng DEV gate (`main.mjs:1432-1439`) gọi `runQueue.finalize(...FAILED...)` ngay **bên trong** lời gọi đồng bộ đó. Các đường tương tự: thiếu agent (1403), PO billing (1558).

Kết quả: `submitClaudeTask` (1649-1665) trả về cho Gemini *"Claude's DEV agent has started the task."* cho một run **đã FAILED**.

Có giảm nhẹ: `finalize` → `onFinalized` → `announceClaudeCompletion` nên Gemini **vẫn** nhận được thông báo lỗi — chỉ là sau đó. Trải nghiệm thực tế: Iris nói "DEV đã bắt đầu" rồi ngay lập tức "đã thất bại vì không có open change nào". Gây khó hiểu, không phải im lặng. Nhưng DEV gate là đường **thường xuyên xảy ra**, nên voice layer thường xuyên tự mâu thuẫn.

**⚠️ Sửa ở `run-queue.mjs` thôi là VÔ TÁC DỤNG.** `submitClaudeTask` (`main.mjs:1649-1665`) chỉ rẽ nhánh trên `outcome.status === "queued"`; **mọi giá trị khác** đều rơi xuống nhánh *"has started the task"*. Trả `"failed"` từ `submit` mà không sửa `main.mjs:1655` thì chỉ đổi một giá trị không ai đọc.

**⚠️ Bản fix ngây thơ còn tệ hơn bug.** `finalize` → `onFinalized` (`main.mjs:218`) → `announceClaudeCompletion` → `notifyIris` chạy **đồng bộ bên trong `beginRun`, trước khi `submit` return** (`run-queue.mjs:116` rồi mới `:117`). Tức là `SYSTEM_EVENT_CLAUDE_COMPLETE` **đã nằm trên đường truyền** trước khi tool response tồn tại. Nếu làm tool response cũng báo lỗi → Gemini nhận **cùng một lỗi trên hai kênh cùng lúc**. Hôm nay là nói-hai-lần **tuần tự** (khó hiểu); bản fix ngây thơ biến nó thành **đồng thời** (mô hình khó hòa giải hơn).

**Hướng fix đúng — ba bước, theo thứ tự:**
1. Gate `onFinalized` theo `run.started_at` (chính là **BUG A'**) → run bị từ chối ở gate chỉ được báo qua **tool response**, đúng kênh mà Gemini đã hỏi và đúng lượt nói.
2. `submit` trả trạng thái thật (`runQueue.status(runId)`).
3. Sửa nhánh ở `main.mjs:1655` để đọc trạng thái đó.

→ **BUG E phụ thuộc BUG A'. Không làm E trước A'.**

**Cần spec delta:** `openspec/specs/run-execution-queue/spec.md:13` viết nguyên văn *"the submitter receives `status: "started"`"*. Trả về trạng thái thật **vi phạm câu đó theo nghĩa đen**. Cần MODIFIED requirement + scenario mới cho "run bị từ chối lúc khởi động". Đây không phải tùy chọn — spec hiện tại **sai**, không phải chỉ im lặng.

**Cách verify:** trong một dự án không có open change nào có task chưa tick, submit DEV task bằng giọng nói → Iris phải nói thẳng là bị từ chối, **một lần**, không nói "đã bắt đầu".

---

## ĐỢT 1 — Frame budget (người dùng cảm nhận ngay)

> Bối cảnh: app chạy đồng thời WebGL orb có bloom postprocessing + MediaPipe GPU inference + phát audio 24 kHz. Ngân sách khung hình là có thật.

### BUG F — `useHandControl` setState mỗi frame → re-render toàn bộ cây 🟠

**Vị trí:** `src/hooks/useHandControl.ts:245-256` và `:264` (và `:136`)

Cả hai nhánh đều tạo **object mới hoàn toàn** mỗi tick rAF rồi đẩy vào React state. `useHandControl` được gọi ở `App.tsx:772`, nên mỗi frame camera kéo theo:

```
setState mới (identity luôn khác)  ~60 lần/giây
   └─▶ App re-render (1291 dòng, KHÔNG có memo ở bất kỳ đâu trong cây)
         ├─▶ CenterStage → ReactorCore → <Canvas> → R3F reconcile cả scene graph
         ├─▶ WorkStream + tối đa 20 WorkCard
         ├─▶ CommsPanel
         └─▶ HudShell
```

Dòng 264 là chỗ đau nhất: **không có bàn tay nào trong khung hình** vẫn `setState({ ...EMPTY_STATE, active: true })` mỗi frame — burn một lần re-render toàn cây 60 lần/giây trong khi tuyệt đối không có gì xảy ra.

Và `App.tsx:750` (`start()`) bật `handControl = true` **vô điều kiện** → đây là trạng thái mặc định của mọi phiên thức.

**Hướng fix:** giữ dữ liệu per-frame trong ref, chỉ publish lên React state khi **đổi ngữ nghĩa** (đổi lớp gesture, đổi trạng thái có/không có tay). Pattern này **đã tồn tại sẵn trong codebase**: `liveHandRef` (`App.tsx:773-774`) cùng hai vòng rAF ở 816-840 và 848-883 đã đọc theo kiểu ref. Nhánh không-có-tay phải early-return khi state trước đó đã rỗng.

**Ràng buộc phải nhớ:** `dwellRef` được ghi trong effect (`App.tsx:804, 809`) nhưng **đọc trong lúc render** ở memo `handAction` (895) và prop của `HandReticles` (1287). Nó chạy đúng chỉ nhờ deps của memo có `hand.point?.x/y` (904-905) — thay đổi mỗi frame **chính vì bug F**. Nếu fix F kiểu ngây thơ (throttle điểm), nhãn "Hold · opening" sẽ trễ hoặc không hiện. → phải chuyển `dwellRef` sang state hoặc version counter **trong cùng lần sửa**, không phải trước hay sau.

---

### BUG G — Orb trong Glass HUD không bao giờ dừng render 🟠

**Vị trí:** `src/components/HudShell.tsx:255-262`

`CenterStage.tsx:130` truyền `running={orbRunning}` với `orbRunning = sidecarRunning && windowFocused` (`App.tsx:1177`) — đúng, và `ReactorCore.tsx:278` ánh xạ nó sang `frameloop`.

Nhưng `HudShell` render `<ReactorCore>` **không truyền prop `running`** → mặc định `true` (`ReactorCore.tsx:235`) → `frameloop="always"`.

Glass HUD chính là chế độ overlay always-on-top **được thiết kế để bật suốt trong lúc làm việc ở app khác** — tức là đúng lúc cửa sổ mất focus và deck lẽ ra đã tạm dừng. → WebGL + `EffectComposer`/`Bloom` (`ReactorCore.tsx:293-295`) chạy 60fps vĩnh viễn, kể cả khi ngủ, kể cả khi mất focus. **Quạt kêu và tụt pin ở đúng chế độ sinh ra để chạy nền.**

Cùng chỗ đó còn thiếu `rotationRef` và `scaleRef` → **fist-rotate và pinch-scale im lặng không hoạt động trong HUD mode**. Đây là lỗi chức năng, không chỉ hiệu năng.

**Hướng fix:** truyền `running` (tối thiểu là `awake`; tốt nhất là thread cả `windowFocused` xuống) và bổ sung `rotationRef`/`scaleRef`.

---

### BUG H — `pushActivity` gửi ~17KB mỗi dòng activity 🟡

**Vị trí:** `electron/main.mjs:1049-1055`

Buffer giới hạn 80 dòng (1053) × tối đa 221 ký tự (1052) ≈ **17.7 KB**, join lại và **gửi lại toàn bộ trên mỗi dòng activity mới**.

Mỗi sự kiện như vậy kéo theo, ở phía renderer:

1. Re-render toàn bộ `App` (không có `memo` ở đâu trong cây) → R3F reconcile scene graph.
2. Effect `sendUiContext` (`App.tsx:954-989`) phụ thuộc `sortedTasks` — identity mảng mới mỗi lần update → **gửi IPC ngược lên main**, serialize cả 20 task, cho mỗi dòng activity.
3. Effect `onUiAction` (`App.tsx:996-1047`) phụ thuộc `tasks, sortedTasks` → **gỡ và đăng ký lại listener IPC `iris:ui-action`** (`preload.cjs:43-47`) mỗi dòng activity.
4. `useHandoffFx` effect (`useHandoffFx.ts:106-134`) dựng lại `Map` trạng thái trên toàn bộ task.

**Hướng fix:** gửi **delta** (chỉ dòng mới) thay vì cả buffer, hoặc trailing-throttle emit toàn buffer ~150ms. Sửa ở nguồn đồng thời giải quyết luôn (2) và (3), vì cả ba đều bị kích bởi `tasks` đổi identity.

**Ghi chú:** việc re-sort 20 card (`App.tsx:911-918`) là **không đáng kể** (micro giây) — đừng tối ưu chỗ đó.

---

### Các mục nhỏ khác trong renderer (gom vào Đợt 1 nếu tiện tay)

| Vấn đề | Vị trí | Ghi chú |
|---|---|---|
| `ReactorCore` cấp phát trong hot loop | `ReactorCore.tsx:25-28, 66, 133, 139-181` | `new THREE.Color` / `new THREE.Vector3` mỗi frame ≈ 700 alloc/giây → GC ngắt lịch phát audio. Palette là tĩnh (17-23) → hoist ra module scope, dùng `.copy()`/`.set()` |
| `ScriptProcessorNode` trên main thread | `useAudioPipeline.ts:102-121` | Deprecated; `onaudioprocess` chạy **trên main thread**, downsample + IPC mỗi ~21ms ở 48kHz, tranh chấp trực tiếp với React và three.js. Đích đến đúng là `AudioWorklet`. Đây là nguồn gốc của tiếng audio giật khi bug F đang hoành hành |
| `window.confirm` khóa cả event loop | `App.tsx:495` | Modal native trong renderer Electron **chặn toàn bộ main thread**: rAF dừng, orb đóng băng, lịch phát audio khựng, MediaPipe dừng. Kết hợp dwell-click (810, khớp `button, a, [data-task-id], [role="button"]`) → tay lơ lửng trên chip role có thể đóng băng audio |
| Dwell-click có thể bấm nút phá hủy | `App.tsx:791` | Không có cơ chế opt-out. `SetupPanel` có nút Remove token / Save. Cần thuộc tính `data-no-dwell` cho các control nguy hiểm |
| Bật webcam ngầm khi wake | `App.tsx:750` | `handControl = true` vô điều kiện → đèn camera sáng mỗi lần thức, tải MediaPipe WASM + model từ CDN (`useHandControl.ts:35-37`), chạy GPU inference — dù người dùng không cần gesture. Nên opt-in và persist như `soundsEnabled`/`cameraDeviceId` (`App.tsx:29-46`) |
| Lỗi camera dính vĩnh viễn | `useHandControl.ts:88` | `error` không bao giờ được clear khi retry thành công → một lần `getUserMedia` lỗi thoáng qua là `handError` kẹt suốt đời tiến trình |
| Chunk audio rò rỉ sau khi ngắt lời | `useAudioPipeline.ts:160-196` | `playGeminiAudio` await `context.resume()` (168) rồi mới tính `startAt` từ `playbackTimeRef` (192). Nếu `flushPlayback` (146-158) chạy trong lúc await — đúng cái mà barge-in làm (`App.tsx:251`) — chunk đang bay được lên lịch theo timeline **trước flush** và vẫn phát. Triệu chứng: Iris nói nốt một mẩu sau khi đã bị cắt lời |
| Output `AudioContext` không bao giờ đóng | `useAudioPipeline.ts:210-215` | `stop()` đóng input context qua `stopCapture` (137) nhưng để `outputContextRef.current` mở vĩnh viễn |
| `handleSidecarEvent` stale closure — **an toàn nhưng do may mắn** | `App.tsx:245, 575-739` | Đăng ký với deps `[hasBridge]` → giữ closure của render 0 vĩnh viễn. Sống sót vì mọi nhánh chỉ dùng setter và functional updater (React đảm bảo ổn định). Chỉ cần một người đọc `pendingPoQuestion` hay `sortedTasks` bên trong là **im lặng đọc giá trị render 0 mãi mãi**. Tối thiểu phải có comment cảnh báo |

---

## ĐỢT 2 — Cứng hóa lifecycle (biến A và I thành không-thể-xảy-ra)

### BUG I — Không watchdog / PO không hủy được / subprocess mồ côi 🟠

**Vị trí:** `electron/run-queue.mjs:138-165`, `electron/main.mjs:1492-1496, 2640-2649`

Ba lỗ hổng liên quan nhau:

1. **Không có timeout ở bất cứ đâu.** `run-queue.mjs` không có timer nào; `startDevRun` không đặt timeout cho child; `startPoRun` không đặt timeout cho promise. Đối chiếu: mọi ngân sách khác trong hệ thống đều tường minh (`IRIS_PO_QUESTION_TIMEOUT_MS`, reconnect backoff, `MAX_RECONNECT_ATTEMPTS`). Run là thứ **duy nhất không giới hạn** — mà nó giữ một slot **singleton toàn cục**.

2. **SIGTERM không escalate.** `run-queue.mjs:155` gửi `SIGTERM`, không có timer nâng lên `SIGKILL`. Nếu `claude` phớt lờ SIGTERM (đang giữa một tool call Bash chẳng hạn), run mang cờ `CANCELLED` nhưng slot **không bao giờ được giải phóng**, vì việc giải phóng phụ thuộc `child.on("close")` (1525) phải fire.

3. **PO không hủy được, chấm hết.** `run-queue.mjs:160-163` ghi rõ đây là no-op có chủ đích. Cộng với BUG A: đường thoát duy nhất người dùng nghĩ tới (đổi workstream / New) lại chính là thứ làm chết queue.

4. **Subprocess mồ côi.** `main.mjs:1492-1496` `spawn` không có `detached: true` → không có process group để signal. `claude -p` chạy `bypassPermissions` tự spawn subprocess tool (bash, editor) — chúng sống sót thành mồ côi sau khi Iris thoát. Đây là vấn đề vệ sinh desktop app có màu sắc bảo mật.

5. **`before-quit` không đợi gì.** `main.mjs:2640-2649` giết `run.child` rồi thôi: `stopLive()` (2641) là `async` và **không được await**, `closeAllPoSessions()` (2648) chỉ gọi `query.return()` (teardown bất đồng bộ), và handler **không hề gọi `event.preventDefault()`**. Tiến trình có thể thoát trước khi cả hai xong.

**Tách I ra làm hai phần có mức rủi ro rất khác nhau:**

#### I.1 — Watchdog theo run ⟵ **ĐƯA LÊN ĐỢT 0, LÀM TRƯỚC BUG A** — ✅ **XONG** (`add-run-idle-watchdog`, 2026-07-22)

`IRIS_RUN_IDLE_TIMEOUT_MS` mặc định **1_800_000 (30 phút)** — xem `run-queue.mjs` (hằng số + comment lý do) và design.md D6 của change này (ràng buộc là sub-agent `Task` call trong `code-review` skill, đo được 263s/365s/380s, 30 phút = ~4.7× giá trị lớn nhất quan sát được). Suspend/resume qua `PendingQuestion.raise`/`settle` xử lý cái bẫy `AskUserQuestion` bên dưới. Test: `electron/run-queue.test.mjs` (Vitest fake timers), 9 kịch bản theo spec delta của change. `npm test` + `npm run build` sạch; xác minh thủ công một DEV run thật và một PO turn treo `AskUserQuestion` **đã làm, đạt** (tasks 6.3-6.5 của change).

Đây là mảnh cưỡng chế bất biến ở phần đầu tài liệu. Nó **không "lớn"**: sống trọn trong `run-queue.mjs` — file mà theo mục Vitest bên dưới **không cần refactor gì để test được** và nhận fake timer dễ dàng. Ba hàm trong một vùng ~20 dòng: `beginRun` (`:87`) arm, `finalize` (`:120`) disarm, `dequeueNext` (`:96`) re-arm.

**Lý do đưa lên trước A không phải là thanh lịch, mà là bán kính ảnh hưởng:**

| | Phạm vi bảo vệ |
|---|---|
| Fix BUG A | đúng **hai** đường thoát đã biết của **một** module. Không phủ trường hợp session **treo mà còn sống** (chính plan này thừa nhận) |
| Watchdog I.1 | **mọi** thành viên của lớp, kể cả những ca chưa ai tìm ra |

Watchdog biến "brick tới khi restart, `savePoToken` cũng brick" thành "một run treo, báo lỗi to, slot được giải phóng". **Đây là fix duy nhất trong plan có tính chất đó.** Và landing A *bên trong* mô hình đó cho A một bài test rẻ, thay vì nghi thức 5 bước bấm tay trên GUI.

**⚠️ Phải là idle-timeout, KHÔNG phải wall-clock.** Deadline theo đồng hồ tường sẽ giết một DEV run 40 phút hợp lệ — tệ hơn cả bug. Reset bộ đếm trên mỗi dòng activity: `pushActivity` (`main.mjs:1049-1055`) đã bắn cho **cả hai** transport, tín hiệu có sẵn. Run khỏe mạnh phát liên tục; run chết thì im. Đặt tên `IRIS_RUN_IDLE_TIMEOUT_MS` — mọi ngân sách khác trong hệ thống đều tường minh như vậy.

**⚠️ CÁI BẪY — phải xử lý, nếu không I.1 thành bug tệ nhất plan:** một PO turn đang chờ `AskUserQuestion` **không phát activity nào** trong tối đa `IRIS_PO_QUESTION_TIMEOUT_MS` (mặc định 300000, `po-session.mjs:9`). Watchdog idle sẽ giết **đúng những turn đang hoạt động chính xác**. Bắt buộc: tạm dừng watchdog khi `PendingQuestion.current` (`main.mjs:126`) khác null, **hoặc** đặt sàn của nó cao hơn timeout câu hỏi.

**Cần spec delta:** không spec nào nói gì về vòng đời có chặn của run. Requirement mới hoàn toàn.

#### I.2-I.5 — Phần còn lại, để ở Đợt 2

- `cancelActive()` để PO turn hủy được thật — **mâu thuẫn trực tiếp** với scenario hiện có (`run-execution-queue`: *"Stopping an active PO turn → the call returns the run's current status unchanged and the turn continues to completion"*). Cần MODIFIED requirement, không phải bổ sung.
- `detached: true` + kill cả process group.
- `before-quit`: `preventDefault()` + await teardown, có deadline cứng. **Phần này đã là drift, không phải gap** — `po-live-session` đã yêu cầu *"Live session ends cleanly on app shutdown … without leaving an orphaned Claude process."*
- `finalize` idempotent với run không-active (xem BUG K).

---

## Vitest — bộ seam tối thiểu

**Vì sao cần:** BUG A **type-check hoàn hảo**. Nó nằm trong module 251 dòng, biên giới sạch, đã tách đúng bài. Cấu trúc không ngăn được nó và type không thấy nó. Mọi bug trong plan này đều thuộc lớp **lifecycle** — đúng lớp mà test bắt được còn type thì không.

**Không cần spawn `claude` thật.** Bộ seam tối thiểu:

| Mục tiêu | Cần làm gì | Giá trị |
|---|---|---|
| `run-queue.mjs` | **Không cần refactor gì cả** — `createRunQueue({startRun, emit, onFinalized})` đã nhận toàn bộ dependency qua injection (`run-queue.mjs:82`) | Fake `startRun`, assert trực tiếp: một active tại một thời điểm; finalize-once; run bị hủy khi đang queued thì bị bỏ qua lúc dequeue (98-105); slot được giải phóng đúng một lần. **File test giá trị cao nhất repo, tốn một buổi chiều.** Viết **trước** Đợt 2 để watchdog có lưới |
| `po-session.mjs` | **Một seam duy nhất**: `state.query = query({...})` ở dòng 190 là chỗ phụ thuộc cứng vào SDK. Biến thành tham số, mặc định là `query` thật | Đưa vào một fake async generator → BUG A thành test 3 dòng: deliver một turn, gọi `closePoSession`, assert promise đã settle |
| `computePoSessionEnv`, `poBillingStatus`, `poQuestionTimeoutMs` | **Không cần gì** — đã nhận `env` làm tham số (`po-session.mjs:19-34`) | Test ngay được. Ai đó đã nghĩ tới chuyện này |
| `claude-stream.mjs` | **Không cần gì** — đã thuần, 53 dòng, callbacks vào | Test miễn phí trên fixture NDJSON ghi lại |

**Không** cố test `main.mjs` end-to-end, Gemini socket, hay Electron IPC. Đó mới là cái bẫy — bẫy về **phạm vi**, không phải về việc có test hay không.

---

## Drift hay Gap? — quyết định Đợt 0 là một change hay cần spec delta

Dự án chạy OpenSpec: `openspec/specs/` là living spec. Với mỗi bug, câu hỏi là **code lệch khỏi spec** (spec đúng, code sai → bugfix thuần) hay **spec thiếu** (spec chưa từng phát biểu bất biến → fix phải thêm requirement).

| Bug | Phán quyết | Căn cứ |
|---|---|---|
| **B** | **Drift thuần, không cần delta** | `session-announcements` đã yêu cầu nguyên văn: *"Buffered announcements are delivered in order on reconnect."* Code không giao được cái nào. Ca sạch nhất plan. ⚠️ **Nhưng** ring-buffer cap 20 phần tử **là** một thay đổi hành vi — "delivered in order" không nói gì về việc bỏ bớt. Hoặc thêm mệnh đề delta, hoặc đổi sang drop-newest-kèm-log |
| **A** | **Chủ yếu drift, một gap thật** | `voice-decision-relay` yêu cầu: *"Session reset with a question pending → the pending callback is settled and the paused turn is torn down without leaving an orphaned Claude process."* Code để run giữ slot vĩnh viễn → drift. `run-execution-queue`: *"Every run SHALL reach exactly one terminal status"* cũng đọc theo nghĩa at-least-once. **Gap:** không spec nào nói turn bị reset giết thì đạt terminal status **nào** |
| **A'** | **Gap** | Không spec nào yêu cầu thông báo phải phân biệt theo status |
| **E** | **Fix MÂU THUẪN với spec hiện tại** | `run-execution-queue:13` viết nguyên văn *"the submitter receives `status: "started"`"*. Cần MODIFIED requirement + scenario mới. **Bắt buộc** — spec đang **sai**, không phải chỉ im lặng |
| **I.1** | **Gap** | Không spec nào nói về vòng đời có chặn của run |
| **I.2** | **Mâu thuẫn** | `run-execution-queue:56` chốt PO-stop là no-op cố ý |
| **I.4/I.5** | **Drift** | `po-live-session` đã yêu cầu không để lại orphan khi shutdown |
| **K** | **Mâu thuẫn có sẵn, chưa ai đụng** | `run-execution-queue:56` nói queued-cancel phải finalize; code cố ý không. Đề xuất sửa **spec** theo code |
| **C, D, F, G, H, J** | không đụng spec | |

**Hệ quả:** Đợt 0 **không thể** là một bugfix change thuần. Ít nhất E, A'(nếu chọn phân biệt status), I.1 cần spec delta.

---

## Thứ tự thực hiện (đã sửa sau phản biện của Software Architect)

```
 0.0  seam `query` trong po-session (1 dòng) + file test run-queue.mjs
        └─ Vitest chuyển LÊN TRƯỚC. Luận điểm cốt lõi của plan này là
           "A type-check hoàn hảo, cấu trúc sạch không ngăn được nó"
           → A cần test ĐÚNG LÚC nó land, không phải hai commit sau

 0.1  I.1  idle watchdog trong run-queue   ⟵ BẤT BIẾN, CÓ TEST, TRƯỚC TIÊN
        └─ chặn cả LỚP lỗi, không chỉ hai đường thoát đã biết
        └─ nhớ cái bẫy AskUserQuestion

 0.2  A    settle trong finally, CÓ GẮN NHÃN LÝ DO
 0.3  A'   announceClaudeCompletion phân biệt + gate onFinalized theo started_at
        └─ một quy tắc, sửa UX của A + nói-hai-lần của E + wart DEV-stop hôm nay
 0.4  B    hoist drain (+ cap buffer trung thực với spec)
 0.5  E    run-queue return + nhánh main.mjs:1655        [cần spec delta]
 0.6  C    atomic write + cách ly file hỏng + schemaVersion
 0.7  J    abandon → deny khi teardown                   [mới, chưa có trong plan cũ]
 0.8  D    output falsy
 0.9  K    hòa giải spec/code cho queued-cancel          [quyết định trước Đợt 2]

 1    F/G/H + nhóm renderer     (F và G phải làm CÙNG NHAU — xem ghi chú dwellRef)
 2    I.2-I.5                   [cần spec delta: cancelActive, before-quit]
 3    refactor: session store, sidecar-event reducer
```

**Thay đổi lớn nhất so với bản đầu, và là điều đáng tranh luận nhất: `0.1` trước `0.2`.** Mọi thứ khác là khẩu vị sắp xếp; riêng cái này là khác biệt giữa "vá hai đường thoát đã biết" và "chặn cả một lớp".

**Đã loại khỏi kế hoạch:**
- Refactor "#2 một run interface cho PO/DEV" — chỉ còn ~6 dòng trùng thật sự, không đáng.
- Refactor "#7 gộp các module renderer nông" — **trái với `openspec/specs/renderer-structure/spec.md`**, vốn chốt rằng TopBar / CenterStage / CommsPanel / HistoryDrawer / CameraDock / BootSequence mỗi cái một file.

**Ghi chú cho Đợt 3:** khi làm session store, nhớ thêm `schemaVersion` vào `claude-sessions.json`. `normalizeWorkstream` (`main.mjs:279-295`) hiện xóa `claude_session_id` sau khi copy sang `agent_sessions.default` — migration một chiều, không có trường version để lần migration thứ ba bám vào.

---

## Nhật ký

| Ngày | Việc | Ghi chú |
|---|---|---|
| 2026-07-21 | Lập plan | Nhánh `develop` tạo từ `main` @ `c429ee2` |
| 2026-07-21 | Sửa lớn sau phản biện agent `Software Architect` | Đặt tên bất biến (`PendingQuestion` là hình mẫu có sẵn); thêm A', J, K; đưa Vitest + watchdog I.1 lên trước BUG A; phát hiện fix E ở `run-queue` là **no-op** nếu không sửa `main.mjs:1655` và bản ngây thơ gây báo lỗi **đồng thời** hai kênh; đưa `schemaVersion` vào commit C; thêm bảng drift-vs-gap |
| 2026-07-22 | **Đợt 0.0 xong** — `add-test-harness-and-po-seam` archived | Thêm Vitest (`4.1.10`, pin cứng) + `npm test`; seam `query` injected vào `getOrCreatePoSession` (`po-session.mjs`), mặc định SDK `query` thật, call site `main.mjs:1579-1590` không đổi. Lưới đã bung cho: `run-queue.mjs` (6 test invariant slot, gồm assertion BUG K trên hành vi hiện tại của code), `po-session.mjs` (`query` giờ đã inject được, sẵn sàng cho test BUG A ở 0.2). `npm test` chạy sạch không `.env`/không `claude` trên PATH; `npm run build` không đổi; `*.test.mjs` xác nhận không lọt vào `app.asar` đóng gói. Không đổi hành vi runtime nào — diff chỉ chạm `package.json`, `package-lock.json`, `vitest.config.mjs`, `po-session.mjs`, `run-queue.test.mjs`. Kế tiếp: **0.1 watchdog I.1**, rồi **0.2 BUG A** với test đã có sẵn |
| 2026-07-22 | **Đợt 0.1 xong** — `add-run-idle-watchdog` implemented (chưa archive) | I.1 xong: timer duy nhất do slot sở hữu (`run-queue.mjs`) arm ở `beginRun`, clear ở `finalize`, mặc định `IRIS_RUN_IDLE_TIMEOUT_MS=1_800_000` (30 phút, xem D6). `heartbeat()`/`suspend()`/`resume()` thêm vào interface của queue; `main.mjs` gọi `heartbeat()` từ cả ba nguồn tiến độ (`pushActivity`, `pushToolStart`, `pushToolEnd`) và `suspend()`/`resume()` từ `PendingQuestion.raise`/`settle` (giải quyết cái bẫy `AskUserQuestion`). Hết hạn và `stop()` dùng chung một đường leo thang SIGTERM→(grace 5s)→SIGKILL→`finalize()`, giữ nguyên bất biến "slot chỉ giải phóng ở một chỗ". BUG K được xem lại, xác nhận **không** chặn (xem ghi chú tại mục BUG K) — vẫn treo, làm riêng. 9 test Vitest fake-timer mới trong `run-queue.test.mjs` (tổng 16 test, tất cả pass); `npm run build` sạch. Tasks 6.3-6.5 (xác minh thủ công một DEV run thật và một PO turn treo `AskUserQuestion` qua ứng dụng thật) đã verify bằng tay, đạt. **34/34 tasks xong.** Kế tiếp: archive change, rồi **0.2 BUG A** |
| 2026-07-22 | **BUG A + A' xong** — `settle-and-attribute-po-turn`, hai commit | **BUG A:** settle chuyển từ `catch` xuống `finally` của `pump` (`po-session.mjs`) — turn nào chưa được `routeMessage` resolve thì bị `finally` reject, dù stream kết thúc sạch (channel đóng), tự kết thúc không throw, hay throw thật. `closePoSession` ghi `state.endReason = { kind: "teardown" }` **trước** `channel.close()`; lỗi reject mang theo `error.poEndReason` khi có. **Ánh xạ status** ở `main.mjs` settle site: `poEndReason.kind === "teardown"` → `CANCELLED`, còn lại → `ERROR` (đọc từ error bị reject, không đọc từ session state vì session đã bị xoá khỏi map). **BUG A':** `onFinalized` (`main.mjs`) gate theo `run.started_at` — run bị từ chối ở gate trước khi dispatch (chưa từng set `started_at`) thì không thông báo, tổng quát hoá đúng quy tắc đã có ở hủy-khi-queued. `announceClaudeCompletion` luôn emit sidecar `claude_completion` (card UI đúng cho mọi status) nhưng bỏ qua `notifyIris` khi status là `CANCELLED` — vá luôn cái wart "stop DEV run vẫn đọc to kết quả". Test mới: `po-session.test.mjs` (4 test, fake async iterator điều khiển được `.return()`/throw/kết thúc lặng lẽ — đúng 3 đường kết thúc BUG A dự đoán) + 1 test mới trong `run-queue.test.mjs` cho gate `started_at`. `npm test` 21/21 pass; `npm run build` sạch; `openspec validate` pass. Tasks 6.3-6.5 (manual: PO turn dài + bấm "New" giữa chừng → `CANCELLED` không kẹt; subprocess chết lặng lẽ → `ERROR` đọc to; turn/DEV run hoàn tất bình thường không đổi hành vi) **đã được người dùng verify bằng tay trên app thật, đạt cả ba**. **24/24 tasks xong.** Kế tiếp: archive change |
| 2026-07-22 | Manual verify 6.3-6.5 xác nhận đạt | Người dùng đã chạy qua app thật (Gemini voice + Claude subscription): PO turn dài bị "New" giữa chừng → `CANCELLED` đúng, DEV run mới chạy ngay không xếp hàng, `savePoToken` không còn bị brick; subprocess chết lặng lẽ → `ERROR` đọc to; đường lành mạnh (PO turn và DEV run hoàn tất bình thường) không đổi hành vi. `settle-and-attribute-po-turn` 24/24 tasks xong, sẵn sàng archive |
| 2026-07-22 | **BUG E xong** — `report-synchronous-start-failure`, một commit | Phụ thuộc **BUG A'** (đã xong trước) nên `onFinalized` đã gate theo `run.started_at` — run bị từ chối đồng bộ lúc khởi động không còn kênh thông báo thứ hai để nói-hai-lần. Fix hai nửa đúng như "Hướng fix đúng" đã ghi: (1) `submit` (`run-queue.mjs`) đọc lại `run.finalized`/`run.status`/`run.output` **sau** `beginRun` thay vì trả cứng `"started"`; (2) `submitClaudeTask` (`main.mjs:1695`) thêm nhánh cho `outcome.status` thuộc `TERMINAL_STATUSES`, trả thẳng lý do `finalize` đã ghi (câu DEV gate "No open OpenSpec change…") thay vì rơi xuống "has started the task". Nhánh `"queued"` và `"started"` lành mạnh giữ nguyên byte-for-byte. Spec delta: `run-execution-queue/spec.md` — requirement "Single execution slot" thêm scenario "Submit rejected synchronously at start". 4 test Vitest mới trong `run-queue.test.mjs` (tổng 24 test, tất cả pass): trả trạng thái thật khi finalize đồng bộ + slot được giải phóng, đường lành mạnh không đổi, đường busy/queued không đổi, và guard `onFinalized`/`started_at` vẫn đứng vững. `npm test` 24/24, `npm run build` sạch, `openspec validate` pass. Tasks 4.3-4.5 (manual: submit DEV task bằng giọng nói không có open change → Iris nói bị từ chối một lần, không nói "đã bắt đầu"; DEV run lành mạnh vẫn báo "started" rồi hoàn tất; task xếp hàng vẫn báo "queued at position N") **đã được người dùng verify bằng tay trên app thật, đạt cả ba**. 19/19 tasks xong, sẵn sàng archive |
