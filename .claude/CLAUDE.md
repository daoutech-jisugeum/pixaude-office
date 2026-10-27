# Pixaude Office

(Pixaude = pixel + Claude.) Claude Code 세션들을 픽셀 사무실에서 운영하는 로컬 도구. tmux(세션 보관) + Django/Channels/daphne(훅 수신·웹소켓) + Phaser(맵) + xterm.js(터미널 탭). LLM 을 따로 호출하지 않는다.

## 구조
- `bin/office` — zsh 런처 (setup / up / down / web / status / restart / doctor / statusline / service / app / uninstall). 출근·재기동은 서버 API 호출
- `web/office/state.py` — 직원 상태 머신·훅 처리·방송 (핵심). `terminal.py` — pty 안 `tmux attach` ↔ 웹소켓. `consumers.py` — 브라우저 명령 테이블. `views.py` — 훅·API. `auth.py` — 토큰 검사
- `web/office/services/` — `tmux.py`(창 제어·명령 조립) · `screen.py`(화면 긁기 패턴, 한 곳) · `hooks.py`(토큰·훅 설정 생성) · `mcp.py`(claude mcp CLI 래퍼·카탈로그) · `company.py`(company.yaml) · `repo.py`(브랜치·PR·포트) · `skills.py` · `usage.py` · `transcript.py`
- `web/office/static/office/ws.js`(패널·모달·터미널·단축키) · `game.js`(맵·캐릭터·연출) · `templates/office/index.html`
- 영역별 세부 규칙·사고 이력은 `.claude/rules/*.md`(파일을 열면 자동 로드), 수정 확인 절차는 `.claude/skills/verify-ui`. 설계 메모 `.claude/architecture.md`, 사용법 `README.md`

## 명령
```bash
./bin/office web                                   # 코드 수정 후 서버 재기동 (정적 파일 버전도 갱신됨)
cd web && ../.venv/bin/python manage.py test office   # 테스트 (화면 패턴 fixture · MCP 파서 · 훅 설정)
ruff check web/                                    # 파이썬 린트
node -e "new Function(require('fs').readFileSync('web/office/static/office/ws.js','utf8'))"   # JS 문법
python3 .claude/skills/verify-ui/cdp.py --errors --shot /tmp/office.png   # 헤드리스 Chrome 으로 실제 화면 확인
./bin/office doctor                                # 설치 상태
```

## 규칙
- 파이썬은 `.venv`(pyenv 아님). 의존성은 `requirements.txt`.
- **화면 긁기 패턴은 `services/screen.py` 에만.** 깨지면 실제 화면을 fixture 로 저장하고 패턴을 고친다 (`.claude/rules/screen.md`).
- **세션에 글자를 넣는 길은 터미널 탭 하나.** 요약 탭/빠른 입력은 유휴일 때만 타이핑, 아니면 메모 큐. "화면 추정 후 타이핑"을 다시 넣지 않는다.
- 훅·웹소켓·API 는 설치 토큰으로만. 새 뷰엔 `auth.token_required`, 새 컨슈머엔 `auth.token_ok`. `consumers.py` 의 sync_to_async 는 `thread_sensitive=False`.
- Phaser Container 커스텀 필드에 `z` 금지. 크롬 기본 단축키와 겹치는 단축키 금지.
- UI 취향: 상호작용보다 **자동 연출**, 플레이스홀더 말고 **실제 값**, 픽셀 폰트 원본 크기 + 정수 배율, 전체 로그 패널 없음.
- 수정 후엔 `./bin/office web` 재기동 + 헤드리스 Chrome 으로 실제 동작 확인 뒤 사용자에게 ⌘⇧R 안내.
- `company.yaml` · `.office-token` · `.generated/` · `.venv/` 는 커밋하지 않는다. 커밋 메시지에 AI 트레일러 금지.
