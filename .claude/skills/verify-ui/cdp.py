#!/usr/bin/env python3
"""헤드리스 Chrome CDP 헬퍼 (표준 라이브러리만).

  cdp.py [JS식 또는 .js 파일] [--shot out.png] [--url URL] [--keep] [--errors]
  --keep    이미 열린 오피스 탭을 다시 로드하지 않고 이어서 평가
  --errors  페이지 로드 뒤 콘솔 에러/예외 목록 출력
"""
import base64
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

PORT = int(os.environ.get("CDP_PORT", "9333"))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE = os.path.expanduser("~/.cache/pixaude-office-cdp-profile")


def _get(path, method="GET"):
    return json.load(urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method), timeout=3))


def ensure_chrome():
    try:
        _get("/json/version")
        return
    except Exception:
        pass
    subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}", "--window-size=1500,960", "--no-first-run",
                      f"--user-data-dir={PROFILE}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(0.25)
        try:
            _get("/json/version")
            return
        except Exception:
            pass
    raise SystemExit("chrome not up")


class WS:
    """최소 웹소켓 클라이언트 (텍스트 프레임만)."""

    def __init__(self, url):
        host, rest = url.split("://", 1)[1].split("/", 1)
        h, p = host.split(":")
        self.s = socket.create_connection((h, int(p)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.s.recv(4096)
        assert b" 101 " in buf.split(b"\r\n", 1)[0], buf[:200]
        self.rest = buf.split(b"\r\n\r\n", 1)[1]

    def _recvn(self, n):
        out = self.rest[:n]
        self.rest = self.rest[n:]
        while len(out) < n:
            chunk = self.s.recv(min(65536, n - len(out)))
            if not chunk:
                raise ConnectionError("closed")
            out += chunk
        return out

    def send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126)
            head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127)
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        self.s.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b1, b2 = self._recvn(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recvn(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recvn(8))[0]
            payload = self._recvn(n)
            op = b1 & 0x0F
            if op == 8:
                raise ConnectionError("closed by peer")
            if op in (1, 0):
                msg += payload
                if b1 & 0x80:
                    return msg.decode("utf-8", "replace")


def main():
    args = sys.argv[1:]
    shot, url, keep, errors, js = None, "http://127.0.0.1:4800/", False, False, None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--shot":
            shot = args[i + 1]
            i += 2
        elif a == "--url":
            url = args[i + 1]
            i += 2
        elif a == "--keep":
            keep = True
            i += 1
        elif a == "--errors":
            errors = True
            i += 1
        else:
            js = open(a).read() if os.path.exists(a) else a
            i += 1
    ensure_chrome()
    base = url.split("/", 3)[2]
    page = next((t for t in _get("/json") if t["type"] == "page" and base in t["url"]), None)
    fresh = page is None
    if fresh:
        page = _get(f"/json/new?{url}", method="PUT")
    ws = WS(page["webSocketDebuggerUrl"])
    mid = 0
    logs = []

    def call(method, **params):
        nonlocal mid
        mid += 1
        ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            m = json.loads(ws.recv())
            if m.get("method") in ("Runtime.exceptionThrown", "Runtime.consoleAPICalled"):
                logs.append(m)
            if m.get("id") == mid:
                return m.get("result", m)

    call("Page.enable")
    call("Runtime.enable")
    if fresh or not keep:
        call("Page.navigate", url=url)
        time.sleep(3.5)
    call("Page.bringToFront")   # 숨은 탭에선 rAF·Phaser 타이머가 멈춰 걷기 연출을 확인할 수 없다 → 항상 앞으로
    if js:
        r = call("Runtime.evaluate", expression=js, awaitPromise=True, returnByValue=True)
        v = r.get("result", {}).get("value", r)
        print(json.dumps(v, ensure_ascii=False, indent=1) if not isinstance(v, str) else v)
    if errors:
        bad = [m for m in logs if m["method"] == "Runtime.exceptionThrown" or m["params"].get("type") == "error"]
        print(f"errors: {len(bad)}")
        for m in bad:
            p = m["params"]
            print(" -", (p.get("exceptionDetails") or {}).get("text") or " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", [])))
    if shot:
        r = call("Page.captureScreenshot", format="png")
        open(shot, "wb").write(base64.b64decode(r["data"]))
        print("shot", shot)


if __name__ == "__main__":
    main()
