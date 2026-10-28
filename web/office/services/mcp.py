import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from . import company

NAME_RE = re.compile(r"^[\w.-]{1,64}$")
SCOPES = ("local", "project", "user")
_CLAUDE_JSON = os.path.expanduser("~/.claude.json")

# ---------------- 카탈로그: 자주 쓰는 서버 (고르면 붙는다) ----------------
# need: 붙이기 전에 물어볼 값. {key, label, kind: env|header|arg, placeholder}
CATALOG = [
    {"id": "playwright", "title": "Playwright", "desc": "브라우저 자동화·E2E. 페이지 열고 클릭·입력·스크린샷", "transport": "stdio", "command": "npx", "args": ["-y", "@playwright/mcp@latest"], "tags": ["브라우저", "테스트"]},
    {"id": "chrome-devtools", "title": "Chrome DevTools", "desc": "크롬 개발자도구: 성능·네트워크·콘솔 분석", "transport": "stdio", "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"], "tags": ["브라우저"]},
    {"id": "context7", "title": "Context7", "desc": "라이브러리 최신 문서를 코드 예제와 함께 가져옴", "transport": "http", "url": "https://mcp.context7.com/mcp", "tags": ["문서"]},
    {"id": "fetch", "title": "Fetch", "desc": "웹 페이지를 마크다운으로 읽어옴", "transport": "stdio", "command": "uvx", "args": ["mcp-server-fetch"], "tags": ["웹"]},
    {"id": "filesystem", "title": "Filesystem", "desc": "지정 폴더 파일 읽기·쓰기 (작업실 경로가 자동으로 들어감)", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "{cwd}"], "tags": ["파일"]},
    {"id": "memory", "title": "Memory", "desc": "세션을 넘어 기억하는 지식 그래프", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"], "tags": ["기억"]},
    {"id": "sequential-thinking", "title": "Sequential Thinking", "desc": "단계별 사고를 구조화하는 도구", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"], "tags": ["사고"]},
    {"id": "github", "title": "GitHub", "desc": "이슈·PR·코드 검색 (GitHub 원격 MCP, 첫 사용 시 로그인)", "transport": "http", "url": "https://api.githubcopilot.com/mcp/", "tags": ["git"]},
    {"id": "sentry", "title": "Sentry", "desc": "에러·이슈 조회와 Seer 분석 (원격, 로그인)", "transport": "http", "url": "https://mcp.sentry.dev/mcp", "tags": ["모니터링"]},
    {"id": "notion", "title": "Notion", "desc": "노션 페이지·DB 읽기/쓰기 (원격, 로그인)", "transport": "http", "url": "https://mcp.notion.com/mcp", "tags": ["문서"]},
    {"id": "atlassian", "title": "Atlassian (Jira·Confluence)", "desc": "지라 이슈·컨플루언스 (원격, 로그인)", "transport": "http", "url": "https://mcp.atlassian.com/v1/mcp", "tags": ["협업"]},
    {"id": "linear", "title": "Linear", "desc": "리니어 이슈 (원격, 로그인)", "transport": "http", "url": "https://mcp.linear.app/mcp", "tags": ["협업"]},
    {"id": "figma", "title": "Figma", "desc": "피그마 디자인 읽기 (원격, 로그인)", "transport": "http", "url": "https://mcp.figma.com/mcp", "tags": ["디자인"]},
    {"id": "stripe", "title": "Stripe", "desc": "결제 데이터·문서 (원격, 로그인)", "transport": "http", "url": "https://mcp.stripe.com", "tags": ["결제"]},
    {"id": "vercel", "title": "Vercel", "desc": "배포·프로젝트 (원격, 로그인)", "transport": "http", "url": "https://mcp.vercel.com", "tags": ["배포"]},
    {"id": "postgres", "title": "PostgreSQL", "desc": "DB 스키마 조회·읽기 전용 쿼리", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "{DSN}"], "tags": ["DB"],
     "need": [{"key": "DSN", "label": "접속 문자열", "kind": "arg", "placeholder": "postgresql://user:pass@localhost:5432/db"}]},
    {"id": "supabase", "title": "Supabase", "desc": "수파베이스 프로젝트·DB", "transport": "stdio", "command": "npx", "args": ["-y", "@supabase/mcp-server-supabase@latest"], "tags": ["DB"],
     "need": [{"key": "SUPABASE_ACCESS_TOKEN", "label": "Access token", "kind": "env", "placeholder": "sbp_…"}]},
    {"id": "slack", "title": "Slack", "desc": "채널 읽기·메시지 보내기", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"], "tags": ["협업"],
     "need": [{"key": "SLACK_BOT_TOKEN", "label": "Bot token", "kind": "env", "placeholder": "xoxb-…"}, {"key": "SLACK_TEAM_ID", "label": "Team ID", "kind": "env", "placeholder": "T0…"}]},
    {"id": "brave-search", "title": "Brave Search", "desc": "웹 검색", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-brave-search"], "tags": ["웹"],
     "need": [{"key": "BRAVE_API_KEY", "label": "API key", "kind": "env", "placeholder": "BSA…"}]},
    {"id": "google-maps", "title": "Google Maps", "desc": "지오코딩·장소 검색", "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-google-maps"], "tags": ["지도"],
     "need": [{"key": "GOOGLE_MAPS_API_KEY", "label": "API key", "kind": "env", "placeholder": "AIza…"}]},
]


