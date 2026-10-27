"""tmux 세션 'office' 제어. 직원 id = window 이름."""
import os
import shlex
import subprocess
import time

from django.conf import settings

from . import screen

SESSION = settings.TMUX_SESSION
LIVE_VIEWS: set[str] = set()   # 브라우저 터미널이 지금 붙어 있는 view_* 세션. reap_views 가 여기 없는 것을 정리한다.


def _run(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["tmux", *args], capture_output=True, text=True)


def target(emp_id: str) -> str:
    return f"{SESSION}:{emp_id}"


def session_exists() -> bool:
    return _run("has-session", "-t", SESSION).returncode == 0


def windows() -> dict[str, dict]:
    """{id: {"dead": bool}}"""
    if not session_exists():
        return {}
    res = {}
    for line in _run("list-windows", "-t", SESSION, "-F", "#W\t#{pane_dead}").stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 2:
            res[parts[0]] = {"dead": parts[1] == "1"}
    return res


def window_exists(emp_id: str) -> bool:
    return emp_id in windows()


def attached_clients() -> int:
    if not session_exists():
        return 0
    return len([ln for ln in _run("list-clients", "-t", SESSION).stdout.splitlines() if ln.strip()])


def send_text(emp_id: str, text: str) -> bool:
    """텍스트를 그대로 타이핑(-l)하고 Enter. 여러 줄은 한 줄로 합쳐 보낸다 (CLI 입력창은 Enter가 전송이므로)."""
    if not window_exists(emp_id):
        return False
    text = text.replace("\r\n", "\n").replace("\n", " ⏎ ")
    if _run("send-keys", "-t", target(emp_id), "-l", text).returncode != 0:
        return False
    _run("send-keys", "-t", target(emp_id), "Enter")
    return True


def send_key(emp_id: str, key: str) -> bool:
    """Escape, Enter, BTab, Down 같은 키 이름."""
    if not window_exists(emp_id):
        return False
    return _run("send-keys", "-t", target(emp_id), key).returncode == 0


def capture(emp_id: str, lines: int = 60) -> str:
    """마지막 lines 줄. 창이 Claude 화면보다 크면 아래쪽이 빈 줄이라 넉넉히 잡고 screen.py 가 빈 줄을 건너뛴다."""
    if not window_exists(emp_id):
        return ""
    return _run("capture-pane", "-p", "-t", target(emp_id), "-S", f"-{lines}").stdout


def is_idle_prompt(emp_id: str) -> bool:
    return screen.is_idle(capture(emp_id))


def detect_login(emp_id: str) -> dict | None:
    return screen.detect_login(capture(emp_id))


def read_mode(emp_id: str) -> str:
    return screen.read_mode(capture(emp_id))


def read_effort(emp_id: str) -> str:
    return screen.read_effort(capture(emp_id))


def _exit_claude(emp_id: str):
    _run("send-keys", "-t", target(emp_id), "Escape")
    _run("send-keys", "-t", target(emp_id), "-l", "/exit")
    _run("send-keys", "-t", target(emp_id), "Enter")


def _env_args(env: dict[str, str]) -> list[str]:
    return [a for k, v in env.items() for a in ("-e", f"{k}={v}")]


def respawn(emp_id: str, cwd: str, cmd: str, env: dict[str, str]) -> bool:
    if not window_exists(emp_id):
        return False
    _run("set-option", "-w", "-t", target(emp_id), "remain-on-exit", "on")
    _exit_claude(emp_id)
    time.sleep(2.0)
    return _run("respawn-window", "-k", "-t", target(emp_id), "-c", cwd, *_env_args(env), cmd).returncode == 0


def new_window(emp_id: str, cwd: str, cmd: str, env: dict[str, str]) -> bool:
    if session_exists():
        r = _run("new-window", "-d", "-t", SESSION, "-n", emp_id, "-c", cwd, *_env_args(env), cmd)
    else:
        r = _run("new-session", "-d", "-s", SESSION, "-n", emp_id, "-c", cwd, *_env_args(env), "-x", "200", "-y", "50", cmd)
        _run("set-environment", "-t", SESSION, "-u", "OFFICE_EMPLOYEE")
    _run("set-option", "-w", "-t", target(emp_id), "remain-on-exit", "on")   # /exit 해도 창이 남아야 respawn 할 수 있다
    return r.returncode == 0


