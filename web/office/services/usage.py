import json
import time
from datetime import datetime
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"

# $/1M tokens: (input, output, cache_read, cache_write)
PRICING = [
    ("fable", (10, 50, 1.0, 12.5)), ("mythos", (10, 50, 1.0, 12.5)),
    ("opus-5-5", (4, 20, 0.4, 5)), ("opus-5", (5, 25, 0.5, 6.25)), ("opus-4", (5, 25, 0.5, 6.25)),
    ("sonnet-5", (2, 10, 0.2, 2.5)), ("sonnet-4", (3, 15, 0.3, 3.75)),
    ("haiku-5", (0.1, 0.5, 0.01, 0.125)), ("haiku-4", (1, 5, 0.1, 1.25)),
]


def price_for(model: str):
    m = (model or "").lower()
    for key, p in PRICING:
        if key in m:
            return p
    return (5, 25, 0.5, 6.25)


def context_window(model: str) -> int:
    m = (model or "").lower()
    if "haiku-4" in m or "3-5" in m or "3-7" in m:
        return 200_000
    return 1_000_000


def cost_usd(model: str, inp: int, out: int, cread: int, cwrite: int) -> float:
    pi, po, pr, pw = price_for(model)
    return (inp * pi + out * po + cread * pr + cwrite * pw) / 1_000_000


def _usage_of(o: dict):
    msg = o.get("message") or {}
    u = msg.get("usage")
    if not u or o.get("type") != "assistant":
        return None
    return {
        "id": msg.get("id") or o.get("uuid") or "",   # 한 API 호출이 content block 마다 한 줄씩 기록돼 usage 가 2~3번 반복된다 → id 로 한 번만 센다
        "model": msg.get("model", ""),
        "in": int(u.get("input_tokens") or 0), "out": int(u.get("output_tokens") or 0),
        "cread": int(u.get("cache_read_input_tokens") or 0), "cwrite": int(u.get("cache_creation_input_tokens") or 0),
        "ts": o.get("timestamp", ""),
    }


# ---------- 세션 컨텍스트 ----------

def context_of(path: Path | None) -> dict:
    """마지막 assistant usage → 현재 컨텍스트 크기. 파일 끝에서 역방향으로 조금만 읽는다."""
    if not path or not path.exists():
        return {}
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(max(0, size - 400_000))
            chunk = f.read().decode("utf-8", errors="replace")
    except OSError:
        return {}
    last = None
    for line in reversed(chunk.splitlines()):
        if '"usage"' not in line or '"assistant"' not in line:
            continue
        try:
            u = _usage_of(json.loads(line))
        except json.JSONDecodeError:
            continue
        if u:
            last = u
            break
    if not last:
        return {}
    ctx = last["in"] + last["cread"] + last["cwrite"]
    win = context_window(last["model"])
    return {"ctx": ctx, "window": win, "pct": round(ctx * 100 / win, 1), "model": last["model"], "ts": last["ts"]}


# ---------- 전체 사용량 (증분) ----------

class UsageScanner:
    """파일별 오프셋을 기억해 새로 추가된 줄만 파싱. 메시지별 (ts, model, tokens)를 최근 24h만 보관."""

    def __init__(self):
        self.offsets: dict[str, int] = {}
        self.events: list[tuple[float, str, int, int, int, int, str]] = []  # (epoch, model, in, out, cread, cwrite, file)
        self.last_scan = 0.0
        self.seen: set[str] = set()   # 이미 센 message id

    def scan(self, min_interval: float = 10.0) -> None:
        now = time.time()
        if now - self.last_scan < min_interval:
            return
        self.last_scan = now
        cutoff = now - 36 * 3600
        if not PROJECTS.is_dir():
            return
        for d in PROJECTS.iterdir():
            if not d.is_dir():
                continue
            for p in d.glob("*.jsonl"):
                try:
                    st = p.stat()
                except OSError:
                    continue
                if st.st_mtime < cutoff:
                    continue
                key = str(p)
                off = self.offsets.get(key, -1)
                if off == -1:
                    # 첫 스캔: 파일 전체를 읽되 오래된 파일은 건너뜀(위 cutoff)
                    off = 0
                if st.st_size <= off:
                    continue
                try:
                    with open(p, "rb") as f:
                        f.seek(off)
                        data = f.read()
                except OSError:
                    continue
                # 마지막 줄이 미완성일 수 있으니 개행까지 만 소비
                nl = data.rfind(b"\n")
                if nl == -1:
                    continue
                consumed = data[: nl + 1]
                self.offsets[key] = off + len(consumed)
                for line in consumed.decode("utf-8", errors="replace").splitlines():
                    if '"usage"' not in line:
                        continue
                    try:
                        u = _usage_of(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                    if not u or not u["ts"]:
                        continue
                    if u["id"] in self.seen:
                        continue
                    self.seen.add(u["id"])
                    try:
                        ep = datetime.fromisoformat(u["ts"].replace("Z", "+00:00")).timestamp()
                    except ValueError:
                        continue
                    self.events.append((ep, u["model"], u["in"], u["out"], u["cread"], u["cwrite"], key))
        self.events = [e for e in self.events if e[0] >= cutoff]
        if len(self.seen) > 200_000:   # 36시간 밖 id 는 더 안 들어오므로 가끔 비워도 된다
            self.seen = set()

    def totals(self) -> dict:
        now = time.time()
        local = datetime.now().astimezone()
        day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        five_h = now - 5 * 3600

        def agg(events):
            out = {"in": 0, "out": 0, "cread": 0, "cwrite": 0, "cost": 0.0, "calls": 0, "by_model": {}}
            for _, model, i, o, cr, cw, _f in events:
                out["in"] += i
                out["out"] += o
                out["cread"] += cr
                out["cwrite"] += cw
                out["calls"] += 1
                out["cost"] += cost_usd(model, i, o, cr, cw)
                bm = out["by_model"].setdefault((model or "?").replace("claude-", ""), {"out": 0, "calls": 0})
                bm["out"] += o
                bm["calls"] += 1
            out["total"] = out["in"] + out["out"] + out["cread"] + out["cwrite"]
            out["cost"] = round(out["cost"], 2)
            return out

        today = agg([e for e in self.events if e[0] >= day_start])
        window = agg([e for e in self.events if e[0] >= five_h])
        return {"today": today, "window5h": window, "scanned_at": now}

    def per_file(self, path: str) -> dict:
        evs = [e for e in self.events if e[6] == path]
        out = sum(e[3] for e in evs)
        cost = sum(cost_usd(e[1], e[2], e[3], e[4], e[5]) for e in evs)
        return {"out": out, "calls": len(evs), "cost": round(cost, 2)}



SCANNER = UsageScanner()

