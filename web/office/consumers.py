import asyncio

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import state
from .auth import token_ok

_ticker_task = None


def _bg(fn):
    return sync_to_async(fn, thread_sensitive=False)


async def _ticker():
    while True:
        await asyncio.sleep(5)
        try:
            await _bg(state.tick)()
        except Exception as e:  # noqa: BLE001
            print("tick error", e)


class BrowserConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        global _ticker_task
        if not token_ok(self.scope):
            await self.close(code=4403)
            return
        await self.channel_layer.group_add(state.GROUP, self.channel_name)
        await self.accept()
        if _ticker_task is None or _ticker_task.done():
            _ticker_task = asyncio.create_task(_ticker())
        await self.send_json({"event": "snapshot", "payload": await _bg(state.snapshot)()})

    async def disconnect(self, code):
        await self.channel_layer.group_discard(state.GROUP, self.channel_name)

    async def receive_json(self, content, **kwargs):
        cmd, emp, g = content.get("cmd"), content.get("employee", ""), content.get
        table = {
            "say": (state.say, (emp, g("text", ""), g("mode", "auto"), g("attachments") or [])),
            "read": (state.mark_read, (emp,)),
            "model": (state.set_model, (emp, g("value", ""))),
            "permission_mode": (state.set_permission, (emp, g("value", ""))),
            "effort": (state.set_effort, (emp, g("value", ""))),
            "restart": (state.restart, (emp,)),
            "start": (state.spawn, (emp, g("resume", ""))),          # emp = 팀 id → 새 직원
            "stop": (state.stop_session, (emp, bool(g("force")))),   # worktree 에 미커밋·미푸시가 있으면 confirm 응답 → force 로 다시
            "open_ide": (state.open_in_editor, (emp, g("path", ""))),
            "resume_here": (state.resume_here, (emp, g("session_id", ""))),
            "login": (state.start_login, (emp,)),
            "compact": (state.say, (emp, "/compact")),
            "clear": (state.say, (emp, "/clear")),
            "tpl_save": (state.save_template, (g("fields") or {},)),
            "tpl_delete": (state.delete_template, (g("id", ""),)),
            "mcp_add": (state.mcp_add, (g("team", ""), g("fields") or {})),
            "mcp_remove": (state.mcp_remove, (g("team", ""), g("name", ""), g("scope", ""))),
        }
        try:
            if cmd == "snapshot":
                res = {"ok": True}
                await self.send_json({"event": "snapshot", "payload": await _bg(state.snapshot)()})
            elif cmd in table:
                fn, args = table[cmd]
                res = await _bg(fn)(*args) or {"ok": True}
            else:
                res = {"ok": False, "error": f"unknown cmd {cmd}"}
        except Exception as e:  # noqa: BLE001
            res = {"ok": False, "error": str(e)}
        await self.send_json({"event": "ack", "payload": {"cmd": cmd, "employee": emp, **res, "ref": content.get("ref")}})

    async def office_event(self, message):
        await self.send_json({"event": message["event"], "payload": message["payload"]})
