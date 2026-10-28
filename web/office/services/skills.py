import json
import os
import re
from pathlib import Path

from . import company

_PLUGINS = Path.home() / ".claude" / "plugins" / "installed_plugins.json"


def skill_commands(root: Path, tag: str) -> list[dict]:
    """<root>/commands/*.md, <root>/skills/*/SKILL.md → {name:'/x', desc, scope}. (frontmatter description, 없으면 첫 줄)"""
    out = []
    if not root.is_dir():
        return out
    for md in sorted((root / "commands").glob("*.md")) + sorted((root / "skills").glob("*/SKILL.md")) + sorted((root / "skills").glob("*/*/SKILL.md")):
        name = md.parent.name if md.name == "SKILL.md" else md.stem
        desc = ""
        try:
            head = md.read_text(encoding="utf-8", errors="replace")[:2000]
            m = re.search(r"^description:\s*(.+)$", head, re.M)
            desc = (m.group(1).strip().strip("\"'") if m else "")
            if not desc:
                body = re.sub(r"^---.*?---\s*", "", head, flags=re.S)
                desc = next((ln.strip().lstrip("#").strip() for ln in body.splitlines() if ln.strip()), "")
        except OSError:
            pass
        out.append({"name": f"/{name}", "desc": desc[:120], "scope": tag, "kind": "skill" if md.name == "SKILL.md" else "command", "path": str(md)})
    return out




def plugins_for(cwd: str) -> list[dict]:
    try:
        data = json.loads(_PLUGINS.read_text(encoding="utf-8")).get("plugins") or {}
    except (OSError, ValueError):
        return []
    roots = company.project_keys(cwd)
    out = []
    for full, installs in data.items():
        for ins in installs or []:
            scope = ins.get("scope", "")
            if scope == "user" or (scope in ("project", "local") and ins.get("projectPath") in roots):
                name, _, market = full.partition("@")
                out.append({"name": name, "marketplace": market, "scope": scope, "version": (ins.get("version") or "")[:12], "updated": (ins.get("lastUpdated") or "")[:10]})
                break
    return sorted(out, key=lambda p: (p["scope"] != "project", p["name"]))


def inventory(cwd: str) -> dict:
    cwd_p = Path(os.path.expanduser(cwd))
    items = skill_commands(cwd_p / ".claude", "project")
    top = next((Path(r) for r in company.project_keys(cwd) if Path(r) != cwd_p and (Path(r) / ".claude").is_dir()), None)
    if top:
        items += [x for x in skill_commands(top / ".claude", "project") if x["name"] not in {i["name"] for i in items}]
    user = skill_commands(Path.home() / ".claude", "user")
    return {"project": items, "user": user, "plugins": plugins_for(cwd)}
