# Pixaude Office

**Pixaude** = pixel + Claude. 켜져 있는 Claude Code 세션들을 한 화면의 픽셀 사무실로 보고, 대표 캐릭터로 돌아다니며 지시하고 보고를 받는 **로컬 도구**입니다.

- 직원 = 레포별 **진짜 `claude` CLI 세션**(tmux). 스킬·훅·MCP·메모리·세션 이어가기가 전부 그대로 동작합니다. LLM 을 따로 호출하지 않습니다. Anthropic 과 무관한 비공식 도구입니다.
- 대화창의 **터미널 탭**은 그 세션의 tmux 창을 그대로 붙인 것(xterm.js)이라 CLI 와 똑같이 씁니다.
- 훅과 상태줄로 상태(작업 중·질문·완료·컨텍스트·구독 사용률)를 읽어 맵과 패널에 보여줍니다.

## 1. 준비물 설치

macOS 또는 Linux 에서 씁니다 (Windows 는 안 됩니다). 아래 네 가지가 필요합니다. 이미 있는 것은 건너뛰세요.

| 준비물 | 확인 | macOS 설치 (Homebrew) |
|---|---|---|
| Python 3.12 이상 | `python3 --version` | `brew install python@3.12` |
| tmux 3.2 이상 | `tmux -V` | `brew install tmux` |
| git | `git --version` | `brew install git` |
| Claude Code CLI | `claude --version` | `curl -fsSL https://claude.ai/install.sh \| bash` 또는 `npm install -g @anthropic-ai/claude-code` |
| zsh | `zsh --version` | macOS 기본 셸. Linux 는 `sudo apt install zsh` |

- Homebrew 가 없으면 https://brew.sh 의 한 줄 명령으로 먼저 설치합니다.
- Linux 는 배포판 패키지 관리자로 같은 것을 설치합니다 (예: `sudo apt install python3 python3-venv tmux git`).
- Claude Code 는 한 번 `claude` 를 실행해 로그인을 마쳐 두세요. 오피스는 그 로그인을 그대로 씁니다.
- Python 코드를 다룰 일은 없습니다. 가상환경(.venv) 과 패키지 설치는 다음 단계의 명령이 알아서 합니다.

## 2. 설치

터미널에서 세 줄을 순서대로 실행합니다.

```bash
git clone https://github.com/jisu9483/pixaude-office.git ~/pixaude-office && cd ~/pixaude-office
./bin/office setup
./bin/office up
```

- `setup`: 준비물을 점검하고, `.venv` 를 만들어 필요한 패키지를 설치하고, 설정 파일 `company.yaml` 과 접속 토큰을 만듭니다. 빠진 준비물이 있으면 ✗ 로 알려주고 멈춥니다.
- `up`: 웹 서버를 백그라운드로 띄우고 브라우저로 http://127.0.0.1:4800/ 을 엽니다. 터미널을 닫아도 서버는 계속 떠 있습니다.
- 아래 글에서 `office` 라고 쓴 명령은 모두 `~/pixaude-office/bin/office` 입니다. 어디서나 짧게 부르려면 `./bin/office setup --alias` 를 한 번 실행하거나 `~/.zshrc` 에 `alias office="$HOME/pixaude-office/bin/office"` 를 추가하고 터미널을 새로 여세요.

## 3. 처음 켰을 때 할 일

1. 왼쪽 **출근 관리** 에서 「＋ 팀」을 누릅니다. 팀 = 레포 하나입니다.
2. 폴더 목록에서 내 레포를 고릅니다(이름과 id 가 자동으로 채워짐). 방 이름을 적고, 평소 `--dangerously-skip-permissions` 로 쓰던 레포면 「skip-permissions」를 체크합니다.
3. 「저장하고 직원 1명 출근」을 누릅니다. 직원이 입구 문으로 걸어 들어와 자리에 앉습니다.
4. 예제로 들어 있는 팀(my-api, my-web)은 가짜 경로이니 카드의 ✎ → 「삭제」로 지웁니다.
5. 레포가 여러 개면 2~3 을 반복합니다. 다음부터는 「전체 출근」 하나로 모두 띄웁니다.

## 4. 쓰는 법

- **지시하기**: 맵에서 방향키(또는 WASD)로 대표를 움직여 직원 옆에서 Enter, 또는 출근 관리의 직원 줄을 클릭. 대화창의 터미널 탭에 평소 CLI 처럼 입력합니다.
- **보고 받기**: 작업이 끝나면 직원 머리 위에 `!`, 상단에 「보고 n」. 대표실 책상 앞에서 Enter(또는 「보고 n」 클릭)로 게시판을 열면 보고 전문과 변경 파일 요약, 「IDE 에서 열기」가 있습니다.
- **질문에 답하기**: 권한 확인이나 질문이 오면 `?` 와 상단 「질문 n」. 클릭하면 그 직원 대화창으로 갑니다. 탭을 가려 두었을 때는 상단 「알림」을 켜면 브라우저 알림으로 옵니다.
- **같은 레포에 직원 둘**: 팀 카드의 「+」를 한 번 더. 두 번째 직원부터 git worktree 로 격리돼 서로 파일을 건드리지 않습니다. 퇴근 때 미커밋·미푸시가 있으면 확인을 묻습니다.
- **퇴근**: 직원 줄의 「퇴근」. 직원이 인사하고 걸어 나간 뒤 자리가 사라집니다. 세션 기록은 남아 다음에 같은 번호로 출근하면 이어집니다.
- **끄기**: 터미널에서 `office down`. 직원 전원이 `/exit` 하고 웹 서버가 내려갑니다. 다시 켜려면 `office up`.

