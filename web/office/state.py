"""직원 상태 머신 (프로세스 메모리) + 이벤트 방송.

- 템플릿: company.yaml 의 항목 (alias 와 1:1). 같은 템플릿으로 세션을 여러 개 띄울 수 있다.
- 인스턴스: 실제로 떠 있는 세션. id = "<템플릿id>_<번호>" (= tmux 창 이름 = claude --name = 세션 간 메시지 주소)
- 상태: away · starting · idle · working · needs_input · meeting · done · error
"""
import itertools
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone

from .models import EmployeeState, Message, Report
from .services import company, hooks, mcp, repo, screen, tmux, transcript, usage


GROUP = "office"
_lock = threading.RLock()
TEMPLATES: dict[str, dict] = {}
EMPLOYEES: dict[str, dict] = {}  # 인스턴스
MEETINGS: dict[frozenset, dict] = {}
_MEETING_ID = itertools.count(1)   # 회의 id (프로세스 내 일련번호. 귓속말 자체는 Message 로 남는다)

RATE_LIMITS: dict = {}
CTX_WARN_LEVELS = (70, 85, 95)
MEETING_IDLE_SEC = 30
UPDATE_RESTART_IDLE_SEC = 300   # Claude Code 업데이트가 내려받아진 세션은 5분 이상 유휴면 --resume 으로 재기동해 적용
_UPDATE_DONE: dict[str, float] = {}   # iid → 마지막 자동 재기동 시각 (반복 방지)
_INST_RE = re.compile(r"^(?P<tid>.+)_(?P<no>\d+)$")
_booted = False


def _now():
    return time.time()


# ---------------- 파일 보존 (세션 ID, 구독 사용률) ----------------

def _read_json(name: str) -> dict:
    """OFFICE_HOME 의 작은 상태 파일 (.sessions.json · .ratelimits.json)."""
    try:
        return json.loads((settings.OFFICE_HOME / name).read_text())
    except (OSError, ValueError):
        return {}


def _write_json(name: str, data: dict):
    try:
        (settings.OFFICE_HOME / name).write_text(json.dumps(data, indent=1))
    except OSError:
        pass


def _read_sessions() -> dict:
    return _read_json(".sessions.json")


def _remember_session(iid: str, session_id: str):
    if not session_id:
        return
    data = _read_sessions()
    if data.get(iid) != session_id:
        data[iid] = session_id
        _write_json(".sessions.json", data)


# ---------------- 인스턴스 ----------------

def split_instance(iid: str) -> tuple[str, int]:
    m = _INST_RE.match(iid)
    if m and m.group("tid") in TEMPLATES:
        return m.group("tid"), int(m.group("no"))
    return iid, 0


def _blank(tpl: dict, iid: str, no: int) -> dict:
    return {
        "id": iid, "template": tpl["id"], "no": no, "name": f"{tpl['name']} #{no}" if no else tpl["name"],
        "room": tpl["room"], "cwd": tpl["cwd_abs"], "model": tpl.get("model") or "", "permission": tpl.get("permission") or "",
        "status": "away", "activity": [], "bubble": "", "session_id": "", "transcript_path": "",
        "turns": 0, "last_prompt": "", "pending": None, "queue": [], "sent": [],
        "status_since": _now(), "meeting": None, "unread": 0,
        "ctx": {}, "ctx_warned": 0, "session_out": 0, "session_cost": 0.0, "error": "", "live": {},
        "branch": repo.git_branch(tpl["cwd_abs"]),

        "mode_actual": "", "effort": "", "pantry": 0.0,
        "last_note": "", "pr": {}, "ports": [], "last_hook": 0.0, "update_pending": False, "_last_recovered": "", "mcp_stale": False,
        "subagents": [],
        # 상태줄·훅에서 오는 부가 정보 (2026-10 필드): fast 모드 · 작업 목록 진행 · worktree · CLI 버전 · 변경 줄 수
        "fast": False, "thinking": False, "tasks": {"total": 0, "done": 0}, "worktree": {}, "version": "", "lines": {},
        "worktree_on": bool(tpl.get("worktree") == "always" or (tpl.get("worktree", "extra") == "extra" and no >= 2)),
        "sandbox": bool(tpl.get("sandbox")),
    }


PERSIST_KEYS = ("status", "bubble", "status_since", "session_id", "transcript_path", "turns", "unread", "last_note", "pr", "ports",
                "ctx", "live", "pending", "queue", "mode_actual", "effort", "pantry", "last_hook", "error", "ctx_warned",
                "session_out", "session_cost", "activity", "last_prompt", "_last_recovered", "update_pending",
                "tasks", "worktree", "worktree_on", "sandbox", "version", "fast", "lines")


def effective_cwd(st: dict) -> str:
    """세션이 실제로 일하는 폴더: worktree 로 출근했으면 그 경로, 아니면 작업실."""
    wt = st.get("worktree") or {}
    return wt.get("path") or st["cwd"]


def _persist(iid: str):
    """상태 스냅샷을 SQLite 에 저장 (재시작 복원용). 실패해도 동작엔 영향 없음."""
    with _lock:
        st = EMPLOYEES.get(iid)
        if not st:
            return
        data = {k: st.get(k) for k in PERSIST_KEYS}
    try:
        EmployeeState.objects.update_or_create(iid=iid, defaults={"data": data})
    except Exception as e:  # noqa: BLE001
        print("persist error", e)


def _restore(iid: str, st: dict) -> None:
    """저장된 스냅샷이 있으면 덮어쓴다 (창이 살아 있을 때만 호출). 회의는 상대 쪽 상태를 모르니 idle 로."""
    try:
        row = EmployeeState.objects.filter(iid=iid).first()
    except Exception:  # noqa: BLE001
        row = None
    if not row:
        return
    data = row.data or {}
    for k in PERSIST_KEYS:
        if k in data and data[k] is not None:
            st[k] = data[k]
    if st["status"] in ("meeting", "starting"):
        st["status"] = "idle"
    st["meeting"] = None


def _forget(iid: str):
    try:
        EmployeeState.objects.filter(iid=iid).delete()
    except Exception:  # noqa: BLE001
        pass


def _ensure_instance(iid: str) -> dict | None:
    tid, no = split_instance(iid)
    tpl = TEMPLATES.get(tid)
    if not tpl:
        return None
    st = EMPLOYEES.get(iid)
    if not st:
        st = EMPLOYEES[iid] = _blank(tpl, iid, no)
        st["session_id"] = _read_sessions().get(iid, "")
        st["unread"] = Report.objects.filter(employee=iid, read_at__isnull=True).count()
    return st


def _next_no(tid: str) -> int:
    used = {st["no"] for st in EMPLOYEES.values() if st["template"] == tid and st["status"] != "away"}
    n = 1
    while n in used:
        n += 1
    return n


def _launch_dict(st: dict) -> dict:
    tpl = dict(TEMPLATES[st["template"]])
    tpl["id"] = st["id"]  # --name 과 창 이름에 인스턴스 id 사용
    tpl["model"] = st.get("model") or tpl.get("model") or ""
    tpl["permission"] = st.get("permission") or tpl.get("permission") or ""
    tpl["worktree_on"] = bool(st.get("worktree_on"))
    tpl["sandbox"] = bool(st.get("sandbox"))
    return tpl


def ensure():
    global _booted
    if not _booted:
        bootstrap()
        _booted = True


def bootstrap():
    """첫 요청 시 company.yaml(템플릿) + tmux 창 목록(인스턴스)으로 초기 상태 구성."""
    global RATE_LIMITS
    RATE_LIMITS = _read_json(".ratelimits.json")
    with _lock:
        TEMPLATES.clear()
        for tpl in company.employees():
            TEMPLATES[tpl["id"]] = tpl
        wins = tmux.windows()
        for wname, info in wins.items():
            st = _ensure_instance(wname)
            if st:
                if not info["dead"]:
                    _restore(wname, st)   # 재시작 전 상태(미읽음·메모 큐·마지막 알림·훅 시각) 복원
                st["status"] = "away" if info["dead"] else ("idle" if st["status"] == "away" else st["status"])
        for iid, st in list(EMPLOYEES.items()):
            if iid not in wins or wins[iid]["dead"]:
                st["status"] = "away"


