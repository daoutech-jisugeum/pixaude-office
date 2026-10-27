"""설치별 생성물: 토큰(.office-token)과 훅 설정(.generated/office-hooks.json).

- 토큰: 브라우저·훅·상태줄이 서버에 붙을 때 쓰는 비밀. 없으면 만든다. (로컬 전용이지만 다른 웹사이트가 127.0.0.1 로 붙는 걸 막는다)
- 훅 설정: `claude --settings` 로 세션에 주입. 이벤트마다 서버 /hook/<event>/ 로 POST 하고 상태줄은 래퍼 스크립트.
  포트·경로·토큰이 바뀌면 다시 쓴다. 세션은 시작할 때 읽으므로 변경은 재기동 뒤 적용.
"""
import json
import os
import secrets
from pathlib import Path

# http 타입 훅: Claude Code 가 직접 POST (헤더에 ${OFFICE_EMPLOYEE} 치환)
HTTP_EVENTS = ("UserPromptSubmit", "PreToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop",
               "PostToolUseFailure", "PermissionDenied", "TaskCreated", "TaskCompleted", "PostModelSwitch", "ConfigChange", "Elicitation", "ElicitationResult")
# command 타입 훅: http 타입이 안 붙는 이벤트는 curl 로 (실패해도 세션에 영향 없게 || true)
CURL_EVENTS = ("PreCompact", "PostCompact", "SessionStart", "SessionEnd")


def token_path(home: Path) -> Path:
    return home / ".office-token"


def load_token(home: Path) -> str:
    p = token_path(home)
    try:
        t = p.read_text(encoding="utf-8").strip()
        if t:
            return t
    except OSError:
        pass
    t = secrets.token_urlsafe(24)
    p.write_text(t + "\n", encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass
    return t


def build(home: Path, port: int, token: str, sandbox: bool = False) -> dict:
    """sandbox=True 면 settings 에 sandbox.enabled 를 함께 넣는다 (bypass 세션에 권장되는 조합). --settings 는 한 번만 쓸 수 있어 파일을 두 벌 둔다."""
    base = f"http://127.0.0.1:{port}/hook"
    hooks = {}
    for ev in HTTP_EVENTS:
        hooks[ev] = [{"hooks": [{
            "type": "http", "url": f"{base}/{ev}/", "timeout": 3000,
            "headers": {"X-Office-Employee": "${OFFICE_EMPLOYEE}", "X-Office-Token": token},
            "allowedEnvVars": ["OFFICE_EMPLOYEE"],
        }]}]
    for ev in CURL_EVENTS:
        cmd = (f"curl -s -m 2 -X POST {base}/{ev}/ -H 'content-type: application/json' "
               f"-H \"X-Office-Employee: $OFFICE_EMPLOYEE\" -H \"X-Office-Token: {token}\" --data-binary @- >/dev/null 2>&1 || true")
        hooks[ev] = [{"hooks": [{"type": "command", "command": cmd, "timeout": 5}]}]
    cfg = {"hooks": hooks, "statusLine": {"type": "command", "command": f"{home}/hooks/office-statusline.sh {port}", "padding": 0}}
    if sandbox:
        cfg["sandbox"] = {"enabled": True}
    return cfg


def ensure(home: Path, port: int, sandbox: bool = False) -> Path:
    out = json.dumps(build(home, port, load_token(home), sandbox=sandbox), indent=2, ensure_ascii=False) + "\n"
    gen = home / ".generated"
    gen.mkdir(exist_ok=True)
    dst = gen / ("office-hooks-sandbox.json" if sandbox else "office-hooks.json")
    if not dst.exists() or dst.read_text(encoding="utf-8") != out:
        dst.write_text(out, encoding="utf-8")
    return dst
