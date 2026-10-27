"""Claude Code 트랜스크립트(jsonl) 파서. 포맷이 바뀌면 이 파일만 고친다."""
import json
from pathlib import Path

from . import company



def by_session(cwd: str, session_id: str) -> Path | None:
    p = company.transcript_dir(cwd) / f"{session_id}.jsonl"
    return p if p.exists() else None


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for block in content:
            if not isinstance(block, dict):
                continue
            t = block.get("type")
            if t == "text":
                out.append(block.get("text", ""))
            elif t == "tool_use":
                name = block.get("name", "tool")
                inp = block.get("input") or {}
                hint = inp.get("file_path") or inp.get("command") or inp.get("pattern") or inp.get("description") or ""
                out.append(f"▸ {name} {str(hint)[:80]}".rstrip())
            elif t == "tool_result":
                continue
        return "\n".join(x for x in out if x)
    return ""


def _is_noise(text: str) -> bool:
    t = text.lstrip()
    return (not t) or t.startswith("<local-command") or t.startswith("<system-reminder") \
        or t.startswith("<command-name") or t.startswith("[Request interrupted")


def history(path: Path, limit: int = 60) -> list[dict]:
    """[{role: user|assistant, text, ts}] 최근 limit개. 도구 호출은 assistant 텍스트에 ▸ 줄로 접힘."""
    if not path or not path.exists():
        return []
    items: list[dict] = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = o.get("type")
            if t not in ("user", "assistant") or o.get("isMeta") or o.get("isSidechain"):
                continue
            msg = o.get("message") or {}
            text = _text_of(msg.get("content"))
            if _is_noise(text):
                continue
            # 도구 결과만 있는 user 턴은 건너뜀
            if t == "user" and isinstance(msg.get("content"), list) and all(
                isinstance(b, dict) and b.get("type") == "tool_result" for b in msg["content"]
            ):
                continue
            items.append({"role": t, "text": text, "ts": o.get("timestamp", "")})
    # 연속된 assistant 조각은 합친다
    merged: list[dict] = []
    for it in items:
        if merged and merged[-1]["role"] == "assistant" and it["role"] == "assistant":
            merged[-1]["text"] += "\n" + it["text"]
        else:
            merged.append(dict(it))
    return merged[-limit:]


def list_sessions(cwd: str, limit: int = 30) -> list[dict]:
    """프로젝트 폴더의 지난 세션들: id, 제목(ai-title 또는 첫 질문), 마지막 수정, 메시지 수."""
    import os
    from datetime import datetime

    d = company.transcript_dir(cwd)
    if not d.is_dir():
        return []
    out = []
    files = sorted(d.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    for p in files:
        title, first, n_user, model = "", "", 0, ""
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if '"ai-title"' in line:
                        try:
                            title = json.loads(line).get("aiTitle", "") or title
                        except json.JSONDecodeError:
                            pass
                        continue
                    if '"type":"user"' in line or '"type": "user"' in line:
                        try:
                            o = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if o.get("isMeta") or o.get("isSidechain"):
                            continue
                        text = _text_of((o.get("message") or {}).get("content"))
                        if _is_noise(text) or text.lstrip().startswith("<"):
                            continue
                        n_user += 1
                        if not first:
                            first = text.strip().split("\n")[0][:80]
                    elif not model and '"type":"assistant"' in line.replace(" ", ""):
                        try:
                            model = (json.loads(line).get("message") or {}).get("model", "")
                        except json.JSONDecodeError:
                            pass
        except OSError:
            continue
        if n_user == 0 and not title:
            continue
        out.append({
            "session_id": p.stem, "title": (title or first or "").strip() or "(제목 없음)", "first": first, "messages": n_user,
            "mtime": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="minutes"), "size_kb": os.path.getsize(p) // 1024,
            "model": model.replace("claude-", ""),
        })
    return out