def _read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def _target_of(cfg: dict) -> str:
    if cfg.get("url"):
        return cfg["url"]
    return " ".join([cfg.get("command", "")] + list(cfg.get("args") or [])).strip()


def scopes_of(cwd: str) -> dict[str, dict]:
    """설정 파일만 읽어 {name: {scope, transport, target, config}}. (즉시 응답용, 헬스는 health() 로)"""
    cwd = os.path.expanduser(cwd)
    cj = _read_json(_CLAUDE_JSON)
    out: dict[str, dict] = {}

    def put(scope, servers):
        for name, cfg in (servers or {}).items():
            if isinstance(cfg, dict):
                out[name] = {"name": name, "scope": scope, "transport": cfg.get("type") or ("http" if cfg.get("url") else "stdio"), "target": _target_of(cfg), "config": cfg}

    put("user", cj.get("mcpServers"))
    put("project", _read_json(os.path.join(cwd, ".mcp.json")).get("mcpServers"))
    projects = cj.get("projects") or {}
    for key in company.project_keys(cwd):
        put("local", (projects.get(key) or {}).get("mcpServers"))
    return out




# ---------------- 헬스 (claude mcp list, 느림 → 캐시 + 백그라운드) ----------------
_HEALTH: dict[str, dict] = {}   # cwd → {"ts", "items": {name: {status, target, kind}}, "busy"}
_LINE_RE = re.compile(r"^(?P<name>.+?):\s+(?P<target>.+?)\s+-\s+(?P<status>[✔!✘⏸·].*)$")


def parse_list(text: str) -> dict[str, dict]:
    items = {}
    for ln in text.splitlines():
        m = _LINE_RE.match(ln.strip())
        if not m:
            continue
        status = m.group("status").strip()
        ok = status.startswith("✔")
        kind = "connector" if m.group("name").startswith("claude.ai ") else "plugin" if m.group("name").startswith("plugin:") else "config"
        items[m.group("name")] = {"status": "ok" if ok else "auth" if "auth" in status.lower() else "pending" if status.startswith("⏸") else "error",
                                  "status_text": status, "target": re.sub(r"\s+\((HTTP|SSE|stdio)\)$", "", m.group("target")), "kind": kind}
    return items


def health(cwd: str, on_done=None, max_age: float = 60.0) -> dict[str, dict] | None:
    """캐시된 헬스. 없거나 오래됐으면 백그라운드로 `claude mcp list` 실행하고 끝나면 on_done(cwd, items) 호출."""
    cwd = os.path.expanduser(cwd)
    c = _HEALTH.get(cwd)
    now = time.time()
    if c and now - c["ts"] < max_age:
        return c["items"]
    if c and c.get("busy"):
        return c.get("items")
    _HEALTH[cwd] = {"ts": c["ts"] if c else 0, "items": c["items"] if c else None, "busy": True}

    def work():
        try:
            r = subprocess.run(["claude", "mcp", "list"], cwd=cwd, capture_output=True, text=True, timeout=40)
            items = parse_list(r.stdout + "\n" + r.stderr)
        except Exception:  # noqa: BLE001
            items = {}
        _HEALTH[cwd] = {"ts": time.time(), "items": items, "busy": False}
        if on_done:
            on_done(cwd, items)

    threading.Thread(target=work, daemon=True).start()
    return c["items"] if c else None


def invalidate(cwd: str):
    """다음 health() 호출 때 다시 조회하되, 그동안은 이전 결과를 계속 보여준다 (목록이 잠깐 비지 않게)."""
    c = _HEALTH.get(os.path.expanduser(cwd))
    if c:
        c["ts"] = 0


# ---------------- 변경 (claude mcp CLI) ----------------
def _run(args: list[str], cwd: str) -> dict:
    try:
        r = subprocess.run(["claude", "mcp", *args], cwd=os.path.expanduser(cwd), capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "claude mcp 가 30초 안에 끝나지 않았습니다"}
    except OSError as e:
        return {"ok": False, "error": str(e)}
    out = (r.stdout + r.stderr).strip()
    last = out.splitlines()[-1] if out else ""
    return {"ok": r.returncode == 0, "error": "" if r.returncode == 0 else (last or f"exit {r.returncode}"), "message": last}


