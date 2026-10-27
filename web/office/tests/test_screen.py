"""화면 긁기 패턴 회귀 테스트. fixtures/*.txt 는 실제 tmux capture-pane 출력(login_required 만 합성).

Claude Code 를 올린 뒤 이 테스트가 깨지면 services/screen.py 의 패턴을 새 화면에 맞춰 고치고,
`tmux capture-pane -p -t office:<창> -S -40 > office/tests/fixtures/<이름>.txt` 로 fixture 를 갱신한다.
"""
from pathlib import Path

from django.test import SimpleTestCase

from office.services import screen

FIX = Path(__file__).parent / "fixtures"


def fx(name: str) -> str:
    return (FIX / f"{name}.txt").read_text(encoding="utf-8")


class ScreenPatternTests(SimpleTestCase):
    def test_idle_screens_are_idle(self):
        for name in ("idle_plan_mode", "idle_booster", "idle_after_turn"):
            with self.subTest(name):
                self.assertTrue(screen.has_prompt(fx(name)))
                self.assertFalse(screen.is_busy(fx(name)), f"{name} 을 작업 중으로 오판")
                self.assertTrue(screen.is_idle(fx(name)))

    def test_busy_screens_are_busy(self):
        for name in ("busy_tool_running", "busy_hooks_running"):
            with self.subTest(name):
                self.assertTrue(screen.has_prompt(fx(name)), "작업 중에도 ❯ 입력줄은 보인다")
                self.assertTrue(screen.is_busy(fx(name)), f"{name} 을 유휴로 오판")
                self.assertFalse(screen.is_idle(fx(name)))

    def test_turn_done_line_is_not_spinner(self):
        self.assertFalse(screen.is_busy("✻ Worked for 10s · done 오전 11:23\n❯ \n"))
        self.assertTrue(screen.is_busy("✳ Newspapering… (4s · ↓ 14 tokens)\n❯ \n"))
        self.assertTrue(screen.is_busy("⏺ Bash(sleep 6)\n  ⎿  Running… (3s)\n❯ \n"))
        self.assertTrue(screen.is_busy("· Thinking…\n❯ \n"))
        self.assertTrue(screen.is_busy("some output (esc to interrupt)\n❯ \n"))   # 예전 버전 호환

    def test_mode_and_effort(self):
        self.assertEqual(screen.read_mode(fx("idle_plan_mode")), "plan")
        self.assertEqual(screen.read_effort(fx("idle_plan_mode")), "medium")
        self.assertEqual(screen.read_mode("  ⏵⏵ bypass permissions on (shift+tab to cycle)"), "bypassPermissions")
        self.assertEqual(screen.read_mode("  ⏵⏵ accept edits on (shift+tab to cycle)"), "acceptEdits")
        self.assertEqual(screen.read_mode("❯ \n  [Opus 4.1 high] │ x"), "")

    def test_login_detection(self):
        for name in ("idle_plan_mode", "idle_booster", "busy_tool_running"):
            with self.subTest(name):
                self.assertIsNone(screen.detect_login(fx(name)), f"{name} 에서 로그인 오탐")
        info = screen.detect_login(fx("login_required"))
        self.assertIsNotNone(info)
        self.assertIn("claude.ai/oauth", info["url"])

    def test_trust_prompt(self):
        self.assertTrue(screen.has_trust_prompt("Do you trust this folder?\n  ❯ 1. Yes, proceed"))
        self.assertFalse(screen.has_trust_prompt(fx("idle_booster")))

    def test_dialog(self):
        for name in ("idle_plan_mode", "idle_booster", "idle_after_turn", "busy_tool_running", "busy_hooks_running"):
            with self.subTest(name):
                self.assertFalse(screen.has_dialog(fx(name)), f"{name} 을 대화상자로 오판")
        resume = "Resuming this conversation will use a noticeable share of your 5-hour limit.\n\n ❯ 1. Resume anyway\n   2. Start fresh\n\n Enter to confirm · Esc to cancel\n"
        self.assertTrue(screen.has_dialog(resume))
        self.assertTrue(screen.has_dialog("Do you trust this folder?\n ❯ 1. Yes, proceed\n   2. No, exit\n"))
        self.assertFalse(screen.has_dialog("1. first\n2. second\n❯ \n  [Fable 5.1 medium] │ x\n"))   # 출력 속 번호 목록 + 빈 입력줄 = 유휴

    def test_pending_update(self):
        self.assertTrue(screen.has_pending_update(fx("idle_after_turn")))
        self.assertFalse(screen.has_pending_update("❯ \n  [Fable 5.1 medium] │ x\n"))
