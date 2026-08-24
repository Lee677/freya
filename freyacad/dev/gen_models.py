import json, math, os

OUT = r"C:\Users\HP\Trusted Cowork Folder\Freya\freyacad\models"

def P(x, y):  return {"x": round(x, 4), "y": round(y, 4)}
def spl(pts): return {"type": "poly", "spline": True, "tan": [], "closed": False, "pts": pts}
def ln(a, b): return {"type": "poly", "closed": False, "pts": [a, b]}
def cir(cx, cy, r): return {"type": "circle", "c": P(cx, cy), "r": r}

class B:
    def __init__(self): self.f = []; self.n = 0
    def _id(self): self.n += 1; return self.n
    def sk(self, name, plane, ents):
        i = self._id()
        self.f.append({"id": i, "type": "sketch", "name": name,
                       "plane": {"kind": "datum", "name": plane},
                       "entities": ents, "dims": [], "cons": [],
                       "fillet": 0, "chamfer": 0, "suppressed": False})
        return i
    def ext(self, name, sid, depth, sym=False, flip=False, merge=True):
        self.f.append({"id": self._id(), "type": "extrude", "name": name, "sketchId": sid,
                       "depth": depth, "symmetric": sym, "flip": flip, "merge": merge,
                       "suppressed": False})
    def cut(self, name, sid, depth=40, through=True, flip=True):
        self.f.append({"id": self._id(), "type": "cut", "name": name, "sketchId": sid,
                       "depth": depth, "through": through, "flip": flip, "suppressed": False})
    def rev(self, name, sid, seg=64, op="add"):
        self.f.append({"id": self._id(), "type": "revolve", "name": name, "sketchId": sid,
                       "angle": 360, "axis": "v", "operation": op, "merge": True,
                       "segments": seg, "suppressed": False})

# ---------------------------------------------------------------- lantern rocket
# Four-fold symmetry comes from putting two mirrored loops in one sketch and
# repeating that sketch on the perpendicular datum plane. A circular pattern
# would copy the whole accumulated body, not the last feature.
def flute(sign):
    s = sign
    return [spl([P(9*s, 0), P(15.5*s, 2.5), P(18*s, 6), P(14*s, 8.5)]),
            spl([P(14*s, 8.5), P(14.5*s, 5), P(12.5*s, 2), P(9*s, 1.6)]),
            ln(P(9*s, 1.6), P(9*s, 0))]

def fin(sign):
    s = sign
    return [spl([P(6*s, -13), P(16*s, -15.5), P(22*s, -13), P(24*s, -7)]),
            spl([P(24*s, -7), P(17*s, -8), P(11*s, -9.5), P(6*s, -9)]),
            ln(P(6*s, -9), P(6*s, -13))]

b = B()
hull = b.sk("Hull profile", "Front", [
    spl([P(0, -14), P(7.5, -13), P(11, -8), P(9.5, -2), P(12.5, 6),
         P(9, 14), P(4.5, 20), P(1.6, 26), P(0, 31)]),
    ln(P(0, 31), P(0, -14))])
b.rev("Hull", hull, 64)

s = b.sk("Flutes A", "Front", flute(1) + flute(-1)); b.ext("Flutes A", s, 2.4, sym=True)
s = b.sk("Flutes B", "Right", flute(1) + flute(-1)); b.ext("Flutes B", s, 2.4, sym=True)
s = b.sk("Fins A",   "Front", fin(1) + fin(-1));     b.ext("Fins A",   s, 1.8, sym=True)
s = b.sk("Fins B",   "Right", fin(1) + fin(-1));     b.ext("Fins B",   s, 1.8, sym=True)

s = b.sk("Upper ports", "Right", [cir(0, 17, 2.2)]); b.cut("Upper ports", s)
s = b.sk("Lower ports", "Front", [cir(0, 10, 2.6)]); b.cut("Lower ports", s)

s = b.sk("Spire profile", "Front", [
    spl([P(0, 29), P(2.6, 32), P(1.2, 35), P(2.2, 38), P(0, 44)]),
    ln(P(0, 44), P(0, 29))])
b.rev("Spire", s, 48)

lantern = b.f

