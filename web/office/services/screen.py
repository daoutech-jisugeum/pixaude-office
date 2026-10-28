import re

# 스피너 줄: 줄 머리에 기호 하나 + 공백 + 단어 + … (예: "✳ Newspapering… (4s · ↓ 14 tokens)")
SPINNER_RE = re.compile(r"^\s*[^\w\s❯⏺⎿]\s+\S+…")
BUSY_MARKERS = ("esc to interrupt", "running Stop hooks", "⎿  Running…", "to interrupt)")
TURN_DONE_RE = re.compile(r"^\s*[^\w\s]\s+\S+ for \S+ · done\b")   # "✻ Worked for 10s · done 오전 11:23"
PROMPT_PREFIX = "❯"

LOGIN_RE = re.compile(r"(not authenticated|please (run )?/?log ?in|invalid api key|oauth token (has )?expired|token (has )?expired|authentication_error|paste code here|browser didn\'t open|select login method|log in to claude|sign in to)", re.I)
LOGIN_IGNORE = ("expires in", "login successful", "login interrupted", "로그인 완료")   # 만료 예고 배너·결과 줄은 로그인 요청이 아니다
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
    """로그인 화면(인증 안 됨·코드 붙여넣기·로그인 방법 선택)이 떠 있으면 {'url', 'line'}; 평소 화면이면 None.
    대화 내용의 '로그인' 단어, 만료 예고 배너, /login 결과 줄(성공·중단)은 로그인 요청으로 보지 않는다."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    tail = lines[-15:]
    hit = [ln for ln in tail if LOGIN_RE.search(ln) and not any(k in ln.lower() for k in LOGIN_IGNORE)]
    if not hit:
        return None
    body = "\n".join(tail)
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
