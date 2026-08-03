# Hướng dẫn Claude Pipeline của Iris

[English →](./PIPELINE_GUIDE.md)

Guide này nói về lớp thứ hai, tùy chọn, của Iris: pipeline xây dựng **PO → DEV**, cho phép bạn giao việc thật — code, research, thao tác file, terminal, tự động hóa — bằng giọng nói. Nếu bạn chỉ muốn trò chuyện với Iris, không cần đọc phần này; xem quickstart trong [README](../README.md) chính là đủ.

## 1. Pipeline là gì

Iris điều khiển Claude Code qua hai role, chuyển giao công việc cho nhau qua một OpenSpec change trên đĩa — không bao giờ qua một cuộc hội thoại chung:

```
Bạn (giọng nói) ──▶ PO (hỏi vặn yêu cầu, đề xuất một OpenSpec change)
                         │
                         ▼  openspec/changes/<tên>/  (proposal, design, specs, tasks)
                         │
                         ▼
                    DEV (làm các task còn lại, tự kiểm thử, archive)
                         │
                         ▼  openspec/specs/  (living spec được cập nhật)
```

- **PO** là một phiên làm việc sống (stateful) — có thể dừng giữa chừng để hỏi lại bạn bằng giọng nói.
- **DEV** chạy ngầm (headless), không hỏi bao giờ — tự triển khai, tự kiểm thử, tự xác minh rồi báo cáo lại.
- Bên dưới, PO chạy skill `grilling` rồi đến flow **propose** của OpenSpec (`/opsx:propose`); DEV chạy flow **apply** (`/opsx:apply`) rồi **archive** (`/opsx:archive`). Bạn không bao giờ tự gõ các lệnh này — lớp giọng nói của Iris ra lệnh cho các agent chạy chúng.

## 2. Cài đặt

**Claude Code và CLI `openspec` đã nằm sẵn bên trong Iris.** Bạn không phải cài
cái nào cả, và hai persona agent cũng đã được tích hợp sẵn. Pipeline tự bật ngay
khi có một credential Claude — không có công tắc riêng để bật/tắt.

1. **Một credential Claude** — mở Iris → **Settings → Claude pipeline** và điền
   *một trong hai*:

   - **Subscription token** (`CLAUDE_CODE_OAUTH_TOKEN`) — tính phí theo gói Claude
     của bạn. Để tạo token, chạy lệnh mà panel hiển thị trong Terminal; lệnh đó
     trỏ thẳng vào binary *của chính Iris*, nên bạn vẫn không phải cài gì:
     ```bash
     "/Applications/Iris.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" setup-token
     ```
     (Panel in ra đường dẫn chính xác cho bản build của bạn — kiến trúc máy và vị
     trí cài đặt sẽ khác nhau.) Dán kết quả vào ô Subscription token. Có hiệu lực
     ngay, không cần khởi động lại.
   - **Anthropic API key** (`ANTHROPIC_API_KEY`) — lựa chọn tính phí theo token từ
     console.anthropic.com, dành cho người không có gói Claude.

   Chỉ cần một trong hai là pipeline bật. Nếu điền cả hai, subscription token thắng.

2. **Global skills** — vẫn trong **Settings → Claude pipeline**, bấm
   **"Install missing"**. Nút này chép các skill cần thiết (`grilling`, `tdd`,
   `code-review`, `diagnosing-bugs`, cùng 3 skill cốt lõi của OpenSpec) vào
   `~/.claude/skills/` và các lệnh `/opsx` vào `~/.claude/commands/opsx/`.
   Những thứ này bắt buộc phải nằm trên đĩa vì Claude Code nạp skill theo tên.

   Nó chỉ cài phần còn thiếu — thứ gì bạn đã tự cài trước đó (qua `skills.sh`,
   `openspec init`, hay cài tay) đều được giữ nguyên, không đè.

Khi mọi dòng trong Settings đều xanh, đánh thức Iris và chuyển sang role PO từ pipeline bar (hoặc nói bằng giọng).

## 3. Trải nghiệm bằng giọng nói

