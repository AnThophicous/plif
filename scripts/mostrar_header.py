# -*- coding: utf-8 -*-
"""Render a transparent RGBA PNG as compact ANSI truecolor half-block art.

Usage from the repository root::

    python scripts/mostrar_header.py 14

The PNG is cropped from its alpha bounding box. Each terminal cell consumes
two image rows: the top pixel becomes foreground and the bottom pixel becomes
background. Transparent halves are never composited over white or black.
"""

from __future__ import annotations

import ctypes
import io
import sys
from pathlib import Path

from PIL import Image


DEFAULT_SOURCE = (
    Path(__file__).resolve().parent.parent
    / "packages"
    / "cli"
    / "assets"
    / "negrocomcachecol.png"
)


def colour_escape(kind: str, rgb: tuple[int, int, int]) -> str:
    return f"\x1b[{38 if kind == 'fg' else 48};2;{rgb[0]};{rgb[1]};{rgb[2]}m"


def render(path: Path, width: int) -> str:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("the PNG has no visible alpha pixels")
    image = image.crop(bbox)

    height = max(2, round(width * image.height / image.width))
    if height % 2:
        height += 1
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    pixels = image.load()

    lines: list[str] = []
    for y in range(0, height, 2):
        foreground: tuple[int, int, int] | None = None
        background: tuple[int, int, int] | None = None
        parts: list[str] = []
        for x in range(width):
            top = pixels[x, y]
            bottom = pixels[x, y + 1]
            top_rgb = top[:3] if top[3] > 128 else None
            bottom_rgb = bottom[:3] if bottom[3] > 128 else None

            if top_rgb is None and bottom_rgb is None:
                if foreground is not None or background is not None:
                    parts.append("\x1b[0m")
                    foreground = background = None
                parts.append(" ")
            elif top_rgb is None:
                if foreground != bottom_rgb:
                    parts.append(colour_escape("fg", bottom_rgb))
                    foreground = bottom_rgb
                if background is not None:
                    parts.append("\x1b[49m")
                    background = None
                parts.append("▄")
            elif bottom_rgb is None:
                if foreground != top_rgb:
                    parts.append(colour_escape("fg", top_rgb))
                    foreground = top_rgb
                if background is not None:
                    parts.append("\x1b[49m")
                    background = None
                parts.append("▀")
            elif top_rgb == bottom_rgb:
                if background != top_rgb:
                    parts.append(colour_escape("bg", top_rgb))
                    background = top_rgb
                if foreground is not None:
                    parts.append("\x1b[39m")
                    foreground = None
                parts.append(" ")
            else:
                if foreground != top_rgb:
                    parts.append(colour_escape("fg", top_rgb))
                    foreground = top_rgb
                if background != bottom_rgb:
                    parts.append(colour_escape("bg", bottom_rgb))
                    background = bottom_rgb
                parts.append("▀")

        if foreground is not None or background is not None:
            parts.append("\x1b[0m")
        lines.append("".join(parts))

    return "\n".join(lines) + "\x1b[0m"


def main() -> None:
    if sys.platform == "win32":
        try:
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
            ctypes.windll.kernel32.SetConsoleCP(65001)
        except Exception:
            pass
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    width = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    if width < 1:
        raise SystemExit("width must be positive")
    source = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else DEFAULT_SOURCE
    sys.stdout.write(render(source, width) + "\n")


if __name__ == "__main__":
    main()
