"""파비콘 생성: sprites.js 의 CAP(대표 교관모 도트 행)과 CAP_LEGEND 를 읽어 PNG(16·32·180)와 ICO 를 만든다. 표준 라이브러리만.
    python3 .claude/skills/verify-ui/favicon.py
"""
import re
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STATIC = ROOT / "web" / "office" / "static" / "office"
BG = (0x1A, 0x18, 0x16)
GRID = 20   # 도트 격자 한 변. 모자는 x -8..8, y -17..-10


def read_cap() -> list[tuple[int, int, int, int, int]]:
    """sprites.js 의 CAP 행 + CAP_AT + CAP_LEGEND → (색, x, y, 1, 1) 픽셀 목록"""
    src = (STATIC / "sprites.js").read_text(encoding="utf-8")
    rows = re.findall(r"'([.A-Za-z]+)'", re.search(r"const CAP = \[(.*?)\n  \];", src, re.S).group(1))
    ax, ay = (int(v) for v in re.search(r"const CAP_AT = \[(-?\d+), (-?\d+)\]", src).groups())
    pal = {k: int(v, 16) for k, v in re.findall(r"(\w+): 0x([0-9a-fA-F]{6})", re.search(r"const P = \{(.*?)\n  \};", src, re.S).group(1))}
    legend = {k: pal[v] for k, v in re.findall(r"(\w): P\.(\w+)", re.search(r"const CAP_LEGEND = \{(.*?)\};", src).group(1))}
    out = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in legend:
                out.append((legend[ch], ax + x, ay + y, 1, 1))
    return out


def grid() -> list[list[tuple[int, int, int] | None]]:
    cells = [[None] * GRID for _ in range(GRID)]
    r = GRID // 2 - 1
    for y in range(GRID):   # 둥근 사각형 배경
        for x in range(GRID):
            dx, dy = max(abs(x - r - 0.5) - (r - 3), 0), max(abs(y - r - 0.5) - (r - 3), 0)
            if dx * dx + dy * dy <= 3.6 * 3.6:
                cells[y][x] = BG
    for color, x, y, w, h in read_cap():
        rgb = ((color >> 16) & 255, (color >> 8) & 255, color & 255)
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                cx, cy = xx + GRID // 2, yy + GRID + 2
                if 0 <= cx < GRID and 0 <= cy < GRID:
                    cells[cy][cx] = rgb
    return cells


def png(size: int, cells) -> bytes:
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            c = cells[py * GRID // size][px * GRID // size]
            row += bytes([*c, 255]) if c else b"\0\0\0\0"
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")


def ico(entries: list[tuple[int, bytes]]) -> bytes:
    head = struct.pack("<HHH", 0, 1, len(entries))
    off = 6 + 16 * len(entries)
    dirs, blobs = b"", b""
    for size, data in entries:
        dirs += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
        blobs += data
    return head + dirs + blobs


if __name__ == "__main__":
    cells = grid()
    p16, p32, p180 = png(16, cells), png(32, cells), png(180, cells)
    (STATIC / "favicon-16.png").write_bytes(p16)
    (STATIC / "favicon-32.png").write_bytes(p32)
    (STATIC / "apple-touch-icon.png").write_bytes(p180)
    (STATIC / "favicon.ico").write_bytes(ico([(16, p16), (32, p32)]))
    print("favicon 갱신:", ", ".join(f"{n}" for n in ("favicon-16.png", "favicon-32.png", "favicon.ico", "apple-touch-icon.png")))
