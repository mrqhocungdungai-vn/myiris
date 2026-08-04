# Hướng dẫn Claude Pipeline của Iris

[English →](./PIPELINE_GUIDE.md)

Guide này nói về lớp thứ hai, tùy chọn, của Iris: pipeline xây dựng cho phép bạn giao việc thật — code, research, thao tác file, terminal, tự động hóa — bằng giọng nói. Nếu bạn chỉ muốn trò chuyện với Iris, không cần đọc phần này; xem quickstart trong [README](../README.md) chính là đủ.

## 1. Pipeline là gì

**Bạn không phải vận hành pipeline này. Bạn cứ nói, Iris tự chọn loại công việc phù hợp.** Không có role nào để chọn, không có mode nào để ở trong đó, và không có thuật ngữ nào bạn phải học — "làm cho tôi cái X" là đủ để bắt đầu.

Bên dưới, Iris gọi Claude Code qua bảy công cụ có tên riêng, mỗi công cụ có việc riêng, model riêng, và bộ skill riêng có giới hạn:

| Bạn nói | Cái gì chạy | Nó làm gì |
| --- | --- | --- |
| "Tôi muốn thêm chế độ tối" | **Shape** | Hỏi vặn để chốt yêu cầu, rồi viết một [OpenSpec](https://github.com/Fission-AI/OpenSpec) change |
| "vẽ ra đi", "sơ đồ của tôi có gì?" | **Canvas** | Vẫn cuộc hội thoại đó, nhưng trên canvas — nó đọc và vẽ được lên đó |
| "làm đi", "sửa lỗi này", "đổi tên file kia" | **Build** | Làm việc thật. Có change đang mở thì làm các task của nó; không có thì cứ làm điều bạn yêu cầu |
| "chốt change đó lại", "archive đi" | **Finish** | Xác minh các task đã xong rồi gộp change vào living spec |
| "còn gì chưa làm?", "X hoạt động thế nào?" | **Look** | Đọc dự án và trả lời. Nó không sửa được gì cả |
| "review cái vừa làm đi" | **Review** | Đánh giá công việc và báo cáo các vấn đề |
| "lưu lại những gì học được" | **Notes** | Dệt những gì đã xảy ra vào second brain của bạn |

Công việc đi qua quy trình đầy đủ vẫn chạy theo đúng luồng cũ — shaping tạo ra một change trên đĩa, rồi build triển khai nó — nhưng **thứ tự đó nay đến từ chính trạng thái của dự án, không phải từ việc bạn tự áp đặt**:

```
Bạn (giọng nói) ──▶ Shape (hỏi vặn, đề xuất một OpenSpec change)
                         │
                         ▼  openspec/changes/<tên>/  (proposal, design, specs, tasks)
                         │
                         ▼
                    Build (làm các task còn lại, tự xác minh)
                         │
                         ▼
                    Finish (archive) ──▶ openspec/specs/  (living spec được cập nhật)
```

- **Shape và Canvas chạy sống** — có thể dừng giữa chừng để hỏi lại bạn bằng giọng nói, và chúng dùng chung một cuộc hội thoại, nên chuyển sang canvas là tiếp tục đúng thứ đang bàn dở.
- **Năm cái còn lại chạy ngầm** — không hỏi bao giờ; tự làm, tự xác minh, rồi báo cáo lại.
- Bạn không bao giờ tự gõ `/opsx:propose`, `/opsx:apply` hay `/opsx:archive`. Iris gọi chúng.

### Yêu cầu nào sẽ dừng lại chờ bạn duyệt

Hai công cụ ghi vào dự án của bạn — **Build** và **Finish** — nên mặc định mỗi lần gọi đều được **giữ lại chờ bạn duyệt**: bạn thấy toàn bộ brief trên màn hình và chọn duyệt, sửa, hoặc hủy; chưa có gì được gửi cho Claude cho tới lúc đó. Mở một cuộc hội thoại shaping mới cũng được giữ lại một lần, ở đầu; các lượt lái cuộc hội thoại đó về sau thì không, vì bạn đã đồng ý rồi. Look, Review và Notes không sửa gì cả nên chạy thẳng.

Nút điều khiển nằm trên pipeline bar và xoay vòng qua ba mức: **Risky** (mặc định, như trên), **All**, và **Off**. Đây là thứ Iris cố ý không tự đổi được cho bạn.

## 2. Cài đặt

**Claude Code và CLI `openspec` đã nằm sẵn bên trong Iris.** Bạn không phải cài
cái nào cả, và hai persona cũng đã được tích hợp sẵn. Pipeline tự bật ngay
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

Chỉ có vậy. Không còn bước thứ hai: các skill mà agent dùng (`grilling`, `tdd`,
`code-review`, `diagnosing-bugs`, các skill OpenSpec) và các lệnh `/opsx` được
đóng gói **bên trong app** và nạp theo từng lần chạy, nên không có gì bị chép ra
máy bạn và cũng không thể cài dở dang. Settings hiển thị chúng thành một dòng
**Bundled** duy nhất.

Iris cũng lưu trạng thái Claude riêng ở `~/.iris/claude-home` thay vì `~/.claude`,
nên các lần chạy của nó không trộn vào lịch sử, cấu hình hay memory Claude Code
của bạn. Đổi lại, Iris **không dùng được** phiên đăng nhập Claude Code trên
terminal của bạn — nó cần credential riêng, chính là thứ bạn vừa điền ở trên.

Khi mọi dòng trong Settings đều xanh, đánh thức Iris và cứ nói điều bạn muốn.

## 3. Trải nghiệm bằng giọng nói

**Bắt đầu một tính năng mới.**
Nói điều bạn muốn, ví dụ *"Tôi muốn thêm chế độ tối cho màn hình cài đặt."* Iris nhận ra đây là thứ cần chốt yêu cầu trước, nói cho bạn biết, rồi mở một cuộc hội thoại shaping — bạn không phải yêu cầu điều đó. Nó dừng lại và hỏi bạn những câu hỏi thật bằng giọng nói; trả lời tự nhiên, Iris đọc từng câu và chuyển câu trả lời của bạn ngược lại. Tiếp tục cho đến khi nó đủ thông tin.

**Báo là đã xong phần hỏi.**
Nói *"Đủ rồi, đề xuất change đi"* (hoặc tương tự). Nó viết ra OpenSpec change — proposal, design, specs, và danh sách task — vào `openspec/changes/<tên>/`.

**Bắt tay vào làm.**
Nói *"làm các task còn lại đi"* hoặc đơn giản *"làm đi."* Iris giữ brief lại chờ bạn duyệt trước; duyệt (có thể sửa trên màn hình trước) là run bắt đầu. Nó làm việc ngầm: triển khai theo kiểu test-first, chạy test suite và build, xác minh từng kịch bản chấp nhận một cách thật sự, rồi báo cáo lại. Khi bạn hài lòng, nói *"chốt lại đi"* để archive change và đồng bộ kết quả vào `openspec/specs/`.

**Việc nhỏ vẫn là việc nhỏ.**
*"Đổi tên file kia"*, *"viết cho tôi script đổi tên mấy file này"*, *"tra xem hóa đơn đến hạn khi nào"* — những việc này **không** đi qua shaping, và cũng không còn bị từ chối vì thiếu spec. Iris cứ thế làm.

**Kiểm tra tiến độ.**
Hỏi *"còn task nào không?"* bất cứ lúc nào, hoặc xem panel Work Stream — nó hiện các tool call theo thời gian thực và change hiện tại đã đi tới đâu.

**Các quyết định dọc đường.**
Một run chạy ngầm không bao giờ dừng chờ — nếu gặp một quyết định sản phẩm thật sự, nó áp dụng lựa chọn khuyến nghị và ghi lại dưới mục "Decisions needed" ở cuối; Iris đọc to các mục này và bạn trả lời bằng giọng nói. Một cuộc hội thoại shaping thì khác, vì đang chạy sống nên có thể dừng ngay giữa task để hỏi bạn trực tiếp.

**Đổi model.**
Cứ nói, ví dụ *"cho thằng build chạy model mạnh hơn để debug cái này."* Lưu ý hai công cụ shaping dùng chung một cuộc hội thoại, nên đổi model của cái này là đổi luôn cái kia — Iris sẽ nói rõ điều đó.

## 4. Phụ lục: dùng agent trực tiếp trong Claude Code

Persona và skill nằm bên trong Iris và được truyền vào mỗi lần chạy trong bộ nhớ,
nên chúng **không** được đăng ký vào bản Claude Code bạn tự cài — đây là chủ ý,
để Iris không đụng vào cấu hình của bạn. Vì vậy muốn chạy từ terminal thì phải
chép ra, chứ không có lệnh chạy thẳng:

```bash
# Persona: chép vào project bạn muốn dùng (chú ý tiền tố iris- mà vị trí
# project-local yêu cầu)
cp /Applications/Iris.app/Contents/Resources/personas/stateful.md .claude/agents/iris-stateful.md
cp /Applications/Iris.app/Contents/Resources/personas/stateless.md .claude/agents/iris-stateless.md

# Skill và lệnh /opsx: trỏ Claude Code vào thư mục plugin của Iris
claude --plugin-dir /Applications/Iris.app/Contents/Resources/iris-plugin
```

Bên trong app, các skill này có tên đầy đủ là `iris:grilling`, `iris:tdd`, … và
các lệnh là `/iris:opsx:propose`, `/iris:opsx:apply`, `/iris:opsx:archive`.

## 5. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Settings báo pipeline đang tắt, chỉ chat được | Chưa cấu hình credential Claude nào | Thêm subscription token hoặc API key trong Settings → Claude pipeline. Đây là trạng thái bình thường của một bản cài mới |
| Settings báo không khởi chạy được binary Claude đi kèm | Bundle ứng dụng bị hỏng (lỗi đóng gói, không phải thứ bạn cài thêm được) | Cài lại Iris |
| Run báo lỗi credential | Token/key bị từ chối hoặc hết hạn | Tạo lại token bằng lệnh `setup-token` mà panel hiển thị, hoặc thay API key |
| Dòng "openspec CLI" vẫn đỏ | Bundle ứng dụng bị hỏng — OpenSpec đi kèm Iris | Cài lại Iris |
| Dòng skills báo "Damaged" | Bundle app hỏng — skill đi kèm Iris | Cài lại Iris |
| Claude Code trên terminal chạy được nhưng Iris thì không | Iris dùng thư mục trạng thái riêng, không thấy phiên đăng nhập terminal của bạn | Thêm credential ở Settings → Claude pipeline |
| Iris cứ mở hội thoại shaping cho một việc nhỏ | Nó hiểu nhầm yêu cầu là một tính năng mới | Nói thẳng là bạn chỉ muốn làm luôn, ví dụ "không cần spec đâu, cứ làm đi" |
| Một lần build đã chạy mà không theo spec bạn tưởng nó phải theo | Khi không có change nào đang mở, Build cứ thế làm việc chứ không từ chối | Hãy shape trước nếu việc đó cần spec; màn hình duyệt trước mỗi lần build chính là chỗ để bắt lỗi này |
