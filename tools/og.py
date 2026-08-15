"""Generate the 1200x630 link-preview cards in og/.

Run after changing a page's title or description:

    .cad-venv/Scripts/python.exe tools/og.py

The cards deliberately mirror the site itself — dark ground, the faint drafting
grid, Palatino for the name, mono for the path — so a shared link looks like the
page it opens. Dark reads well against both light and dark social feeds.
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (11, 14, 20)
INK = (238, 241, 248)
MUTED = (152, 165, 189)
FAINT = (107, 120, 144)
ACCENT = (138, 162, 255)
GRID = (255, 255, 255, 12)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "og")
F = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(F + name, size)


# path, filename, name, description
CARDS = [
    ("freya.co.nz", "home", "freya",
     "A small workshop on the web — software, hardware, and a little calm. Auckland, New Zealand."),
    ("freya.co.nz/grid", "grid", "Grid",
     "Magnet-free Gridfinity for any drawer. Baseplates sized to the millimetre, and pockets cut "
     "from a photograph of the tool. STL or STEP."),
    ("freya.co.nz/freyacad", "freyacad", "freyacad",
     "Parametric solid modelling in the browser — sketch, extrude and boolean geometry, powered by "
     "Manifold and three.js."),
    ("freya.co.nz/stars", "stars", "Star Guide",
     "An interactive map of the night sky — constellations, their figures, and the planets overhead."),
    ("freya.co.nz/zen", "zen", "Æther",
     "A living daily companion — a generative sky that shifts with the hour, a focus timer, a "
     "breathing guide, and a private journal."),
    ("freya.co.nz/flow", "flow", "Flow",
     "A tiny hand-typed p5.js sketch, rebuilt for the web. Original piece by @yuruyurau."),
    ("freya.co.nz/sentinel", "sentinel", "Shitehawk Sentinel",
     "An autonomous pan-tilt turret that keeps the shitehawks off the boat — ESP32-CAM motion "
     "tracking, below-horizon lock, 0% AI."),
]


def wrap(draw, text, fnt, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def card(path, stem, name, desc):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img, "RGBA")

    # the drafting grid, fading out toward the bottom right like the site's mask
    step = 42                                   # the gridfinity pitch, quietly
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=GRID)

    d.rectangle([0, 0, 6, H], fill=ACCENT)      # accent spine, as on a hovered row

    x0 = 92
    f_path = font("consola.ttf", 27)
    f_name = font("palab.ttf", 96)
    f_desc = font("segoeui.ttf", 34)
    f_foot = font("consola.ttf", 24)

    d.text((x0, 118), "/" + path.split("/", 1)[1] if "/" in path else "freya.co.nz",
           font=f_path, fill=ACCENT)
    d.text((x0, 168), name, font=f_name, fill=INK)

    y = 310
    for line in wrap(d, desc, f_desc, W - x0 * 2):
        d.text((x0, y), line, font=f_desc, fill=MUTED)
        y += 48

    d.line([(x0, H - 108), (W - x0, H - 108)], fill=(255, 255, 255, 28))
    d.text((x0, H - 78), "freya.co.nz", font=f_foot, fill=FAINT)
    d.text((W - x0 - d.textlength("Auckland, New Zealand", font=f_foot), H - 78),
           "Auckland, New Zealand", font=f_foot, fill=FAINT)

    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, stem + ".png")
    img.save(p, "PNG", optimize=True)
    return p, os.path.getsize(p)


if __name__ == "__main__":
    for c in CARDS:
        p, size = card(*c)
        print(f"{os.path.basename(p):18s} {size/1024:6.1f} KB")
