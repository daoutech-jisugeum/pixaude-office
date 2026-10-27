import json
import re
import time
from pathlib import Path

from django.conf import settings
from django.http import HttpResponseBadRequest, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import state
from .auth import token_required
from .models import Report
from .services import company, mcp, skills, transcript

_STATIC_V = str(int(time.time()))   # 정적 파일 캐시 무효화용 버전 (서버 기동 시각)


def _json(data) -> JsonResponse:
    return JsonResponse(data, json_dumps_params={"ensure_ascii": False})


def _body(request) -> dict:
    try:
        return json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return {}


def index(request):
    # 토큰은 같은 머신의 브라우저에게만 보인다
    return render(request, "office/index.html", {"period": state.period_label(), "v": _STATIC_V, "token": settings.OFFICE_TOKEN})


@csrf_exempt
@require_POST
@token_required
def hook(request, event: str):
    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return HttpResponseBadRequest("bad json")
    header_iid = request.headers.get("X-Office-Employee", "")
    emp_id = state.resolve(header_iid, payload, allow_cwd=event != "StatusLine")   # 전역 상태줄은 오피스 밖 세션에서도 오므로 cwd 추정 금지
    if not emp_id:
        if event == "StatusLine":  # 오피스 밖 터미널 세션: 계정 전체 사용률만
            state.update_rate_limits(payload)
            return JsonResponse({"ok": True, "global": True})
        return JsonResponse({"ok": False, "ignored": True})
    try:
        state.handle_hook(event, emp_id, payload)
    except Exception as e:  # noqa: BLE001
        print(f"hook error {event} {emp_id}: {e}")
        return JsonResponse({"ok": False, "error": str(e)})
    return JsonResponse({"ok": True})


@require_GET
@token_required
def api_state(request):
    return _json(state.snapshot())


@csrf_exempt
@require_POST
@token_required
def api_up(request):
    """런처 `office up [tid...]`. teams 가 비면 active 팀 중 출근자가 없는 팀마다 1명, 주어지면 그 팀에 1명 더."""
    return _json({"items": state.spawn_many((_body(request).get("teams") or []))})


@csrf_exempt
@require_POST
@token_required
def api_restart(request, emp_id: str):
    """런처 `office restart <iid>`."""
    return _json(state.restart(emp_id))


@require_GET
@token_required
def api_history(request, emp_id: str):
    state.ensure()
    st = state.EMPLOYEES.get(emp_id)
    if not st:
        return JsonResponse({"items": []})
    path = state.transcript_path(st)   # 이 직원 세션의 파일만 (같은 레포의 다른 터미널 세션을 보여주지 않기 위해)
    items = transcript.history(path, limit=int(request.GET.get("limit", 60))) if path else []
    return _json({"items": items, "path": str(path or "")})


@require_GET
@token_required
def api_reports(request):
    qs = Report.objects.all()
    if request.GET.get("unread"):
        qs = qs.filter(read_at__isnull=True)
    return _json({"items": [r.as_dict() for r in qs[:100]]})


@require_GET
@token_required
def api_sessions(request, tid: str):
    state.ensure()
    tpl = state.TEMPLATES.get(tid)
    if not tpl:
        return JsonResponse({"items": []})
    items = transcript.list_sessions(tpl["cwd_abs"])
    running = {st["session_id"]: iid for iid, st in state.EMPLOYEES.items() if st["template"] == tid and st["status"] != "away"}
    for it in items:
        it["running"] = running.get(it["session_id"], "")
    return _json({"items": items})


_BUILTIN_CMDS = None


def _builtin_commands():
    global _BUILTIN_CMDS
    if _BUILTIN_CMDS is None:
        f = Path(settings.BASE_DIR) / "office" / "static" / "office" / "builtin-commands.json"
        try:
            items = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            items = []
        # 수확 당시의 프로젝트/사용자 스킬은 제외 (아래에서 인스턴스별로 다시 읽음)
        _BUILTIN_CMDS = [c for c in items if "(project)" not in c["desc"] and "(user)" not in c["desc"]]
    return _BUILTIN_CMDS


@require_GET
@token_required
def api_commands(request, emp_id: str):
    state.ensure()
    st = state.EMPLOYEES.get(emp_id)
    items = []
    if st:
        items += [{"name": x["name"], "desc": f"{x['desc']} (project)"} for x in skills.skill_commands(Path(st["cwd"]) / ".claude", "project")]
    items += [{"name": x["name"], "desc": f"{x['desc']} (user)"} for x in skills.skill_commands(Path.home() / ".claude", "user")]
    seen = {c["name"] for c in items}
    items += [c for c in _builtin_commands() if c["name"] not in seen]
    return _json({"items": items})


_UPLOAD_EXTS = ("png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "json", "csv")


@csrf_exempt
@require_POST
@token_required
def api_upload(request, emp_id: str):
    """대화창에 붙여 넣은 이미지 저장. multipart 'file' 또는 raw body(+ X-Filename). 경로를 돌려주면 지시문에 함께 보낸다."""
    state.ensure()
    if emp_id not in state.EMPLOYEES:
        return JsonResponse({"ok": False, "error": "unknown instance"})
    f = request.FILES.get("file")
    data = f.read() if f else request.body
    name = (f.name if f else request.headers.get("X-Filename", "image.png")) or "image.png"
    if not data or len(data) > 20 * 1024 * 1024:
        return JsonResponse({"ok": False, "error": "비어 있거나 20MB 초과"})
    stem, _, ext = name.rpartition(".")
    ext = ext.lower() if ext.lower() in _UPLOAD_EXTS else "png"
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", stem or name)[:40] or "image"
    d = Path(settings.UPLOAD_DIR) / emp_id
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{time.strftime('%Y%m%d-%H%M%S')}-{safe}.{ext}"
    path.write_bytes(data)
    return JsonResponse({"ok": True, "path": str(path), "name": path.name, "size": len(data)})


@require_GET
@token_required
def api_dirs(request):
    """팀 추가 폼의 폴더 고르기 (홈 디렉터리 아래만)."""
    home = Path.home().resolve()
    p = Path(request.GET.get("p") or "~").expanduser().resolve()
    if home != p and home not in p.parents:
        p = home
    return _json(company.list_dirs(str(p)))


@require_GET
@token_required
def api_mcp(request, tid: str):
    """팀의 MCP 목록 (설정 파일 즉시 + 캐시된 헬스. 헬스는 백그라운드로 갱신돼 mcp.list 이벤트로 옴)."""
    state.ensure()
    return _json(state.mcp_list(tid))


@require_GET
@token_required
def api_mcp_catalog(request):
    return _json({"items": mcp.CATALOG})


@require_GET
@token_required
def api_mcp_search(request):
    return _json({"items": mcp.registry_search(request.GET.get("q", ""))})


@require_GET
@token_required
def api_skills(request, tid: str):
    """팀이 쓸 수 있는 스킬·명령·플러그인 (읽기 전용)."""
    state.ensure()
    t = state.TEMPLATES.get(tid)
    if not t:
        return JsonResponse({"project": [], "user": [], "plugins": []})
    return _json(skills.inventory(t["cwd_abs"]))
