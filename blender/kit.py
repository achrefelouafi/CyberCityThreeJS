"""
kit.py - the modular building kit, every piece a Geometry Nodes generator.

Conventions (Blender space, Z up, metres):
  * Tower bodies are authored on a UNIT footprint ([-0.5, 0.5]^2, height 0..1);
    the city generator scales them per lot. Windows are not geometry - they are
    shaded in world space, so non-uniform scaling never stretches them.
  * Facade-mounted pieces (signs, screens, lamps) have their back on the wall
    plane y = 0 and extend towards -Y (outwards). Base at z = 0.
  * Vehicles face +X.
Pieces are named <Prefix><index>_<Name>; the numeric prefix fixes the order used
by "Pick Instance" in the city generator and by the JS port.
"""

import math
import bpy
from gn import GN
from materials import MATS

PI = math.pi

KIT = {}  # piece name -> dict(collection, tree)


def _M(name):
    return MATS[name]


def _mk_object(name, tree, collection, location):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name + "_mesh")
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    mod = ob.modifiers.new("Generator", "NODES")
    mod.node_group = tree
    ob.location = location
    return ob


def ring_xy(g, geo_unit, positions):
    """Instance a piece at several XY positions (list of (x, y)) and realize."""
    pts = [g.transform(geo_unit, t=(x, y, 0)) for x, y in positions]
    return g.join(*pts)


def around4(g, geo):
    """Copy geometry rotated 0/90/180/270 degrees about Z."""
    return g.join(*[g.transform(geo, r=(0, 0, k * PI / 2)) for k in range(4)])


