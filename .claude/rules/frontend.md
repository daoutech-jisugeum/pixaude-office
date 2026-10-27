---
paths:
  - web/office/static/**
  - web/office/templates/**
---

# 프런트 (ws.js · game.js · index.html · style.css)

- 빌드 없음. CDN(Phaser 3.80.1, xterm 5.5.0) + 정적 파일. 문법 확인: `node -e "new Function(require('fs').readFileSync('web/office/static/office/ws.js','utf8'))"`.
- 서버 이벤트는 `ws.js` 의 `handlers` 테이블 한 곳에서 받고, 맵은 `Office.on(...)` 으로 구독한다. `/api/*` 호출은 `api()` 헬퍼(토큰 헤더 + JSON).
- **Phaser Container 커스텀 필드에 `z` 를 쓰지 않는다**(내장 속성과 충돌해 update 루프 전체가 멈춘 사고). `zz`, `body_` 처럼 피한다.
- 픽셀 폰트(Galmuri9/11)는 원본 크기 + 정수 배율(`fitZoom`). `setResolution(n)` 은 표시 크기도 n배라 쓰지 않는다. 이동 좌표는 `Math.round` 로 격자에 맞춘다.
- 취향: 버튼·모달보다 **자동 연출**(출근 때 입구 문으로 걸어 들어옴, 탕비실, 회의실. 보고 배달 걷기는 뺐음). 플레이스홀더 말고 실제 값. 전체 로그 패널 없음(사이드는 출근 관리만. '확인할 것' 목록·빠른 입력은 뺐음).
- 단축키는 크롬 기본(⌘숫자, ⌘W, ⌘T 등)과 겹치지 않게. 현재: ⌘⇧U · ⌘[ ⌘] · ⌘D · ⌘F · ⌘+ ⌘- · ⌘⇧I · ⌘. · ⌘/ (`isShortcut`). 목록은 `#keysbox` 모달에 — 추가하면 거기도 갱신.
- 터미널 소켓은 탭이 **보인 뒤** 연다. 숨긴 채 열면 80×24 로 붙었다가 리사이즈돼 화면이 두 번 그려진다. `pagehide` 에서 소켓을 닫아야 서버가 view 세션을 정리한다.
- 입력창(textarea·검색·폼)의 keydown 은 `stopPropagation` 으로 Phaser·문서 Esc 핸들러에 새지 않게 한다. 한글 조합 중 Enter 는 `isComposing` 을 보고 keyup 에서 보낸다.
