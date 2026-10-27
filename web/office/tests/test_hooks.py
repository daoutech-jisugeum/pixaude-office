"""훅 설정 생성: 모든 이벤트가 서버 주소·토큰을 갖고, 상태줄 래퍼가 포트를 받는지."""
from pathlib import Path

from django.test import SimpleTestCase

from office.services import hooks


class HooksRenderTests(SimpleTestCase):
    def test_build(self):
        cfg = hooks.build(Path("/x/office"), 4801, "tok")
        ev = cfg["hooks"]
        self.assertEqual(set(ev), set(hooks.HTTP_EVENTS) | set(hooks.CURL_EVENTS))
        h = ev["Stop"][0]["hooks"][0]
        self.assertEqual(h["type"], "http")
        self.assertEqual(h["url"], "http://127.0.0.1:4801/hook/Stop/")
        self.assertEqual(h["headers"]["X-Office-Token"], "tok")
        self.assertIn("OFFICE_EMPLOYEE", h["allowedEnvVars"])
        c = ev["SessionStart"][0]["hooks"][0]
        self.assertEqual(c["type"], "command")
        self.assertIn("/hook/SessionStart/", c["command"])
        self.assertIn("X-Office-Token: tok", c["command"])
        self.assertTrue(c["command"].endswith("|| true"))
        self.assertEqual(cfg["statusLine"]["command"], "/x/office/hooks/office-statusline.sh 4801")
        self.assertNotIn("sandbox", cfg)
        for name in ("PostToolUseFailure", "TaskCreated", "TaskCompleted", "PostModelSwitch", "ConfigChange", "Elicitation"):
            self.assertEqual(ev[name][0]["hooks"][0]["type"], "http")

    def test_build_sandbox(self):
        cfg = hooks.build(Path("/x/office"), 4801, "tok", sandbox=True)
        self.assertEqual(cfg["sandbox"], {"enabled": True})
        self.assertEqual(set(cfg["hooks"]), set(hooks.HTTP_EVENTS) | set(hooks.CURL_EVENTS))