# ============================================================================ towers
def tower_pillars():
    g = GN("CC_Tower_Pillars")
    g.inp("Pillar Size", "FLOAT", 0.075, 0.0, 0.25, "Corner pillar size (fraction of footprint)", panel="Shape")
    g.inp("Glass Inset", "FLOAT", 0.03, 0.0, 0.1, "Curtain wall inset behind the pillars", panel="Shape")
    g.inp("Crown Height", "FLOAT", 0.014, 0.0, 0.05, "Parapet height (fraction of height)", panel="Shape")
    g.inp("Mid Bands", "INT", 3, 0, 8, "Horizontal service floors", panel="Shape")
    with g.frame("Curtain wall"):
        inset = g.p("Glass Inset")
        s = g.sub(1.0, g.mul(inset, 2.0))
        glass = g.set_mat(g.transform(g.cube(g.vec(s, s, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Pillars"):
        ps = g.p("Pillar Size")
        c = g.sub(0.5, g.mul(ps, 0.5))
        pil = g.cube(g.vec(ps, ps, 1.0))
        pil = g.transform(pil, t=(0, 0, 0.5))
        pts = g.grid(g.mul(c, 2.0), g.mul(c, 2.0), 2, 2)
        pillars = g.realize(g.instance(pts, pil))
        pillars = g.set_mat(pillars, _M("CC_Facade"))
    with g.frame("Crown & bands"):
        ch = g.p("Crown Height")
        crown = g.transform(g.cube(g.vec(1.02, 1.02, ch)), t=g.vec(0, 0, g.sub(1.0, g.mul(ch, 0.5))))
        base = g.transform(g.cube((1.01, 1.01, 0.02)), t=(0, 0, 0.01))
        nb = g.p("Mid Bands")
        band = g.cube((0.985, 0.985, 0.006))
        line = g.mesh_line(nb, (0, 0, 0.25), (0, 0, 0.2))
        bands = g.realize(g.instance(line, band))
        crown = g.set_mat(g.join(crown, base, bands), _M("CC_Facade"))
    geo = g.union(glass, pillars, crown)
    g.out("Geometry", geo)
    return g.finish()


def tower_fins():
    g = GN("CC_Tower_Fins")
    g.inp("Fins Per Side", "INT", 9, 0, 24, "Vertical fins per facade", panel="Shape")
    g.inp("Fin Depth", "FLOAT", 0.025, 0.0, 0.08, panel="Shape")
    g.inp("Fin Width", "FLOAT", 0.008, 0.002, 0.03, panel="Shape")
    g.inp("Corner Size", "FLOAT", 0.06, 0.0, 0.2, panel="Shape")
    with g.frame("Core"):
        glass = g.set_mat(g.transform(g.cube((0.96, 0.96, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Fins"):
        n = g.p("Fins Per Side")
        fd = g.p("Fin Depth")
        fin = g.transform(g.cube(g.vec(g.p("Fin Width"), fd, 1.0)), t=g.vec(0, g.sub(-0.48, g.mul(fd, 0.5)), 0.5))
        # fins evenly spaced along X between the corners
        step = g.div(0.84, g.fmax(g.sub(n, 1), 1))
        line = g.mesh_line(n, (-0.42, 0, 0), g.vec(step, 0, 0))
        side = g.realize(g.instance(line, fin))
        fins = around4(g, side)
    with g.frame("Corners"):
        cs = g.p("Corner Size")
        corner = g.transform(g.cube(g.vec(cs, cs, 1.0)), t=(0, 0, 0.5))
        k = g.sub(0.5, g.mul(cs, 0.5))
        pts = g.grid(g.mul(k, 2.0), g.mul(k, 2.0), 2, 2)
        corners = g.realize(g.instance(pts, corner))
        cap = g.transform(g.cube((1.0, 1.0, 0.01)), t=(0, 0, 0.995))
        frame = g.set_mat(g.join(fins, corners, cap), _M("CC_Facade"))
    g.out("Geometry", g.union(glass, frame))
    return g.finish()


def tower_octa():
    g = GN("CC_Tower_Octa")
    g.inp("Sides", "INT", 8, 4, 16, "Polygon sides of the shaft", panel="Shape")
    g.inp("Rib Size", "FLOAT", 0.035, 0.0, 0.1, panel="Shape")
    g.inp("Crown Height", "FLOAT", 0.02, 0.0, 0.06, panel="Shape")
    with g.frame("Shaft"):
        sides = g.p("Sides")
        # circumradius so the flats touch the unit square
        R = g.div(0.5, g.cos(g.div(PI, sides)))
        shaft = g.cyl(sides, R, 1.0)
        shaft = g.transform(shaft, t=(0, 0, 0.5), r=g.euler(0, 0, g.div(PI, sides)))
        shaft = g.set_mat(shaft, _M("CC_Glass"))
    with g.frame("Ribs & crown"):
        rs = g.p("Rib Size")
        rib = g.transform(g.cube(g.vec(rs, rs, 1.0)), t=(0, 0, 0.5))
        circ = g.node("GeometryNodeMeshCircle", fill_type="NONE")
        g.wire(circ, Vertices=sides, Radius=R)
        circ_r = g.transform(circ.outputs[0], r=g.euler(0, 0, g.div(PI, sides)))
        ribs = g.realize(g.instance(circ_r, rib))
        ch = g.p("Crown Height")
        crown = g.cyl(sides, g.mul(R, 1.03), ch)
        crown = g.transform(crown, t=g.vec(0, 0, g.sub(1.0, g.mul(ch, 0.5))), r=g.euler(0, 0, g.div(PI, sides)))
        frame = g.set_mat(g.join(ribs, crown), _M("CC_Facade"))
    g.out("Geometry", g.union(shaft, frame))
    return g.finish()


def tower_round():
    g = GN("CC_Tower_Round")
    g.inp("Segments", "INT", 28, 8, 64, panel="Shape")
    g.inp("Ribs", "INT", 14, 0, 32, panel="Shape")
    g.inp("Rib Size", "FLOAT", 0.022, 0.0, 0.06, panel="Shape")
    with g.frame("Drum"):
        drum = g.cyl(g.p("Segments"), 0.5, 1.0)
        drum = g.auto_smooth(g.transform(drum, t=(0, 0, 0.5)), 40)
        drum = g.set_mat(drum, _M("CC_Glass"))
    with g.frame("Ribs"):
        rs = g.p("Rib Size")
        rib = g.transform(g.cube(g.vec(rs, rs, 1.0)), t=(0, 0, 0.5))
        circ = g.node("GeometryNodeMeshCircle", fill_type="NONE")
        g.wire(circ, Vertices=g.p("Ribs"), Radius=0.505)
        ribs = g.realize(g.instance(circ.outputs[0], rib))
        crown = g.transform(g.cyl(g.p("Segments"), 0.52, 0.016), t=(0, 0, 0.992))
        base = g.transform(g.cyl(g.p("Segments"), 0.515, 0.02), t=(0, 0, 0.01))
        frame = g.set_mat(g.join(ribs, crown, base), _M("CC_Facade"))
    g.out("Geometry", g.union(drum, frame))
    return g.finish()


def tower_spine():
    g = GN("CC_Tower_Spine")
    g.inp("Core Width", "FLOAT", 0.26, 0.1, 0.5, "Width of the service core", panel="Shape")
    g.inp("Core Protrusion", "FLOAT", 0.04, 0.0, 0.15, panel="Shape")
    g.inp("Neon Slot", "BOOL", True, desc="Neon strip running up the core", panel="Shape")
    with g.frame("Glass wing"):
        cw = g.p("Core Width")
        gw = g.sub(1.0, cw)
        glass = g.cube(g.vec(gw, 0.92, 1.0))
        glass = g.transform(glass, t=g.vec(g.mul(cw, 0.5), 0, 0.5))
        glass = g.set_mat(glass, _M("CC_Glass"))
    with g.frame("Core"):
        cp = g.p("Core Protrusion")
        cy = g.add(1.0, g.mul(cp, 2.0))
        core = g.cube(g.vec(cw, cy, 1.02))
        cx = g.sub(-0.5, g.mul(cw, -0.5))
        core = g.transform(core, t=g.vec(cx, 0, 0.51))
        core = g.set_mat(core, _M("CC_Facade"))
        slot = g.cube(g.vec(0.035, g.add(cy, 0.006), 0.94))
        slot = g.transform(slot, t=g.vec(cx, 0, 0.5))
        slot = g.set_mat(slot, _M("CC_Neon"))
        slot = g.switch("GEOMETRY", g.p("Neon Slot"), None, slot)
    g.out("Geometry", g.union(glass, core, slot))
    return g.finish()


def tower_stack():
    g = GN("CC_Tower_Stack")
    g.inp("Shafts Per Side", "INT", 3, 0, 8, "Protruding utility shafts", panel="Shape")
    g.inp("Shaft Size", "FLOAT", 0.05, 0.01, 0.15, panel="Shape")
    with g.frame("Block"):
        body = g.set_mat(g.transform(g.cube((0.95, 0.95, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Shafts"):
        n = g.p("Shafts Per Side")
        ss = g.p("Shaft Size")
        shaft = g.transform(g.cube(g.vec(ss, ss, 1.0)), t=g.vec(0, g.sub(-0.475, g.mul(ss, 0.4)), 0.5))
        step = g.div(0.7, g.fmax(g.sub(n, 1), 1))
        line = g.mesh_line(n, (-0.35, 0, 0), g.vec(step, 0, 0))
        side = g.realize(g.instance(line, shaft))
        shafts = around4(g, side)
        roof = g.transform(g.cube((0.98, 0.98, 0.008)), t=(0, 0, 0.996))
        frame = g.set_mat(g.join(shafts, roof), _M("CC_Facade"))
    g.out("Geometry", g.union(body, frame))
    return g.finish()


# ============================================================================ roof clutter (metres)
def roof_ac():
    g = GN("CC_Roof_ACUnit")
    g.inp("Size", "VEC", (3.0, 2.2, 1.6), panel="Shape")
    g.inp("Fans", "INT", 2, 1, 4, panel="Shape")
    with g.frame("Housing"):
        size = g.p("Size")
        sx, sy, sz = g.sep(size)
        box = g.transform(g.cube(size), t=g.vec(0, 0, g.mul(sz, 0.5)))
        box = g.set_mat(box, _M("CC_Metal"))
    with g.frame("Fans"):
        n = g.p("Fans")
        fan = g.cyl(20, 0.62, 0.12)
        step = g.div(sx, n)
        line = g.mesh_line(n, g.vec(g.add(g.mul(sx, -0.5), g.mul(step, 0.5)), 0, g.add(sz, 0.06)), g.vec(step, 0, 0))
        fans = g.set_mat(g.realize(g.instance(line, fan)), _M("CC_Facade"))
    g.out("Geometry", g.join(box, fans))
    return g.finish()


def roof_tank():
    g = GN("CC_Roof_WaterTank")
    g.inp("Radius", "FLOAT", 2.1, 0.5, 5.0, panel="Shape")
    g.inp("Height", "FLOAT", 3.6, 1.0, 8.0, panel="Shape")
    g.inp("Leg Height", "FLOAT", 2.4, 0.5, 6.0, panel="Shape")
    r, h, lh = g.p("Radius"), g.p("Height"), g.p("Leg Height")
    leg = g.transform(g.cube(g.vec(0.25, 0.25, lh)), t=g.vec(0, 0, g.mul(lh, 0.5)))
    k = g.mul(r, 0.6)
    legs = g.realize(g.instance(g.grid(g.mul(k, 2), g.mul(k, 2), 2, 2), leg))
    tank = g.auto_smooth(g.transform(g.cyl(24, r, h), t=g.vec(0, 0, g.add(lh, g.mul(h, 0.5)))), 50)
    roof = g.transform(g.cone(24, 0.25, g.mul(r, 1.06), 1.0), t=g.vec(0, 0, g.add(g.add(lh, h), 0.5)))
    g.out("Geometry", g.join(g.set_mat(legs, _M("CC_Metal")), g.set_mat(g.join(tank, roof), _M("CC_Facade"))))
    return g.finish()


def roof_antenna():
    g = GN("CC_Roof_Antenna")
    g.inp("Height", "FLOAT", 16.0, 4.0, 40.0, panel="Shape")
    g.inp("Cross Bars", "INT", 3, 0, 8, panel="Shape")
    h = g.p("Height")
    mast = g.transform(g.cube(g.vec(0.32, 0.32, h)), t=g.vec(0, 0, g.mul(h, 0.5)))
    n = g.p("Cross Bars")
    bar = g.cube((2.2, 0.12, 0.12))
    line = g.mesh_line(n, g.vec(0, 0, g.mul(h, 0.4)), g.vec(0, 0, g.div(g.mul(h, 0.5), g.fmax(n, 1))))
    bars = g.realize(g.instance(line, bar))
    beacon = g.transform(g.uvsphere(12, 6, 0.32), t=g.vec(0, 0, g.add(h, 0.25)))
    g.out("Geometry", g.join(g.set_mat(g.join(mast, bars), _M("CC_Metal")), g.set_mat(beacon, _M("CC_Beacon"))))
    return g.finish()


def roof_dish():
    g = GN("CC_Roof_Dish")
    g.inp("Dish Radius", "FLOAT", 1.7, 0.5, 4.0, panel="Shape")
    g.inp("Tilt", "FLOAT", 0.6, 0.0, 1.4, subtype="ANGLE", panel="Shape")
    r = g.p("Dish Radius")
    stand = g.transform(g.cyl(10, 0.18, 2.2), t=(0, 0, 1.1))
    dish = g.cone(24, r, 0.25, g.mul(r, 0.35))
    dish = g.transform(dish, t=(0, 0, 2.4), r=g.euler(g.p("Tilt"), 0, 0))
    arm = g.transform(g.cube((0.08, 0.08, 1.6)), t=(0, -0.5, 2.9), r=(0.6, 0, 0))
    g.out("Geometry", g.join(g.set_mat(g.join(stand, arm), _M("CC_Metal")), g.set_mat(g.auto_smooth(dish, 50), _M("CC_Facade"))))
    return g.finish()


def roof_hut():
    g = GN("CC_Roof_Hut")
    g.inp("Size", "VEC", (5.0, 4.0, 3.4), panel="Shape")
    size = g.p("Size")
    sx, sy, sz = g.sep(size)
    hut = g.transform(g.cube(size), t=g.vec(0, 0, g.mul(sz, 0.5)))
    door = g.transform(g.cube((1.2, 0.1, 2.2)), t=g.vec(0, g.mul(sy, -0.5), 1.1))
    strip = g.transform(g.cube(g.vec(g.add(sx, 0.04), g.add(sy, 0.04), 0.12)), t=g.vec(0, 0, g.sub(sz, 0.3)))
    g.out("Geometry", g.join(g.set_mat(hut, _M("CC_Concrete")), g.set_mat(door, _M("CC_Light")), g.set_mat(strip, _M("CC_Neon"))))
    return g.finish()


def roof_vents():
    g = GN("CC_Roof_Vents")
    g.inp("Count", "INT", 3, 1, 6, panel="Shape")
    g.inp("Radius", "FLOAT", 0.5, 0.2, 1.2, panel="Shape")
    n, r = g.p("Count"), g.p("Radius")
    pipe = g.auto_smooth(g.transform(g.cyl(14, r, 2.6), t=(0, 0, 1.3)), 50)
    cap = g.transform(g.cone(14, 0.05, g.mul(r, 1.5), 0.6), t=(0, 0, 2.95))
    unit = g.join(g.set_mat(pipe, _M("CC_Metal")), g.set_mat(cap, _M("CC_Facade")))
    line = g.mesh_line(n, (-1.5, 0, 0), (1.5, 0, 0))
    g.out("Geometry", g.realize(g.instance(line, unit)))
    return g.finish()


def landmark_spire():
    g = GN("CC_Landmark_Spire")
    g.inp("Rings", "INT", 4, 0, 10, "Neon rings around the spire", panel="Shape")
    g.inp("Taper", "FLOAT", 0.06, 0.0, 0.5, "Top radius (fraction)", panel="Shape")
    n = g.p("Rings")
    spire = g.cone(8, g.p("Taper"), 0.5, 1.0)
    spire = g.set_mat(g.transform(spire, t=(0, 0, 0.5), r=(0, 0, PI / 8)), _M("CC_Metal"))
    ring = g.cyl(24, 0.5, 0.012)
    # rings shrink with the cone: scale each instance by (1 - z)
    line = g.mesh_line(n, (0, 0, 0.12), g.vec(0, 0, g.div(0.7, g.fmax(n, 1))))
    _, _, z = g.sep(g.position())
    sc = g.vec(g.sub(1.04, z), g.sub(1.04, z), 1.0)
    rings = g.realize(g.instance(line, ring, scale=sc))
    rings = g.set_mat(rings, _M("CC_Neon"))
    beacon = g.set_mat(g.transform(g.uvsphere(10, 5, 0.03), t=(0, 0, 1.0)), _M("CC_Beacon"))
    g.out("Geometry", g.join(spire, rings, beacon))
    return g.finish()


# ============================================================================ signage & screens
def _sign_face(g, w, h):
    """A face plane (W x H) in the XZ plane facing -Y, UV 0..1, centred at origin."""
    face = g.grid(w, h, 2, 2)
    return g.transform(face, r=(PI / 2, 0, 0))


def _outline(g, w, h, t):
    top = g.transform(g.cube(g.vec(g.add(w, t), t, t)), t=g.vec(0, 0, g.mul(h, 0.5)))
    bot = g.transform(g.cube(g.vec(g.add(w, t), t, t)), t=g.vec(0, 0, g.mul(h, -0.5)))
    lef = g.transform(g.cube(g.vec(t, t, h)), t=g.vec(g.mul(w, -0.5), 0, 0))
    rig = g.transform(g.cube(g.vec(t, t, h)), t=g.vec(g.mul(w, 0.5), 0, 0))
    return g.join(top, bot, lef, rig)


def sign_blade():
    g = GN("CC_Sign_Blade")
    g.inp("Size", "VEC", (2.6, 0.5, 9.0), "Reach from wall (X), thickness (Y), height (Z)", panel="Shape")
    g.inp("Wall Gap", "FLOAT", 0.45, 0.0, 2.0, panel="Shape")
    g.inp("Tube", "FLOAT", 0.07, 0.0, 0.2, "Neon outline thickness", panel="Shape")
    size = g.p("Size")
    reach, thick, h = g.sep(size)
    gap = g.p("Wall Gap")
    cy = g.mul(g.add(gap, g.mul(reach, 0.5)), -1.0)
    with g.frame("Box"):
        box = g.transform(g.cube(g.vec(thick, reach, h)), t=g.vec(0, cy, g.mul(h, 0.5)))
        brk = g.cube(g.vec(0.18, gap, 0.18))
        b1 = g.transform(brk, t=g.vec(0, g.mul(gap, -0.5), g.mul(h, 0.2)))
        b2 = g.transform(brk, t=g.vec(0, g.mul(gap, -0.5), g.mul(h, 0.8)))
        frame = g.set_mat(g.join(box, b1, b2), _M("CC_Metal"))
    with g.frame("Faces"):
        fw, fh = g.sub(reach, 0.24), g.sub(h, 0.24)
        face = _sign_face(g, fw, fh)
        off = g.add(g.mul(thick, 0.5), 0.01)
        fpos = g.transform(face, t=g.vec(off, cy, g.mul(h, 0.5)), r=(0, 0, PI / 2))
        fneg = g.transform(face, t=g.vec(g.mul(off, -1.0), cy, g.mul(h, 0.5)), r=(0, 0, -PI / 2))
        faces = g.set_mat(g.join(fpos, fneg), _M("CC_Sign"))
    with g.frame("Neon outline"):
        t = g.p("Tube")
        ol = _outline(g, reach, h, t)
        ol = g.transform(ol, t=(0, 0, 0), r=(0, 0, PI / 2))
        o1 = g.transform(ol, t=g.vec(g.add(off, 0.03), cy, g.mul(h, 0.5)))
        o2 = g.transform(ol, t=g.vec(g.mul(g.add(off, 0.03), -1.0), cy, g.mul(h, 0.5)))
        neon = g.set_mat(g.join(o1, o2), _M("CC_Neon"))
    g.out("Geometry", g.join(frame, faces, neon))
    return g.finish()


def _flat_sign(name, size):
    g = GN(name)
    g.inp("Size", "VEC", size, "Width (X), depth (Y), height (Z)", panel="Shape")
    g.inp("Tube", "FLOAT", 0.08, 0.0, 0.2, "Neon outline thickness", panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    box = g.transform(g.cube(s), t=g.vec(0, g.mul(d, -0.5), g.mul(h, 0.5)))
    face = _sign_face(g, g.sub(w, 0.24), g.sub(h, 0.24))
    face = g.transform(face, t=g.vec(0, g.sub(g.mul(d, -1.0), 0.01), g.mul(h, 0.5)))
    ol = _outline(g, w, h, g.p("Tube"))
    ol = g.transform(ol, t=g.vec(0, g.sub(g.mul(d, -1.0), 0.04), g.mul(h, 0.5)))
    g.out("Geometry", g.join(g.set_mat(box, _M("CC_Metal")), g.set_mat(face, _M("CC_Sign")), g.set_mat(ol, _M("CC_Neon"))))
    return g.finish()


def sign_wide():
    return _flat_sign("CC_Sign_Wide", (8.0, 0.35, 2.6))


def sign_tall():
    return _flat_sign("CC_Sign_Tall", (2.8, 0.35, 10.0))


def sign_roof():
    g = GN("CC_Sign_Roof")
    g.inp("Size", "VEC", (14.0, 0.4, 4.6), panel="Shape")
    g.inp("Leg Height", "FLOAT", 3.0, 0.5, 8.0, panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    lh = g.p("Leg Height")
    zc = g.add(lh, g.mul(h, 0.5))
    box = g.transform(g.cube(s), t=g.vec(0, 0, zc))
    leg = g.transform(g.cube(g.vec(0.35, 0.35, lh)), t=g.vec(0, 0, g.mul(lh, 0.5)))
    legs = g.join(g.transform(leg, t=g.vec(g.mul(w, -0.33), 0, 0)), g.transform(leg, t=g.vec(g.mul(w, 0.33), 0, 0)))
    face = _sign_face(g, g.sub(w, 0.3), g.sub(h, 0.3))
    front = g.transform(face, t=g.vec(0, g.sub(g.mul(d, -0.5), 0.01), zc))
    back = g.transform(face, t=g.vec(0, g.add(g.mul(d, 0.5), 0.01), zc), r=(0, 0, PI))
    walk = g.transform(g.cube(g.vec(w, 1.2, 0.12)), t=g.vec(0, -0.9, lh))
    g.out("Geometry", g.join(g.set_mat(g.join(box, legs, walk), _M("CC_Metal")), g.set_mat(g.join(front, back), _M("CC_Sign"))))
    return g.finish()


def screen_billboard():
    g = GN("CC_Screen_Billboard")
    g.inp("Size", "VEC", (16.0, 0.6, 9.0), "Screen width, depth, height", panel="Shape")
    g.inp("Wall Gap", "FLOAT", 0.8, 0.0, 3.0, panel="Shape")
    g.inp("Bezel", "FLOAT", 0.35, 0.0, 1.0, panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    gap, bz = g.p("Wall Gap"), g.p("Bezel")
    yc = g.mul(g.add(gap, g.mul(d, 0.5)), -1.0)
    box = g.transform(g.cube(g.vec(g.add(w, g.mul(bz, 2)), d, g.add(h, g.mul(bz, 2)))), t=g.vec(0, yc, g.mul(h, 0.5)))
    strut = g.cube(g.vec(0.3, 0.3, gap))
    struts = g.realize(g.instance(g.grid(g.mul(w, 0.7), g.mul(h, 0.7), 2, 2), strut))
    struts = g.transform(struts, t=g.vec(0, g.mul(gap, -0.5), g.mul(h, 0.5)), r=(PI / 2, 0, 0))
    face = _sign_face(g, w, h)
    face = g.transform(face, t=g.vec(0, g.sub(g.sub(yc, g.mul(d, 0.5)), 0.01), g.mul(h, 0.5)))
    g.out("Geometry", g.join(g.set_mat(g.join(box, struts), _M("CC_Metal")), g.set_mat(face, _M("CC_Screen"))))
    return g.finish()


# ============================================================================ street & structure
def street_sidewalk():
    g = GN("CC_Street_Sidewalk")
    g.inp("Curb Lip", "FLOAT", 0.03, 0.0, 0.1, "Bevel lip ratio", panel="Shape")
    slab = g.transform(g.cube((1.0, 1.0, 1.0)), t=(0, 0, 0.5))
    lip = g.p("Curb Lip")
    k = g.add(1.0, lip)
    curb = g.transform(g.cube(g.vec(k, k, 0.2)), t=(0, 0, 0.1))
    g.out("Geometry", g.set_mat(g.join(slab, curb), _M("CC_Concrete")))
    return g.finish()


def street_lamp():
    g = GN("CC_Street_Lamp")
    g.inp("Height", "FLOAT", 7.5, 3.0, 14.0, panel="Shape")
    g.inp("Arm", "FLOAT", 2.0, 0.5, 4.0, panel="Shape")
    h, a = g.p("Height"), g.p("Arm")
    pole = g.transform(g.cyl(10, 0.12, h), t=g.vec(0, 0, g.mul(h, 0.5)))
    arm = g.transform(g.cube(g.vec(0.1, a, 0.12)), t=g.vec(0, g.mul(a, -0.5), h))
    head = g.transform(g.cube(g.vec(0.42, 1.1, 0.16)), t=g.vec(0, g.sub(0.0, a), g.sub(h, 0.05)))
    light = g.transform(g.cube(g.vec(0.3, 0.95, 0.04)), t=g.vec(0, g.sub(0.0, a), g.sub(h, 0.14)))
    g.out("Geometry", g.join(g.set_mat(g.join(pole, arm, head), _M("CC_Metal")), g.set_mat(light, _M("CC_Light"))))
    return g.finish()


def street_bridge():
    g = GN("CC_Street_Skybridge")
    g.inp("Width", "FLOAT", 6.0, 2.0, 12.0, panel="Shape")
    g.inp("Height", "FLOAT", 4.2, 2.0, 8.0, panel="Shape")
    w, h = g.p("Width"), g.p("Height")
    floor = g.transform(g.cube(g.vec(1.0, w, 0.6)), t=(0, 0, 0.3))
    roof = g.transform(g.cube(g.vec(1.0, w, 0.5)), t=g.vec(0, 0, g.sub(h, 0.25)))
    glass = g.transform(g.cube(g.vec(1.0, g.sub(w, 0.3), g.sub(h, 1.1))), t=g.vec(0, 0, g.mul(h, 0.5)))
    band = g.transform(g.cube(g.vec(1.0, g.sub(w, 0.25), 0.18)), t=g.vec(0, 0, g.sub(h, 0.62)))
    n1 = g.transform(g.cube((1.0, 0.1, 0.1)), t=g.vec(0, g.mul(w, 0.5), 0.05))
    n2 = g.transform(g.cube((1.0, 0.1, 0.1)), t=g.vec(0, g.mul(w, -0.5), 0.05))
    g.out("Geometry", g.join(g.set_mat(g.join(floor, roof), _M("CC_Facade")), g.set_mat(glass, _M("CC_Glass")),
                             g.set_mat(band, _M("CC_Light")), g.set_mat(g.join(n1, n2), _M("CC_Neon"))))
    return g.finish()


def neon_bar():
    g = GN("CC_NeonBar")
    g.inp("Segments", "INT", 1, 1, 4, panel="Shape")
    bar = g.transform(g.cube((1.0, 1.0, 1.0), verts=(2, 2, 2)), t=(0, 0, 0.5))
    g.out("Geometry", g.set_mat(bar, _M("CC_Neon")))
    return g.finish()


# ============================================================================ holograms
def holo_diamond():
    g = GN("CC_Holo_Diamond")
    g.inp("Stretch", "FLOAT", 1.8, 0.5, 4.0, panel="Shape")
    oct_ = g.node("GeometryNodeMeshUVSphere")
    g.wire(oct_, Segments=4, Rings=2, Radius=0.5)
    d = g.transform(oct_.outputs[0], t=g.vec(0, 0, g.mul(g.p("Stretch"), 0.5)), s=g.vec(1, 1, g.p("Stretch")))
    inner = g.transform(d, s=(0.6, 0.6, 0.6), t=g.vec(0, 0, g.mul(g.p("Stretch"), 0.2)))
    g.out("Geometry", g.set_mat(g.join(d, inner), _M("CC_Holo")))
    return g.finish()


def holo_rings():
    g = GN("CC_Holo_Rings")
    g.inp("Rings", "INT", 3, 1, 6, panel="Shape")
    g.inp("Tube", "FLOAT", 0.025, 0.005, 0.1, panel="Shape")
    circle = g.node("GeometryNodeCurvePrimitiveCircle")
    g.wire(circle, Resolution=64, Radius=0.5)
    prof = g.node("GeometryNodeCurvePrimitiveCircle")
    g.wire(prof, Resolution=8, Radius=g.p("Tube"))
    tor = g.node("GeometryNodeCurveToMesh")
    g.wire(tor, Curve=circle.outputs[0], Profile_Curve=prof.outputs[0])
    ring = tor.outputs[0]
    n = g.p("Rings")
    line = g.mesh_line(n, (0, 0, 0.5), (0, 0, 0))
    idx = g.index()
    rot = g.vec(g.mul(idx, 1.0), g.mul(idx, 0.6), 0)
    rings = g.realize(g.instance(line, ring, rot=rot, scale=g.vec(g.sub(1.0, g.mul(idx, 0.12)), g.sub(1.0, g.mul(idx, 0.12)), g.sub(1.0, g.mul(idx, 0.12)))))
    core = g.transform(g.ico(0.12, 1), t=(0, 0, 0.5))
    g.out("Geometry", g.set_mat(g.join(rings, core), _M("CC_Holo")))
    return g.finish()


# ============================================================================ traffic car
def traffic_car():
    g = GN("CC_Vehicle_Traffic")
    g.inp("Length", "FLOAT", 4.6, 3.0, 9.0, panel="Shape")
    g.inp("Width", "FLOAT", 1.9, 1.2, 3.0, panel="Shape")
    L, W = g.p("Length"), g.p("Width")
    body = g.cube(g.vec(L, W, 0.7), verts=(3, 2, 2))
    # wedge the nose: lower the top-front vertices
    px, py, pz = g.sep(g.position())
    front_top = g.band(g.cmp("GREATER_THAN", px, 0.1), g.cmp("GREATER_THAN", pz, 0.0))
    body = g.set_pos(body, offset=(0, 0, -0.25), sel=front_top)
    body = g.transform(body, t=(0, 0, 0.6))
    cabin = g.cube(g.vec(g.mul(L, 0.45), g.mul(W, 0.82), 0.5))
    cabin = g.transform(cabin, t=g.vec(g.mul(L, -0.08), 0, 1.15))
    head = g.transform(g.cube(g.vec(0.06, g.mul(W, 0.86), 0.12)), t=g.vec(g.mul(L, 0.5), 0, 0.62))
    tail = g.transform(g.cube(g.vec(0.06, g.mul(W, 0.9), 0.16)), t=g.vec(g.mul(L, -0.5), 0, 0.72))
    under = g.transform(g.cube(g.vec(g.mul(L, 0.7), g.mul(W, 0.7), 0.04)), t=(0, 0, 0.22))
    g.out("Geometry", g.join(
        g.set_mat(body, _M("CC_CarPaint")), g.set_mat(cabin, _M("CC_CarGlass")),
        g.set_mat(head, _M("CC_HeadLight")), g.set_mat(tail, _M("CC_TailLight")),
        g.set_mat(under, _M("CC_CarNeon"))))
    return g.finish()



# ============================================================================ v2 archetypes
def _twist(g, geo, amount):
    """Rotate every vertex around Z by z * amount (unit-height pieces)."""
    px, py, pz = g.sep(g.position())
    a = g.mul(pz, amount)
    c, s_ = g.cos(a), g.sin(a)
    return g.set_pos(geo, pos=g.vec(g.sub(g.mul(px, c), g.mul(py, s_)), g.add(g.mul(px, s_), g.mul(py, c)), pz))


def tower_twist():
    g = GN("CC_Tower_Twist")
    g.inp("Twist", "FLOAT", 1.1, 0.0, 3.0, "Rotation from base to top (rad)", "ANGLE", "Shape")
    g.inp("Segments", "INT", 28, 4, 64, "Vertical resolution of the twist", panel="Shape")
    g.inp("Rib Size", "FLOAT", 0.05, 0.0, 0.12, panel="Shape")
    seg = g.p("Segments")
    with g.frame("Shaft"):
        glass = g.set_mat(g.transform(g.cube((0.66, 0.66, 1.0), verts=(2, 2, seg)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Ribs"):
        rs = g.p("Rib Size")
        rib = g.transform(g.cube(g.vec(rs, rs, 1.0), verts=(2, 2, seg)), t=(0, 0, 0.5))
        ribs = g.realize(g.instance(g.grid(0.66, 0.66, 2, 2), rib))
        bands = g.realize(g.instance(g.mesh_line(6, (0, 0, 0.16), (0, 0, 0.16)), g.cube((0.69, 0.69, 0.006))))
        frame = g.set_mat(g.join(ribs, bands), _M("CC_Facade"))
        crown = g.set_mat(g.transform(g.cube((0.7, 0.7, 0.02)), t=(0, 0, 0.99)), _M("CC_Neon"))
    g.out("Geometry", _twist(g, g.union(glass, frame, crown), g.p("Twist")))
    return g.finish()


def tower_taper():
    g = GN("CC_Tower_Taper")
    g.inp("Taper", "FLOAT", 0.52, 0.2, 1.0, "Top width relative to the base", "FACTOR", "Shape")
    g.inp("Pyramid", "FLOAT", 0.07, 0.0, 0.3, "Height of the pyramid cap", panel="Shape")
    with g.frame("Frustum"):
        body = g.set_mat(g.transform(g.cube((0.98, 0.98, 1.0), verts=(2, 2, 6)), t=(0, 0, 0.5)), _M("CC_Glass"))
        rib = g.transform(g.cube((0.06, 0.06, 1.0), verts=(2, 2, 6)), t=(0, 0, 0.5))
        ribs = g.set_mat(g.realize(g.instance(g.grid(0.94, 0.94, 2, 2), rib)), _M("CC_Facade"))
        px, py, pz = g.sep(g.position())
        k = g.sub(1.0, g.mul(pz, g.sub(1.0, g.p("Taper"))))
        shaft = g.set_pos(g.join(body, ribs), pos=g.vec(g.mul(px, k), g.mul(py, k), pz))
    with g.frame("Cap"):
        tp = g.p("Taper")
        cap = g.cone(4, 0.0, g.mul(tp, 0.69), g.p("Pyramid"))
        cap = g.transform(cap, t=g.vec(0, 0, g.add(1.0, g.mul(g.p("Pyramid"), 0.5))), r=(0, 0, PI / 4))
        cap = g.set_mat(cap, _M("CC_Metal"))
        ring = g.set_mat(g.transform(g.cube(g.vec(g.add(tp, 0.03), g.add(tp, 0.03), 0.008)), t=(0, 0, 0.996)), _M("CC_Neon"))
    g.out("Geometry", g.union(shaft, cap, ring))
    return g.finish()


def tower_diagrid():
    g = GN("CC_Tower_Diagrid")
    g.inp("Columns", "INT", 3, 1, 8, "Diamonds across a facade", panel="Shape")
    g.inp("Rows", "INT", 7, 2, 20, "Diamonds up the tower", panel="Shape")
    g.inp("Strut", "FLOAT", 0.014, 0.004, 0.05, "Strut thickness", panel="Shape")
    with g.frame("Core"):
        glass = g.set_mat(g.transform(g.cube((0.94, 0.94, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Diagrid"):
        cols, rows, st = g.p("Columns"), g.p("Rows"), g.p("Strut")
        cw, chh = g.div(1.0, cols), g.div(1.0, rows)
        ln = g.math("SQRT", g.add(g.mul(cw, cw), g.mul(chh, chh)))
        ang = g.math("ARCTAN2", chh, cw)
        strut = g.cube(g.vec(ln, st, st))
        # cell centres of a cols x rows lattice on the -Y facade (XZ plane)
        pts = g.grid(g.div(g.sub(cols, 1), cols), g.div(g.sub(rows, 1), rows), cols, rows)
        pts = g.transform(pts, t=(0, -0.49, 0.5), r=(PI / 2, 0, 0))
        a1 = g.realize(g.instance(pts, strut, rot=g.vec(0, g.mul(ang, -1.0), 0)))
        a2 = g.realize(g.instance(pts, strut, rot=g.vec(0, ang, 0)))
        grid = g.set_mat(around4(g, g.join(a1, a2)), _M("CC_Metal"))
        cap = g.set_mat(g.transform(g.cube((1.0, 1.0, 0.012)), t=(0, 0, 0.994)), _M("CC_Facade"))
    g.out("Geometry", g.union(glass, grid, cap))
    return g.finish()


def tower_ziggurat():
    g = GN("CC_Tower_Ziggurat")
    g.inp("Step Inset", "FLOAT", 0.17, 0.05, 0.3, "Inset of each step", "FACTOR", "Shape")
    g.inp("Ledge Glow", "BOOL", True, "Neon strips on every ledge", panel="Shape")
    si = g.p("Step Inset")
    parts, ledges, glows = [], [], []
    bounds = [0.0, 0.42, 0.66, 0.85, 1.0]
    for k in range(4):
        z0, z1 = bounds[k], bounds[k + 1]
        w = g.sub(1.0, g.mul(si, float(k)))
        parts.append(g.transform(g.cube(g.vec(w, w, z1 - z0)), t=(0, 0, (z0 + z1) / 2)))
        if k < 3:
            ledges.append(g.transform(g.cube(g.vec(g.add(w, 0.02), g.add(w, 0.02), 0.008)), t=(0, 0, z1)))
            glows.append(g.transform(g.cube(g.vec(g.add(w, 0.024), g.add(w, 0.024), 0.003)), t=(0, 0, z1 + 0.004)))
    glow = g.switch("GEOMETRY", g.p("Ledge Glow"), None, g.set_mat(g.join(*glows), _M("CC_Neon")))
    g.out("Geometry", g.union(g.set_mat(g.join(*parts), _M("CC_Glass")), g.set_mat(g.join(*ledges), _M("CC_Facade")), glow))
    return g.finish()


def tower_cantilever():
    g = GN("CC_Tower_Cantilever")
    g.inp("Core Size", "FLOAT", 0.6, 0.3, 0.9, "Footprint of the core", "FACTOR", "Shape")
    g.inp("Pod Height", "FLOAT", 0.1, 0.03, 0.25, "Height of each pod (fraction)", panel="Shape")
    cs, ph = g.p("Core Size"), g.p("Pod Height")
    core = g.set_mat(g.transform(g.cube(g.vec(cs, cs, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    reach = g.sub(0.5, g.mul(cs, 0.5))
    pw = g.mul(cs, 0.9)
    pods, frames, neons = [], [], []
    for z, side in ((0.28, 0), (0.46, 1), (0.63, 2), (0.8, 3)):
        yc = g.mul(g.add(g.mul(cs, 0.5), g.mul(reach, 0.5)), -1.0)
        pod = g.transform(g.cube(g.vec(pw, reach, ph)), t=g.vec(0, yc, z))
        fr = g.transform(g.cube(g.vec(g.add(pw, 0.02), g.add(reach, 0.01), 0.01)), t=g.vec(0, yc, g.sub(z, g.mul(ph, 0.5))))
        nb = g.transform(g.cube(g.vec(pw, 0.012, 0.004)), t=g.vec(0, -0.497, g.sub(z, g.mul(ph, 0.5))))
        rot = (0, 0, side * PI / 2)
        pods.append(g.transform(pod, r=rot))
        frames.append(g.transform(fr, r=rot))
        neons.append(g.transform(nb, r=rot))
    g.out("Geometry", g.union(core, g.set_mat(g.join(*pods), _M("CC_Glass")), g.set_mat(g.join(*frames), _M("CC_Facade")),
                              g.set_mat(g.join(*neons), _M("CC_Neon"))))
    return g.finish()


def tower_lplan():
    g = GN("CC_Tower_LPlan")
    g.inp("Wing Width", "FLOAT", 0.46, 0.25, 0.7, "Width of each wing", "FACTOR", "Shape")
    g.inp("Second Wing Height", "FLOAT", 0.78, 0.3, 1.0, "Height of the lower wing", "FACTOR", "Shape")
    ww, h2 = g.p("Wing Width"), g.p("Second Wing Height")
    off = g.sub(0.5, g.mul(ww, 0.5))
    a = g.transform(g.cube(g.vec(1.0, ww, 1.0)), t=g.vec(0, off, 0.5))
    b = g.transform(g.cube(g.vec(ww, 1.0, h2)), t=g.vec(g.mul(off, -1.0), 0, g.mul(h2, 0.5)))
    corner = g.transform(g.cube((0.05, 0.05, 1.0)), t=(0.475, 0.475, 0.5))
    deck = g.transform(g.cube(g.vec(g.add(ww, 0.02), 1.02, 0.01)), t=g.vec(g.mul(off, -1.0), 0, h2))
    g.out("Geometry", g.union(g.set_mat(g.join(a, b), _M("CC_Glass")), g.set_mat(g.join(corner, deck), _M("CC_Facade"))))
    return g.finish()


def tower_cross():
    g = GN("CC_Tower_Cross")
    g.inp("Arm Width", "FLOAT", 0.42, 0.2, 0.7, "Width of the cross arms", "FACTOR", "Shape")
    g.inp("Core Rise", "FLOAT", 0.06, 0.0, 0.2, "Core rises above the arms", panel="Shape")
    aw, cr = g.p("Arm Width"), g.p("Core Rise")
    a = g.transform(g.cube(g.vec(1.0, aw, 1.0)), t=(0, 0, 0.5))
    b = g.transform(g.cube(g.vec(aw, 1.0, 1.0)), t=(0, 0, 0.5))
    core = g.transform(g.cube(g.vec(g.mul(aw, 0.8), g.mul(aw, 0.8), g.add(1.0, cr))), t=g.vec(0, 0, g.mul(g.add(1.0, cr), 0.5)))
    tips = [g.transform(g.cube(g.vec(0.02, g.add(aw, 0.01), 1.0)), t=(0.5, 0, 0.5)) for _ in range(1)]
    tips = [g.transform(tips[0], r=(0, 0, k * PI / 2)) for k in range(4)]
    crown = g.transform(g.cube(g.vec(g.mul(aw, 0.84), g.mul(aw, 0.84), 0.006)), t=g.vec(0, 0, g.add(1.0, cr)))
    g.out("Geometry", g.union(g.set_mat(g.join(a, b), _M("CC_Glass")), g.set_mat(core, _M("CC_Facade")),
                              g.set_mat(g.join(*tips), _M("CC_Facade")), g.set_mat(crown, _M("CC_Neon"))))
    return g.finish()


def tower_kowloon():
    g = GN("CC_Tower_Kowloon")
    g.inp("Module Density", "FLOAT", 80.0, 0.0, 400.0, "Protruding room modules per unit facade", panel="Shape")
    g.inp("Seed", "INT", 3, 0, 999, panel="Shape")
    with g.frame("Block"):
        shell = g.set_mat(g.transform(g.cube((0.86, 0.86, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    with g.frame("Modules"):
        sides = g.transform(g.cube((0.86, 0.86, 0.94)), t=(0, 0, 0.5))
        _, _, nz = g.sep(g.normal())
        dist = g.node("GeometryNodeDistributePointsOnFaces", distribute_method="RANDOM")
        g.wire(dist, Mesh=sides, Density=g.p("Module Density"), Seed=g.p("Seed"))
        g.set(g.i(dist, "Selection"), g.cmp("LESS_THAN", g.absf(nz), 0.5))
        idx = g.index()
        sx = g.rand_f(idx, 11, 0.05, 0.13)
        sy = g.rand_f(idx, 12, 0.03, 0.07)
        sz = g.rand_f(idx, 13, 0.018, 0.045)
        mods = g.instance(g.o(dist, "Points"), g.cube((1.0, 1.0, 1.0)), rot=g.o(dist, "Rotation"), scale=g.vec(sx, sz, sy))
        mods = g.set_mat(g.realize(mods), _M("CC_Facade"))
        lit = g.instance(g.o(dist, "Points"), g.cube((1.0, 1.0, 1.0)), sel=g.cmp("LESS_THAN", g.rand_f(idx, 14), 0.35),
                         rot=g.o(dist, "Rotation"), scale=g.vec(g.mul(sx, 0.6), g.mul(sz, 0.5), g.add(sy, 0.002)))
        lit = g.set_mat(g.realize(lit), _M("CC_Light"))
    g.out("Geometry", g.join(shell, mods, lit))
    return g.finish()


def tower_arcology():
    g = GN("CC_Tower_Arcology")
    g.inp("Gap", "FLOAT", 0.05, 0.01, 0.12, "Height of the sky-garden gaps", panel="Shape")
    gp = g.p("Gap")
    segs, gardens, cols = [], [], []
    for z0, z1 in ((0.0, 0.32), (0.32, 0.66), (0.66, 1.0)):
        a0 = g.add(z0, gp) if z0 > 0 else 0.0
        h = g.sub(z1, a0) if z0 > 0 else z1
        cz = g.mul(g.add(a0, z1), 0.5) if z0 > 0 else z1 / 2
        segs.append(g.transform(g.cube(g.vec(1.0, 1.0, h)), t=g.vec(0, 0, cz)))
        if z0 > 0.0:
            gardens.append(g.transform(g.cube((0.84, 0.84, 0.006)), t=(0, 0, z0 + 0.004)))
            col = g.transform(g.cube(g.vec(0.05, 0.05, gp)), t=g.vec(0, 0, g.add(z0, g.mul(gp, 0.5))))
            cols.append(g.realize(g.instance(g.grid(0.88, 0.88, 2, 2), col)))
            cols.append(g.transform(g.cube(g.vec(0.3, 0.3, gp)), t=g.vec(0, 0, g.add(z0, g.mul(gp, 0.5)))))
    g.out("Geometry", g.union(g.set_mat(g.join(*segs), _M("CC_Glass")), g.set_mat(g.join(*cols), _M("CC_Facade")),
                              g.set_mat(g.join(*gardens), _M("CC_Light"))))
    return g.finish()


def tower_blade():
    g = GN("CC_Tower_Blade")
    g.inp("Depth", "FLOAT", 0.46, 0.2, 0.9, "Slab depth (fraction of footprint)", "FACTOR", "Shape")
    g.inp("Screen Width", "FLOAT", 0.3, 0.1, 0.8, "Width of the vertical LED screens", "FACTOR", "Shape")
    dp, sw = g.p("Depth"), g.p("Screen Width")
    slab = g.set_mat(g.transform(g.cube(g.vec(1.0, dp, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
    off = g.add(g.mul(dp, 0.5), 0.004)
    face = _sign_face(g, sw, 0.86)
    front = g.transform(face, t=g.vec(0, g.mul(off, -1.0), 0.52))
    back = g.transform(face, t=g.vec(0, off, 0.52), r=(0, 0, PI))
    screens = g.set_mat(g.join(front, back), _M("CC_Screen"))
    bez = g.transform(g.cube(g.vec(g.add(sw, 0.03), g.add(dp, 0.004), 0.89)), t=(0, 0, 0.52))
    ends = g.transform(g.cube(g.vec(0.04, g.add(dp, 0.02), 1.02)), t=(0.49, 0, 0.51))
    ends2 = g.transform(ends, s=(-1, 1, 1))
    g.out("Geometry", g.join(g.union(slab, g.set_mat(g.join(bez, ends, g.flip(ends2)), _M("CC_Facade"))), screens))
    return g.finish()


def tower_deco():
    g = GN("CC_Tower_Deco")
    g.inp("Needle", "FLOAT", 0.14, 0.0, 0.4, "Spire needle above the crown", panel="Shape")
    shaft = g.set_mat(g.transform(g.cube((0.92, 0.92, 0.84)), t=(0, 0, 0.42)), _M("CC_Glass"))
    pil = g.transform(g.cube((0.07, 0.07, 0.86)), t=(0, 0, 0.43))
    pils = g.set_mat(g.realize(g.instance(g.grid(0.9, 0.9, 2, 2), pil)), _M("CC_Facade"))
    steps, glows = [], []
    for k in range(5):
        w = 0.92 - k * 0.15
        z0 = 0.84 + k * 0.032
        steps.append(g.transform(g.cube((w, w, 0.032)), t=(0, 0, z0 + 0.016)))
        glows.append(g.transform(g.cube((w + 0.012, w + 0.012, 0.004)), t=(0, 0, z0 + 0.03)))
    nd = g.p("Needle")
    needle = g.transform(g.cone(8, 0.0, 0.05, nd), t=g.vec(0, 0, g.add(1.0, g.mul(nd, 0.5))))
    g.out("Geometry", g.union(shaft, pils, g.set_mat(g.join(*steps), _M("CC_Facade")), g.set_mat(g.join(*glows), _M("CC_Neon")),
                              g.set_mat(needle, _M("CC_Metal"))))
    return g.finish()


def tower_hex():
    g = GN("CC_Tower_Hex")
    g.inp("Fin Depth", "FLOAT", 0.04, 0.0, 0.12, panel="Shape")
    R = 0.5 / math.cos(PI / 6)
    shaft = g.set_mat(g.transform(g.cyl(6, R * 0.94, 1.0), t=(0, 0, 0.5)), _M("CC_Glass"))
    fd = g.p("Fin Depth")
    fin = g.transform(g.cube(g.vec(fd, 0.02, 1.0)), t=g.vec(g.mul(fd, 0.5), 0, 0.5))
    circ = g.node("GeometryNodeMeshCircle", fill_type="NONE")
    g.wire(circ, Vertices=6, Radius=R * 0.94)
    px, py, _ = g.sep(g.position())
    rot = g.vec(0, 0, g.math("ARCTAN2", py, px))
    fins = g.set_mat(g.realize(g.instance(circ.outputs[0], fin, rot=rot)), _M("CC_Facade"))
    crown = g.set_mat(g.transform(g.cyl(6, R * 0.97, 0.012), t=(0, 0, 0.994)), _M("CC_Neon"))
    g.out("Geometry", g.union(shaft, fins, crown))
    return g.finish()


# ---------------------------------------------------------------------------- more signage
def sign_disc():
    g = GN("CC_Sign_Disc")
    g.inp("Radius", "FLOAT", 2.4, 0.5, 6.0, panel="Shape")
    g.inp("Arm", "FLOAT", 1.6, 0.2, 4.0, "Bracket length from the wall", panel="Shape")
    r, arm = g.p("Radius"), g.p("Arm")
    cy = g.mul(g.add(arm, g.add(r, 0.2)), -1.0)
    disc = g.transform(g.cyl(24, r, 0.3), t=g.vec(0, cy, r), r=(0, PI / 2, 0))
    disc = g.transform(disc, r=(0, 0, 0))
    face = g.grid(g.mul(r, 1.7), g.mul(r, 1.7), 2, 2)
    # faces look along +-X (blade-style disc sticking out of the wall)
    f1 = g.transform(_sign_face(g, g.mul(r, 1.4), g.mul(r, 1.4)), t=g.vec(0.16, cy, r), r=(0, 0, PI / 2))
    f2 = g.transform(_sign_face(g, g.mul(r, 1.4), g.mul(r, 1.4)), t=g.vec(-0.16, cy, r), r=(0, 0, -PI / 2))
    ring_c = g.node("GeometryNodeCurvePrimitiveCircle")
    g.wire(ring_c, Resolution=28, Radius=g.add(r, 0.05))
    prof = g.node("GeometryNodeCurvePrimitiveCircle")
    g.wire(prof, Resolution=4, Radius=0.09)
    c2m = g.node("GeometryNodeCurveToMesh")
    g.wire(c2m, Curve=ring_c.outputs[0], Profile_Curve=prof.outputs[0])
    ring = g.transform(c2m.outputs[0], t=g.vec(0, cy, r), r=(0, PI / 2, 0))
    bracket = g.transform(g.cube(g.vec(0.15, g.add(arm, 0.2), 0.15)), t=g.vec(0, g.mul(g.add(arm, 0.2), -0.5), g.mul(r, 1.6)))
    g.out("Geometry", g.join(g.set_mat(g.join(disc, bracket), _M("CC_Metal")), g.set_mat(g.join(f1, f2), _M("CC_Sign")),
                             g.set_mat(ring, _M("CC_Neon"))))
    return g.finish()


def sign_banner():
    g = GN("CC_Sign_Banner")
    g.inp("Size", "VEC", (3.2, 0.25, 22.0), "Width, depth, height of the hanging LED banner", panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    rod = g.transform(g.cube(g.vec(g.add(w, 0.6), 0.15, 0.15)), t=g.vec(0, -1.2, h))
    arms = g.transform(g.cube(g.vec(0.12, 1.2, 0.12)), t=g.vec(0, -0.6, h))
    panel = g.transform(g.cube(s), t=g.vec(0, -1.2, g.mul(h, 0.5)))
    face = _sign_face(g, g.sub(w, 0.2), g.sub(h, 0.4))
    f1 = g.transform(face, t=g.vec(0, g.sub(-1.2, g.add(g.mul(d, 0.5), 0.01)), g.mul(h, 0.5)))
    f2 = g.transform(face, t=g.vec(0, g.add(-1.2, g.add(g.mul(d, 0.5), 0.01)), g.mul(h, 0.5)), r=(0, 0, PI))
    g.out("Geometry", g.join(g.set_mat(g.join(rod, arms, panel), _M("CC_Metal")), g.set_mat(g.join(f1, f2), _M("CC_Sign"))))
    return g.finish()


# ---------------------------------------------------------------------------- facade clutter (near LOD)
def facade_ac():
    g = GN("CC_Facade_AC")
    g.inp("Size", "VEC", (1.1, 0.7, 0.8), panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    box = g.transform(g.cube(s), t=g.vec(0, g.mul(d, -0.5), 0))
    grill = g.transform(g.cyl(16, g.mul(h, 0.32), 0.04), t=g.vec(0, g.sub(g.mul(d, -1.0), 0.02), 0), r=(PI / 2, 0, 0))
    brk = g.transform(g.cube(g.vec(g.mul(w, 0.9), d, 0.06)), t=g.vec(0, g.mul(d, -0.5), g.sub(g.mul(h, -0.5), 0.03)))
    drip = g.transform(g.cube((0.05, 0.05, 0.9)), t=g.vec(g.mul(w, 0.4), -0.1, g.sub(g.mul(h, -0.5), 0.45)))
    g.out("Geometry", g.join(g.set_mat(g.join(box, brk, drip), _M("CC_Metal")), g.set_mat(grill, _M("CC_Facade"))))
    return g.finish()


def facade_balcony():
    g = GN("CC_Facade_Balcony")
    g.inp("Width", "FLOAT", 4.0, 1.5, 8.0, panel="Shape")
    g.inp("Depth", "FLOAT", 1.3, 0.5, 3.0, panel="Shape")
    w, d = g.p("Width"), g.p("Depth")
    slab = g.transform(g.cube(g.vec(w, d, 0.18)), t=g.vec(0, g.mul(d, -0.5), 0))
    rail = g.transform(g.cube(g.vec(w, 0.05, 1.0)), t=g.vec(0, g.add(g.mul(d, -1.0), 0.03), 0.6))
    s1 = g.transform(g.cube(g.vec(0.05, d, 1.0)), t=g.vec(g.mul(w, 0.5), g.mul(d, -0.5), 0.6))
    s2 = g.transform(g.cube(g.vec(0.05, d, 1.0)), t=g.vec(g.mul(w, -0.5), g.mul(d, -0.5), 0.6))
    light = g.transform(g.cube(g.vec(g.mul(w, 0.8), 0.04, 0.04)), t=g.vec(0, g.add(g.mul(d, -1.0), 0.05), 1.1))
    g.out("Geometry", g.join(g.set_mat(slab, _M("CC_Concrete")), g.set_mat(g.join(rail, s1, s2), _M("CC_Metal")),
                             g.set_mat(light, _M("CC_Neon"))))
    return g.finish()


def facade_pipes():
    g = GN("CC_Facade_Pipes")
    g.inp("Count", "INT", 3, 1, 6, panel="Shape")
    g.inp("Radius", "FLOAT", 0.18, 0.05, 0.5, panel="Shape")
    n, r = g.p("Count"), g.p("Radius")
    pipe = g.transform(g.auto_smooth(g.cyl(10, r, 1.0), 50), t=g.vec(0, g.sub(g.mul(r, -1.0), 0.05), 0.5))
    pipes = g.realize(g.instance(g.mesh_line(n, (-0.6, 0, 0), (0.6, 0, 0)), pipe))
    clamps = g.realize(g.instance(g.mesh_line(8, (0, 0, 0.06), (0, 0, 0.125)), g.cube(g.vec(g.mul(n, 0.62), g.mul(r, 2.6), 0.012))))
    clamps = g.transform(clamps, t=g.vec(0, g.mul(r, -1.0), 0))
    g.out("Geometry", g.join(g.set_mat(pipes, _M("CC_Metal")), g.set_mat(clamps, _M("CC_Facade"))))
    return g.finish()


# ============================================================================ v3 archetypes
# Distinct silhouettes. Every closed part is merged with a Mesh Boolean union, so no two
# faces are ever coplanar (no Z-fighting on caps, crowns and ledges). Tops stay flat at
# z = 1 so setback tiers, roof clutter and the GN-exact layout stack on them unchanged.
def _box(g, size, at, mat=None):
    geo = g.transform(g.cube(size), t=at)
    return g.set_mat(geo, _M(mat)) if mat else geo


def _edge_bars(g, w, d, z, t, h):
    """Four thin bars outlining a w x d rectangle at height z (neon edges)."""
    return g.join(
        g.transform(g.cube((w + t, t, h)), t=(0, -d / 2, z)), g.transform(g.cube((w + t, t, h)), t=(0, d / 2, z)),
        g.transform(g.cube((t, d + t, h)), t=(-w / 2, 0, z)), g.transform(g.cube((t, d + t, h)), t=(w / 2, 0, z)))


def tower_pagoda():
    g = GN("CC_Tower_Pagoda")
    g.inp("Roofs", "INT", 7, 2, 14, "Flared eave roofs up the tower", panel="Shape")
    g.inp("Core", "FLOAT", 0.64, 0.4, 0.85, "Core width (fraction of footprint)", "FACTOR", "Shape")
    n, core = g.p("Roofs"), g.p("Core")
    with g.frame("Core & posts"):
        body = g.set_mat(g.transform(g.cube(g.vec(core, core, 1.0)), t=(0, 0, 0.5)), _M("CC_Glass"))
        post = g.transform(g.cube((0.05, 0.05, 1.0)), t=(0, 0, 0.5))
        posts = g.set_mat(g.realize(g.instance(g.grid(core, core, 2, 2), post)), _M("CC_Facade"))
    with g.frame("Eaves"):
        # a flared square roof: 4-sided cone frustum, wide at the bottom (corners at 45 deg)
        eave = g.transform(g.cone(4, 0.50, 0.735, 0.03), r=(0, 0, PI / 4))
        step = g.div(0.8, g.fmax(n, 1))
        line = g.mesh_line(n, (0, 0, 0.17), g.vec(0, 0, step))
        eaves = g.set_mat(g.realize(g.instance(line, eave)), _M("CC_Facade"))
        cap = _box(g, (0.74, 0.74, 0.03), (0, 0, 0.985), "CC_Facade")
    with g.frame("Lantern rims"):
        rim = g.transform(_edge_bars(g, 1.02, 1.02, 0.0, 0.012, 0.008), t=(0, 0, -0.019))
        rims = g.set_mat(g.realize(g.instance(line, rim)), _M("CC_Neon"))
        top_rim = g.set_mat(g.transform(_edge_bars(g, 0.75, 0.75, 0.0, 0.01, 0.006), t=(0, 0, 0.968)), _M("CC_Neon"))
    g.out("Geometry", g.join(g.union(body, posts, eaves, cap), rims, top_rim))
    return g.finish()


def tower_tyrell():
    g = GN("CC_Tower_Tyrell")
    g.inp("Terraces", "INT", 9, 3, 20, "Stepped terraces per tier", panel="Shape")
    g.inp("Top Width", "FLOAT", 0.8, 0.6, 1.0, "Width at the top (matches the GN setback)", "FACTOR", "Shape")
    n, tw = g.p("Terraces"), g.p("Top Width")
    with g.frame("Terraces"):
        # n stacked slabs from 1.0 down to Top Width; each slab is scaled by its height
        step = g.div(1.0, n)
        line = g.mesh_line(n, g.vec(0, 0, g.mul(step, 0.5)), g.vec(0, 0, step))
        _, _, z = g.sep(g.position())
        k = g.sub(1.0, g.mul(g.sub(z, g.mul(step, 0.5)), g.sub(1.0, tw)))
        slab = g.cube(g.vec(1.0, 1.0, step))
        slabs = g.set_mat(g.realize(g.instance(line, slab, scale=g.vec(k, k, 1.0))), _M("CC_Glass"))
    with g.frame("Buttresses & light strips"):
        but = g.transform(g.cube((0.07, 0.07, 1.0), verts=(2, 2, 2)), t=(0, 0, 0.5))
        cor = g.join(*[g.transform(but, t=(sx * 0.48, sy * 0.48, 0)) for sx in (-1, 1) for sy in (-1, 1)])
        bpx, bpy, bpz = g.sep(g.position())
        kz = g.sub(1.0, g.mul(bpz, g.sub(1.0, tw)))
        cor = g.set_mat(g.set_pos(cor, pos=g.vec(g.mul(bpx, kz), g.mul(bpy, kz), bpz)), _M("CC_Metal"))
        strip = g.transform(g.cube((0.012, 0.03, 1.0), verts=(2, 2, 2)), t=(0, -0.5, 0.5))
        strips = around4(g, g.join(*[g.transform(strip, t=(x, 0, 0)) for x in (-0.22, 0.0, 0.22)]))
        spx, spy, spz = g.sep(g.position())
        ks = g.sub(1.0, g.mul(spz, g.sub(1.0, tw)))
        strips = g.set_mat(g.set_pos(strips, pos=g.vec(g.mul(spx, ks), g.mul(spy, ks), spz)), _M("CC_Neon"))
    g.out("Geometry", g.join(g.union(slabs, cor), strips))
    return g.finish()


def tower_bundle():
    g = GN("CC_Tower_Bundle")
    g.inp("Segments", "INT", 28, 8, 64, panel="Shape")
    seg = g.p("Segments")
    tubes, caps = [], []
    for x, y, r in ((-0.24, -0.24, 0.26), (0.24, -0.24, 0.26), (-0.24, 0.24, 0.26), (0.24, 0.24, 0.26), (0.0, 0.0, 0.3)):
        tubes.append(g.transform(g.cyl(seg, r, 1.0), t=(x, y, 0.5)))
        caps.append(g.transform(g.cyl(seg, r + 0.012, 0.02), t=(x, y, 0.99)))
        caps.append(g.transform(g.cyl(seg, r + 0.008, 0.008), t=(x, y, 0.5)))
    body = g.set_mat(g.auto_smooth(g.join(*tubes), 40), _M("CC_Glass"))
    rings = g.set_mat(g.join(*caps), _M("CC_Facade"))
    # vertical light seams in the four valleys between the tubes
    seam = g.transform(g.cube((0.015, 0.015, 0.98)), t=(0, -0.42, 0.49))
    seams = g.set_mat(around4(g, seam), _M("CC_Neon"))
    g.out("Geometry", g.join(g.union(body, rings), seams))
    return g.finish()


def tower_exo():
    g = GN("CC_Tower_Exo")
    g.inp("Levels", "INT", 5, 2, 12, "Braced levels of the exoskeleton", panel="Shape")
    g.inp("Brace", "FLOAT", 0.024, 0.008, 0.06, "Brace thickness", panel="Shape")
    n, bt = g.p("Levels"), g.p("Brace")
    with g.frame("Core"):
        core = _box(g, (0.84, 0.84, 1.0), (0, 0, 0.5), "CC_Glass")
    with g.frame("Megacolumns & belts"):
        col = g.transform(g.cube((0.1, 0.1, 1.012)), t=(0, 0, 0.506))
        cols = g.realize(g.instance(g.grid(0.9, 0.9, 2, 2), col))
        lh = g.div(1.0, n)
        belt = g.cube((0.93, 0.93, 0.012))
        belts = g.realize(g.instance(g.mesh_line(g.iadd(n, 1), (0, 0, 0.006), g.vec(0, 0, g.mul(lh, 0.988))), belt))
        frame = g.set_mat(g.join(cols, belts), _M("CC_Metal"))
    with g.frame("X braces"):
        ln = g.math("SQRT", g.add(0.7056, g.mul(lh, lh)))
        ang = g.math("ARCTAN2", lh, 0.84)
        strut = g.cube(g.vec(ln, bt, bt))
        pts = g.mesh_line(n, g.vec(0, -0.455, g.mul(lh, 0.5)), g.vec(0, 0, lh))
        x1 = g.realize(g.instance(pts, strut, rot=g.vec(0, g.mul(ang, -1.0), 0)))
        x2 = g.realize(g.instance(pts, strut, rot=g.vec(0, ang, 0)))
        braces = g.set_mat(around4(g, g.join(x1, x2)), _M("CC_Metal"))
    with g.frame("Corner light"):
        lamp = g.transform(g.cube((0.012, 0.012, 0.995)), t=(0, 0, 0.5))
        lamps = g.set_mat(g.realize(g.instance(g.grid(1.002, 1.002, 2, 2), lamp)), _M("CC_Neon"))
    g.out("Geometry", g.join(g.union(core, frame, braces), lamps))
    return g.finish()


def tower_halo():
    g = GN("CC_Tower_Halo")
    g.inp("Halo Height", "FLOAT", 0.8, 0.4, 0.95, "Height of the ring", "FACTOR", "Shape")
    g.inp("Halo Radius", "FLOAT", 0.66, 0.5, 0.9, panel="Shape")
    hh, hr = g.p("Halo Height"), g.p("Halo Radius")
    with g.frame("Drum"):
        drum = g.set_mat(g.auto_smooth(g.transform(g.cyl(36, 0.44, 1.0), t=(0, 0, 0.5)), 40), _M("CC_Glass"))
        band = g.cyl(36, 0.452, 0.008)
        bands = g.realize(g.instance(g.mesh_line(9, (0, 0, 0.1), (0, 0, 0.1)), band))
        crown = g.transform(g.cyl(36, 0.46, 0.03), t=(0, 0, 0.985))
        fr = g.set_mat(g.join(bands, crown), _M("CC_Facade"))
    with g.frame("Halo ring"):
        circ = g.node("GeometryNodeCurvePrimitiveCircle")
        g.wire(circ, Resolution=64, Radius=hr)
        prof = g.node("GeometryNodeCurvePrimitiveCircle")
        g.wire(prof, Resolution=10, Radius=0.028)
        tor = g.node("GeometryNodeCurveToMesh")
        g.wire(tor, Curve=circ.outputs[0], Profile_Curve=prof.outputs[0])
        ring = g.set_mat(g.transform(tor.outputs[0], t=g.vec(0, 0, hh)), _M("CC_Metal"))
        prof2 = g.node("GeometryNodeCurvePrimitiveCircle")
        g.wire(prof2, Resolution=6, Radius=0.012)
        tor2 = g.node("GeometryNodeCurveToMesh")
        g.wire(tor2, Curve=circ.outputs[0], Profile_Curve=prof2.outputs[0])
        glow = g.set_mat(g.transform(tor2.outputs[0], t=g.vec(0, 0, g.sub(hh, 0.034))), _M("CC_Neon"))
        spoke = g.transform(g.cube(g.vec(g.sub(hr, 0.3), 0.03, 0.03)), t=g.vec(g.add(0.3, g.mul(g.sub(hr, 0.3), 0.5)), 0, hh))
        spokes = g.set_mat(g.join(*[g.transform(spoke, r=(0, 0, k * PI / 3)) for k in range(6)]), _M("CC_Metal"))
    g.out("Geometry", g.join(g.union(drum, fr, ring, spokes), glow))
    return g.finish()


def tower_capsule():
    g = GN("CC_Tower_Capsule")
    g.inp("Rows", "INT", 16, 4, 40, "Capsules up the tower", panel="Shape")
    g.inp("Seed", "INT", 5, 0, 999, panel="Shape")
    rows = g.p("Rows")
    with g.frame("Cores"):
        cores = g.join(_box(g, (0.34, 0.34, 1.0), (-0.18, -0.18, 0.5)), _box(g, (0.34, 0.34, 1.0), (0.18, 0.18, 0.5)))
        cores = g.set_mat(cores, _M("CC_Concrete"))
        stair = _box(g, (0.5, 0.5, 1.0), (0, 0, 0.5), "CC_Glass")
    with g.frame("Capsules"):
        # 4 columns per face x Rows; each capsule pushed out by a random amount
        ch = g.div(1.0, rows)
        pts = g.grid(0.72, g.sub(1.0, ch), 4, rows)
        pts = g.transform(pts, t=g.vec(0, -0.3, 0.5), r=(PI / 2, 0, 0))
        idx = g.index()
        out = g.rand_f(idx, g.p("Seed"), 0.0, 0.12)
        pts = g.set_pos(pts, offset=g.vec(0, g.mul(out, -1.0), 0))
        keep = g.cmp("GREATER_THAN", g.rand_f(idx, g.iadd(g.p("Seed"), 1)), 0.12)
        cap = g.cube(g.vec(0.17, 0.3, g.mul(ch, 0.86)))
        caps = g.realize(g.instance(pts, cap, sel=keep))
        caps = g.set_mat(around4(g, caps), _M("CC_Facade"))
        win = g.transform(g.cyl(12, 0.045, 0.02), r=(PI / 2, 0, 0), t=(0, -0.15, 0))
        lit = g.band(keep, g.cmp("LESS_THAN", g.rand_f(idx, g.iadd(g.p("Seed"), 2)), 0.55))
        wins = g.realize(g.instance(pts, win, sel=lit, scale=g.vec(1.0, 1.0, g.fmin(g.mul(ch, 14.0), 1.0))))
        wins = g.set_mat(around4(g, wins), _M("CC_Light"))
    g.out("Geometry", g.join(g.union(cores, stair), caps, wins))
    return g.finish()


def tower_sail():
    g = GN("CC_Tower_Sail")
    g.inp("Bow", "FLOAT", 0.22, 0.0, 0.45, "Curvature of the sail facade", panel="Shape")
    g.inp("Taper", "FLOAT", 0.82, 0.6, 1.0, "Width at the top", "FACTOR", "Shape")
    bow, tp = g.p("Bow"), g.p("Taper")
    with g.frame("Hull"):
        hull = g.transform(g.cube((1.0, 0.6, 1.0), verts=(14, 2, 18)), t=(0, 0.2, 0.5))
        px, py, pz = g.sep(g.position())
        k = g.sub(1.0, g.mul(pz, g.sub(1.0, tp)))
        front = g.cmp("LESS_THAN", py, 0.0)
        bulge = g.mul(bow, g.sub(1.0, g.mul(g.mul(px, px), 4.0)))
        ny = g.switch("FLOAT", front, py, g.sub(py, bulge))
        hull = g.set_mat(g.set_pos(hull, pos=g.vec(g.mul(px, k), ny, pz)), _M("CC_Glass"))
    with g.frame("Spine & fins"):
        spine = g.transform(g.cube((0.05, 0.12, 1.03)), t=(0, 0.47, 0.515))
        mast = g.transform(g.cone(8, 0.0, 0.03, 0.18), t=(0, 0.47, 1.12))
        fin = g.transform(g.cube((0.008, 0.6, 1.0), verts=(2, 2, 2)), t=(0, 0.2, 0.5))
        fins = g.join(*[g.transform(fin, t=(x, 0, 0)) for x in (-0.5, 0.5)])
        fpx, fpy, fpz = g.sep(g.position())
        fk = g.sub(1.0, g.mul(fpz, g.sub(1.0, tp)))
        fins = g.set_pos(fins, pos=g.vec(g.mul(fpx, fk), fpy, fpz))
        frame = g.set_mat(g.join(spine, mast, fins), _M("CC_Metal"))
        neon = g.set_mat(g.transform(g.cube((0.012, 0.13, 0.98)), t=(0, 0.47, 0.5)), _M("CC_Neon"))
    g.out("Geometry", g.join(g.union(hull, frame), neon))
    return g.finish()


def tower_portal():
    g = GN("CC_Tower_Portal")
    g.inp("Void Bottom", "FLOAT", 0.62, 0.3, 0.85, "Bottom of the sky portal", "FACTOR", "Shape")
    g.inp("Void Height", "FLOAT", 0.2, 0.05, 0.35, "Height of the sky portal", "FACTOR", "Shape")
    g.inp("Void Width", "FLOAT", 0.52, 0.2, 0.8, "Width of the sky portal", "FACTOR", "Shape")
    vb, vh, vw = g.p("Void Bottom"), g.p("Void Height"), g.p("Void Width")
    vt = g.add(vb, vh)
    leg = g.mul(g.sub(1.0, vw), 0.5)
    lower = g.transform(g.cube(g.vec(1.0, 1.0, vb)), t=g.vec(0, 0, g.mul(vb, 0.5)))
    upper = g.transform(g.cube(g.vec(1.0, 1.0, g.sub(1.0, vt))), t=g.vec(0, 0, g.mul(g.add(vt, 1.0), 0.5)))
    lx = g.mul(g.add(vw, leg), 0.5)
    l1 = g.transform(g.cube(g.vec(leg, 1.0, vh)), t=g.vec(lx, 0, g.add(vb, g.mul(vh, 0.5))))
    l2 = g.transform(g.cube(g.vec(leg, 1.0, vh)), t=g.vec(g.mul(lx, -1.0), 0, g.add(vb, g.mul(vh, 0.5))))
    body = g.set_mat(g.join(lower, upper, l1, l2), _M("CC_Glass"))
    t = 0.014

    def lining(y):
        top = g.transform(g.cube(g.vec(g.add(vw, t), t, t)), t=g.vec(0, y, vt))
        bot = g.transform(g.cube(g.vec(g.add(vw, t), t, t)), t=g.vec(0, y, vb))
        lf = g.transform(g.cube(g.vec(t, t, vh)), t=g.vec(g.mul(vw, -0.5), y, g.add(vb, g.mul(vh, 0.5))))
        rt = g.transform(g.cube(g.vec(t, t, vh)), t=g.vec(g.mul(vw, 0.5), y, g.add(vb, g.mul(vh, 0.5))))
        return g.join(top, bot, lf, rt)
    neon = g.set_mat(g.join(lining(-0.503), lining(0.503)), _M("CC_Neon"))
    soffit = g.set_mat(g.transform(g.cube(g.vec(g.sub(vw, 0.04), 0.9, 0.01)), t=g.vec(0, 0, g.sub(vt, 0.006))), _M("CC_Light"))
    col = g.transform(g.cube((0.06, 0.06, 1.0)), t=(0, 0, 0.5))
    cols = g.set_mat(g.realize(g.instance(g.grid(0.98, 0.98, 2, 2), col)), _M("CC_Facade"))
    g.out("Geometry", g.join(g.union(body, cols), neon, soffit))
    return g.finish()


# ============================================================================ dressing (runtime, metric)
# Pieces the browser adds on top of the GN-exact layout (not part of parity):
# floor-aligned cornice ledges (unit footprint, height in metres), rooftop crowns
# (unit footprint, uniformly scaled by the roof width) and street awnings (metres).
def dress_ledge(name, shape):
    g = GN(name)
    g.inp("Thickness", "FLOAT", 0.45, 0.1, 2.0, "Slab thickness (m)", panel="Shape")
    g.inp("Reach", "FLOAT", 0.03, 0.0, 0.1, "Projection beyond the facade (fraction)", panel="Shape")
    th, rc = g.p("Thickness"), g.p("Reach")
    k = g.add(1.0, rc)
    k2 = g.add(k, 0.004)
    if shape == "box":
        slab = g.transform(g.cube(g.vec(k, k, th)), t=g.vec(0, 0, g.mul(th, 0.5)))
        lip = g.transform(g.cube(g.vec(k2, k2, 0.08)), t=(0, 0, 0.04))
    else:
        sides, R = {"round": (40, 0.5), "octa": (8, 0.5 / math.cos(PI / 8)), "hex": (6, 0.5 / math.cos(PI / 6) * 0.94)}[shape]
        rot = (0, 0, PI / sides) if shape == "octa" else (0, 0, 0)
        slab = g.transform(g.cyl(sides, g.mul(R, k), th), t=g.vec(0, 0, g.mul(th, 0.5)), r=rot)
        lip = g.transform(g.cyl(sides, g.mul(R, k2), 0.08), t=(0, 0, 0.04), r=rot)
    g.out("Geometry", g.join(g.set_mat(slab, _M("CC_Facade")), g.set_mat(lip, _M("CC_Neon"))))
    return g.finish()


def crown_helipad():
    g = GN("CC_Crown_Helipad")
    g.inp("Pad Radius", "FLOAT", 0.36, 0.2, 0.48, panel="Shape")
    r = g.p("Pad Radius")
    pad = g.set_mat(g.transform(g.cyl(8, r, 0.02), t=(0, 0, 0.07), r=(0, 0, PI / 8)), _M("CC_Concrete"))
    leg = g.transform(g.cube((0.025, 0.025, 0.06)), t=(0, 0, 0.03))
    circ = g.node("GeometryNodeMeshCircle", fill_type="NONE")
    g.wire(circ, Vertices=8, Radius=g.mul(r, 0.8))
    legs = g.set_mat(g.realize(g.instance(circ.outputs[0], leg)), _M("CC_Metal"))
    lamp = g.transform(g.cube((0.016, 0.016, 0.01)), t=(0, 0, 0.085))
    ring = g.node("GeometryNodeMeshCircle", fill_type="NONE")
    g.wire(ring, Vertices=24, Radius=g.mul(r, 0.95))
    lamps = g.set_mat(g.realize(g.instance(ring.outputs[0], lamp)), _M("CC_Light"))
    hbar = g.join(_box(g, (0.02, 0.16, 0.004), (-0.06, 0, 0.081)), _box(g, (0.02, 0.16, 0.004), (0.06, 0, 0.081)),
                  _box(g, (0.12, 0.02, 0.004), (0, 0, 0.081)))
    hmark = g.set_mat(hbar, _M("CC_Neon"))
    g.out("Geometry", g.join(pad, legs, lamps, hmark))
    return g.finish()


def crown_lattice():
    g = GN("CC_Crown_Lattice")
    g.inp("Height", "FLOAT", 0.45, 0.15, 1.0, "Height (fraction of roof width)", panel="Shape")
    h = g.p("Height")
    post = g.transform(g.cube(g.vec(0.03, 0.03, h)), t=g.vec(0, 0, g.mul(h, 0.5)))
    posts = g.realize(g.instance(g.grid(0.8, 0.8, 2, 2), post))
    rings = [g.transform(_edge_bars(g, 0.8, 0.8, 0.0, 0.02, 0.02), t=g.vec(0, 0, g.mul(h, f))) for f in (0.33, 0.66)]
    hs = g.mul(h, 0.33)
    ln = g.math("SQRT", g.add(0.64, g.mul(hs, hs)))
    ang = g.math("ARCTAN2", hs, 0.8)
    br = g.cube(g.vec(ln, 0.012, 0.012))
    braces = []
    for f in (0.165, 0.495):
        b1 = g.transform(br, t=g.vec(0, -0.4, g.mul(h, f)), r=g.vec(0, g.mul(ang, -1.0), 0))
        b2 = g.transform(br, t=g.vec(0, -0.4, g.mul(h, f)), r=g.vec(0, ang, 0))
        braces.append(around4(g, g.join(b1, b2)))
    steel = g.set_mat(g.join(posts, *rings, *braces), _M("CC_Metal"))
    top = g.set_mat(g.transform(_edge_bars(g, 0.8, 0.8, 0.0, 0.025, 0.025), t=g.vec(0, 0, h)), _M("CC_Neon"))
    mast = g.set_mat(g.transform(g.cone(6, 0.0, 0.02, g.mul(h, 0.8)), t=g.vec(0, 0, g.mul(h, 1.4))), _M("CC_Metal"))
    beacon = g.set_mat(g.transform(g.uvsphere(8, 4, 0.018), t=g.vec(0, 0, g.mul(h, 1.82))), _M("CC_Beacon"))
    g.out("Geometry", g.join(steel, top, mast, beacon))
    return g.finish()


def crown_deco():
    g = GN("CC_Crown_Deco")
    g.inp("Step Height", "FLOAT", 0.07, 0.02, 0.2, panel="Shape")
    sh = g.p("Step Height")
    steps, glows = [], []
    for k, w in enumerate((0.86, 0.68, 0.5, 0.32)):
        steps.append(g.transform(g.cube(g.vec(w, w, sh)), t=g.vec(0, 0, g.mul(sh, k + 0.5))))
        glows.append(g.transform(_edge_bars(g, w + 0.01, w + 0.01, 0.0, 0.012, 0.01), t=g.vec(0, 0, g.mul(sh, k + 0.94))))
    needle = g.transform(g.cone(8, 0.0, 0.06, g.mul(sh, 6.0)), t=g.vec(0, 0, g.mul(sh, 7.0)))
    g.out("Geometry", g.join(g.set_mat(g.union(*steps), _M("CC_Facade")), g.set_mat(g.join(*glows), _M("CC_Neon")),
                             g.set_mat(needle, _M("CC_Metal"))))
    return g.finish()


def crown_antennas():
    g = GN("CC_Crown_Antennas")
    g.inp("Masts", "INT", 7, 1, 16, panel="Shape")
    g.inp("Seed", "INT", 3, 0, 999, panel="Shape")
    dist = g.node("GeometryNodeDistributePointsOnFaces", distribute_method="POISSON")
    g.wire(dist, Mesh=g.grid(0.7, 0.7, 2, 2), Distance_Min=0.12, Density_Max=60.0, Seed=g.p("Seed"))
    pts = g.o(dist, "Points")
    idx = g.index()
    keep = g.cmp("LESS_THAN", idx, g.p("Masts"), "INT")
    h = g.rand_f(idx, 31, 0.25, 1.1)
    mast = g.transform(g.cube((0.016, 0.016, 1.0)), t=(0, 0, 0.5))
    masts = g.set_mat(g.realize(g.instance(pts, mast, sel=keep, scale=g.vec(1.0, 1.0, h))), _M("CC_Metal"))
    bar = g.transform(g.cube((0.12, 0.008, 0.008)), t=(0, 0, 0.6))
    bars = g.set_mat(g.realize(g.instance(pts, bar, sel=keep, scale=g.vec(1.0, 1.0, h))), _M("CC_Metal"))
    bpos = g.set_pos(pts, offset=g.vec(0, 0, h))
    beacons = g.set_mat(g.realize(g.instance(bpos, g.uvsphere(8, 4, 0.016), sel=keep)), _M("CC_Beacon"))
    base = _box(g, (0.78, 0.78, 0.03), (0, 0, 0.015), "CC_Metal")
    g.out("Geometry", g.join(base, masts, bars, beacons))
    return g.finish()


def crown_ledring():
    g = GN("CC_Crown_LEDRing")
    g.inp("Band Height", "FLOAT", 0.16, 0.05, 0.4, "Height of the LED crown (fraction of roof width)", panel="Shape")
    bh = g.p("Band Height")
    zc = g.add(g.mul(bh, 0.5), 0.02)
    frame = g.set_mat(g.transform(g.cube(g.vec(0.94, 0.94, bh)), t=g.vec(0, 0, zc)), _M("CC_Metal"))
    face = _sign_face(g, 0.9, g.sub(bh, 0.02))
    screens = g.set_mat(around4(g, g.transform(face, t=g.vec(0, -0.4755, zc))), _M("CC_Screen"))
    leg = g.transform(g.cube((0.03, 0.03, 0.03)), t=(0, 0, 0.01))
    legs = g.set_mat(g.realize(g.instance(g.grid(0.8, 0.8, 2, 2), leg)), _M("CC_Metal"))
    rim = g.set_mat(g.transform(_edge_bars(g, 0.95, 0.95, 0.0, 0.012, 0.012), t=g.vec(0, 0, g.add(bh, 0.026))), _M("CC_Neon"))
    g.out("Geometry", g.join(frame, screens, legs, rim))
    return g.finish()


def crown_dome():
    g = GN("CC_Crown_Dome")
    dome = g.node("GeometryNodeMeshUVSphere")
    g.wire(dome, Segments=40, Rings=16, Radius=0.44)
    _, _, z = g.sep(g.position())
    half = g.delete(dome.outputs[0], g.cmp("LESS_THAN", z, -0.001))
    half = g.set_mat(g.auto_smooth(g.transform(half, s=(1, 1, 0.55)), 50), _M("CC_Glass"))
    ring = g.set_mat(g.transform(g.cyl(40, 0.46, 0.02), t=(0, 0, 0.01)), _M("CC_Neon"))
    spire = g.set_mat(g.transform(g.cone(8, 0.0, 0.025, 0.3), t=(0, 0, 0.38)), _M("CC_Metal"))
    beacon = g.set_mat(g.transform(g.uvsphere(8, 4, 0.02), t=(0, 0, 0.54)), _M("CC_Beacon"))
    g.out("Geometry", g.join(half, ring, spire, beacon))
    return g.finish()


def street_awning():
    g = GN("CC_Street_Awning")
    g.inp("Size", "VEC", (6.0, 2.2, 0.3), "Width, reach, thickness (m)", panel="Shape")
    s = g.p("Size")
    w, d, h = g.sep(s)
    slab = g.transform(g.cube(s), t=g.vec(0, g.mul(d, -0.5), 0))
    front = g.transform(g.cube(g.vec(w, 0.08, 0.14)), t=g.vec(0, g.sub(g.mul(d, -1.0), 0.04), -0.02))
    under = g.transform(g.cube(g.vec(g.sub(w, 0.4), g.sub(d, 0.4), 0.04)), t=g.vec(0, g.mul(d, -0.5), g.sub(g.mul(h, -0.5), 0.02)))
    box = g.transform(g.cube(g.vec(g.sub(w, 0.4), 0.2, 1.3)), t=g.vec(0, -0.1, g.add(h, 0.9)))
    sign = g.transform(_sign_face(g, g.sub(w, 0.6), 1.1), t=g.vec(0, -0.22, g.add(h, 0.9)))
    g.out("Geometry", g.join(g.set_mat(g.join(slab, box), _M("CC_Metal")), g.set_mat(front, _M("CC_Neon")),
                             g.set_mat(under, _M("CC_Light")), g.set_mat(sign, _M("CC_Sign"))))
    return g.finish()


# ============================================================================ hologram art (3D holograms)
def _loft_body(g, prof_w, prof_h, segs=40, rings=16):
    """A smooth body along X (length 1) whose half-width / half-height follow Float Curves."""
    sph = g.node("GeometryNodeMeshUVSphere")
    g.wire(sph, Segments=segs, Rings=rings, Radius=0.5)
    geo = g.transform(sph.outputs[0], r=(0, PI / 2, 0))
    px, py, pz = g.sep(g.position())
    t = g.clamp(g.add(px, 0.5))  # 0 tail .. 1 head
    kw = g.float_curve(t, prof_w)
    kh = g.float_curve(t, prof_h)
    geo = g.set_pos(geo, pos=g.vec(px, g.mul(py, g.mul(kw, 2.0)), g.mul(pz, g.mul(kh, 2.0))))
    return g.auto_smooth(geo, 60)


def holo_koi():
    g = GN("CC_HoloArt_Koi")
    body = _loft_body(g, [(0.0, 0.03), (0.2, 0.08), (0.55, 0.2), (0.85, 0.17), (1.0, 0.04)],
                      [(0.0, 0.04), (0.2, 0.1), (0.55, 0.24), (0.85, 0.18), (1.0, 0.05)])
    # tail fan, dorsal fin and pectoral fins: thin flattened cones
    tail = g.transform(g.cone(3, 0.0, 0.2, 0.01), t=(-0.6, 0, 0), r=(PI / 2, 0, PI / 2), s=(1.6, 1.0, 1.0))
    dorsal = g.transform(g.cone(3, 0.0, 0.16, 0.008), t=(0.05, 0, 0.2), r=(PI / 2, 0, 0), s=(1.6, 1.0, 0.6))
    pec1 = g.transform(g.cone(3, 0.0, 0.1, 0.008), t=(0.22, 0.16, -0.08), r=(0.3, 0, 0.6), s=(1.2, 1.0, 1.0))
    pec2 = g.transform(g.cone(3, 0.0, 0.1, 0.008), t=(0.22, -0.16, -0.08), r=(-0.3, 0, -0.6), s=(1.2, 1.0, 1.0))
    whisk = g.transform(g.cube((0.12, 0.006, 0.006)), t=(0.52, 0.05, -0.03), r=(0, 0.3, 0.4))
    g.out("Geometry", g.set_mat(g.join(body, tail, dorsal, pec1, pec2, whisk), _M("CC_Holo")))
    return g.finish()


def holo_whale():
    g = GN("CC_HoloArt_Whale")
    body = _loft_body(g, [(0.0, 0.02), (0.15, 0.05), (0.5, 0.15), (0.8, 0.16), (1.0, 0.09)],
                      [(0.0, 0.02), (0.15, 0.05), (0.5, 0.14), (0.8, 0.15), (1.0, 0.1)], segs=48, rings=20)
    fluke = g.transform(g.cone(3, 0.0, 0.16, 0.01), t=(-0.55, 0, 0), r=(0, 0, PI), s=(0.7, 1.6, 1.0))
    pec1 = g.transform(g.cube((0.22, 0.32, 0.012)), t=(0.18, 0.26, -0.08), r=(0.25, 0, -0.5))
    pec2 = g.transform(g.cube((0.22, 0.32, 0.012)), t=(0.18, -0.26, -0.08), r=(-0.25, 0, 0.5))
    groove = g.transform(g.cube((0.38, 0.006, 0.006)), t=(0.33, 0, -0.145))
    grooves = g.join(*[g.transform(groove, t=(0, y, 0.0)) for y in (-0.08, -0.04, 0.0, 0.04, 0.08)])
    g.out("Geometry", g.set_mat(g.join(body, fluke, pec1, pec2, grooves), _M("CC_Holo")))
    return g.finish()


def holo_torii():
    g = GN("CC_HoloArt_Torii")
    # a gate 1.0 wide and ~0.95 tall (scaled to the street at runtime)
    pil = g.transform(g.cyl(16, 0.035, 0.85), t=(0, 0, 0.425))
    pillars = g.join(g.transform(pil, t=(-0.36, 0, 0)), g.transform(pil, t=(0.36, 0, 0)))
    kasagi = g.transform(g.cube((1.18, 0.09, 0.05), verts=(16, 2, 2)), t=(0, 0, 0.88))
    px, _, _ = g.sep(g.position())
    kasagi = g.set_pos(kasagi, offset=g.vec(0, 0, g.mul(g.mul(px, px), 0.22)))  # upswept ends
    shimaki = g.transform(g.cube((1.02, 0.08, 0.04)), t=(0, 0, 0.83))
    nuki = g.transform(g.cube((0.92, 0.05, 0.035)), t=(0, 0, 0.68))
    gaku = g.transform(g.cube((0.08, 0.03, 0.12)), t=(0, 0, 0.755))
    base = g.join(g.transform(g.cyl(16, 0.05, 0.05), t=(-0.36, 0, 0.025)), g.transform(g.cyl(16, 0.05, 0.05), t=(0.36, 0, 0.025)))
    g.out("Geometry", g.set_mat(g.join(pillars, kasagi, shimaki, nuki, gaku, base), _M("CC_Holo")))
    return g.finish()


# ============================================================================ registry
PIECES = [
    # (collection, object name, builder) - Blender sorts children naturally = Pick Instance order
    ("CC_Kit_Towers", "T00_Pillars", tower_pillars),
    ("CC_Kit_Towers", "T01_Fins", tower_fins),
    ("CC_Kit_Towers", "T02_Octa", tower_octa),
    ("CC_Kit_Towers", "T03_Round", tower_round),
    ("CC_Kit_Towers", "T04_Spine", tower_spine),
    ("CC_Kit_Towers", "T05_Stack", tower_stack),
    ("CC_Kit_Towers", "T06_Twist", tower_twist),
    ("CC_Kit_Towers", "T07_Taper", tower_taper),
    ("CC_Kit_Towers", "T08_Diagrid", tower_diagrid),
    ("CC_Kit_Towers", "T09_Ziggurat", tower_ziggurat),
    ("CC_Kit_Towers", "T10_Cantilever", tower_cantilever),
    ("CC_Kit_Towers", "T11_LPlan", tower_lplan),
    ("CC_Kit_Towers", "T12_Cross", tower_cross),
    ("CC_Kit_Towers", "T13_Kowloon", tower_kowloon),
    ("CC_Kit_Towers", "T14_Arcology", tower_arcology),
    ("CC_Kit_Towers", "T15_Blade", tower_blade),
    ("CC_Kit_Towers", "T16_Deco", tower_deco),
    ("CC_Kit_Towers", "T17_Hex", tower_hex),
    ("CC_Kit_Towers", "T18_Pagoda", tower_pagoda),
    ("CC_Kit_Towers", "T19_Tyrell", tower_tyrell),
    ("CC_Kit_Towers", "T20_Bundle", tower_bundle),
    ("CC_Kit_Towers", "T21_Exo", tower_exo),
    ("CC_Kit_Towers", "T22_Halo", tower_halo),
    ("CC_Kit_Towers", "T23_Capsule", tower_capsule),
    ("CC_Kit_Towers", "T24_Sail", tower_sail),
    ("CC_Kit_Towers", "T25_Portal", tower_portal),
    ("CC_Kit_Roof", "R0_ACUnit", roof_ac),
    ("CC_Kit_Roof", "R1_WaterTank", roof_tank),
    ("CC_Kit_Roof", "R2_Antenna", roof_antenna),
    ("CC_Kit_Roof", "R3_Dish", roof_dish),
    ("CC_Kit_Roof", "R4_Hut", roof_hut),
    ("CC_Kit_Roof", "R5_Vents", roof_vents),
    ("CC_Kit_Landmark", "L0_Spire", landmark_spire),
    ("CC_Kit_Signs", "S0_Blade", sign_blade),
    ("CC_Kit_Signs", "S1_Wide", sign_wide),
    ("CC_Kit_Signs", "S2_Tall", sign_tall),
    ("CC_Kit_Signs", "S3_Roof", sign_roof),
    ("CC_Kit_Signs", "S4_Disc", sign_disc),
    ("CC_Kit_Signs", "S5_Banner", sign_banner),
    ("CC_Kit_Screens", "B0_Billboard", screen_billboard),
    ("CC_Kit_Facade", "F0_WallAC", facade_ac),
    ("CC_Kit_Facade", "F1_Balcony", facade_balcony),
    ("CC_Kit_Facade", "F2_Pipes", facade_pipes),
    ("CC_Kit_Street", "P0_Sidewalk", street_sidewalk),
    ("CC_Kit_Street", "P1_Lamp", street_lamp),
    ("CC_Kit_Street", "P2_Skybridge", street_bridge),
    ("CC_Kit_Street", "P3_NeonBar", neon_bar),
    ("CC_Kit_Holo", "H0_Diamond", holo_diamond),
    ("CC_Kit_Holo", "H1_Rings", holo_rings),
    ("CC_Kit_Vehicles", "V1_Traffic", traffic_car),
    ("CC_Kit_Dressing", "D0_LedgeBox", lambda: dress_ledge("CC_Dress_LedgeBox", "box")),
    ("CC_Kit_Dressing", "D1_LedgeRound", lambda: dress_ledge("CC_Dress_LedgeRound", "round")),
    ("CC_Kit_Dressing", "D2_LedgeOcta", lambda: dress_ledge("CC_Dress_LedgeOcta", "octa")),
    ("CC_Kit_Dressing", "D3_LedgeHex", lambda: dress_ledge("CC_Dress_LedgeHex", "hex")),
    ("CC_Kit_Dressing", "C0_Helipad", crown_helipad),
    ("CC_Kit_Dressing", "C1_Lattice", crown_lattice),
    ("CC_Kit_Dressing", "C2_Deco", crown_deco),
    ("CC_Kit_Dressing", "C3_Antennas", crown_antennas),
    ("CC_Kit_Dressing", "C4_LEDRing", crown_ledring),
    ("CC_Kit_Dressing", "C5_Dome", crown_dome),
    ("CC_Kit_Dressing", "A0_Awning", street_awning),
    ("CC_Kit_HoloArt", "X0_Koi", holo_koi),
    ("CC_Kit_HoloArt", "X1_Whale", holo_whale),
    ("CC_Kit_HoloArt", "X2_Torii", holo_torii),
]

# Pieces that are authored on a unit footprint and shown scaled on the shelf.
SHELF_SCALE = {"T": (24, 24, 60), "D": (24, 24, 1), "C": (24, 24, 24), "X0_Koi": (12, 12, 12), "X1_Whale": (30, 30, 30), "X2_Torii": (20, 20, 20), "L0_Spire": (8, 8, 40), "P0_Sidewalk": (10, 10, 0.3),
               "P2_Skybridge": (12, 1, 1), "P3_NeonBar": (0.3, 0.3, 12), "H0_Diamond": (6, 6, 6), "H1_Rings": (8, 8, 8)}


def build_kit(root):
    """Create all kit collections + objects under `root`, laid out on a 'shelf' for browsing."""
    colls = {}
    x = 0.0
    row_y = {"CC_Kit_Towers": 0, "CC_Kit_Roof": 40, "CC_Kit_Landmark": 40, "CC_Kit_Signs": 70,
             "CC_Kit_Screens": 70, "CC_Kit_Street": 100, "CC_Kit_Holo": 100, "CC_Kit_Vehicles": 130, "CC_Kit_Facade": 160,
             "CC_Kit_Dressing": 200, "CC_Kit_HoloArt": 250}
    cursor = {}
    for cname, oname, builder in PIECES:
        if cname not in colls:
            c = bpy.data.collections.get(cname) or bpy.data.collections.new(cname)
            if c.name not in root.children:
                root.children.link(c)
            colls[cname] = c
        tree = builder()
        cx = cursor.get(cname, 0.0)
        y = row_y[cname]
        ob = _mk_object(oname, tree, colls[cname], (cx, y, 0))
        sc = SHELF_SCALE.get(oname) or (SHELF_SCALE[oname[0]] if oname[0] in "TDC" else None)
        if sc:
            ob.scale = sc
        cursor[cname] = cx + (sc[0] if sc else 10) + 14
        if cname == "CC_Kit_Landmark":
            cursor["CC_Kit_Roof"] = cursor.get("CC_Kit_Roof", 0) + 30
        KIT[oname] = {"collection": cname, "tree": tree, "object": ob}
    return colls