### 화면 요소

- **대화창**: 터미널 탭(기본, CLI 그대로) / 요약 탭(지시·보고만 + 메모 큐). 창 가장자리를 끌어 크기 조절(기억됨). ⌘D 분할(가운데 손잡이로 너비 조절), ⌘F 검색, ⌘+ ⌘- 글자, ⌘[ ⌘] 직원 이동, ⌘⇧U 다음 확인할 것, ⌘⇧I 탭 전환, ⌘. 닫기, ⌘/ 단축키 목록.
- **출근 관리**: 팀 카드(＋ 직원 출근, ✎ 설정, 태그) / 직원 줄(상태·컨텍스트·모델·effort·작업 진행·PR·포트·마지막 알림·퇴근).
- **팀 설정(✎)**: 작업실·방·권한·모델·worktree 격리·샌드박스(skip-permissions 와 함께 권장) + MCP(카탈로그 클릭 한 번, 레지스트리 검색, 다른 팀에서 복사) + 스킬·플러그인 목록. pyenv 칸은 파이썬 팀만 쓰며 pyenv 가 없는 컴퓨터에선 보이지 않습니다.
- **상단**: 시계 옆 현재 날씨(이모지·온도, 기본 성남시, `server.weather` 로 위치 변경), 오늘 쓴 토큰, 구독 5시간·주간 사용률(리셋 시각), 비용, 「소리」「알림」 토글, 「단축키」, 「가이드」. CLI 버전이 검증 범위(2.1.299~2.1.311) 밖이면 `⚠ CLI 미검증` 배지가 뜨지만 동작은 합니다.
- **연출(전부 자동)**: 대표실 창문이 실제 날씨를 따라감(해·구름·비·눈·밤하늘) · 출근·퇴근 때 입구 문으로 드나듦 · 작업 중 `…` · 끝나면 `!` · 질문 `?` · 컨텍스트 압축 중엔 탕비실 ☕ · 세션 간 메시지는 회의실 · 서브에이전트는 책상 옆 조수 · Claude Code 업데이트가 내려받아지면 유휴 5분 뒤 자동 재기동.

## 5. 선택 사항

- `office statusline install` — Claude Code 상태줄에 래퍼를 끼워 상단에 구독 사용률을 표시합니다. 원래 상태줄은 보존되고 `office statusline uninstall` 로 되돌립니다.
- `company.yaml` 의 `server.port` / `server.tmux_session` — 4800 포트나 `office` 라는 tmux 세션 이름이 이미 쓰이고 있을 때 바꿉니다.
- `server.editor: code` — 「IDE 에서 열기」에 쓸 명령(code · cursor · idea). 비우면 자동 탐지.
- `server.notify_macos: true` — 질문·오류를 macOS 알림으로도 받습니다.
- `office uninstall` — 상태줄 복원, 세션 종료, 생성물 삭제.

## 문제 해결

- **안 켜진다**: `office doctor` 가 빠진 준비물과 설정 상태를 ✓/✗ 로 보여줍니다. 서버 로그는 `.web.log`.
- **포트가 이미 사용 중**: `company.yaml` 의 `server.port` 를 바꾸고 `office down` → `office up`.
- **직원 상태가 "작업 중"에 멈춰 보인다**: 터미널 탭이 진실입니다. Claude Code 를 올린 뒤 화면 모양이 바뀌면 생길 수 있으며, 패턴은 `web/office/services/screen.py` 한 곳에 있습니다.
- **훅이 안 온다**: 훅 설정은 세션 시작 때 읽히므로 직원을 재기동(명패의 「재기동」)하세요. 포트를 바꿨으면 `office down` → `office up`.
- **브라우저 알림이 "차단됨"**: 주소창 왼쪽 ⓘ → 알림 → 허용 후 새로고침.

## 보안 메모

- 서버는 127.0.0.1 에만 묶이고, 브라우저·훅·상태줄은 설치 토큰(`.office-token`)으로만 통합니다. 다른 웹사이트가 로컬 서버를 건드릴 수 없습니다.
- 그래도 skip-permissions 세션을 다루는 도구입니다. 포트를 외부에 노출하지 마세요. 샌드박스 옵션을 함께 켜면 작업실 밖 파일 쓰기와 외부 네트워크가 막힙니다.
- 토큰·`company.yaml`·`.generated/`·DB(`office.sqlite3`)·업로드는 git 에 올라가지 않습니다. 각자 컴퓨터에만 있습니다.

구조와 설계 결정은 `.claude/architecture.md` (이 레포를 Claude 로 개발할 때 읽히는 메모).
