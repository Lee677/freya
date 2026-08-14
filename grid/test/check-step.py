"""Read every STEP in test/out with OCCT and report what a CAD package will see:
solid or shell, closed or open, face count, volume, and any validity errors.

    .cad-venv/Scripts/python.exe test/check-step.py
"""
import glob
import os
import sys

from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRep import BRep_Tool

here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "out")

def count(shape, kind):
    exp, n = TopExp_Explorer(shape, kind), 0
    while exp.More():
        n += 1
        exp.Next()
    return n

fails = 0
for f in sorted(glob.glob(os.path.join(out, "*.step"))):
    name = os.path.basename(f)
    rdr = STEPControl_Reader()
    if rdr.ReadFile(f) != IFSelect_RetDone:
        print(f"{name:32s} READ FAILED")
        fails += 1
        continue
    rdr.TransferRoots()
    shape = rdr.OneShape()
    solids, shells, faces = count(shape, TopAbs_SOLID), count(shape, TopAbs_SHELL), count(shape, TopAbs_FACE)

    closed = None
    exp = TopExp_Explorer(shape, TopAbs_SHELL)
    if exp.More():
        closed = BRep_Tool.IsClosed_s(exp.Current())

    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    vol = props.Mass() / 1000.0

    valid = BRepCheck_Analyzer(shape).IsValid()
    ok = solids == 1 and closed and valid and vol > 0
    if not ok:
        fails += 1
    print(f"{name:32s} solids={solids} shells={shells} faces={faces:5d} "
          f"closed={closed} valid={valid} vol={vol:9.2f} cm3  {'OK' if ok else '<<< PROBLEM'}")

print()
print("all good" if fails == 0 else f"{fails} file(s) with problems")
sys.exit(1 if fails else 0)
