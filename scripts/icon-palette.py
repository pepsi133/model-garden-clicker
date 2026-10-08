#!/usr/bin/env python3
"""Derive the extension's colour palette from the icon photo.

Quantizes extension/icons/icon-master.png to a handful of colours, picks the
warm tones the theme is built from (the amber wall, the dog's tan and dark
brown, the off-white ceiling), derives the UI roles from them and checks the
WCAG contrast of every text/background pair the popup and options page use.
Prints the CSS custom properties for extension/common/theme.css together with
the contrast ratios. Needs only Pillow.

Run from the repository root:

    python3 scripts/icon-palette.py

Exits 1 when a text pair falls under 4.5:1.
"""
from __future__ import annotations

import colorsys
import sys
from pathlib import Path

from PIL import Image

ICON = Path(__file__).resolve().parent.parent / "extension" / "icons" / "icon-master.png"


def hexs(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def hsv(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    return h * 360, s, v


def from_hsv(h: float, s: float, v: float) -> tuple[int, int, int]:
    return tuple(round(c * 255) for c in colorsys.hsv_to_rgb(h / 360, s, v))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    """a blended towards b by t (0 = a, 1 = b)."""
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def luminance(rgb: tuple[int, int, int]) -> float:
    def chan(c: int) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def dominant(path: Path, n: int = 12) -> list[tuple[float, tuple[int, int, int]]]:
    im = Image.open(path).convert("RGB").resize((128, 128), Image.LANCZOS)
    q = im.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    total = 128 * 128
    out = []
    for count, idx in q.getcolors():
        rgb = tuple(pal[idx * 3:idx * 3 + 3])
        out.append((count / total, rgb))
    return sorted(out, reverse=True)


def pick(colors, pred, key):
    cands = [c for c in colors if pred(*hsv(c[1]), c[1])]
    if not cands:
        raise SystemExit("no quantized colour matches " + key)
    return max(cands, key=lambda c: key(*hsv(c[1])) * c[0])[1]


def main() -> int:
    colors = dominant(ICON)
    print("dominant colours of", ICON.name)
    for share, rgb in colors:
        h, s, v = hsv(rgb)
        print(f"  {share * 100:5.1f}%  {hexs(rgb)}  hue {h:5.1f}  sat {s:.2f}  val {v:.2f}")

    # Source tones, picked by hue/saturation/value from the quantized set.
    amber = pick(colors, lambda h, s, v, rgb: 25 <= h <= 50 and s >= 0.6 and v >= 0.5, lambda h, s, v: s * v)
    tan = pick(colors, lambda h, s, v, rgb: 20 <= h <= 45 and 0.3 <= s <= 0.6 and 0.4 <= v <= 0.75, lambda h, s, v: v)
    dark = pick(colors, lambda h, s, v, rgb: 10 <= h <= 40 and s >= 0.4 and 0.1 <= v <= 0.3, lambda h, s, v: 1 / v)
    ceiling = pick(colors, lambda h, s, v, rgb: 15 <= h <= 40 and s <= 0.15 and v >= 0.85, lambda h, s, v: v)
    white = (255, 255, 255)

    # Derived roles. The accent keeps the wall's hue and saturation but takes
    # the value the wall has in daylight (the quantized tone carries the
    # photo's shadows); the background is the ceiling lightened; borders and
    # the neutral mode banner are the ceiling itself; muted text is the dark
    # brown pulled towards the tan.
    ah, as_, _ = hsv(amber)
    roles = {
        "bg": mix(ceiling, white, 0.55),
        "surface": white,
        "text": dark,
        "muted": mix(dark, tan, 0.45),
        "border": mix(ceiling, tan, 0.25),
        "accent": from_hsv(ah, as_, 0.85),
        "accent-dark": from_hsv(ah, as_, 0.55),
        "neutral": ceiling,
        "warn": (0xb3, 0x26, 0x1e),
        "warn-bg": (0xfb, 0xe9, 0xe7),
        "ok": (0x2e, 0x6b, 0x3a),
        "info": (0x3f, 0x5d, 0x8a),
    }
    print()
    print("source tones: amber", hexs(amber), "tan", hexs(tan), "dark brown", hexs(dark), "ceiling", hexs(ceiling))
    print()
    print(":root {")
    for name, rgb in roles.items():
        print(f"  --mgc-{name}: {hexs(rgb)};")
    print("}")

    pairs = [
        ("text on bg", roles["text"], roles["bg"]),
        ("text on surface", roles["text"], roles["surface"]),
        ("muted on bg", roles["muted"], roles["bg"]),
        ("muted on surface", roles["muted"], roles["surface"]),
        ("warn text on bg", roles["warn"], roles["bg"]),
        ("warn text on warn-bg", roles["warn"], roles["warn-bg"]),
        ("white on warn (FULL RUN banner)", white, roles["warn"]),
        ("text on accent (Start button)", roles["text"], roles["accent"]),
        ("white on accent-dark", white, roles["accent-dark"]),
        ("text on neutral (DRY RUN banner)", roles["text"], roles["neutral"]),
        ("accent-dark on bg (links, focus ring)", roles["accent-dark"], roles["bg"]),
        ("accent-dark on surface (links, focus ring)", roles["accent-dark"], roles["surface"]),
        ("ok on bg", roles["ok"], roles["bg"]),
        ("ok on surface", roles["ok"], roles["surface"]),
        ("info on bg", roles["info"], roles["bg"]),
        ("info on surface", roles["info"], roles["surface"]),
        ("warn vs accent (hue distance, not a text pair)", roles["warn"], roles["accent"]),
    ]
    print()
    bad = []
    for label, fg, bg in pairs:
        c = contrast(fg, bg)
        text_pair = "hue distance" not in label
        flag = "" if (not text_pair or c >= 4.5) else "  <-- UNDER 4.5"
        if flag:
            bad.append(label)
        print(f"  {c:5.2f}:1  {label}  ({hexs(fg)} on {hexs(bg)}){flag}")
    hw, _, _ = hsv(roles["warn"])
    print(f"  warn hue {hw:.0f} vs accent hue {ah:.0f}: {abs(hw - ah):.0f} degrees apart")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
