#!/bin/bash
# 상태줄 래퍼. Claude Code 가 stdin 으로 주는 상태 JSON(컨텍스트 %, 세션 비용, 구독 사용률)을 오피스 서버에 넘기고,
# 원래 statusLine 명령(.generated/original-statusline.cmd)이 있으면 그대로 실행해 터미널 표시를 바꾸지 않는다.
# 사용: office-statusline.sh [port]   (오피스 세션은 생성된 훅 설정이, 전역은 `office statusline install` 이 포트를 넣어 준다)
input="$(cat)"
here="$(cd "$(dirname "$0")" && pwd)"
home="$(dirname "$here")"
port="${1:-${OFFICE_PORT:-4800}}"
token="$(cat "$home/.office-token" 2>/dev/null)"
printf '%s' "$input" | curl -s -m 1 -X POST "http://127.0.0.1:${port}/hook/StatusLine/" \
  -H 'content-type: application/json' -H "X-Office-Employee: ${OFFICE_EMPLOYEE:-}" -H "X-Office-Token: ${token}" --data-binary @- >/dev/null 2>&1 &
orig=""
[ -f "$home/.generated/original-statusline.cmd" ] && orig="$(cat "$home/.generated/original-statusline.cmd")"
if [ -n "$orig" ]; then
  printf '%s' "$input" | bash -c "$orig"
else
  # 원래 상태줄이 없을 때의 간단한 기본 표시 (python3 3.9 호환)
  printf '%s' "$input" | python3 -c '
import json, sys
d = json.load(sys.stdin)
cw = d.get("context_window") or {}
rl = d.get("rate_limits") or {}
m = (d.get("model") or {}).get("display_name", "")
fh = (rl.get("five_hour") or {}).get("used_percentage", "-")
sd = (rl.get("seven_day") or {}).get("used_percentage", "-")
print("[%s] ctx %s%% | 5h %s%% | 7d %s%%" % (m, cw.get("used_percentage") or 0, fh, sd))'
fi
wait
