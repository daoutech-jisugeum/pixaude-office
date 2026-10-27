"""MCP 서비스: `claude mcp list` 출력 파서와 카탈로그 치환."""
from django.test import SimpleTestCase

from office.services import mcp

SAMPLE = """Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
claude.ai Atlassian Rovo: https://mcp.atlassian.com/v1/mcp - ! Needs authentication
plugin:context7:context7: https://mcp.context7.com/mcp?client=claude-code-plugin (HTTP) - ! Needs authentication
sentry: npx -y @sentry/mcp-server@latest - ✔ Connected
broken: npx -y nope - ✘ Failed to connect
"""


class McpTests(SimpleTestCase):
    def test_parse_list(self):
        items = mcp.parse_list(SAMPLE)
        self.assertEqual(items["sentry"]["status"], "ok")
        self.assertEqual(items["sentry"]["kind"], "config")
        self.assertEqual(items["claude.ai Atlassian Rovo"]["status"], "auth")
        self.assertEqual(items["claude.ai Atlassian Rovo"]["kind"], "connector")
        self.assertEqual(items["plugin:context7:context7"]["kind"], "plugin")
        self.assertEqual(items["plugin:context7:context7"]["target"], "https://mcp.context7.com/mcp?client=claude-code-plugin")
        self.assertEqual(items["broken"]["status"], "error")
        self.assertEqual(len(items), 5)

    def test_catalog_substitution(self):
        spec = mcp.from_catalog("filesystem", "/tmp/repo", {})
        self.assertTrue(spec["ok"])
        self.assertIn("/tmp/repo", spec["args"])
        self.assertFalse(mcp.from_catalog("postgres", "/tmp", {})["ok"])
        spec = mcp.from_catalog("postgres", "/tmp", {"DSN": "postgresql://x"})
        self.assertIn("postgresql://x", spec["args"])
        spec = mcp.from_catalog("slack", "/tmp", {"SLACK_BOT_TOKEN": "x", "SLACK_TEAM_ID": "T1"})
        self.assertEqual(spec["env"]["SLACK_TEAM_ID"], "T1")

    def test_name_validation(self):
        self.assertFalse(mcp.add("/tmp", "bad name", "local", "stdio", "x")["ok"])
        self.assertFalse(mcp.add("/tmp", "ok", "nope", "stdio", "x")["ok"])
        self.assertFalse(mcp.remove("/tmp", "claude.ai X", "connector")["ok"])
