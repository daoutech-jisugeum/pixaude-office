"""화면 긁기 패턴을 한 곳에 모은다.

tmux `capture-pane` 로 받은 Claude Code 화면 텍스트만 입력으로 받는 순수 함수들이다.
Claude Code 가 UI 문구를 바꾸면 여기만 고치면 되고, tests/fixtures/*.txt (실제 화면 캡처) 로
`manage.py test office` 가 깨짐을 바로 알려준다.

알려진 화면 (2026-10 기준):
- 유휴:   `❯ ` 입력줄 + 상태줄. 직전 턴은 `✻ Worked for 10s · done 오전 11:23`.
- 작업 중: `✳ Newspapering… (4s · ↓ 14 tokens)` 같은 스피너 줄(글리프는 ✻ ✳ ✶ ✽ ✢ · 등 회전),
          도구 실행 중엔 `⎿  Running… (3s)`, 훅 실행 중엔 `(running PreToolUse hooks… 2/3 …)`.
          입력줄 `❯` 은 작업 중에도 그대로 보인다 → 프롬프트 유무만으로 유휴를 판정하면 안 된다.
- 예전 버전은 `esc to interrupt` 문구가 있었다. 호환을 위해 같이 본다.
"""
import re

# 스피너 줄: 줄 머리에 기호 하나 + 공백 + 단어 + … (예: "✳ Newspapering… (4s · ↓ 14 tokens)")
SPINNER_RE = re.compile(r"^\s*[^\w\s❯⏺⎿]\s+\S+…")
BUSY_MARKERS = ("esc to interrupt", "running Stop hooks", "⎿  Running…", "to interrupt)")
TURN_DONE_RE = re.compile(r"^\s*[^\w\s]\s+\S+ for \S+ · done\b")   # "✻ Worked for 10s · done 오전 11:23"
PROMPT_PREFIX = "❯"

LOGIN_RE = re.compile(r"(log ?in|로그인|not authenticated|authentication|oauth|/login|paste.*code|sign in)", re.I)
URL_RE = re.compile(r"https://[^\s\"'<>]+")
LOGIN_HOSTS = ("anthropic.com", "claude.ai", "claude.com")

MODE_LABELS = [("bypass permissions on", "bypassPermissions"), ("accept edits on", "acceptEdits"), ("plan mode on", "plan"),
               ("auto mode on", "auto"), ("manual mode on", "default")]
EFFORT_RE = re.compile(r"\[[^\]]*?\b(low|medium|high|xhigh|max)\]")
TRUST_PROMPT = "trust this folder"
UPDATE_PENDING = "Restart to update"   # "✔ Update installed · Restart to update" (상태줄 오른쪽 아래)


def _tail(text: str, n: int) -> list[str]:
    lines = [ln.rstrip() for ln in text.splitlines()]
    return [ln for ln in lines if ln.strip()][-n:]


def has_prompt(text: str) -> bool:
    return any(ln.strip().startswith(PROMPT_PREFIX) for ln in _tail(text, 12))


def is_busy(text: str) -> bool:
    """스피너/도구 실행/훅 실행 줄이 하나라도 보이면 작업 중."""
    tail = _tail(text, 14)
    for ln in tail:
        if any(m in ln for m in BUSY_MARKERS):
            return True
        if SPINNER_RE.match(ln) and not TURN_DONE_RE.match(ln):
            return True
    return False


def is_idle(text: str) -> bool:
    """빈 입력줄(❯)이 있고 작업 표시가 없으면 응답이 끝난 상태."""
    return has_prompt(text) and not is_busy(text)


def detect_login(text: str) -> dict | None:
    """로그인 안내가 떠 있으면 {'url', 'line'}; 평소 화면이면 None."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    body = "\n".join(lines[-25:])
    if PROMPT_PREFIX in body and not any(k in body.lower() for k in ("log in", "login", "sign in", "paste")):
        return None
    hit = [ln for ln in lines[-25:] if LOGIN_RE.search(ln) and "hooks" not in ln and "Context" not in ln]
    if not hit:
        return None
    urls = [u for u in URL_RE.findall(body) if any(h in u for h in LOGIN_HOSTS)]
    return {"url": urls[-1] if urls else "", "line": hit[-1][:120]}


def read_mode(text: str) -> str:
    tail = "\n".join(_tail(text, 12)).lower()
    for label, mode in MODE_LABELS:
        if label in tail:
            return mode
    return ""


def read_effort(text: str) -> str:
    m = EFFORT_RE.findall("\n".join(_tail(text, 12)))
    return m[-1] if m else ""


def has_trust_prompt(text: str) -> bool:
    return TRUST_PROMPT in text


DIALOG_RE = re.compile(r"^\s*(?:❯\s*)?[1-9]\.\s+\S")   # "❯ 1. Yes, resume" / "  2. Start fresh" 같은 번호 선택지


def has_dialog(text: str) -> bool:
    """번호 선택지 대화상자가 떠 있고 빈 입력줄이 아니면 True (시작 중 재개 경고·확인 질문 등). trust 프롬프트는 has_trust_prompt 가 먼저."""
    tail = _tail(text, 20)
    if sum(1 for ln in tail if DIALOG_RE.match(ln)) < 2:
        return False
    return not any(ln.strip() == PROMPT_PREFIX for ln in tail)   # 빈 입력줄(❯ 만)이 보이면 대화상자가 아니라 유휴


def has_pending_update(text: str) -> bool:
    """새 버전이 내려받아졌고 재기동해야 적용되는 상태 (상태줄 근처 마지막 14줄에서)."""
    return any(UPDATE_PENDING in ln for ln in _tail(text, 14))