**Bắt đầu một tính năng mới — PO hỏi vặn bạn.**
Nói điều bạn muốn, ví dụ *"Tôi muốn thêm chế độ tối cho màn hình cài đặt."* Iris chuyển yêu cầu này cho PO kèm một chỉ dẫn ngắn để bắt đầu hỏi vặn (grilling). PO dừng lại và hỏi bạn những câu hỏi thật bằng giọng nói — trả lời tự nhiên; Iris đọc từng câu và chuyển câu trả lời của bạn ngược lại. Tiếp tục cho đến khi PO đã đủ thông tin.

**Báo cho PO là xong.**
Nói *"Đủ rồi, đề xuất change đi"* (hoặc tương tự). PO viết ra OpenSpec change — proposal, design, specs, và danh sách task — vào `openspec/changes/<tên>/`. Đây chính là flow `/opsx:propose` chạy bên dưới; bạn không bao giờ thấy hay gõ lệnh đó.

**Chuyển giao cho DEV.**
Chuyển role đang hoạt động sang DEV (pipeline bar, hoặc nói *"chuyển sang DEV"*), rồi nói *"làm các task còn lại đi."* DEV làm việc ngầm: triển khai theo kiểu test-first, chạy test suite và build, xác minh từng kịch bản chấp nhận một cách thật sự — và khi mọi task đã tick xong và xác minh qua, nó archive change, đồng bộ kết quả vào `openspec/specs/` (living spec của dự án). Đây là `/opsx:apply` rồi `/opsx:archive` chạy bên dưới.

**Kiểm tra tiến độ.**
Hỏi *"còn task nào không?"* trong khi PO đang hoạt động, hoặc xem panel Work Stream — nó hiện các tool call của DEV theo thời gian thực và các dấu ✓ gate (PO đã đề xuất ✓ / DEV đã triển khai ✓) theo từng tính năng.

**Các quyết định dọc đường.**
DEV không bao giờ dừng lại chờ — nếu gặp một quyết định sản phẩm thật sự, nó áp dụng lựa chọn khuyến nghị và ghi lại dưới mục "Decisions needed" ở cuối; Iris đọc to các mục này và bạn có thể gửi yêu cầu tiếp theo với lựa chọn của mình. PO thì khác, vì đang chạy sống nên có thể dừng ngay giữa task để hỏi bạn trực tiếp.

## 4. Phụ lục: dùng agent trực tiếp trong Claude Code

Sau khi cài xong (bước 4 ở trên), các persona hoạt động như bất kỳ agent Claude Code nào khác — hữu ích nếu bạn muốn điều khiển chúng từ terminal thay vì bằng giọng nói:

```bash
claude --agent iris-po -p "Hỏi vặn yêu cầu tính năng này và đề xuất OpenSpec change tiếp theo"
claude --agent iris-dev -p "Triển khai các task chưa hoàn thành của OpenSpec change hiện tại"
```

Hoặc dùng tương tác ngay trong một phiên Claude Code ở project đã có `openspec/`: `/opsx:propose`, `/opsx:apply`, `/opsx:archive` hoạt động trực tiếp như slash command một khi các skill OpenSpec đã được cài.

## 5. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Settings báo pipeline đang tắt, chỉ chat được | Chưa cấu hình credential Claude nào | Thêm subscription token hoặc API key trong Settings → Claude pipeline. Đây là trạng thái bình thường của một bản cài mới |
| Settings báo không khởi chạy được binary Claude đi kèm | Bundle ứng dụng bị hỏng (lỗi đóng gói, không phải thứ bạn cài thêm được) | Cài lại Iris |
| Run báo lỗi credential | Token/key bị từ chối hoặc hết hạn | Tạo lại token bằng lệnh `setup-token` mà panel hiển thị, hoặc thay API key |
| Dòng "openspec CLI" vẫn đỏ | Bundle ứng dụng bị hỏng — OpenSpec đi kèm Iris | Cài lại Iris |
| Dòng "Global skills" vẫn đỏ | Skill chưa được cài ở cấp user | Bấm "Install missing", hoặc chạy lệnh copy được cạnh dòng đó |
| DEV báo lỗi "no open change with remaining tasks" | PO chưa đề xuất gì cả | Chuyển sang PO và yêu cầu nó hỏi vặn rồi đề xuất trước — DEV không bao giờ tự code khi chưa có spec |
