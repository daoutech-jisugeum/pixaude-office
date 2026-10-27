---
paths:
  - web/office/services/screen.py
  - web/office/tests/**
---

# 화면 긁기 패턴

- Claude Code 화면 텍스트를 해석하는 함수는 전부 `services/screen.py` 의 순수 함수다. 다른 파일에 문자열 패턴을 두지 않는다.
- 캡처는 60줄(`tmux.capture` 기본값). 12줄만 읽으면 창이 큰 직원의 모드·업데이트 판정이 전부 빗나간다(실제 사고). 빈 줄은 `_tail` 이 건너뛴다.
- 유휴 판정 = `❯` 입력줄 + 작업 표시 없음. 입력줄은 작업 중에도 보이므로 프롬프트 유무만으로 판정하지 않는다. 작업 표시는 `✳ 단어… (4s · ↓ N tokens)` 스피너, `⎿  Running…`, 훅 실행 줄. 옛 버전의 `esc to interrupt` 도 호환으로 본다.
- 패턴이 깨지면(업데이트 뒤 "작업 중"에 멈춤, 모드 안 읽힘): 실제 화면을 fixture 로 저장하고 패턴을 고친다.

```bash
tmux capture-pane -p -t office:<창> -S -40 > web/office/tests/fixtures/<이름>.txt
cd web && ../.venv/bin/python manage.py test office
```

- fixture 는 합성하지 말고 실제 `capture-pane` 출력으로 (login_required 만 합성본).
