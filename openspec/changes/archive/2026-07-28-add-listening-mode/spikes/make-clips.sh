#!/usr/bin/env bash
# Regenerate the Vietnamese test audio the spikes stream into Gemini Live.
#
# macOS only (uses `say` and `afconvert`). Produces 16 kHz mono 16-bit PCM WAV,
# which is exactly the format the renderer's mic path sends in production
# (docs/REFERENCE.md: send 16 kHz, receive 24 kHz).
#
# The clips are deliberately dense with checkable facts — dates, amounts, names —
# so a spike can assert on recall instead of on vibes.
set -euo pipefail
cd "$(dirname "$0")"

say -v Linh -o clip.aiff \
  "Kế hoạch của tôi là dời deadline sang tháng chín, vì thiếu người test, và ngân sách chỉ còn bốn mươi hai triệu đồng. Rủi ro lớn nhất là bạn Hải sắp nghỉ phép ba tuần."

say -v Linh -o clip2.aiff \
  "Còn một việc nữa, tôi hẹn cà phê với khách hàng lúc ba giờ chiều thứ năm."

say -v Linh -o c1.aiff \
  "Đoạn một. Dự án Iris phải hoàn thành trước tháng chín. Ngân sách được duyệt là bốn mươi hai triệu đồng. Đây là hai con số quan trọng nhất của kế hoạch."

say -v Linh -o c2.aiff \
  "Đoạn hai. Anh Hải sẽ phụ trách phần backend và cơ sở dữ liệu. Tôi sẽ tự làm phần giao diện và trải nghiệm người dùng."

say -v Linh -o c3.aiff \
  "Đoạn ba. Buổi nghiệm thu cuối cùng dự kiến vào thứ năm, lúc ba giờ chiều, tại phòng họp lớn."

for f in clip clip2 c1 c2 c3; do
  afconvert -f WAVE -d LEI16@16000 -c 1 "$f.aiff" "$f.wav"
  printf '%s.wav  ' "$f"
  # `|| true`: this line is cosmetic. Under `set -o pipefail` a wording change in
  # afinfo would make grep exit 1 and kill the script *after* the clips were written,
  # which reads as a conversion failure.
  afinfo "$f.wav" | grep -o 'estimated duration: [0-9.]* sec' || echo "(duration unavailable)"
done

echo "done — clip.wav feeds spike-listen{,2,3}.mjs, clip2.wav only spike-listen3.mjs; c1..c3.wav feed spike-listen4.mjs and the probes"
