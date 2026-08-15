"""Insert (or refresh) the link-preview meta tags on each page.

    .cad-venv/Scripts/python.exe tools/meta.py

Idempotent: an existing block written by this script is replaced, so re-running
after editing a description below is safe. Pages belonging to other brands
(nextround, vpas) are deliberately absent — they carry their own metadata
pointing at their own domains.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
SITE = "https://freya.co.nz"
BEGIN = "<!-- link preview -->"
END = "<!-- /link preview -->"

# file, url path, og image stem, title, description, image alt
PAGES = [
    ("index.html", "/", "home",
     "freya — a small workshop on the web",
     "Software, hardware, and a little calm. freyacad, grid, star guide, Æther, flow and the "
     "shitehawk sentinel. Auckland, New Zealand.",
     "freya — a small workshop on the web"),
    ("grid/index.html", "/grid", "grid",
     "Grid — magnet-free Gridfinity generator",
     "Baseplates sized to any drawer to the millimetre, bins in any size, and pockets cut to the "
     "shape of a real tool from a photograph. STL or STEP, entirely in the browser.",
     "Grid — magnet-free Gridfinity generator"),
    ("freyacad/index.html", "/freyacad", "freyacad",
     "freyacad — parametric solid modelling in the browser",
     "Sketch, extrude and boolean geometry in the browser, powered by Manifold and three.js. "
     "No install, no account.",
     "freyacad — parametric solid modelling in the browser"),
    ("stars/index.html", "/stars", "stars",
     "Star Guide — a map of the night sky",
     "An interactive map of the night sky: constellations, their figures, and the planets "
     "overhead right now.",
     "Star Guide — a map of the night sky"),
    ("zen/index.html", "/zen", "zen",
     "Æther — your atmosphere",
     "A living daily companion: a generative sky that shifts with the hour, a focus timer, a "
     "breathing guide, and a journal that stays on your device.",
     "Æther — a living daily companion"),
    ("flow/index.html", "/flow", "flow",
     "Flow — a generative sketch",
     "A tiny hand-typed p5.js sketch, rebuilt for the web. Original piece by @yuruyurau.",
     "Flow — a generative sketch"),
    ("sentinel/index.html", "/sentinel", "sentinel",
     "Shitehawk Sentinel — autonomous avian deterrence",
     "A pan-tilt turret that keeps the shitehawks off the boat. ESP32-CAM motion tracking, "
     "below-horizon lock, 0% AI.",
     "Shitehawk Sentinel — an autonomous pan-tilt deterrence turret"),
]


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")


def block(path, stem, title, desc, alt):
    img = f"{SITE}/og/{stem}.png"
    url = SITE + path + ("" if path.endswith("/") else "/")
    t, d, a = esc(title), esc(desc), esc(alt)
    return "\n".join([
        BEGIN,
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="freya">',
        '<meta property="og:locale" content="en_NZ">',
        f'<meta property="og:title" content="{t}">',
        f'<meta property="og:description" content="{d}">',
        f'<meta property="og:url" content="{url}">',
        f'<meta property="og:image" content="{img}">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:image:alt" content="{a}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{t}">',
        f'<meta name="twitter:description" content="{d}">',
        f'<meta name="twitter:image" content="{img}">',
        f'<meta name="twitter:image:alt" content="{a}">',
        END,
    ])


for fn, path, stem, title, desc, alt in PAGES:
    p = os.path.join(ROOT, fn)
    html = open(p, encoding="utf-8").read()
    new = block(path, stem, title, desc, alt)

    if BEGIN in html:
        html = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), new, html, flags=re.S)
        action = "refreshed"
    else:
        # after the description meta if there is one, otherwise before </head>
        m = re.search(r'<meta name="description"[^>]*>', html)
        if m:
            html = html[:m.end()] + "\n" + new + html[m.end():]
        else:
            html = html.replace("</head>", new + "\n</head>", 1)
        action = "added"

    # a page with no description of its own should have one
    if not re.search(r'<meta name="description"', html):
        html = html.replace(
            "</head>", f'<meta name="description" content="{esc(desc)}">\n</head>', 1)
        action += " + description"

    open(p, "w", encoding="utf-8", newline="").write(html)
    print(f"{fn:22s} {action}")