def reload_templates():
    with _lock:
        for tpl in company.employees():
            TEMPLATES[tpl["id"]] = tpl


def snapshot() -> dict:
    ensure()
    with _lock:
        emps = [_public(st) for st in EMPLOYEES.values() if st["status"] != "away"]
        tpls = _templates_payload()
        return {
            "employees": emps, "templates": tpls,
            "meetings": [{"participants": sorted(k), "id": v["id"]} for k, v in MEETINGS.items()],
            "attached": tmux.attached_clients(),
            "unread": Report.objects.filter(read_at__isnull=True).count(),
            "usage": _usage_totals(), "rate_limits": RATE_LIMITS, "weather": weather_label(), "sky": weather_info()["sky"],
            "editor": editor_cmd(), "claude_tested": list(settings.CLAUDE_TESTED), "pyenvs": pyenv_versions(),
        }


# 「IDE 에서 열기」 후보: (표시 이름, argv 앞부분). PATH 의 CLI → macOS 앱 번들 안의 CLI → open -a 순. server.editor 가 있으면 그것만.
_EDITORS = (
    ("code", ["code"]), ("cursor", ["cursor"]), ("idea", ["idea"]),
    ("code", ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"]),
    ("cursor", ["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"]),
    ("idea", ["open", "-a", "IntelliJ IDEA"]), ("code", ["open", "-a", "Visual Studio Code"]), ("cursor", ["open", "-a", "Cursor"]),
)


def _editor_argv() -> tuple[str, list[str]]:
    if settings.EDITOR_CMD:
        return settings.EDITOR_CMD, [settings.EDITOR_CMD]
    for label, argv in _EDITORS:
        if argv[0] == "open":
            if os.path.isdir(f"/Applications/{argv[2]}.app"):
                return label, argv
        elif shutil.which(argv[0]) or (argv[0].startswith("/") and os.access(argv[0], os.X_OK)):
            return label, argv
    return "", []


def pyenv_versions() -> list[str]:
    """~/.pyenv/versions 의 이름들 (pyenv 가 없으면 빈 목록 → 팀 설정 폼에서 pyenv 칸을 숨긴다. Java·Vue 팀엔 필요 없는 값)."""
    root = os.path.expanduser("~/.pyenv/versions")
    try:
        return sorted(n for n in os.listdir(root) if not n.startswith("."))
    except OSError:
        return []


def editor_cmd() -> str:
    return _editor_argv()[0]


def open_in_editor(iid: str, path: str = "") -> dict:
    st = EMPLOYEES.get(iid)
    label, argv = _editor_argv()
    if not argv:
        return {"ok": False, "error": "에디터를 찾지 못했습니다 (company.yaml server.editor)"}
    target = path or (effective_cwd(st) if st else "")
    if not target or not os.path.isdir(target):
        return {"ok": False, "error": "열 폴더가 없습니다"}
    try:
        subprocess.Popen([*argv, target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "editor": label, "path": target}


def _templates_payload() -> list[dict]:
    return [{"id": t["id"], "name": t["name"], "room": t["room"], "cwd": t["cwd_abs"], "cwd_raw": t.get("cwd") or "", "model": t.get("model") or "",
             "permission": t.get("permission") or "", "args": t.get("args") or "", "active": t.get("active", True),
             "pyenv": t.get("pyenv") or "", "add_dirs": t.get("add_dirs") or "", "alias": t.get("alias") or "", "memo": t.get("memo") or "",
             "worktree": t.get("worktree") or "extra", "sandbox": bool(t.get("sandbox")),
             "mcp_n": sum(1 for v in mcp.scopes_of(t["cwd_abs"]).values() if v["scope"] in ("local", "project")),
             "running": sorted(st["id"] for st in EMPLOYEES.values() if st["template"] == t["id"] and st["status"] != "away")}
            for t in TEMPLATES.values()]


def save_template(fields: dict) -> dict:
    """출근 관리의 직원 추가/수정 → company.yaml 저장 → 템플릿 다시 읽고 전체에 방송."""
    before = TEMPLATES.get((fields.get("id") or "").strip()) or {}
    saved = company.save_employee(fields)
    with _lock:
        TEMPLATES.clear()
    reload_templates()
    after = TEMPLATES.get(saved["id"]) or {}
    if before and any(before.get(k) != after.get(k) for k in ("sandbox", "worktree", "args", "permission", "model", "add_dirs_abs", "pyenv")):
        _mark_stale(saved["id"])   # 다음 출근부터 적용 → 떠 있는 직원엔 「설정 변경됨 · 재기동」
    broadcast("templates", {"items": _templates_payload()})
    return {"ok": True, "id": saved["id"]}


def _mark_stale(tid: str):
    with _lock:
        ids = [st["id"] for st in EMPLOYEES.values() if st["template"] == tid and st["status"] != "away"]
        for i in ids:
            EMPLOYEES[i]["mcp_stale"] = True
    for i in ids:
        _emit_status(i)


# ---------------- MCP (팀별) ----------------
def _mcp_items(tid: str) -> dict:
    t = TEMPLATES[tid]
    cfg = mcp.scopes_of(t["cwd_abs"])
    hl = mcp.health(t["cwd_abs"], on_done=lambda cwd, items: broadcast("mcp.list", {"team": tid, "items": _merge_mcp(cfg if cwd == t["cwd_abs"] else mcp.scopes_of(cwd), items), "checked": True}))
    return {"team": tid, "items": _merge_mcp(cfg, hl), "checked": hl is not None}


def _merge_mcp(cfg: dict, hl: dict | None) -> list[dict]:
    rows = {}
    for name, v in cfg.items():
        rows[name] = {"name": name, "scope": v["scope"], "transport": v["transport"], "target": v["target"], "status": "unknown", "status_text": ""}
    for name, h in (hl or {}).items():
        r = rows.setdefault(name, {"name": name, "scope": h["kind"], "transport": "http" if h["target"].startswith("http") else "stdio", "target": h["target"]})
        r["status"], r["status_text"] = h["status"], h["status_text"]
    return sorted(rows.values(), key=lambda r: ({"local": 0, "project": 1, "user": 2}.get(r["scope"], 3), r["name"]))


def mcp_list(tid: str) -> dict:
    if tid not in TEMPLATES:
        return {"ok": False, "error": "unknown team"}
    return {"ok": True, **_mcp_items(tid)}


def _after_mcp_change(tid: str, res: dict) -> dict:
    if not res.get("ok"):
        return res
    _mark_stale(tid)
    broadcast("templates", {"items": _templates_payload()})
    broadcast("mcp.list", {**_mcp_items(tid), "checked": False})
    return {"ok": True, "message": res.get("message", "")}


def mcp_add(tid: str, fields: dict) -> dict:
    """fields: {name, transport, target, args[], env{}, headers{}, scope} 또는 {catalog: id, values{}} 또는 {copy_from: tid, name}."""
    if tid not in TEMPLATES:
        return {"ok": False, "error": "unknown team"}
    cwd = TEMPLATES[tid]["cwd_abs"]
    scope = fields.get("scope") or "local"
    if fields.get("catalog"):
        spec = mcp.from_catalog(fields["catalog"], cwd, fields.get("values") or {})
        if not spec.get("ok"):
            return spec
        res = mcp.add(cwd, spec["name"], scope, spec["transport"], spec["target"], spec["args"], spec["env"], fields.get("headers") or {})
    elif fields.get("copy_from"):
        src = TEMPLATES.get(fields["copy_from"])
        if not src:
            return {"ok": False, "error": "원본 팀이 없습니다"}
        res = mcp.copy(src["cwd_abs"], cwd, fields.get("name", ""), scope)
    else:
        res = mcp.add(cwd, fields.get("name", ""), scope, fields.get("transport") or "stdio", fields.get("target", ""), fields.get("args") or [], fields.get("env") or {}, fields.get("headers") or {})
    return _after_mcp_change(tid, res)


def mcp_remove(tid: str, name: str, scope: str) -> dict:
    if tid not in TEMPLATES:
        return {"ok": False, "error": "unknown team"}
    return _after_mcp_change(tid, mcp.remove(TEMPLATES[tid]["cwd_abs"], name, scope))


def delete_template(tid: str) -> dict:
    if any(st["template"] == tid and st["status"] != "away" for st in EMPLOYEES.values()):
        return {"ok": False, "error": "출근 중인 세션이 있습니다. 먼저 퇴근시키세요"}
    if not company.delete_employee(tid):
        return {"ok": False, "error": "그런 직원이 없습니다"}
    with _lock:
        TEMPLATES.pop(tid, None)
    broadcast("templates", {"items": _templates_payload()})
    return {"ok": True}


def _usage_totals() -> dict:
    try:
        usage.SCANNER.scan()
        return usage.SCANNER.totals()
    except Exception as e:  # noqa: BLE001
        print("usage error", e)
        return {}


def broadcast(event: str, payload: dict):
    layer = get_channel_layer()
    async_to_sync(layer.group_send)(GROUP, {"type": "office.event", "event": event, "payload": payload})


def _public(st: dict) -> dict:
    """브라우저로 나가는 직원 payload (snapshot · employee.add · employee.status 공통)."""
    pend = st.get("pending") or {}
    out = {k: v for k, v in st.items() if k not in ("sent", "pending", "queue", "activity", "subagents") and not k.startswith("_")}
    out["subagents"] = [a["type"] for a in st.get("subagents") or []]
    out.update(pending_kind=pend.get("kind", ""), login_url=pend.get("url", ""), pantry=bool(st.get("pantry")),
               queue_n=len(st.get("queue") or []), update_pending=bool(st.get("update_pending")), since=st["status_since"])
    return out


def _emit_status(iid: str):
    broadcast("employee.status", _public(EMPLOYEES[iid]))
    _persist(iid)


def _reset_ctx(st: dict):
    """새 컨텍스트(/clear · 세션 전환 · 새 세션 시작) 때 컨텍스트 관련 수치 초기화."""
    st.update(ctx={}, live={}, ctx_warned=0, turns=0, session_out=0, session_cost=0.0, pending=None)


def transcript_path(st: dict) -> Path | None:
    if st.get("transcript_path"):
        return Path(st["transcript_path"])
    return transcript.by_session(st["cwd"], st["session_id"]) if st.get("session_id") else None


def _note(iid: str, text: str):
    """출근 관리 행에 보이는 '마지막 알림' 한 줄 (cmux 사이드바의 latest notification)."""
    line = next((ln.strip() for ln in (text or "").splitlines() if ln.strip()), "")
    with _lock:
        EMPLOYEES[iid]["last_note"] = line[:80]


def set_status(iid: str, status: str, bubble: str | None = None):
    with _lock:
        st = EMPLOYEES[iid]
        changed = st["status"] != status
        if changed:
            st["status_since"] = _now()
        st["status"] = status
        if bubble is not None:
            st["bubble"] = bubble
    _emit_status(iid)
    if changed and status in ("needs_input", "error"):
        _notify_macos(st["name"], (bubble or st.get("bubble") or "").strip() or ("입력 대기" if status == "needs_input" else "오류"))


def _notify_macos(name: str, text: str):
    """company.yaml server.notify_macos 가 켜져 있으면 질문·오류를 macOS 알림으로 (브라우저가 가려져 있을 때용. 서버는 로컬 전용이라 이 사용자에게만 뜬다)."""
    if not settings.NOTIFY_MACOS or not shutil.which("osascript"):
        return
    body = text.replace('"', "'").replace("\\", "")[:120]
    title = f"Pixaude Office · {name}".replace('"', "'")
    try:
        subprocess.Popen(["osascript", "-e", f'display notification "{body}" with title "{title}"'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        pass


def log(iid: str, channel: str, text: str, peer: str = "") -> Message:
    st = EMPLOYEES.get(iid) or {}
    m = Message.objects.create(employee=iid, channel=channel, text=text, peer=peer, session_id=st.get("session_id", ""))
    broadcast("message", m.as_dict())
    return m


def resolve(iid: str, payload: dict, allow_cwd: bool = True) -> str | None:
    """훅 → 인스턴스. 헤더(X-Office-Employee)가 기본. 없으면 같은 cwd 인스턴스가 하나뿐일 때만 cwd 로 (allow_cwd)."""
    ensure()
    if iid and (iid in EMPLOYEES or tmux.window_exists(iid)):  # 살아 있는 창일 때만 헤더를 믿는다 (옛 이름으로 도는 프로세스 대비)
        st = _ensure_instance(iid)
        if st:
            return iid
    cwd = payload.get("cwd") if allow_cwd else ""
    if cwd:
        cwd = os.path.realpath(os.path.expanduser(cwd))
        cands = [i for i, st in EMPLOYEES.items() if os.path.realpath(st["cwd"]) == cwd and st["status"] != "away"]
        if len(cands) == 1:
            return cands[0]
    return None


# ---------------- 상태줄 (컨텍스트 %, 비용, 구독 사용률) ----------------

def update_rate_limits(p: dict) -> bool:
    """상태줄 JSON의 rate_limits 만 반영 (어느 세션에서 왔든 계정 전체 값)."""
    global RATE_LIMITS
    rl = p.get("rate_limits")
    if not isinstance(rl, dict) or not rl:
        return False
    new = {k: v for k, v in rl.items() if isinstance(v, dict)}
    new["ts"] = _now()
    changed = {k: v for k, v in new.items() if k != "ts"} != {k: v for k, v in RATE_LIMITS.items() if k != "ts"}
    RATE_LIMITS = new
    _write_json(".ratelimits.json", new)

    if changed:
        broadcast("usage", {"employees": {}, "totals": {}, "rate_limits": RATE_LIMITS, "partial": True})
    return changed


def handle_statusline(iid: str, p: dict):
    cw = p.get("context_window") or {}
    cost = p.get("cost") or {}
    model = (p.get("model") or {}).get("display_name") or (p.get("model") or {}).get("id") or ""
    pct = cw.get("used_percentage")
    live = {
        "ctx_pct": round(pct, 1) if isinstance(pct, (int, float)) else None,
        "ctx_in": cw.get("total_input_tokens"), "ctx_size": cw.get("context_window_size"),
        "cost": cost.get("total_cost_usd"), "duration_ms": cost.get("total_duration_ms"),
        "lines_added": cost.get("total_lines_added"), "lines_removed": cost.get("total_lines_removed"),
        "model": model, "ts": _now(),
    }
    # 2026-10 상태줄 필드: effort.level(화면 긁기보다 정확) · fast_mode · pr(gh 폴링 대체) · worktree.* · version · session_name
    effort = (p.get("effort") or {}).get("level") or ""
    fast = bool(p.get("fast_mode"))
    pr_raw = p.get("pr") or {}
    pr = {"number": pr_raw.get("number"), "url": pr_raw.get("url", ""), "review_state": pr_raw.get("review_state", ""), "src": "statusline"} if pr_raw.get("number") else None
    wt_raw = p.get("worktree") or {}
    wt = {k: wt_raw.get(k, "") for k in ("name", "path", "branch", "original_branch")} if wt_raw.get("path") else {}
    lines = {"added": live["lines_added"] or 0, "removed": live["lines_removed"] or 0}
    update_rate_limits(p)
    with _lock:
        st = EMPLOYEES[iid]
        prev = st.get("live") or {}
        st["live"] = live
        if p.get("session_id"):
            st["session_id"] = p["session_id"]
        if p.get("transcript_path"):
            st["transcript_path"] = p["transcript_path"]
        if live["ctx_pct"] is not None:
            st["ctx"] = {"ctx": live["ctx_in"] or 0, "window": live["ctx_size"] or 0, "pct": live["ctx_pct"], "model": model}
        elif cw.get("current_usage") is None:
            st["ctx"] = {}
        extra_changed = (effort and effort != st.get("effort")) or fast != st.get("fast") or wt != st.get("worktree") or (p.get("version") or "") != st.get("version") \
            or (pr is not None and pr != st.get("pr")) or lines != st.get("lines")
        if effort:
            st["effort"] = effort
        st["fast"] = fast
        st["thinking"] = bool((p.get("thinking") or {}).get("enabled"))
        st["worktree"] = wt
        st["version"] = p.get("version") or ""
        st["lines"] = lines
        if pr is not None:
            st["pr"] = pr
        if p.get("session_name") and p["session_name"] != st.get("session_name"):
            st["session_name"] = p["session_name"]
    if p.get("session_id"):
        _remember_session(iid, p["session_id"])
    if prev.get("ctx_pct") != live["ctx_pct"] or prev.get("cost") != live["cost"] or prev.get("model") != model or extra_changed:
        broadcast("live", {"id": iid, "live": live, "ctx": st["ctx"], "rate_limits": None,
                           "effort": st["effort"], "fast": st["fast"], "worktree": st["worktree"], "version": st["version"], "lines": st["lines"], "pr": st["pr"]})
    _check_ctx_warn(iid)


def _check_ctx_warn(iid: str):
    st = EMPLOYEES[iid]
    pct = (st.get("ctx") or {}).get("pct") or 0
    level = max([lv for lv in CTX_WARN_LEVELS if pct >= lv], default=0)
    if level and level > st["ctx_warned"]:
        with _lock:
            st["ctx_warned"] = level
        msg = f"컨텍스트 {pct}% 사용 중" + (" — /compact 또는 /clear 를 권합니다" if level >= 85 else "")
        log(iid, "system", msg)
        broadcast("question", {"id": iid, "kind": "context", "summary": msg})


# ---------------- 훅 처리 ----------------

def _tool_summary(name: str, inp: dict) -> str:
    inp = inp or {}
    if name in ("Edit", "Write", "Read", "MultiEdit", "NotebookEdit"):
        return f"{name} {str(inp.get('file_path', '')).rsplit('/', 1)[-1]}"
    if name == "Bash":
        return f"$ {str(inp.get('command', ''))[:50]}"
    if name in ("Grep", "Glob"):
        return f"{name} {str(inp.get('pattern', ''))[:40]}"
    if name in ("WebSearch", "WebFetch"):
        return f"{name} {str(inp.get('query') or inp.get('url', ''))[:40]}"
    if name == "Agent":
        return f"서브에이전트: {str(inp.get('description', ''))[:40]}"
    if name == "SendMessage":
        return f"→ {inp.get('to', '?')} 메시지"
    return name


def handle_hook(event: str, iid: str, p: dict):
    if event == "StatusLine":
        return handle_statusline(iid, p)
    with _lock:
        st = EMPLOYEES[iid]
        st["last_hook"] = _now()
        if p.get("session_id"):
            st["session_id"] = p["session_id"]
        if p.get("transcript_path"):
            st["transcript_path"] = p["transcript_path"]
    if p.get("session_id"):
        _remember_session(iid, p["session_id"])

    if event == "SessionStart":
        if p.get("source") in ("clear", "startup"):
            with _lock:
                _reset_ctx(st)
                st["tasks"] = {"total": 0, "done": 0}
            broadcast("live", {"id": iid, "live": {}, "ctx": {}, "rate_limits": None})
        set_status(iid, "idle", "")
        log(iid, "system", f"{st['name']} 출근 ({p.get('source', 'startup')})")
        _drain_queue(iid)

    elif event == "SessionEnd":
        set_status(iid, "away", "")
        log(iid, "system", f"{st['name']} 퇴근 ({p.get('reason', '')})")

    elif event == "UserPromptSubmit":
        prompt = p.get("prompt", "") or ""
        with _lock:
            st["turns"] += 1
            st["activity"] = []
            st["last_prompt"] = prompt
            sent = st["sent"]
            norm = prompt.replace("\r\n", "\n").replace("\n", " ⏎ ").strip()
            source = "ceo" if (sent and sent[-1].replace("\n", " ⏎ ").strip() == norm) else "terminal"
            if source == "ceo" and sent:
                sent.pop()
        peer = _peer_from_prompt(iid, prompt)
        if peer:  # 다른 세션이 보낸 메시지를 받은 쪽 → 회의실로
            _join_meeting(peer, iid, prompt)
        if st["meeting"]:
            set_status(iid, "meeting", "답하는 중…")
        else:
            set_status(iid, "working", "생각 중…")
        if source == "terminal" and not peer:
            log(iid, "order", prompt, peer="terminal")

    elif event == "PreToolUse":
        name = p.get("tool_name", "")
        summary = _tool_summary(name, p.get("tool_input") or {})
        with _lock:
            st["activity"].append(summary)
            st["activity"] = st["activity"][-8:]
        if name == "SendMessage":
            _on_whisper(iid, p.get("tool_input") or {})
        else:
            set_status(iid, "meeting" if st["meeting"] else "working", summary)
        broadcast("employee.activity", {"id": iid, "tool": name, "summary": summary})

    elif event == "PermissionRequest":
        name = p.get("tool_name", "")
        summary = _tool_summary(name, p.get("tool_input") or {})
        with _lock:
            st["pending"] = {"kind": "permission", "tool": name, "summary": summary}
        _note(iid, f"허용? {summary}")
        set_status(iid, "needs_input", f"허용? {summary}")
        log(iid, "question", f"권한 요청: {summary}")
        broadcast("question", {"id": iid, "kind": "permission", "tool": name, "summary": summary})

    elif event == "Notification":
        ntype = p.get("notification_type", "")
        msg = p.get("message", "") or ""
        if ntype in ("permission_prompt", "elicitation_dialog", "agent_needs_input"):
            with _lock:
                if not st["pending"]:
                    st["pending"] = {"kind": ntype, "summary": msg}
            _note(iid, msg or "입력 필요")
            set_status(iid, "needs_input", msg[:40] or "입력 필요")
            if ntype != "permission_prompt":
                log(iid, "question", msg)
            broadcast("question", {"id": iid, "kind": ntype, "summary": msg})
        elif ntype == "idle_prompt" and st["status"] == "working":
            set_status(iid, "idle", "")

    elif event == "Stop":
        text = (p.get("last_assistant_message") or "").strip()
        with _lock:
            st["pending"] = None
            st["subagents"] = []
            was_meeting = st["meeting"]
        if text:
            _note(iid, text)
            cwd = effective_cwd(st)
            Report.objects.create(employee=iid, summary=text, session_id=st["session_id"],
                                  meta={"diff": repo.diff_stat(cwd), "lines": st.get("lines") or {}, "cwd": cwd})
            with _lock:
                st["unread"] = Report.objects.filter(employee=iid, read_at__isnull=True).count()
            m = log(iid, "report" if not was_meeting else "reply", text)
            broadcast("report", {"id": iid, "text": text, "message_id": m.id, "unread": st["unread"]})
        if was_meeting:
            set_status(iid, "meeting", text[:40] if text else "")
        else:
            set_status(iid, "done" if text else "idle", "!" if text else "")
        _drain_queue(iid)
        _maybe_end_meetings()

    elif event == "StopFailure":
        err = p.get("error", "unknown")
        detail = (p.get("error_details") or p.get("last_assistant_message") or "")[:200]
        label = {"rate_limit": "요청 한도 초과", "overloaded": "서버 과부하", "max_output_tokens": "출력 토큰 한도",
                 "authentication_failed": "인증 실패", "billing_error": "결제 문제", "invalid_request": "잘못된 요청",
                 "server_error": "서버 오류"}.get(err, err)
        with _lock:
            st["error"] = f"{label}: {detail}" if detail else label
            st["pending"] = {"kind": "login", "url": "", "summary": "로그인 필요"} if err in ("authentication_failed", "oauth_org_not_allowed") else None
        _note(iid, f"⚠ {st['error']}")
        if err in ("authentication_failed", "oauth_org_not_allowed"):
            set_status(iid, "needs_input", "🔑 로그인 필요")
            log(iid, "question", "인증이 만료되었습니다. 대화 모달에서 '로그인 시작'을 누르세요.")
            broadcast("question", {"id": iid, "kind": "login", "summary": "인증 만료", "url": ""})
            return
        set_status(iid, "error", f"⚠ {label}")
        log(iid, "system", f"응답 실패 ({label}) {detail}")
        broadcast("question", {"id": iid, "kind": "error", "summary": st["error"]})

    elif event == "PreCompact":
        trig = "수동" if p.get("trigger") == "manual" else "자동"
        with _lock:
            st["pantry"] = _now()   # 압축하는 동안 탕비실에서 커피 한 잔
        broadcast("pantry.visit", {"id": iid})
        set_status(iid, "working", f"☕ 커피 한 잔 (컨텍스트 정리 중 · {trig})")
        log(iid, "system", f"컨텍스트 압축 시작 ({trig}) — 탕비실로")

    elif event == "PostCompact":
        summary = (p.get("compact_summary") or "").strip()
        log(iid, "system", "컨텍스트 압축 완료" + (f": {summary[:120]}" if summary else ""))
        with _lock:
            st["ctx_warned"] = 0
            st["pantry"] = 0.0
        broadcast("pantry.done", {"id": iid})
        set_status(iid, st["status"], "재충전 완료")

    elif event == "SubagentStart":
        aid = p.get("agent_id") or p.get("session_id") or str(_now())
        atype = p.get("agent_type") or p.get("subagent_type") or "agent"
        if atype == "fork":   # 2.1.302 부터 fork 서브에이전트가 기본이라 너무 자주 온다. 조수 연출에서 제외 (Stop 쪽도 같이)
            return
        with _lock:
            st["subagents"] = [a for a in st["subagents"] if a["id"] != aid][-8:] + [{"id": aid, "type": atype, "ts": _now()}]
        _emit_status(iid)
        broadcast("employee.activity", {"id": iid, "tool": "SubagentStart", "summary": f"부하 투입: {atype}"})

    elif event == "SubagentStop":
        aid = p.get("agent_id") or p.get("session_id")
        if (p.get("agent_type") or p.get("subagent_type")) == "fork":
            return
        with _lock:
            before = len(st["subagents"])
            st["subagents"] = [a for a in st["subagents"] if a["id"] != aid] if aid in {a["id"] for a in st["subagents"]} else st["subagents"][:-1]
        if len(st["subagents"]) != before:
            _emit_status(iid)

    elif event == "PostToolUseFailure":
        name = p.get("tool_name", "")
        err = str(p.get("error") or p.get("error_message") or "")[:120]
        with _lock:
            st["bubble"] = f"⚠ {_tool_summary(name, p.get('tool_input') or {})}"
        log(iid, "system", f"도구 실패 {name}: {err}" if err else f"도구 실패 {name}")
        _emit_status(iid)

    elif event == "PermissionDenied":
        log(iid, "system", f"자동 거부: {_tool_summary(p.get('tool_name', ''), p.get('tool_input') or {})}")

    elif event == "TaskCreated":
        with _lock:
            t = st["tasks"] = dict(st.get("tasks") or {"total": 0, "done": 0})
            t["total"] = t.get("total", 0) + 1
        _emit_status(iid)

    elif event == "TaskCompleted":
        with _lock:
            t = st["tasks"] = dict(st.get("tasks") or {"total": 0, "done": 0})
            t["done"] = min(t.get("done", 0) + 1, t.get("total", 0) or t.get("done", 0) + 1)
            t["total"] = max(t["total"], t["done"])
        _emit_status(iid)

    elif event == "PostModelSwitch":
        to = p.get("to_model") or ""
        if to:
            with _lock:
                st["model"] = to
                st["live"] = {**(st.get("live") or {}), "model": to}
                if st.get("ctx"):
                    st["ctx"]["model"] = to
            log(iid, "system", f"모델 전환 → {to}")
            _emit_status(iid)

    elif event == "ConfigChange":
        src = p.get("source") or ""
        if src in ("project_settings", "local_settings", "user_settings", "skills"):
            with _lock:
                st["mcp_stale"] = True
            log(iid, "system", f"설정 변경 감지 ({src}) — 재기동하면 전부 반영")
            _emit_status(iid)

    elif event == "Elicitation":
        server = p.get("server_name") or p.get("mcp_server") or "MCP"
        msg = (p.get("message") or "")[:60]
        with _lock:
            st["pending"] = {"kind": "elicitation", "summary": msg or f"{server} 입력 요청"}
        _note(iid, f"{server} 입력 요청" + (f": {msg}" if msg else ""))
        set_status(iid, "needs_input", f"{server} 입력 요청")
        log(iid, "question", f"MCP {server} 가 입력을 요청합니다" + (f": {msg}" if msg else ""))
        broadcast("question", {"id": iid, "kind": "elicitation", "summary": f"{server} 입력 요청"})

    elif event == "ElicitationResult":
        if st["status"] == "needs_input" and (st.get("pending") or {}).get("kind") == "elicitation":
            with _lock:
                st["pending"] = None
            set_status(iid, "working", "")


# ---------------- 대표 → 직원 ----------------

def _with_attachments(text: str, attachments: list[str] | None) -> str:
    """붙인 파일 경로를 지시문에 덧붙인다. CLI에서 경로를 적어 주면 Read 로 여는 것과 같은 방식."""
    paths = [p for p in (attachments or []) if p]
    if not paths:
        return text
    listed = "\n".join(f"- {p}" for p in paths)
    return f"{text}\n\n[첨부 파일 {len(paths)}개 — Read 도구로 열어서 내용을 보고 답해줘]\n{listed}"


def say(iid: str, text: str, mode: str = "auto", attachments: list[str] | None = None) -> dict:
    """요약 탭/빠른 입력에서 온 글. 화면이 빈 입력줄일 때만 타이핑하고, 작업 중·대화상자 중이면 메모 큐에 넣어 턴이 끝난 뒤 전달한다.
    즉시 끼어들기(Esc)·선택지 답변·권한 응답은 터미널 탭에서 직접 한다 (글자 타이핑은 대화상자에 들어가면 엉뚱한 곳에 꽂히므로)."""
    text = _with_attachments(text, attachments)
    with _lock:
        st = EMPLOYEES[iid]
        status = st["status"]
    if status in ("away", "starting"):
        return {"ok": False, "error": "아직 출근 전입니다."}
    if status == "needs_input":
        return {"ok": False, "error": "입력을 기다리는 중입니다. 터미널 탭에서 직접 답하세요", "needs_terminal": True}
    if status == "error":
        with _lock:
            st["error"] = ""
    busy = status in ("working", "meeting") or not tmux.is_idle_prompt(iid)
    if busy or mode == "queue":
        with _lock:
            st["queue"].append(text)
        log(iid, "system", f"메모 보관 (턴 종료 후 전달): {text[:60]}")
        _emit_status(iid)   # queue_n 갱신 + 스냅샷 저장
        return {"ok": True, "queued": True}
    if text.startswith("/"):
        # CLI 슬래시 명령(/compact, /model, /clear, /help …)을 그대로 타이핑. 보고 턴이 없을 수 있으니 상태는 유지
        with _lock:
            st["sent"] = (st["sent"] + [text])[-5:]
        ok = tmux.send_text(iid, text)
        log(iid, "system", f"명령 {text}")
        if text.split()[0] == "/clear":
            with _lock:
                _reset_ctx(st)
                st["tasks"] = {"total": 0, "done": 0}
            _emit_status(iid)
            broadcast("live", {"id": iid, "live": {}, "ctx": {}, "rate_limits": None})
        return {"ok": ok, "command": True}
    with _lock:
        st["sent"] = (st["sent"] + [text])[-5:]
    ok = tmux.send_text(iid, text)
    log(iid, "order", text)
    if ok:
        set_status(iid, "working", "지시 수신")
    return {"ok": ok}


def _drain_queue(iid: str):
    with _lock:
        st = EMPLOYEES[iid]
        if not st["queue"]:
            return
    if not tmux.is_idle_prompt(iid):   # 대화상자·후속 작업 중이면 다음 기회(tick)에
        return
    text = st["queue"][0]
    if tmux.send_text(iid, text):
        with _lock:
            st["queue"].pop(0)
            st["sent"] = (st["sent"] + [text])[-5:]
        log(iid, "order", text, peer="queue")
        set_status(iid, "working", "메모 전달")


def set_model(iid: str, model: str) -> dict:
    ok = tmux.send_text(iid, f"/model {model}") if model else False
    with _lock:
        EMPLOYEES[iid]["model"] = model
    log(iid, "system", f"모델 변경 → {model or '(기본)'}")
    _emit_status(iid)
    return {"ok": ok}


MODE_CYCLE_MAX = 6


def set_permission(iid: str, permission: str) -> dict:
    """권한 모드를 세션 안에서 바로 변경: Shift+Tab 순환을 화면에서 읽으며 목표 모드까지 돌린다."""
    st = EMPLOYEES[iid]
    if st["status"] in ("working", "meeting", "starting", "away"):
        return {"ok": False, "error": "작업 중에는 모드를 바꿀 수 없습니다."}
    target = permission or "default"
    cur = tmux.read_mode(iid)
    tries = 0
    while cur != target and tries < MODE_CYCLE_MAX:
        tmux.send_key(iid, "BTab")
        time.sleep(0.7)
        cur = tmux.read_mode(iid)
        tries += 1
    with _lock:
        st["mode_actual"] = cur
        st["permission"] = cur if cur else permission
    ok = cur == target
    log(iid, "system", f"권한 모드 → {cur or '?'}" + ("" if ok else f" (목표 {target} 는 이 세션 순환에 없음)"))
    _emit_status(iid)
    return {"ok": ok, "mode": cur, "error": None if ok else f"'{target}' 모드는 이 세션에서 선택할 수 없습니다 (현재 {cur or '?'})."}


def set_effort(iid: str, level: str) -> dict:
    st = EMPLOYEES[iid]
    if level not in ("low", "medium", "high", "xhigh", "max"):
        return {"ok": False, "error": "effort 는 low/medium/high/xhigh/max"}
    if st["status"] in ("working", "meeting", "starting", "away"):
        return {"ok": False, "error": "작업 중에는 effort 를 바꿀 수 없습니다."}
    tmux.send_key(iid, "Escape")
    tmux.send_text(iid, f"/effort {level}")
    cur = ""
    confirmed = False
    for _ in range(12):   # 최대 ~6초: 확인 다이얼로그가 뜨면 Enter, 상태줄이 바뀌면 종료
        time.sleep(0.5)
        pane = tmux.capture(iid, 20)
        if not confirmed and "Change effort level" in pane:
            tmux.send_key(iid, "Enter")   # 캐시 재생성 확인
            confirmed = True
            continue
        cur = tmux.read_effort(iid)
        if cur == level:
            break
    with _lock:
        st["effort"] = cur
    log(iid, "system", f"effort → {cur or level}")
    _emit_status(iid)
    return {"ok": cur == level, "effort": cur}


def _launch(iid: str, respawn: bool) -> dict:
    st = EMPLOYEES[iid]
    emp = _launch_dict(st)
    if emp.get("worktree_on") and not os.path.isdir(os.path.join(emp["cwd_abs"], ".git")):
        log(iid, "system", "작업실이 git 레포가 아니라 worktree 없이 출근")
        with _lock:
            st["worktree_on"] = False
        emp["worktree_on"] = False
    hooks_path = str(hooks.ensure(settings.OFFICE_HOME, settings.OFFICE_PORT, sandbox=bool(emp.get("sandbox"))))
    sid = st.get("session_id") or _read_sessions().get(iid, "")
    resume = sid if sid and transcript.by_session(emp["cwd_abs"], sid) else ""
    cmd = tmux.build_launch_cmd(emp, hooks_path, resume=resume)
    env = tmux.launch_env(emp, settings.OFFICE_PORT)
    set_status(iid, "starting", "")
    log(iid, "system", ("재기동: " if respawn else "출근: ") + cmd)
    ok = tmux.respawn(iid, emp["cwd_abs"], cmd, env) if respawn and tmux.window_exists(iid) else tmux.new_window(iid, emp["cwd_abs"], cmd, env)
    if ok:
        threading.Thread(target=tmux.accept_trust_prompt, args=(iid,), daemon=True).start()
    else:
        set_status(iid, "away", "")
    return {"ok": ok, "cmd": cmd, "id": iid}


def spawn(tid: str, resume_sid: str = "") -> dict:
    """출근: 템플릿으로 새 인스턴스(다음 번호) 생성. resume_sid 를 주면 그 세션을, 아니면 그 번호가 예전에 쓴 세션을 --resume."""
    ensure()
    if tid not in TEMPLATES:
        return {"ok": False, "error": f"unknown template {tid}"}
    if resume_sid:
        for iid, st in EMPLOYEES.items():
            if st["session_id"] == resume_sid and st["status"] != "away":
                return {"ok": True, "already": True, "id": iid}
    with _lock:
        no = _next_no(tid)
        iid = f"{tid}_{no}"
        if tmux.window_exists(iid):  # 죽은 창이 남아 있으면 정리
            tmux.kill_window(iid)
        EMPLOYEES[iid] = _blank(TEMPLATES[tid], iid, no)
        EMPLOYEES[iid]["session_id"] = resume_sid or _read_sessions().get(iid, "")
        EMPLOYEES[iid]["unread"] = Report.objects.filter(employee=iid, read_at__isnull=True).count()
    broadcast("employee.add", _public(EMPLOYEES[iid]))
    return _launch(iid, respawn=False)


def spawn_many(teams: list[str]) -> list[dict]:
    """런처 `office up`: teams 가 비면 active 팀 중 출근자가 없는 팀마다 1명(_1), 주어지면 그 팀마다 1명 더."""
    ensure()
    if not teams:
        running = {st["template"] for st in EMPLOYEES.values() if st["status"] != "away"}
        teams = [t["id"] for t in TEMPLATES.values() if t.get("active", True) and t["id"] not in running]
    return [{"team": tid, **spawn(tid)} for tid in teams]


def restart(iid: str) -> dict:
    ensure()
    if iid not in EMPLOYEES:
        return {"ok": False, "error": "unknown instance"}
    with _lock:
        EMPLOYEES[iid]["mcp_stale"] = False
    return _launch(iid, respawn=True)


def stop_session(iid: str, force: bool = False) -> dict:
    """퇴근: /exit 로 닫고 창 제거. 자리도 사라진다. 세션 기록은 남아 같은 번호로 출근하면 이어진다.
    worktree 직원은 미커밋·미푸시가 있으면 먼저 확인을 요구한다 (CLI 의 정리 질문을 오피스의 /exit 자동 입력이 지나칠 수 있어서)."""
    ensure()
    if iid not in EMPLOYEES:
        return {"ok": False, "error": "unknown instance"}
    st = EMPLOYEES[iid]
    wt = st.get("worktree") or {}
    if wt.get("path") and not force and os.path.isdir(wt["path"]):
        d = repo.git_dirty(wt["path"])
        if d["uncommitted"] or d["unpushed"]:
            return {"ok": False, "confirm": True, "dirty": d, "worktree": wt,
                    "error": f"worktree 에 미커밋 {d['uncommitted']}개 · 미푸시 커밋 {d['unpushed']}개가 있습니다"}
    ok = tmux.kill_window(iid)
    _remove_instance(iid, "퇴근 (오피스에서 종료)")
    return {"ok": ok}


def _remove_instance(iid: str, reason: str):
    with _lock:
        st = EMPLOYEES.pop(iid, None)
    if not st:
        return
    log(iid, "system", f"{st['name']} {reason}")
    broadcast("employee.remove", {"id": iid})
    _forget(iid)


def resume_here(iid: str, session_id: str) -> dict:
    """같은 자리에서 다른 대화로 전환 (/resume <id>). 작업 중이면 거부."""
    st = EMPLOYEES.get(iid)
    if not st:
        return {"ok": False, "error": "unknown instance"}
    if st["status"] in ("working", "meeting", "starting", "away"):
        return {"ok": False, "error": "작업 중에는 전환할 수 없습니다. 끝나거나 멈춘 뒤 다시 시도하세요."}
    for oid, ost in EMPLOYEES.items():
        if oid != iid and ost["session_id"] == session_id and ost["status"] != "away":
            return {"ok": False, "error": f"그 세션은 이미 {ost['name']} 자리에서 열려 있습니다."}
    tmux.send_key(iid, "Escape")
    ok = tmux.send_text(iid, f"/resume {session_id}")
    with _lock:
        _reset_ctx(st)
    log(iid, "system", f"세션 전환 → {session_id[:8]}")
    set_status(iid, "starting", "전환 중…")
    return {"ok": ok}


def mark_read(iid: str):
    Report.objects.filter(employee=iid, read_at__isnull=True).update(read_at=timezone.now())
    with _lock:
        st = EMPLOYEES.get(iid)
        if not st:
            return
        st["unread"] = 0
        if st["status"] == "done":
            st["status"] = "idle"
            st["bubble"] = ""
    _emit_status(iid)
    broadcast("unread", {"total": Report.objects.filter(read_at__isnull=True).count()})


# ---------------- 회의 (세션 간 메시지 관찰) ----------------

_PEER_RE = re.compile(r"(?:from|From|FROM)\s*[:\s\"'\[<]*([A-Za-z0-9][A-Za-z0-9._-]*_\d+)")


def _peer_from_prompt(iid: str, prompt: str) -> str | None:
    """다른 세션이 보낸 메시지로 시작된 턴이면 발신 인스턴스 id. 오피스 밖 세션이면 None."""
    head = prompt[:300]
    if "<" not in head and "message" not in head.lower() and "메시지" not in head:
        return None
    for m in _PEER_RE.finditer(head):
        cand = m.group(1)
        if cand in EMPLOYEES and cand != iid:
            return cand
    for eid in EMPLOYEES:
        if eid != iid and eid in head and ("message" in head.lower() or "메시지" in head):
            return eid
    return None


def _join_meeting(a: str, b: str, text: str):
    key = frozenset({a, b})
    with _lock:
        m = MEETINGS.get(key)
        new = m is None
        if new:
            m = MEETINGS[key] = {"id": next(_MEETING_ID), "last": _now()}
        else:
            m["last"] = _now()
        for eid in key:
            EMPLOYEES[eid]["meeting"] = m["id"]
    if new:
        broadcast("meeting.start", {"id": m["id"], "participants": sorted(key)})
        log(a, "system", f"{EMPLOYEES[a]['name']} ↔ {EMPLOYEES[b]['name']} 회의 시작")
    return m


def _on_whisper(sender: str, tool_input: dict):
    to = str(tool_input.get("to", "") or "")
    text = str(tool_input.get("message", "") or "")
    target_id = next((eid for eid in EMPLOYEES if eid == to), None) or next((eid for eid in EMPLOYEES if to.startswith(eid)), None)
    log(sender, "whisper", text, peer=target_id or to)
    if not target_id or target_id == sender:
        return
    key = frozenset({sender, target_id})
    m = _join_meeting(sender, target_id, text)
    for eid in key:
        set_status(eid, "meeting", text[:40] if eid == sender else EMPLOYEES[eid]["bubble"])
    broadcast("meeting.turn", {"id": m["id"], "from": sender, "to": target_id, "text": text})


def _maybe_end_meetings():
    now = _now()
    ended = []
    with _lock:
        for key, m in list(MEETINGS.items()):
            if now - m["last"] < MEETING_IDLE_SEC:
                continue
            if now - m["last"] < MEETING_IDLE_SEC * 4 and any(not tmux.is_idle_prompt(e) for e in key if e in EMPLOYEES):
                continue  # 아직 누군가 답하는 중 (단, 2분이 지나면 무조건 종료)
            ended.append((key, m))
            del MEETINGS[key]
            for e in key:
                if e in EMPLOYEES:
                    EMPLOYEES[e]["meeting"] = None
    for key, m in ended:
        broadcast("meeting.end", {"id": m["id"], "participants": sorted(key)})
        for e in key:
            if e in EMPLOYEES and EMPLOYEES[e]["status"] == "meeting":
                set_status(e, "idle", "")


# ---------------- 주기 작업 ----------------

def tick():
    ensure()
    _maybe_end_meetings()
    wins = tmux.windows()
    for wname, info in wins.items():  # 터미널에서 직접 만든 office 창도 인스턴스로 편입
        if wname not in EMPLOYEES and not info["dead"]:
            st = _ensure_instance(wname)
            if st:
                _restore(wname, st)
                if st["status"] == "away":
                    st["status"] = "idle"
                broadcast("employee.add", _public(st))
    for iid, st in list(EMPLOYEES.items()):
        alive = iid in wins and not wins[iid]["dead"]
        if not alive and st["status"] not in ("away", "starting"):
            _remove_instance(iid, "세션 종료 감지")
            continue
        if alive and st["status"] == "away":
            set_status(iid, "idle", "")
        if st["status"] == "starting" and _now() - st["status_since"] > 40:
            if alive and screen.has_dialog(tmux.capture(iid, 30)):   # 재개 경고(2.1.304)·확인 질문이 떠서 못 올라온 것 → 손 들기
                with _lock:
                    st["pending"] = {"kind": "dialog", "summary": "시작 확인 필요"}
                _note(iid, "시작 중 확인 질문 — 터미널 탭에서 답하세요")
                set_status(iid, "needs_input", "시작 확인 필요")
                log(iid, "question", "시작 중 확인 질문이 떠 있습니다. 터미널 탭에서 답하세요.")
                broadcast("question", {"id": iid, "kind": "dialog", "summary": "시작 확인 필요"})
            else:
                set_status(iid, "idle" if alive else "away", "")
        if st.get("pantry") and _now() - st["pantry"] > 120:   # PostCompact 유실 대비
            with _lock:
                st["pantry"] = 0.0
            broadcast("pantry.done", {"id": iid})
        if not alive or st["status"] in ("away", "starting"):
            continue
        pane = tmux.capture(iid, 60)   # 화면은 tick 당 한 번만 읽고 screen.* 순수 함수로 판정
        if st["status"] == "working" and not st.get("pantry") and _now() - st["status_since"] > 20 and screen.is_idle(pane):
            _recover_finished(iid)   # 압축 중(pantry)에는 프롬프트가 비어 보여도 끝난 게 아님
        if _now() - st["status_since"] > 3:
            _check_login(iid, screen.detect_login(pane))
        if st["queue"] and st["status"] in ("idle", "done") and screen.is_idle(pane):
            _drain_queue(iid)   # 턴 종료 때 대화상자가 떠 있어 못 보낸 메모
        if st["status"] in ("idle", "done"):
            _check_update(iid, screen.has_pending_update(pane))
        if st["status"] == "needs_input" and (st.get("pending") or {}).get("kind") == "dialog" and screen.is_idle(pane):
            with _lock:
                st["pending"] = None
            set_status(iid, "idle", "")
        md = screen.read_mode(pane)
        ef = "" if (st.get("live") or {}).get("ts") else screen.read_effort(pane)   # 상태줄이 오면 effort.level 이 더 정확하므로 화면 값은 상태줄 없을 때만
        if (md and md != st.get("mode_actual")) or (ef and ef != st.get("effort")):
            with _lock:
                st["mode_actual"] = md or st["mode_actual"]
                st["effort"] = ef or st["effort"]
            _emit_status(iid)
    _refresh_usage()
    tmux.reap_views()

    broadcast("tick", {"attached": tmux.attached_clients(), "time": datetime.now().strftime("%H:%M"), "period": period_label(), "weather": weather_label(), "sky": weather_info()["sky"]})


def _check_update(iid: str, pending: bool):
    """상태줄에 'Restart to update' 가 보이면 표시하고, 5분 이상 유휴(메모 큐 없음)면 자동 재기동(--resume)해 적용."""
    st = EMPLOYEES[iid]
    if pending != bool(st.get("update_pending")):
        with _lock:
            st["update_pending"] = pending
        if pending:
            log(iid, "system", "Claude Code 업데이트 내려받음 → 유휴 5분 뒤 자동 재기동해 적용")
        _emit_status(iid)
    if not pending or st["queue"] or st["status"] == "done":
        return
    if _now() - st["status_since"] < UPDATE_RESTART_IDLE_SEC or _now() - _UPDATE_DONE.get(iid, 0) < 600:
        return
    # 2.1.304: 큰 컨텍스트를 오래 쉰 뒤 --resume 하면 5h 한도를 눈에 띄게 쓴다는 경고가 뜬다 → 그런 세션은 자동 재기동하지 않고 배지만 둔다
    if ((st.get("ctx") or {}).get("pct") or 0) >= 50 and _now() - (st.get("last_hook") or 0) > 3600:
        return
    _UPDATE_DONE[iid] = _now()
    log(iid, "system", "업데이트 적용을 위해 재기동 (--resume)")
    with _lock:
        st["update_pending"] = False
    threading.Thread(target=lambda: _launch(iid, respawn=True), daemon=True).start()


def _check_login(iid: str, info: dict | None):
    """터미널에 로그인 안내가 떠 있으면 손 들기(🔑). 로그인 URL 이 보이면 같이 전달."""
    st = EMPLOYEES[iid]
    if not info:
        if (st.get("pending") or {}).get("kind") == "login":
            with _lock:
                st["pending"] = None
            set_status(iid, "idle", "")
            log(iid, "system", "로그인 완료 감지")
        return
    pend = st.get("pending") or {}
    if pend.get("kind") == "login" and pend.get("url") == info["url"]:
        return
    with _lock:
        st["pending"] = {"kind": "login", "url": info["url"], "summary": "로그인 필요"}
    set_status(iid, "needs_input", "🔑 로그인 필요")
    if pend.get("kind") != "login":
        log(iid, "question", "로그인이 필요합니다. 대화 모달에서 '로그인 시작'을 누르세요.")
    broadcast("question", {"id": iid, "kind": "login", "summary": "로그인 필요", "url": info["url"]})


def start_login(iid: str) -> dict:
    """/login 을 타이핑하고 잠시 뒤 화면에서 URL 을 긁어 온다."""
    tmux.send_key(iid, "Escape")
    ok = tmux.send_text(iid, "/login")
    log(iid, "system", "/login 요청")
    time.sleep(2.5)
    info = tmux.detect_login(iid) or {}
    url = info.get("url", "")
    with _lock:
        EMPLOYEES[iid]["pending"] = {"kind": "login", "url": url, "summary": "로그인 필요"}
    set_status(iid, "needs_input", "🔑 로그인 필요")
    broadcast("question", {"id": iid, "kind": "login", "summary": "브라우저에서 로그인하세요", "url": url})
    return {"ok": ok, "url": url}


def _recover_finished(iid: str):
    """Stop 훅이 안 온 경우(Esc 로 끊음·유실): 화면이 유휴면 트랜스크립트의 마지막 응답을 보고로 올리고 done 으로."""
    st = EMPLOYEES[iid]
    path = transcript_path(st)
    text = ""
    if path and path.exists():
        items = transcript.history(path, limit=3)
        for it in reversed(items):
            if it["role"] == "assistant":
                text = "\n".join(ln for ln in it["text"].split("\n") if not ln.startswith("▸")).strip()
                break
    with _lock:
        st["pending"] = None
    if text and text != st.get("_last_recovered"):
        with _lock:
            st["_last_recovered"] = text
        Report.objects.create(employee=iid, summary=text, session_id=st["session_id"])
        with _lock:
            st["unread"] = Report.objects.filter(employee=iid, read_at__isnull=True).count()
        m = log(iid, "report", text)
        broadcast("report", {"id": iid, "text": text, "message_id": m.id, "unread": st["unread"]})
        set_status(iid, "done", "!")
    else:
        set_status(iid, "idle", "")
    log(iid, "system", "응답 종료 감지 (훅 유실 복구)")
    _drain_queue(iid)


def _refresh_usage():
    try:
        usage.SCANNER.scan()
    except Exception as e:  # noqa: BLE001
        print("usage scan error", e)
    per = {}
    for iid, st in list(EMPLOYEES.items()):
        if st["status"] in ("away", "starting"):
            continue
        path = transcript_path(st)
        live = st.get("live") or {}
        if live.get("ctx_pct") is not None and _now() - live.get("ts", 0) < 600:
            ctx = {"ctx": live["ctx_in"] or 0, "window": live["ctx_size"] or 0, "pct": live["ctx_pct"], "model": live.get("model", "")}
        elif live:
            ctx = {}  # 상태줄은 오는데 컨텍스트가 없다 = 새 컨텍스트
        else:
            ctx = usage.context_of(path) if path else {}
        sess = usage.SCANNER.per_file(str(path)) if path else {"out": 0, "calls": 0, "cost": 0.0}
        if live.get("cost") is not None:
            sess["cost"] = round(live["cost"], 2)
        with _lock:
            st["ctx"] = ctx
            st["session_out"] = sess["out"]
            st["session_cost"] = sess["cost"]
        cwd = effective_cwd(st)
        branch = (st.get("worktree") or {}).get("branch") or repo.git_branch(cwd)
        ports = repo.listening_ports(st["cwd"])   # worktree 는 레포 하위라 prefix 매칭으로 같이 잡힌다
        pr = st["pr"] if (st.get("pr") or {}).get("src") == "statusline" else repo.pr_info(cwd, branch)   # 상태줄 pr 이 오면 gh 폴링 생략
        with _lock:
            st["branch"] = branch
            st["pr"], st["ports"] = pr, ports
        per[iid] = {"ctx": ctx, "session": sess, "model": live.get("model") or ctx.get("model") or st["model"], "branch": branch, "pr": pr, "ports": ports, "last_note": st.get("last_note", "")}
        _check_ctx_warn(iid)
    broadcast("usage", {"employees": per, "totals": usage.SCANNER.totals(), "rate_limits": RATE_LIMITS})


_WEATHER: dict = {"ts": 0.0, "label": "", "sky": {}}
# WMO 날씨 코드 → (이모지 낮, 이모지 밤, 종류). 종류는 맵 창문 연출용: clear / cloud / fog / rain / snow / storm
_WMO = [(0, "☀", "🌙", "clear"), (1, "🌤", "🌙", "clear"), (2, "⛅", "☁", "cloud"), (3, "☁", "☁", "cloud"), (48, "🌫", "🌫", "fog"),
        (57, "🌦", "🌧", "rain"), (67, "🌧", "🌧", "rain"), (77, "❄", "❄", "snow"), (82, "🌧", "🌧", "rain"), (86, "❄", "❄", "snow"), (99, "⛈", "⛈", "storm")]


def _wmo(code: int, is_day: bool) -> tuple[str, str]:
    for upto, day, night, kind in _WMO:
        if code <= upto:
            return (day if is_day else night), kind
    return "☁", "cloud"


def weather_label() -> str:
    return weather_info()["label"]


def weather_info() -> dict:
    """헤더·창문용 날씨. server.weather_cmd 가 있으면 그 출력(label), 없으면 Open-Meteo(성남시 기본)를 10분마다. 인터넷이 없으면 비운다."""
    now = _now()
    if now - _WEATHER["ts"] < 600:
        return _WEATHER
    _WEATHER["ts"] = now
    cmd = settings.WEATHER_CMD   # company.yaml server.weather_cmd — 표준출력이 {"label": "☀ 13°C"} 이거나 그냥 한 줄 텍스트
    if cmd:
        try:
            out = subprocess.run(["bash", "-lc", os.path.expanduser(cmd)], capture_output=True, text=True, timeout=6).stdout.strip()
            if out:
                try:
                    _WEATHER["label"] = (json.loads(out).get("label") or "").strip()
                except ValueError:
                    _WEATHER["label"] = out.splitlines()[0][:20]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        return _WEATHER
    url = (f"https://api.open-meteo.com/v1/forecast?latitude={settings.WEATHER_LAT}&longitude={settings.WEATHER_LON}"
           "&current=temperature_2m,weather_code,is_day&timezone=auto")
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            cur = json.load(r).get("current") or {}
        code, is_day, temp = int(cur.get("weather_code") or 0), bool(cur.get("is_day", 1)), cur.get("temperature_2m")
        emoji, kind = _wmo(code, is_day)
        _WEATHER["label"] = f"{emoji} {round(temp)}°C" if temp is not None else emoji
        _WEATHER["sky"] = {"kind": kind, "code": code, "is_day": is_day, "temp": temp}
    except Exception:   # 오프라인·응답 이상: 이전 값 유지 (없으면 빈 채로)
        pass
    return _WEATHER
    _WEATHER["ts"] = now
    cmd = settings.WEATHER_CMD   # company.yaml server.weather_cmd — 표준출력이 {"label": "☀ 13°C"} 이거나 그냥 한 줄 텍스트
    if not cmd:
        return ""
    try:
        out = subprocess.run(["bash", "-lc", os.path.expanduser(cmd)], capture_output=True, text=True, timeout=6).stdout.strip()
        if out:
            try:
                _WEATHER["label"] = (json.loads(out).get("label") or "").strip()
            except ValueError:
                _WEATHER["label"] = out.splitlines()[0][:20]
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return _WEATHER["label"]


def period_label(dt: datetime | None = None) -> str:
    h = (dt or datetime.now()).hour
    if h < 9:
        return "이른 아침"
    if h < 12:
        return "오전"
    if h < 13:
        return "점심"
    if h < 18:
        return "오후"
    if h < 21:
        return "저녁"
    return "야근"