def create_view(view: str, emp_id: str) -> bool:
    """브라우저 터미널용 그룹 세션. office 와 창을 공유하되 '현재 창'은 독립 → 다른 클라이언트의 창을 바꾸지 않는다."""
    if not window_exists(emp_id):
        return False
    if _run("new-session", "-d", "-t", SESSION, "-s", view).returncode != 0:
        return False
    _run("set-option", "-t", view, "status", "off")   # destroy-unattached 는 attach 전에 세션을 지워버려 쓰지 않음 → reap_views 로 정리
    _run("set-option", "-t", view, "mouse", "on")     # 휠 → tmux 스크롤백(copy mode). 끄면 Claude 전체화면에 방향키로 전달돼 위로 못 본다
    _run("select-window", "-t", f"{view}:{emp_id}")
    LIVE_VIEWS.add(view)
    return True


def kill_view(view: str) -> None:
    LIVE_VIEWS.discard(view)
    if view.startswith("view_"):
        _run("kill-session", "-t", view)


def reap_views(min_age: float = 60.0) -> None:
    """컨슈머가 더 이상 들고 있지 않은 view_* 세션 정리 (페이지 이탈로 소켓이 안 닫힌 경우, 서버 비정상 종료 잔재)."""
    now = time.time()
    for ln in _run("list-sessions", "-F", "#{session_name}\t#{session_created}").stdout.splitlines():
        parts = ln.split("\t")
        if len(parts) == 2 and parts[0].startswith("view_") and parts[0] not in LIVE_VIEWS and now - float(parts[1] or 0) > min_age:
            _run("kill-session", "-t", parts[0])


def kill_window(emp_id: str) -> bool:
    if not window_exists(emp_id):
        return False
    _exit_claude(emp_id)
    time.sleep(1.0)   # /exit 가 처리돼 SessionEnd 훅이 나갈 시간
    return _run("kill-window", "-t", target(emp_id)).returncode == 0


def accept_trust_prompt(emp_id: str, timeout: float = 10.0) -> None:
    """새 폴더 첫 실행 시 신뢰 확인 다이얼로그를 자동 수락 (company.yaml 에 등록한 폴더이므로). 백그라운드 스레드에서 호출."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(0.5)
        pane = capture(emp_id, 30)
        if screen.has_trust_prompt(pane):
            send_key(emp_id, "Down")
            time.sleep(0.2)
            send_key(emp_id, "Enter")
            return
        if screen.has_prompt(pane):
            return


def build_launch_cmd(emp: dict, hooks_path: str, resume: str = "") -> str:
    parts = ["claude", "--name", emp["id"], "--settings", hooks_path]
    if emp.get("args"):
        parts += shlex.split(emp["args"])
    if resume:
        parts += ["--resume", resume]
    if emp.get("worktree_on"):
        parts += ["--worktree", emp["id"]]   # CLI 가 .claude/worktrees/<id> 를 만들고 그리로 이동 (정리·WorktreeCreate 훅도 CLI 몫). --resume 과 같이 써도 된다
    if emp.get("model"):
        parts += ["--model", emp["model"]]
    if emp.get("permission"):
        parts += ["--permission-mode", emp["permission"]]
    for d in emp.get("add_dirs_abs") or []:
        parts += ["--add-dir", d]
    up = settings.UPLOAD_DIR / emp["id"]
    up.mkdir(parents=True, exist_ok=True)
    parts += ["--add-dir", str(up)]   # 오피스에서 이 직원에게 붙인 이미지만 Read 할 수 있게
    return " ".join(shlex.quote(p) for p in parts)


def launch_env(emp: dict, port: int) -> dict[str, str]:
    # CLAUDE_CODE_DISABLE_AGENT_VIEW: 사용자가 /config defaultToAgentsView 를 켰어도 오피스 창은 대화 세션으로 떠야 한다 (세션 env 로만, 전역 설정은 안 건드림)
    env = {"OFFICE_EMPLOYEE": emp["id"], "OFFICE_PORT": str(port), "CLAUDE_CODE_DISABLE_AGENT_VIEW": "1"}
    name = emp.get("pyenv") or ""
    vbin = os.path.expanduser(f"~/.pyenv/versions/{name}/bin")
    if name and os.path.isdir(vbin):
        env["PATH"] = f"{vbin}:{os.environ.get('PATH', '')}"
        env["PYENV_VERSION"] = name
        env["VIRTUAL_ENV"] = os.path.dirname(vbin)
    return env