def add(cwd: str, name: str, scope: str, transport: str, target: str, args: list[str] | None = None, env: dict | None = None, headers: dict | None = None) -> dict:
    if not NAME_RE.match(name or ""):
        return {"ok": False, "error": "이름은 영문·숫자·.-_ 만 (64자 이내)"}
    if scope not in SCOPES:
        return {"ok": False, "error": "범위는 local / project / user"}
    if not target:
        return {"ok": False, "error": "명령 또는 URL 이 비었습니다"}
    cmd = ["add", "-s", scope]
    if transport in ("http", "sse"):
        cmd += ["-t", transport]
    for k, v in (env or {}).items():
        cmd += ["-e", f"{k}={v}"]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd += [name, "--", target, *(args or [])] if transport == "stdio" else [name, target]
    res = _run(cmd, cwd)
    if res["ok"]:
        invalidate(cwd)
    return res


def remove(cwd: str, name: str, scope: str) -> dict:
    if scope not in SCOPES:
        return {"ok": False, "error": "claude.ai 커넥터·플러그인 MCP 는 여기서 뗄 수 없습니다"}
    res = _run(["remove", "-s", scope, name], cwd)
    if res["ok"]:
        invalidate(cwd)
    return res


def copy(src_cwd: str, dst_cwd: str, name: str, scope: str = "local") -> dict:
    cfg = (scopes_of(src_cwd).get(name) or {}).get("config")
    if not cfg:
        return {"ok": False, "error": f"{name} 설정을 원본 팀에서 찾지 못했습니다"}
    res = _run(["add-json", "-s", scope, name, json.dumps(cfg)], dst_cwd)
    if res["ok"]:
        invalidate(dst_cwd)
    return res


def from_catalog(item_id: str, cwd: str, values: dict) -> dict:
    """카탈로그 항목 → add() 인자. {cwd} 치환, need 값은 env/arg 로."""
    it = next((c for c in CATALOG if c["id"] == item_id), None)
    if not it:
        return {"ok": False, "error": "카탈로그에 없는 항목"}
    env, args = {}, []
    for a in it.get("args") or []:
        a = a.replace("{cwd}", os.path.expanduser(cwd))
        for n in it.get("need") or []:
            if n["kind"] == "arg":
                a = a.replace("{" + n["key"] + "}", values.get(n["key"], ""))
        args.append(a)
    for n in it.get("need") or []:
        if not values.get(n["key"]):
            return {"ok": False, "error": f"{n['label']} 값이 필요합니다"}
        if n["kind"] == "env":
            env[n["key"]] = values[n["key"]]
    return {"ok": True, "name": it["id"], "transport": it["transport"], "target": it.get("url") or it.get("command"), "args": args, "env": env}


# ---------------- 공식 레지스트리 검색 ----------------
_SEARCH: dict[str, tuple[float, list]] = {}


def registry_search(q: str, limit: int = 20) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    hit = _SEARCH.get(q)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    url = "https://registry.modelcontextprotocol.io/v0/servers?" + urllib.parse.urlencode({"search": q, "limit": limit})
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.load(r)
    except Exception as e:  # noqa: BLE001
        return [{"error": f"레지스트리 조회 실패: {e}"}]
    out = []
    for row in data.get("servers") or []:
        s = row.get("server") or row
        meta = (s.get("_meta") or {}).get("io.modelcontextprotocol.registry/publisher-provided") or {}
        item = {"name": s.get("name", ""), "title": s.get("title") or meta.get("title") or s.get("name", "").split("/")[-1], "desc": s.get("description", ""), "repo": (s.get("repository") or {}).get("url", ""), "options": []}
        for p in s.get("packages") or []:
            rt, ident = p.get("registryType") or p.get("registry_name"), p.get("identifier") or p.get("name")
            if not ident:
                continue
            if rt == "npm":
                opt = {"transport": "stdio", "target": "npx", "args": ["-y", ident], "label": f"npm · {ident}"}
            elif rt == "pypi":
                opt = {"transport": "stdio", "target": "uvx", "args": [ident], "label": f"pypi · {ident}"}
            else:
                continue
            opt["env"] = [{"key": e.get("name"), "label": e.get("description") or e.get("name"), "required": bool(e.get("isRequired"))} for e in (p.get("environmentVariables") or []) if e.get("name")]
            item["options"].append(opt)
        for rm in s.get("remotes") or []:
            if rm.get("url"):
                t = "sse" if (rm.get("type") or "").startswith("sse") else "http"
                item["options"].append({"transport": t, "target": rm["url"], "args": [], "label": f"원격 · {rm['url']}", "headers": [{"key": h.get("name"), "label": h.get("description") or h.get("name")} for h in (rm.get("headers") or []) if h.get("name")]})
        if item["options"]:
            out.append(item)
    _SEARCH[q] = (time.time(), out)
    return out
