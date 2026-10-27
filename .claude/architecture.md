# 구조 메모

설치·사용법은 [README](../README.md). 여기는 동작 원리와 설계 결정.

### 팀과 직원

- `company.yaml`의 항목은 **팀**(zshrc alias와 1:1). 실제 자리는 **직원** `my-api_1`, `my-api_2`… 같은 프로젝트에 세션을 여러 개 띄울 수 있다.
- 직원 id = tmux 창 이름 = `claude --name` = 세션 간 메시지 주소. 다른 세션에서 `my-api_2`로 바로 메시지를 보낼 수 있다.
- 오른쪽 "출근 관리"에서 팀마다 **출근 / + 한 명 더**, 직원마다 상태·컨텍스트 HP·모델(클릭해 변경)·**퇴근**. 출근하면 자리가 생기고 퇴근하면 사라진다.
- 확인할 것은 상단 「질문 n」「보고 n」과 ⌘⇧U 로 찾는다 (사이드의 "확인할 것" 목록과 빠른 입력 패널은 2026-10-27 에 뺐다).

### 팀·직원 작성 가이드

- **팀** = 레포 하나(굵은 행, 「＋ 팀」/✎). **직원** = 그 팀의 세션(팀 행 「+」로 `id_1, id_2…`). **방** = 팀이 앉는 곳(팀 설정의 `room`, 같은 이름끼리 한 방).
- **순서**: 「＋ 팀」 → 폴더 목록에서 레포 클릭(작업실·이름·id 자동) → 방·권한 → 「저장하고 직원 1명 출근」. 팀을 다 만든 뒤엔 「전체 출근」(= `office up`).
- **항목**: id(소문자·숫자·하이픈, 변경 불가) · 팀 이름 · 작업실 · 방 · 권한(skip-permissions / default / plan) · 모델 · pyenv(파이썬 팀만, pyenv 없으면 칸 숨김) · 추가 인자 · add-dir(`auto` = 활성 팀 전부) · active(전체 출근 포함 여부) · worktree 격리 · 샌드박스.
- 역할형 팀(기획자·QA): 빈 폴더 + `CLAUDE.md`, add-dir `auto`, 권한 plan. company.example.yaml 의 주석 참고.
- **스킬·명령·플러그인**: MCP 섹션 아래에 이 팀이 쓸 수 있는 프로젝트/사용자 스킬·명령과 플러그인 목록(읽기 전용, 편집은 IDE). **서브에이전트**: Task/Agent 로 부하를 띄우면 책상 옆에 작은 조수가 나타나고 행에 「부하 n」, 턴이 끝나면 사라진다.
- **MCP**: 팀 설정(✎) 아래 MCP 섹션에서 그 팀 세션에 붙는 서버를 보고(상태 ✔/!/⏸), 「＋ 추가」로 **카탈로그(20종, 클릭 한 번)** · **공식 레지스트리 검색** · **다른 팀에서 복사** · 직접 입력으로 붙이고 ✕ 로 뗀다. 「모든 팀에」를 켜면 user 범위. 내부적으로 `claude mcp add/remove` 를 그 작업실에서 실행하므로 터미널과 동일하게 기록된다(local 범위는 레포 루트 키). 변경은 다음 출근부터, 떠 있는 직원 행의 「MCP 변경됨 · 재기동」 클릭으로 적용. 팀 행의 `MCP n` 배지 = local+project 서버 수.
- 수정은 다음 출근부터(떠 있는 직원엔 「설정 변경됨 · 재기동」 배지), 삭제는 한 번 클릭·출근 중이면 서버가 거부. 저장 = company.yaml. 화면 「가이드」에 같은 내용.

### 쓰기 경로와 상태 추정 (구조 메모)

