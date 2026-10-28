import json
import shutil
import subprocess
import threading
import time

_BRANCH: dict[str, tuple[float, str]] = {}


def git_branch(cwd: str) -> str:
    now = time.time()
    hit = _BRANCH.get(cwd)
    if hit and now - hit[0] < 30:
        return hit[1]
    try:
        out = subprocess.run(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True, timeout=2).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        out = ""
    if out == "HEAD":  # 커밋 없는 레포 / detached
        out = ""
    _BRANCH[cwd] = (now, out)
    return out


_PR: dict[str, dict] = {}   # cwd → {"ts", "branch", "pr", "busy"}


def pr_info(cwd: str, branch: str) -> dict:
    """현재 브랜치의 PR (gh pr view). 네트워크라 백그라운드 스레드에서 2분마다 갱신, 호출자는 캐시만 받는다."""
    if not branch or not shutil.which("gh"):
        return {}
    now = time.time()
    c = _PR.get(cwd)
    same = bool(c and c["branch"] == branch)
    if same and (now - c["ts"] < 120 or c.get("busy")):
        return c["pr"]
    if c and c.get("busy"):
        return c["pr"] if same else {}
    _PR[cwd] = {"ts": now, "branch": branch, "pr": c["pr"] if same else {}, "busy": True}

    def work():
        pr = {}
        try:
            r = subprocess.run(["gh", "pr", "view", "--json", "number,state,isDraft,url,title"], cwd=cwd, capture_output=True, text=True, timeout=8)
            if r.returncode == 0:
                pr = json.loads(r.stdout)
        except Exception:  # noqa: BLE001
            pr = {}
        _PR[cwd] = {"ts": time.time(), "branch": branch, "pr": pr, "busy": False}

    threading.Thread(target=work, daemon=True).start()
    return _PR[cwd]["pr"]


def diff_stat(cwd: str, top: int = 5) -> dict:
    """보고 카드용 변경 요약: 작업 트리의 미커밋 변경(HEAD 대비) 파일별 +/- 와 총계, untracked 수. git 이 아니거나 실패하면 {}."""
    try:
        r = subprocess.run(["git", "-C", cwd, "diff", "--numstat", "HEAD"], capture_output=True, text=True, timeout=3)
        if r.returncode != 0:
            return {}
        files = []
        for ln in r.stdout.splitlines():
            parts = ln.split("\t")
            if len(parts) == 3:
                a, d, f = parts
                files.append({"file": f, "added": int(a) if a.isdigit() else 0, "removed": int(d) if d.isdigit() else 0})
        st = subprocess.run(["git", "-C", cwd, "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True, timeout=3).stdout
        untracked = sum(1 for ln in st.splitlines() if ln.startswith("??"))
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return {}
    if not files and not untracked:
        return {}
    files.sort(key=lambda x: -(x["added"] + x["removed"]))
    return {"files": files[:top], "n_files": len(files), "added": sum(x["added"] for x in files), "removed": sum(x["removed"] for x in files), "untracked": untracked}


def git_dirty(cwd: str) -> dict:
    """퇴근 전 worktree 점검: 미커밋 변경 수와 미푸시 커밋 수 (업스트림 없으면 로컬 커밋 전부)."""
    out = {"uncommitted": 0, "unpushed": 0}
    try:
        st = subprocess.run(["git", "-C", cwd, "status", "--porcelain"], capture_output=True, text=True, timeout=3).stdout
        out["uncommitted"] = sum(1 for ln in st.splitlines() if ln.strip())
        r = subprocess.run(["git", "-C", cwd, "rev-list", "--count", "@{upstream}..HEAD"], capture_output=True, text=True, timeout=3)
        if r.returncode != 0:   # 업스트림 없음 → 기본 브랜치에 없는 커밋 수
            base = subprocess.run(["git", "-C", cwd, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], capture_output=True, text=True, timeout=3).stdout.strip() or "origin/HEAD"
            r = subprocess.run(["git", "-C", cwd, "rev-list", "--count", f"{base}..HEAD"], capture_output=True, text=True, timeout=3)
        out["unpushed"] = int(r.stdout.strip() or 0) if r.returncode == 0 else 0
    except (OSError, subprocess.TimeoutExpired, ValueError):
        pass
    return out


_PORTS: dict = {"ts": 0.0, "by_cwd": {}}


def _lsof_pairs(args: list[str]) -> list[tuple[str, str]]:
    """lsof -F 출력에서 (pid, n값) 쌍."""
    out = subprocess.run(["lsof", *args, "-Fpn"], capture_output=True, text=True, timeout=4).stdout
    pid, pairs = "", []
    for ln in out.splitlines():
        if ln.startswith("p"):
            pid = ln[1:]
        elif ln.startswith("n") and pid:
            pairs.append((pid, ln[1:]))
    return pairs


def listening_ports(cwd: str) -> list[int]:
    """이 작업실(cwd 아래)에서 돌고 있는 프로세스가 LISTEN 중인 TCP 포트 (30초 캐시)."""
    now = time.time()
    if now - _PORTS["ts"] > 30:
        _PORTS["ts"] = now
        try:
            by_pid: dict[str, set] = {}
            for pid, n in _lsof_pairs(["-nP", "-iTCP", "-sTCP:LISTEN"]):
                port = n.rsplit(":", 1)[-1]
                if port.isdigit():
                    by_pid.setdefault(pid, set()).add(int(port))
            by_cwd: dict[str, set] = {}
            if by_pid:
                for pid, d in _lsof_pairs(["-a", "-d", "cwd", "-p", ",".join(by_pid)]):
                    if pid in by_pid:
                        by_cwd.setdefault(d, set()).update(by_pid[pid])
            _PORTS["by_cwd"] = by_cwd
        except Exception:  # noqa: BLE001
            pass
    res: set = set()
    for d, ports in _PORTS["by_cwd"].items():
        if d == cwd or d.startswith(cwd.rstrip("/") + "/"):
            res |= ports
    return sorted(res)
