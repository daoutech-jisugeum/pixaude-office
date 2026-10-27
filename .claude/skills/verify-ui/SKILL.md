---
name: verify-ui
description: 코드 수정 뒤 오피스 웹을 재기동하고 헤드리스 Chrome(CDP)으로 실제 화면·상태를 확인한다. 프런트·백엔드 어느 쪽을 고쳤든 사용자에게 보고하기 전에 실행.
---

# 수정 확인 절차

1. 린트·테스트·문법
   ```bash
   ruff check web/
   cd web && ../.venv/bin/python manage.py test office && cd ..
   node -e "new Function(require('fs').readFileSync('web/office/static/office/ws.js','utf8'))"
   ```
2. 서버 재기동 (정적 파일 버전도 갱신됨)
   ```bash
   ./bin/office web
   ```
3. 헤드리스 Chrome 으로 실제 확인. `cdp.py` 는 표준 라이브러리만 쓴다(9333 포트에 Chrome 이 없으면 띄운다).
   ```bash
   python3 .claude/skills/verify-ui/cdp.py 'document.title'                      # 페이지 로드 + JS 식 평가
   python3 .claude/skills/verify-ui/cdp.py 'JSON.stringify(Object.values(Office.employees).map(e=>[e.id,e.status]))'
   python3 .claude/skills/verify-ui/cdp.py --shot /tmp/office.png                 # 스크린샷 (Read 로 열어 본다)
   python3 .claude/skills/verify-ui/cdp.py --keep 'Office.openModal("my-api_1"); "ok"'   # 이미 열린 탭에서 이어서
   ```
   확인할 것: 콘솔 에러 없음(`--errors`), `#conn` 이 "연결됨", 직원 수가 tmux 창 수와 같음, 고친 부분이 실제로 보임.
4. 사용자에게 ⌘⇧R(강력 새로고침) 안내. 훅 설정을 바꿨으면 세션 재기동이 필요하다고 함께 말한다.