- **즉시 입력은 터미널 탭 한 길.** 요약 탭·빠른 입력의 Enter 는 화면이 빈 입력줄일 때만 타이핑하고, 작업 중이거나 대화상자가 떠 있으면 **메모 큐**에 넣어 턴이 끝난 뒤(또는 다음 tick 에 유휴가 되면) 전달한다. 끼어들기(Esc)·선택지·권한 y/n 은 터미널에서 직접. 예전의 "Esc 후 접두어 타이핑" 인터럽트와 허용/거부 버튼은 없앴다.
- **화면 긁기 패턴은 `services/screen.py` 한 곳.** 유휴/작업 중/로그인/모드/effort/trust 판정이 전부 여기 있고, `office/tests/fixtures/*.txt`(실제 `capture-pane` 캡처)로 `manage.py test office` 가 검증한다. Claude Code 를 올린 뒤 깨지면 패턴을 고치고 fixture 를 다시 캡처한다. (2026-10 기준 작업 중 표시는 `✳ Newspapering… (4s · ↓ 14 tokens)` 스피너와 `⎿ Running…`. `esc to interrupt` 문구는 사라졌다.)
- **훅 수신 시각**을 직원마다 기록해 모달 힌트에 "마지막 훅 n초 전"으로 보여주고, 작업 중인데 3분 넘게 훅이 없으면 출근 관리 행에 「훅 n분 없음」을 띄운다. 유실 복구는 추정이 아니라 이 관측으로 판단한다.
- **상태 스냅샷은 SQLite** (`EmployeeState`). 상태가 바뀔 때마다 저장하고 웹 재시작 시 창이 살아 있는 직원은 복원한다(미읽음·메모 큐·마지막 알림·컨텍스트·훅 시각). 회의 상태만 idle 로 되돌린다.
- **상시 실행**: `office up` 이 웹 서버를 nohup + disown 으로 띄워 터미널을 닫아도 유지된다(끄기는 `office down`). 로그인 시 자동 시작까지 원하면 `office service install`(launchd). 단, macOS 가 launchd 에서 띄운 프로세스의 `~/Documents` 접근을 막으므로(TCC) 프로젝트가 `~/Documents` 아래면 설치를 거부한다. `~/pixaude-office` 처럼 옮기고 `OFFICE_HOME` 을 바꾸면 된다. Docker 는 하지 않는다.

### 세션 이어가기 규칙

- 서버가 직원별 세션 ID를 `.sessions.json`에 기록한다. `office up`/`restart`는 그 ID가 있고 트랜스크립트가 존재하면 **`--resume <id>`** 로 정확히 자기 세션을 잇는다.
- 기록이 없으면(처음 등록한 프로젝트) 새 세션으로 시작한다. `--continue` 는 같은 폴더의 다른 터미널 세션을 집어 올 수 있어 쓰지 않는다.
- `/clear`를 하면 세션 ID가 바뀌고 자동으로 기록이 갱신된다.

### 화면 조작

