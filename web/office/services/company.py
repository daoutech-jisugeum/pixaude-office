import os
import re
import subprocess
from pathlib import Path

import yaml
from django.conf import settings

ROOM_FOR_UNASSIGNED = "사무실"
WORKTREE_MODES = ("off", "extra", "always")   # 같은 팀 직원의 git worktree 격리: 끄기 / 두 번째 직원부터 / 항상


def _expand(p: str) -> str:
    return os.path.expanduser(p or "")


def load() -> dict:
    with open(settings.COMPANY_YAML, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    data.setdefault("employees", [])
    emps = data["employees"]
    for e in emps:
        e.setdefault("active", True)
        e.setdefault("room", ROOM_FOR_UNASSIGNED)
        e["cwd_abs"] = _expand(e.get("cwd", ""))
        e["model"] = e.get("model") or ""
        e["permission"] = e.get("permission") or ""
        e["pyenv"] = e.get("pyenv") or ""
        e["args"] = e.get("args") or ""
        e["worktree"] = e.get("worktree") if e.get("worktree") in WORKTREE_MODES else "extra"
        e["sandbox"] = bool(e.get("sandbox", False))
    for e in emps:
        ad = e.get("add_dirs")
        if ad == "auto":
            e["add_dirs_abs"] = [x["cwd_abs"] for x in emps if x["active"] and x["id"] != e["id"] and os.path.isdir(x["cwd_abs"])]
        elif isinstance(ad, list):
            e["add_dirs_abs"] = [_expand(x) for x in ad if os.path.isdir(_expand(x))]
        else:
            e["add_dirs_abs"] = []
    return data


def employees() -> list[dict]:
    return load()["employees"]


def get(emp_id: str) -> dict | None:
    for e in employees():
        if e["id"] == emp_id:
            return e
    return None


ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _read_raw() -> tuple[str, dict]:
    """(맨 위 주석 블록, 데이터). 저장할 때 주석 블록은 그대로 두고 데이터만 다시 쓴다."""
    path = Path(settings.COMPANY_YAML)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    head = []
    for ln in text.splitlines():
        if ln.startswith("#") or not ln.strip():
            head.append(ln)
        else:
            break
    raw = yaml.safe_load(text) or {}
    raw.setdefault("employees", [])
    return ("\n".join(head).rstrip() + "\n\n") if head else "", raw


def _write_raw(head: str, raw: dict) -> None:
    emps = raw.pop("employees", [])
    body = yaml.safe_dump(raw, allow_unicode=True, sort_keys=False, width=200) if raw else ""
    out = [body.rstrip(), "", "employees:"]
    for e in emps:   # 직원마다 빈 줄로 띄우고 2칸 들여쓰기 (원래 파일 모양)
        item = yaml.safe_dump([e], allow_unicode=True, sort_keys=False, width=200).rstrip().splitlines()
        out.append("")
        out.extend("  " + ln for ln in item)
    raw["employees"] = emps
    Path(settings.COMPANY_YAML).write_text(head + "\n".join(out).lstrip("\n") + "\n", encoding="utf-8")


def validate(fields: dict) -> dict:
    """UI 에서 온 값 정리. 잘못되면 ValueError."""
    tid = (fields.get("id") or "").strip()
    if not ID_RE.match(tid):
        raise ValueError("id 는 소문자·숫자·하이픈만 (예: my-api)")
    if re.search(r"_\d+$", tid):
        raise ValueError("id 끝에 _숫자 는 인스턴스 번호와 겹쳐 쓸 수 없습니다")
    name = (fields.get("name") or "").strip()
    if not name:
        raise ValueError("이름이 비었습니다")
    cwd = (fields.get("cwd") or "").strip()
    if not cwd or not os.path.isdir(_expand(cwd)):
        raise ValueError(f"작업실 폴더가 없습니다: {cwd}")
    home = os.path.expanduser("~")
    if cwd.startswith(home):
        cwd = "~" + cwd[len(home):]
    out = {"id": tid, "name": name, "cwd": cwd, "room": (fields.get("room") or "").strip() or ROOM_FOR_UNASSIGNED}
    for k in ("pyenv", "args", "model", "permission", "alias", "memo"):
        v = (fields.get(k) or "").strip()
        if v:
            out[k] = v
    if out.get("permission") not in (None, "default", "acceptEdits", "plan", "bypassPermissions", "auto"):
        raise ValueError("권한 모드 값이 이상합니다")
    ad = fields.get("add_dirs")
    if ad == "auto":
        out["add_dirs"] = "auto"
    elif isinstance(ad, str) and ad.strip():
        out["add_dirs"] = [x.strip() for x in ad.replace("\n", ",").split(",") if x.strip()]
    elif isinstance(ad, list) and ad:
        out["add_dirs"] = ad
    out["active"] = bool(fields.get("active", True))
    wt = fields.get("worktree") or "extra"
    if wt not in WORKTREE_MODES:
        raise ValueError("worktree 값은 off / extra / always")
    if wt != "extra":
        out["worktree"] = wt
    if fields.get("sandbox"):
        out["sandbox"] = True
    return out


def save_employee(fields: dict) -> dict:
    """직원(템플릿) 추가 또는 수정. 같은 id 가 있으면 덮어쓴다. 반환: 저장된 항목."""
    head, raw = _read_raw()
    emps = raw["employees"]
    clean = validate(fields)
    for i, e in enumerate(emps):
        if e.get("id") == clean["id"]:
            emps[i] = clean
            break
    else:
        emps.append(clean)
    _write_raw(head, raw)
    return get(clean["id"])


def delete_employee(emp_id: str) -> bool:
    head, raw = _read_raw()
    before = len(raw["employees"])
    raw["employees"] = [e for e in raw["employees"] if e.get("id") != emp_id]
    if len(raw["employees"]) == before:
        return False
    _write_raw(head, raw)
    return True


def list_dirs(path: str) -> dict:
    """폴더 고르기용: path 아래 하위 폴더 (숨김 제외), git 레포 표시."""
    p = os.path.realpath(_expand(path or "~"))
    if not os.path.isdir(p):
        p = os.path.expanduser("~")
    items = []
    try:
        for n in sorted(os.listdir(p), key=str.lower):
            full = os.path.join(p, n)
            if n.startswith(".") or not os.path.isdir(full):
                continue
            items.append({"name": n, "path": full, "git": os.path.isdir(os.path.join(full, ".git"))})
    except OSError:
        pass
    return {"path": p, "home": os.path.expanduser("~"), "parent": os.path.dirname(p) if p != "/" else "", "git": os.path.isdir(os.path.join(p, ".git")), "items": items[:300]}


def encode_cwd(cwd: str) -> str:
    """~/.claude/projects/ 아래 디렉토리 이름 규칙: 영숫자 외 전부 '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", _expand(cwd))


def transcript_dir(cwd: str) -> Path:
    return Path.home() / ".claude" / "projects" / encode_cwd(cwd)


_ROOTS: dict[str, set[str]] = {}


def project_keys(cwd: str) -> set[str]:
    """Claude Code 가 local 설정·플러그인을 묶는 키 = 프로젝트 루트(git 최상위). cwd 가 레포 안 하위 폴더(planner/)면 루트도 포함. 캐시."""
    cwd = _expand(cwd)
    if cwd in _ROOTS:
        return _ROOTS[cwd]
    keys = {cwd, os.path.realpath(cwd)}
    try:
        top = subprocess.run(["git", "-C", cwd, "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=3).stdout.strip()
        if top:
            keys |= {top, os.path.realpath(top)}
    except (OSError, subprocess.TimeoutExpired):
        pass
    _ROOTS[cwd] = keys
    return keys
