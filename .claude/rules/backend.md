---
paths:
  - web/office/state.py
  - web/office/consumers.py
  - web/office/views.py
  - web/office/terminal.py
  - web/office/auth.py
  - web/office/services/tmux.py
  - web/office/services/hooks.py
---

# 상태 머신 · 훅 · tmux

## 세션에 글자를 넣는 길은 하나
- 즉시 입력은 터미널 탭(xterm.js ↔ pty `tmux attach`) 뿐. 요약 탭/빠른 입력(`state.say`)은 화면이 유휴일 때만 `send_text`, 아니면 메모 큐에 넣고 턴이 끝난 뒤 `_drain_queue`.
- "화면을 추정하고 타이핑"(인터럽트 접두어, 허용/거부 y/n 전송)은 의도적으로 없앴다. 다시 넣지 않는다.
- 예외는 명령 자체가 목적인 것뿐: `/model` `/effort` `/resume` `/login` `/compact` `/clear`, 권한 모드는 Shift+Tab 순환을 화면으로 읽으며 돌림.

## 훅
- 훅 설정은 `services/hooks.py` 가 생성한다(`.generated/office-hooks.json`, 샌드박스 팀은 `office-hooks-sandbox.json`, `claude --settings`). 템플릿 파일 없음. 이벤트를 추가하려면 `HTTP_EVENTS`/`CURL_EVENTS` 에 넣고 `handle_hook` 에 분기. 2026-10 기준 수신 이벤트: UserPromptSubmit·PreToolUse·PermissionRequest·PermissionDenied·Notification·Stop·StopFailure·SubagentStart/Stop(fork 무시)·PostToolUseFailure·TaskCreated/Completed·PostModelSwitch·ConfigChange·Elicitation/Result + curl: SessionStart/End·Pre/PostCompact.
- 상태줄 JSON 에서 effort.level·fast_mode·pr·worktree.*·version·변경 줄 수를 읽는다(`handle_statusline`). effort 는 상태줄이 오면 화면 긁기 값을 쓰지 않는다. 직원의 실제 작업 폴더는 `effective_cwd(st)`(worktree 면 그 경로).
- 귀속은 `X-Office-Employee` 헤더(= tmux 창의 `OFFICE_EMPLOYEE`)가 기본. cwd 추정은 같은 cwd 인스턴스가 하나일 때만, **StatusLine 엔 금지**(전역 상태줄은 오피스 밖 세션에서도 온다 → 직원 세션 ID 를 덮어쓴 사고).
- 모든 /api·/hook·웹소켓은 설치 토큰. 새 뷰엔 `auth.token_required`, 새 컨슈머엔 `auth.token_ok`.
- `consumers.py` 의 sync_to_async 는 반드시 `thread_sensitive=False`. 기본값이면 화면 캡처가 훅 POST(3초)를 막아 Stop 이 유실된다. 과거 "복구 로직"이 필요했던 진짜 원인.
- `_recover_finished` 는 Esc 로 끊긴 턴(Stop 안 옴)을 화면 유휴로 닫는 용도. 훅 유실 대책으로 키우지 않는다.

## tmux
- 직원 id = 창 이름 = `claude --name` = 세션 간 메시지 주소. `.sessions.json` 에 직원별 세션 ID → `--resume` 만 쓴다. `--continue` 는 같은 폴더의 다른 터미널 세션을 집어 올 수 있어 쓰지 않는다.
- `remain-on-exit` 는 창 단위(`set-option -w`)여야 /exit 뒤 respawn 된다.
- 브라우저 터미널은 접속마다 그룹 세션 `view_xxxx`(현재 창 독립). `destroy-unattached` 는 attach 전에 지워버려 못 쓴다 → `tmux.LIVE_VIEWS` + `reap_views`. 뷰 세션은 `mouse on`(휠 → copy mode).
- 런처의 출근/재기동은 `/api/up/`·`/api/employees/<iid>/restart/` 를 부른다. 명령 조립(`tmux.build_launch_cmd`)·trust 자동 수락·세션 이어가기는 여기 한 곳. zsh 에 다시 구현하지 않는다.
