# Pixaude Office

**Pixaude** = pixel + Claude.
여러 레포에서 돌리는 Claude Code 세션들을 **픽셀 사무실의 직원**으로 한 화면에 모아 보고, 대표 캐릭터로 돌아다니며 지시하고 보고를 받는 로컬 도구입니다.

- 직원 하나 = 레포 하나에서 띄운 **진짜 `claude` 세션**(tmux). 평소 쓰던 스킬·훅·MCP·메모리가 그대로 동작합니다.
- 대화창의 터미널은 그 세션을 그대로 붙인 것이라 CLI 와 똑같이 입력합니다.
- 작업 중 `…`, 질문 `?`, 완료 `!` 가 캐릭터 머리 위에 뜨고, 상단에서 질문·보고 개수와 구독 사용률을 봅니다.
- Anthropic 과 무관한 비공식 도구이며 LLM 을 따로 호출하지 않습니다.

## 준비물

macOS 또는 Linux. 아래 네 개가 설치돼 있으면 됩니다 (Python 코드를 만질 일은 없습니다).

| 준비물 | 확인 명령 | macOS 설치 |
|---|---|---|
| Python 3.12+ | `python3 --version` | `brew install python@3.12` |
| tmux 3.2+ | `tmux -V` | `brew install tmux` |
| git · zsh | `git --version` | macOS 기본 |
| Claude Code CLI | `claude --version` | `curl -fsSL https://claude.ai/install.sh \| bash` |

Claude Code 는 한 번 `claude` 를 실행해 로그인해 두세요. Linux 는 `sudo apt install python3 python3-venv tmux git zsh`.

## 설치

```bash
git clone https://github.com/daoutech-jisugeum/pixaude-office.git ~/pixaude-office && cd ~/pixaude-office
./bin/office setup     # 준비물 점검 → 가상환경·패키지 설치 → 설정 파일·토큰 생성
./bin/office up        # 웹 서버를 백그라운드로 띄우고 브라우저를 엽니다 (http://127.0.0.1:4800)
```

`office` 를 어디서나 짧게 쓰려면 `./bin/office setup --alias` 를 한 번 실행하고 터미널을 새로 여세요. 아래 명령은 전부 `~/pixaude-office/bin/office` 와 같습니다.

## 처음 켰을 때

1. 왼쪽 **출근 관리**의 「＋ 팀」 → 폴더 목록에서 내 레포 선택 → 방 이름 적기 → 「저장하고 직원 1명 출근」.
2. 평소 `--dangerously-skip-permissions` 로 쓰던 레포면 「skip-permissions」를 체크하세요.
3. 예제 팀(my-api, my-web)은 가짜 경로이니 카드의 ✎ → 「삭제」.
4. 다음부터는 「전체 출근」 하나로 모두 띄웁니다.

## 쓰는 법

- **지시**: 방향키로 대표를 움직여 직원 옆에서 Enter, 또는 왼쪽 직원 줄 클릭 → 터미널 탭에 평소처럼 입력.
- **보고**: 끝나면 직원 머리 위 `!`, 상단 「보고 n」. 대표실 책상 앞 Enter 또는 「보고 n」 클릭으로 게시판(보고 전문·변경 파일·IDE 에서 열기).
- **질문**: `?` 와 상단 「질문 n」. 클릭하면 그 직원에게 갑니다. 상단 「알림」을 켜면 탭이 가려져 있을 때 브라우저 알림으로 옵니다.
- **같은 레포 직원 둘**: 팀 카드 「+」를 한 번 더. 두 번째부터 git worktree 로 격리돼 서로 파일을 건드리지 않습니다.
- **퇴근**: 직원 줄의 「퇴근」. **끄기**: 터미널에서 `office down`. 다시 켜기 `office up`.
- 단축키는 화면 상단 「단축키」(⌘/), 나머지 설명은 「가이드」에 있습니다.

## 설정 (선택)

`company.yaml` 의 `server` 아래에 적습니다. 팀은 화면에서 추가하는 게 편합니다.

| 키 | 뜻 |
|---|---|
| `port`, `tmux_session` | 4800 포트나 `office` 세션 이름이 이미 쓰일 때 변경 |
| `weather: {lat, lon}` | 상단 날씨·대표실 창문의 위치 (기본 성남시) |
| `editor` | 「IDE 에서 열기」 명령 (code · cursor · idea). 비우면 자동 탐지 |
| `notify_macos: true` | 질문·오류를 macOS 알림으로도 |

`office statusline install` 을 하면 Claude Code 상태줄에 래퍼를 끼워 상단에 구독 사용률이 표시됩니다 (`uninstall` 로 복원). 완전 제거는 `office uninstall`.

## 문제가 생기면

- **안 켜진다** → `office doctor` 가 빠진 것을 ✗ 로 보여줍니다. 서버 로그는 `.web.log`.
- **직원이 "작업 중"에 멈춰 보인다** → 터미널 탭이 진실입니다. Claude Code 화면이 바뀌면 생길 수 있고, 패턴은 `web/office/services/screen.py` 한 곳에 있습니다.
- **훅이 안 온다** → 명패의 「재기동」. 포트를 바꿨으면 `office down` → `office up`.
- **브라우저 알림이 차단됨** → 주소창 ⓘ → 알림 → 허용.

## 보안

서버는 127.0.0.1 에만 열리고 브라우저·훅은 설치 토큰으로만 통합니다. 토큰·`company.yaml`·DB·업로드는 git 에 올라가지 않습니다. skip-permissions 세션을 다루는 도구이니 포트를 외부에 노출하지 마세요. 팀 설정의 **샌드박스**를 켜면 작업실 밖 파일 쓰기와 외부 네트워크가 막힙니다.

구조와 설계 메모는 `.claude/architecture.md`. MIT 라이선스.