- 직원 캐릭터는 직원 id 를 시드로 머리·옷·안경/모자/헤드폰 같은 부품을 조합해 그린다(옷 색 = 팀 색). 같은 직원은 늘 같은 얼굴. 명패의 「🎲 외모 바꾸기」로 다음 조합.
- **보고 서류철**: 보고가 오면 직원은 자리에서 `!` 만 띄우고, 대표실 책상 위 더미가 바로 쌓인다(= 미확인 보고 수, 7개 넘으면 숫자). 배달 걷기 연출은 2026-10-27 에 뺐다(사용자 요청). 대표가 책상 앞에서 Enter 를 누르면 게시판.
- **마스코트**: 하늘색 토끼 후드 친구가 사무실을 돌아다니다 탕비실 소파에서 잔다. 대표가 가까이 가면 "야옹"·"냐~" 같은 소리만 낸다. 세션과 무관한 장식.
- 방향키/WASD로 대표 이동, 바닥 클릭으로도 이동. **스페이스**: 채찍질(옆에 직원이 있으면 한마디 한다. 세션에는 아무 영향 없음). 벽은 통과 못 하고 방마다 복도 쪽 문으로 드나든다. 직원 옆에서 **Enter** 또는 직원 클릭 → 대화 모달(안내 문구는 없음).
- **대화 모달 = 터미널 탭(기본) + 요약 탭.** 터미널 탭은 그 직원의 tmux 창을 xterm.js 로 그대로 붙인 것(cmux 처럼)이라 CLI 와 완전히 같다: 스트리밍 출력, AskUserQuestion 선택지, 플랜 승인, 권한 메뉴(항상 허용 포함), Shift+Tab 모드 순환, Esc·Ctrl+C, `/help` `/context` 출력, ⌘V 이미지 붙여넣기(경로 타이핑). 접속마다 `view_*` 그룹 세션을 만들어 iTerm 의 `office attach` 와 창을 서로 바꾸지 않는다.
- **요약 탭**: 지시/보고만 추린 기록 + 입력창. **Enter**: 대기 중이면 지시, 작업 중이면 메모(턴 종료 후 전달). 끼어들려면 터미널 탭에서 Esc. ⌘Enter: 줄바꿈. 슬래시 팝업·↑↓ 히스토리·첨부 칩은 이 탭에서.
- **단축키**: ⌘⇧U 다음 확인할 것(질문 → 보고 순) · ⌘[ ⌘] 이전/다음 직원 · ⌘D 분할(오른쪽에 다른 직원 터미널, ‹ › 로 바꿈) · ⌘F 터미널 검색 · ⌘+ ⌘- 글자 크기(기억됨) · ⌘⇧I 터미널/요약 전환 · ⌘. 닫기 · ⌘/ 단축키 창 (터미널 안에서 Esc 는 CLI 로 간다. ⌘숫자는 크롬 탭 전환과 겹쳐 쓰지 않음). 상단 「단축키」 버튼 또는 ⌘/ 로 맵·어디서나·대화창 세 묶음 표.
- **출근 관리 행**: 상태·컨텍스트·모델 아래에 현재 브랜치의 PR 번호/상태(`gh`), 그 작업실에서 LISTEN 중인 포트(`:8001`), 마지막 보고/질문 한 줄.
- **소리**: 보고(↗ 두 음)·질문(같은 음 두 번)·오류(낮은 음 두 번). 상단 「소리」 토글(점 = 켬/끔)로 끄고 켬. 「새 창」(대화만 띄우는 #chat= 모드)은 2026-10-27 에 뺐다.
- 권한 요청·선택지·질문은 터미널 탭에서 직접 답한다 (요약 탭에는 「터미널 탭에서 답하기」 안내만). 책상 아래 이름표 클릭 → **명패**(모델·권한 모드·컨텍스트 게이지·`/compact`·`/clear`·재기동).
- 게시판(우상단) 클릭 → 보고 목록. 상단 바 「보고 n」(0 이면 흐리게, 클릭 → 게시판. 「질문 n」 클릭 → 그 직원), 브라우저 탭 제목 `(n) Pixaude Office`.

### 사용량과 컨텍스트

- **상단 HUD**: `5h 18% · 주간 15%`는 구독 사용률(Claude Code 상태줄 JSON의 `rate_limits`), `오늘 71M · ≈$139`는 `~/.claude/projects` 전체 트랜스크립트에서 집계한 토큰(오피스 밖 터미널 세션 포함, API 단가 기준 참고치). 클릭하면 상세.
- **캐릭터 머리 위 게이지** = 그 세션의 컨텍스트 사용률. 60% 노랑, 80% 빨강. 70/85/95%를 넘을 때 로그에 경고가 한 번씩 올라온다.
- **탕비실**: 세션이 컨텍스트 압축(자동이든 `/compact`든)을 시작하면 그 직원이 탕비실로 걸어가 ☕ 커피를 마시고(커피머신에 김), 끝나면 자리로 돌아옵니다. 클릭할 건 없습니다.
- **컨텍스트가 찼을 때**: 명패의 `/compact`(요약해 비움, PreCompact→PostCompact 훅으로 진행 상황 표시) 또는 `/clear`(새 컨텍스트, 두 번 클릭 확인). 자동 압축도 같은 훅으로 보인다.
- **응답 실패**(요청 한도·과부하·출력 한도 등)는 `StopFailure` 훅으로 받아 캐릭터에 ⚠ 표시, 로그에 원인. 다시 지시하면 재시도.


### 이미지 첨부와 uploads/
- 대화 모달(요약 탭 입력창·터미널 탭·빠른 입력)에 ⌘V 로 붙여 넣거나 드롭한 파일은 `POST /api/employees/<iid>/upload/` 로 `uploads/<iid>/<시각>-<이름>` 에 저장된다(20MB, 이미지·PDF·텍스트).
- 요약 탭에서는 지시문 끝에 "[첨부 파일 N개 — Read 도구로 열어서…] - 경로" 를 붙여 보내고, 터미널 탭에서는 경로 문자열만 타이핑한다(CLI 에서 경로를 적어 주는 것과 같음).
- 세션은 출근 시 `--add-dir <OFFICE_HOME>/uploads/<iid>` 로 자기 폴더만 읽을 수 있다. tmux 로 Ctrl+V 를 보내 클립보드 이미지를 직접 붙이는 방식은 CLI 가 받지 않아 쓰지 않는다.

## 구조

```
company.yaml              팀 목록: id, name, cwd, room, pyenv, args, model, permission, add_dirs, active, worktree, sandbox, alias
bin/office                zsh 런처. up/restart 는 서버 API(/api/up/, /api/employees/<iid>/restart/) 호출, down/status/attach 만 tmux 직접
.generated/office-hooks.json  claude --settings 로 주입되는 훅 + statusLine (services/hooks.py 가 생성). 프로젝트 파일은 건드리지 않음
hooks/office-statusline.sh  상태줄 JSON을 서버로 보내고 원래 statusLine(claude-hud)을 그대로 실행
web/                      Django 5 + Channels (in-memory layer) + Phaser 3 (CDN, 빌드 없음)
  office/state.py         상태 머신 (away/starting/idle/working/needs_input/meeting/done/error)
  office/services/tmux.py send-keys · respawn · capture · 실행 명령 조립(--resume/--add-dir)
  office/services/repo.py 브랜치 · PR(gh) · LISTEN 포트(lsof)
  office/services/transcript.py  jsonl 파서 (대화 이력)
  office/services/usage.py       토큰 집계 (컨텍스트 크기, 오늘/5시간 합계, 비용 추정)
  office/static/office/game.js   Phaser 씬 (복도·문·충돌, 게이지, 시간대 조명)
```

### 훅 → 상태

| 훅 | 상태 |
|---|---|
| SessionStart / SessionEnd (command, curl) | idle / away, 세션 ID 기록 |
| SubagentStart / SubagentStop | 책상 옆 조수 |
| UserPromptSubmit | working (터미널에서 직접 친 입력도 로그에 "터미널 →"로 표시) |
| PreToolUse | 말풍선 (Edit campaign.py, $ pytest …) |
| PreToolUse tool=SendMessage | 귓속말 로그 + 회의실 이동 |
| PermissionRequest / Notification | needs_input (답은 터미널 탭에서) |
| Stop (`last_assistant_message`) | done + 보고 카드 + 게시판 |
| StopFailure | error (⚠), 원인 로그 |
| PreCompact / PostCompact | "컨텍스트 정리 중" → 요약 로그 |
| PostToolUseFailure | 말풍선 ⚠ + 로그 (상태는 유지) |
| PermissionDenied | auto 모드 거부 로그 |
| TaskCreated / TaskCompleted | 행·명패에 작업 진행 `✓ 3/7` (SessionStart·/clear 에서 초기화) |
| PostModelSwitch | 모델 배지 즉시 갱신 |
| ConfigChange | 「설정 변경됨 · 재기동」 배지 (MCP 변경과 같은 배지) |
| Elicitation / ElicitationResult | MCP 가 입력을 요구하면 needs_input, 답하면 working |
| statusLine JSON | 컨텍스트 %, 세션 비용, 구독 5h/주간 사용률(+리셋 시각), effort.level·fast_mode, pr(review_state 포함 → gh 폴링 대체), worktree.*, version, 변경 줄 수 |

- `SubagentStart/Stop` 의 `agent_type == "fork"` 는 무시한다 (2.1.302 부터 fork 서브에이전트가 기본이라 조수 연출이 너무 잦아짐).
- 상태줄 `version` 이 `web/config/settings.py` 의 `CLAUDE_TESTED` 범위 밖이면 상단바에 `⚠ CLI x.y.z 미검증`, 런처 `doctor`/`up` 도 같은 값을 읽어 경고. 세션 env 에 `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` 을 넣어 사용자가 `defaultToAgentsView` 를 켰어도 오피스 창은 대화 세션으로 뜬다.
- 시작(starting) 40초 뒤에도 안 올라오고 화면에 번호 선택지(`❯ 1.`)가 떠 있으면(2.1.304 의 재개 경고 등) error 대신 needs_input「시작 확인 필요」. 업데이트 자동 재기동은 컨텍스트 50% 이상인 세션을 1시간 넘게 쉰 뒤엔 하지 않는다(그 경고 때문).

### worktree · 샌드박스 · 변경 요약 (2026-10)

- 팀 옵션 `worktree: extra|always|off`(기본 extra = 두 번째 직원부터). 켜진 직원은 `claude --worktree <iid>` 로 띄워 CLI 가 `.claude/worktrees/<iid>` 와 `worktree-<iid>` 브랜치를 만든다. 오피스는 `git worktree` 를 직접 만들지도 지우지도 않는다(CLI 규칙·WorktreeCreate 훅 존중). 상태줄 `worktree.*` 는 명패에만 보인다(행에 브랜치 칩을 두면 레포 브랜치와 달라 헷갈려서 뺌). 퇴근 때 미커밋·미푸시가 있으면 서버가 `confirm` 을 요구하고(`stop` → `force`), worktree 는 남긴다.
- 팀 옵션 `sandbox: true` 면 `hooks.ensure(sandbox=True)` 가 `.generated/office-hooks-sandbox.json`(훅 + `sandbox.enabled`)을 따로 만들어 `--settings` 로 넣는다. `--settings` 는 한 번만 쓸 수 있어 파일을 두 벌 둔다.
- 보고(Stop) 저장 때 `Report.meta = {diff: repo.diff_stat(실제 cwd), lines, cwd}`. 게시판 카드 하단 `+a −b · 파일 n`, 상세에 상위 5파일. 「IDE 에서 열기」(게시판 상세·명패)는 `server.editor` 또는 PATH 의 code/cursor/idea 로 그 폴더(worktree 면 그 경로)를 연다. diff 뷰어는 여전히 IDE.
- 알림: 상단 「알림」 토글(브라우저 알림. 크롬이 차단해 둔 상태면 주소창 ⓘ 에서 풀도록 안내, 탭이 가려졌을 때만, 클릭하면 그 직원 모달) + `server.notify_macos` (osascript, 질문·오류만).

- **픽셀 아트(2026-10-27 재수정)**: 그림 데이터는 `web/office/static/office/sprites.js`(Endesga 32 팔레트 `P`, 문자열 행 스프라이트, `paint()`), 그리기 함수는 `game.js` 의 makeChar/drawMap/drawDesks/… 본체만. 규칙은 `.claude/rules/pixel.md`. 상태·좌표·연출 로직은 재수정 전과 같다(출근 입장·퇴근 퇴장·충돌 추적 로그 동일).

## 주의

- 새 폴더 첫 실행 시 뜨는 "trust this folder" 확인은 자동 수락한다 (company.yaml에 등록한 폴더이므로).
- 끼어들기는 터미널 탭에서 Esc (CLI 와 동일). 권한 프롬프트 대기 중이면 Esc 가 그 요청을 취소한다.
- 훅/상태줄 설정을 바꾸면 `office restart <id>`로 세션을 다시 띄워야 반영된다.
- **Claude Code 업데이트**: 상태줄에 "Update installed · Restart to update" 가 보이면 행에 「업데이트」 배지가 뜨고, 그 직원이 5분 이상 유휴(메모 큐 없음, 미확인 보고 없음)면 자동으로 재기동(`--resume`)해 적용한다. 바로 적용하려면 명패의 재기동.
- 코드 diff는 오피스에 없다. IDE에서 본다.
