import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios
import uuid
from urllib.parse import parse_qs

from channels.generic.websocket import AsyncWebsocketConsumer

from .auth import token_ok
from .services import tmux


def _set_winsize(fd: int, cols: int, rows: int):
    cols = max(20, min(int(cols or 80), 500))
    rows = max(5, min(int(rows or 24), 200))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


class TerminalConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        iid = self.scope["url_route"]["kwargs"]["iid"]
        self.iid, self.pid, self.fd, self.view, self.q, self._writer = iid, 0, -1, "", None, None
        if not token_ok(self.scope):
            await self.close(code=4403)
            return
        if not tmux.window_exists(iid):
            await self.close(code=4404)
            return
        qs = parse_qs(self.scope.get("query_string", b"").decode())
        cols, rows = (qs.get("cols") or ["120"])[0], (qs.get("rows") or ["36"])[0]
        self.view = f"view_{uuid.uuid4().hex[:8]}"
        if not tmux.create_view(self.view, iid):
            await self.close(code=4500)
            return
        pid, fd = pty.fork()
        if pid == 0:  # 자식: tmux 클라이언트
            try:
                _set_winsize(0, cols, rows)
                env = dict(os.environ)
                env.pop("TMUX", None)
                env["TERM"] = "xterm-256color"
                env["LANG"] = env.get("LANG") or "ko_KR.UTF-8"
                os.execvpe("tmux", ["tmux", "attach-session", "-t", self.view], env)
            finally:
                os._exit(1)
        self.pid, self.fd = pid, fd
        os.set_blocking(fd, False)
        await self.accept()
        self.q = asyncio.Queue()
        self._writer = asyncio.create_task(self._pump())
        asyncio.get_running_loop().add_reader(fd, self._on_readable)

    def _on_readable(self):
        try:
            data = os.read(self.fd, 65536)
        except BlockingIOError:
            return
        except OSError:  # EIO = 클라이언트 종료
            data = b""
        self.q.put_nowait(data)
        if not data:
            asyncio.get_running_loop().remove_reader(self.fd)

    async def _pump(self):
        while True:
            data = await self.q.get()
            if not data:
                await self.close()
                return
            try:
                await self.send(bytes_data=data)
            except Exception:  # noqa: BLE001
                return

    async def receive(self, text_data=None, bytes_data=None):
        if self.fd < 0:
            return
        if bytes_data:
            try:
                os.write(self.fd, bytes_data)
            except OSError:
                pass
        elif text_data:
            try:
                msg = json.loads(text_data)
                if isinstance(msg, dict) and "resize" in msg:
                    _set_winsize(self.fd, *msg["resize"][:2])
            except (ValueError, OSError, TypeError):
                pass

    async def disconnect(self, code):
        loop = asyncio.get_running_loop()
        if self.fd >= 0:
            try:
                loop.remove_reader(self.fd)
                os.close(self.fd)
            except OSError:
                pass
            self.fd = -1
        if self.pid:
            pid, self.pid = self.pid, 0
            try:
                os.kill(pid, signal.SIGHUP)
            except OSError:
                pass
            try:   # tmux 클라이언트는 HUP 에 바로 끝난다. 블로킹 waitpid 를 스레드에서 → 좀비 안 남김
                await loop.run_in_executor(None, os.waitpid, pid, 0)
            except ChildProcessError:
                pass
        if self._writer:
            self._writer.cancel()
        if self.view:
            tmux.kill_view(self.view)
            self.view = ""
