#!/bin/bash
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