# ---------------------------------------------------------------- jet engine
def blade_loop(th0, r_in, r_out, sweep, half_arc):
    """One closed blade: swept camber line, upper spline out, lower spline back.
       half_arc is an arc LENGTH, so the angular half-width is half_arc/r — keep
       it small or neighbouring blades intersect at the root and the profile set
       stops being a valid set of faces."""
    ks = [0.0, 0.34, 0.68, 1.0]
    def pt(k, side):
        r = r_in + (r_out - r_in) * k
        ph = th0 + sweep * k * k                      # sweeps back toward the tip
        dphi = (half_arc * (1.0 - 0.4 * k)) / r       # thins toward the tip
        a = ph + side * dphi
        return P(r * math.cos(a), r * math.sin(a))
    up = [pt(k, +1) for k in ks]
    lo = [pt(k, -1) for k in reversed(ks)]
    return [spl(up), ln(up[-1], lo[0]), spl(lo), ln(lo[-1], up[0])]

def rotor(name, r_hub, r_tip, count, sweep, thick, bore, half_arc=0.5):
    c = B()
    s = c.sk("Hub", "Top", [cir(0, 0, r_hub)]);        c.ext("Hub", s, thick)
    r_in = r_hub * 0.92
    gap = 2 * math.pi * r_in / count                  # arc between blade centres
    assert 2 * half_arc < gap * 0.55, (name, 2 * half_arc, gap)
    ents = []
    for i in range(count):
        ents += blade_loop(i * 2 * math.pi / count, r_in, r_tip, sweep, half_arc)
    s = c.sk("Blades", "Top", ents);                   c.ext("Blades", s, thick * 0.7)
    s = c.sk("Bore", "Top", [cir(0, 0, bore)]);        c.cut("Bore", s)
    return {"name": name, "features": c.f}

def duct():
    c = B()
    s = c.sk("Nacelle profile", "Front", [
        spl([P(20, 0), P(24, 6), P(25, 16), P(23, 28), P(21, 36)]),
        ln(P(21, 36), P(19, 36)),
        spl([P(19, 36), P(20.5, 28), P(21.5, 16), P(21, 6), P(18.5, 0)]),
        ln(P(18.5, 0), P(20, 0))])
    c.rev("Nacelle", s, 72)
    return {"name": "Nacelle", "features": c.f}

def cone():
    c = B()
    s = c.sk("Cone profile", "Front", [
        spl([P(0, 0), P(6, 1.5), P(5.5, 6), P(3, 10), P(0, 13)]),
        ln(P(0, 13), P(0, 0))])
    c.rev("Exhaust cone", s, 48)
    return {"name": "Exhaust cone", "features": c.f}

def shaft():
    c = B()
    s = c.sk("Shaft", "Top", [cir(0, 0, 2.4)]); c.ext("Shaft", s, 40)
    return {"name": "Shaft", "features": c.f}

# local +Y becomes world +X under rz = -90, so every part is built pointing up
# and then laid down along the engine axis.
STATIONS = [("Nacelle", duct(), 0), ("Shaft", shaft(), -1),
            ("Fan", rotor("Fan", 6, 17.5, 11, 0.55, 3.0, 2.6, 0.55), 5),
            ("Compressor", rotor("Compressor", 8, 14, 14, 0.45, 2.6, 2.6, 0.5), 15),
            ("Turbine", rotor("Turbine", 9, 15, 13, -0.5, 2.8, 2.6, 0.55), 27),
            ("Exhaust cone", cone(), 31)]

comps = []
for i, (nm, part, x) in enumerate(STATIONS):
    comps.append({"id": i + 1, "name": nm, "features": part["features"],
                  "t": {"x": x, "y": 0, "z": 0, "rx": 0, "ry": 0, "rz": -90},
                  "fixed": i == 0})
engine = {"type": "assembly", "components": comps, "mates": []}

os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, "lantern-rocket.sketchcad"), "w").write(json.dumps(lantern))
open(os.path.join(OUT, "jet-engine.asmcad"), "w").write(json.dumps(engine))
print("lantern features:", len(lantern))
print("engine comps:", [(c["name"], len(c["features"])) for c in comps])
print("bytes:", os.path.getsize(os.path.join(OUT, "lantern-rocket.sketchcad")),
      os.path.getsize(os.path.join(OUT, "jet-engine.asmcad")))
