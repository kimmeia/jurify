"""Gera a logo JuridFlow em formato Instagram (1080x1080), versoes dark e white.

Fiel ao componente client/src/pages/landing/Logo.tsx (variant dark/light):
  "Jurid" Poppins ExtraBold (800)  +  "Flow" Poppins SemiBold (600)
  tracking-tight (-0.025em), leading-none, "Flow" em violet-600 (#7C3AED).
Fundo dark = gradiente radial do hero (#1a1140 -> #0d0a1c -> #07060f).

Auto-contido: baixa as fontes Poppins (OFL) num cache temporario na 1a execucao.
Uso:  pip install Pillow && python3 generate-instagram-logo.py
"""
import math
import os
import tempfile
import urllib.request

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_CACHE = os.path.join(tempfile.gettempdir(), "juridflow-fonts")
FONT_BASE = "https://github.com/google/fonts/raw/main/ofl/poppins"

SS = 2                      # supersampling
SIDE = 1080
SIZE = SIDE * SS           # 2160

VIOLET = (124, 58, 237)    # text-violet-600  #7C3AED
WHITE = (255, 255, 255)
DARK_INK = (11, 11, 23)    # #0b0b17 (Jurid no fundo claro)
TARGET_W = int(0.72 * SIZE)   # largura do wordmark ~72% do quadro


def font_path(name):
    os.makedirs(FONT_CACHE, exist_ok=True)
    dest = os.path.join(FONT_CACHE, name)
    if not os.path.exists(dest):
        urllib.request.urlretrieve(f"{FONT_BASE}/{name}", dest)
    return dest


JURID_TTF = lambda: font_path("Poppins-ExtraBold.ttf")   # font-extrabold = 800
FLOW_TTF = lambda: font_path("Poppins-SemiBold.ttf")     # font-semibold = 600


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def radial_bg(inner, mid, outer, cx=0.5, cy=0.40, rad=0.78, mid_pos=0.52):
    """Gradiente radial 3-stops, gerado em baixa-res e ampliado (sem banding)."""
    low = 384
    g = Image.new("RGB", (low, low))
    px = g.load()
    ccx, ccy, maxr = cx * low, cy * low, rad * low
    for y in range(low):
        for x in range(low):
            d = min(1.0, math.hypot(x - ccx, y - ccy) / maxr)
            if d < mid_pos:
                px[x, y] = lerp(inner, mid, d / mid_pos)
            else:
                px[x, y] = lerp(mid, outer, (d - mid_pos) / (1 - mid_pos))
    return g.resize((SIZE, SIZE), Image.LANCZOS)


def build_glyphs(font_px):
    jf = ImageFont.truetype(JURID_TTF(), font_px)
    ff = ImageFont.truetype(FLOW_TTF(), font_px)
    seq = [(c, jf) for c in "Jurid"] + [(c, ff) for c in "Flow"]
    tracking = -0.025 * font_px        # tracking-tight
    advances = [f.getlength(c) for c, f in seq]
    total = sum(advances) + tracking * (len(seq) - 1)
    return seq, advances, tracking, total


def render_wordmark(jurid_color, flow_color):
    # acha font_px tal que a largura total ~= TARGET_W (largura e linear em font_px)
    probe = 600
    _, _, _, w0 = build_glyphs(probe)
    font_px = max(8, round(probe * TARGET_W / w0))
    seq, advances, tracking, total = build_glyphs(font_px)
    jurid_ttf = JURID_TTF()

    layer = Image.new("RGBA", (int(total) + 200, font_px * 2 + 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x = 100.0
    baseline = font_px + 100
    for (ch, f), adv in zip(seq, advances):
        color = jurid_color if f.path == jurid_ttf else flow_color
        d.text((x, baseline), ch, font=f, fill=color + (255,), anchor="ls")
        x += adv + tracking
    return layer.crop(layer.getbbox())   # bbox optico (tight)


def compose(bg, wordmark, name):
    canvas = bg.convert("RGBA")
    w, h = wordmark.size
    canvas.alpha_composite(wordmark, ((SIZE - w) // 2, (SIZE - h) // 2))
    final = canvas.convert("RGB").resize((SIDE, SIDE), Image.LANCZOS)
    path = os.path.join(HERE, name)
    final.save(path, "PNG")
    print(f"saved {path}  ({SIDE}x{SIDE})  wordmark={w // SS}x{h // SS}px")


def main():
    dark_bg = radial_bg((26, 17, 64), (13, 10, 28), (7, 6, 15))
    compose(dark_bg, render_wordmark(WHITE, VIOLET), "juridflow-instagram-dark.png")

    white_bg = radial_bg((255, 255, 255), (250, 249, 254), (244, 242, 252),
                         cy=0.42, rad=0.85, mid_pos=0.5)
    compose(white_bg, render_wordmark(DARK_INK, VIOLET), "juridflow-instagram-white.png")


if __name__ == "__main__":
    main()
