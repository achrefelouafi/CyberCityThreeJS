"""
city.py - CC_CityGenerator: the procedural city as a Geometry Nodes tree.

The layout is a pure function of integer grid coordinates and Blender's
Random Value node (Jenkins lookup3 hash), so the exact same city can be rebuilt
anywhere: the web build (src/city/layout.js) is a line-by-line port of this file
and `npm run parity` checks both produce identical instance transforms.

Coordinate system: Blender space, X east, Y north, Z up. Streets run along the
grid lines x = i * pitch and y = j * pitch, blocks sit between them.

Random channels (shared with layout.js, keep in sync):
"""

import math
from gn import GN

PI = math.pi
N_STYLES = 26    # T00..T25
ROUND_STYLES = {2, 3, 6, 17, 20, 22}     # need a square footprint (octa, round, twist, hex, bundle, halo)
BOXY_STYLES = {0, 1, 4, 5, 8, 13, 14, 16, 25}  # box-like: corner neon trims + facade clutter
N_ROOF = 6       # R0..R5
N_ATLAS = 64     # sign artwork slots in the runtime atlas
N_SCREEN = 8     # billboard programmes

CH = dict(
    # per lot (id = lx, seed = ly*64 + ch + Seed*7919)
    H=0, LANDMARK=1, TIER=2, STYLE=3, INSET_X=4, INSET_Y=5, OFF_X=6, OFF_Y=7,
    TRIM=8, TRIM_HUE=9, WSTYLE=10, BSEED=11, BB=12, BB_SIDE=13, BB_Z=14, BB_SCALE=15,
    BB_CONTENT=16, RSIGN=17, RSIGN_ATLAS=18, RSIGN_HUE=19, HOLO=20, HOLO_TYPE=21, RSIGN_SIDE=22,
    # per block / district cell
    DIST=30, MEGA=31, BRX=32, BRX_ROW=33, BRX_Z=34, BRX_HUE=35, BRY=36, BRY_COL=37, BRY_Z=38, BRY_HUE=39,
    # per item (id = lx*16 + k)
    ROOF_TYPE=40, ROOF_PX=41, ROOF_PY=42, ROOF_ROT=43,
    SIGN_TYPE=44, SIGN_SIDE=45, SIGN_ALONG=46, SIGN_Z=47, SIGN_ATLAS=48, SIGN_HUE=49, SIGN_SCALE=50,
    CLUT_TYPE=51, CLUT_SIDE=52, CLUT_ALONG=53, CLUT_Z=54,
)

PARAMS = [
    # name, type, default, min, max, description, panel, subtype
    ("Seed", "INT", 7, 0, 999, "Global seed - same seed, same city, in Blender and in the browser", "Grid", None),
    ("Block Size", "FLOAT", 58.0, 30.0, 140.0, "Size of a city block (m)", "Grid", "DISTANCE"),
    ("Street Width", "FLOAT", 28.0, 10.0, 60.0, "Width of the street canyons (m)", "Grid", "DISTANCE"),
    ("Lots Per Side", "INT", 2, 1, 3, "Building lots per block side", "Grid", None),
    ("Lot Gap", "FLOAT", 3.0, 0.0, 10.0, "Alley between lots (m)", "Grid", "DISTANCE"),
    ("Max Inset", "FLOAT", 3.0, 0.0, 10.0, "Max setback of a building from its lot edge (m)", "Grid", "DISTANCE"),
    ("Mega Block Chance", "FLOAT", 0.14, 0.0, 1.0, "Chance a whole block becomes one megastructure", "Grid", "FACTOR"),
    ("Height Min", "FLOAT", 42.0, 8.0, 120.0, "Lowest building (m)", "Skyline", "DISTANCE"),
    ("Height Max", "FLOAT", 400.0, 40.0, 700.0, "Tallest regular building (m)", "Skyline", "DISTANCE"),
    ("Height Power", "FLOAT", 1.6, 0.3, 5.0, "Height distribution exponent (higher = more low-rise)", "Skyline", None),
    ("District Size", "INT", 6, 2, 30, "Size of downtown clusters (blocks)", "Skyline", None),
    ("District Floor", "FLOAT", 0.3, 0.0, 1.0, "Height multiplier of the quietest districts", "Skyline", "FACTOR"),
    ("Landmark Chance", "FLOAT", 0.08, 0.0, 0.5, "Chance of a landmark tower (scaled by district)", "Skyline", "FACTOR"),
    ("Landmark Boost", "FLOAT", 1.6, 1.0, 3.0, "Height multiplier of landmarks", "Skyline", None),
    ("Floor Height", "FLOAT", 4.0, 2.8, 6.0, "Storey height; heights snap to whole floors (m)", "Skyline", "DISTANCE"),
    ("Tier Chance", "FLOAT", 0.65, 0.0, 1.0, "Chance of stepped setback tiers", "Massing", "FACTOR"),
    ("Setback", "FLOAT", 0.2, 0.0, 0.45, "Footprint reduction per tier", "Massing", "FACTOR"),
    ("Roof Clutter", "INT", 4, 0, 8, "AC units, tanks, antennas, dishes per roof", "Details", None),
    ("Sign Density", "INT", 12, 0, 16, "Neon signs per building", "Details", None),
    ("Sign Scale", "FLOAT", 1.7, 0.3, 4.0, "Size multiplier of facade signs", "Details", None),
    ("Facade Clutter", "INT", 14, 0, 40, "AC units, balconies and pipes per building", "Details", None),
    ("Billboard Chance", "FLOAT", 0.45, 0.0, 1.0, "Chance of a giant LED screen on a tall building", "Details", "FACTOR"),
    ("Roof Sign Chance", "FLOAT", 0.22, 0.0, 1.0, "Chance of a rooftop sign", "Details", "FACTOR"),
    ("Trim Chance", "FLOAT", 0.5, 0.0, 1.0, "Chance a building is outlined in neon", "Details", "FACTOR"),
    ("Skybridge Chance", "FLOAT", 0.16, 0.0, 1.0, "Chance of a skybridge across a street", "Details", "FACTOR"),
    ("Hologram Chance", "FLOAT", 0.5, 0.0, 1.0, "Chance a landmark carries a hologram", "Details", "FACTOR"),
    ("Trim Thickness", "FLOAT", 0.45, 0.05, 2.0, "Neon tube thickness (m)", "Details", "DISTANCE"),
    ("Preview Blocks", "INT", 10, 1, 40, "Blender only: blocks per side in the viewport preview", "Preview", None),
    ("Preview Origin X", "INT", 0, -100000, 100000, "Blender only: first block X - any window of the infinite city", "Preview", None),
    ("Preview Origin Y", "INT", 0, -100000, 100000, "Blender only: first block Y", "Preview", None),
]


RAND_TREE = None


def build_rand_tree():
    """CC_Rand: Blender's Random Value hash with the city's channel/seed scheme.
    id = X * Mult + K ; seed = Y * 64 + Channel + Seed * 7919
    Float = hash_to_float(seed, id), Int = Min + hash(id, seed) % (Max - Min + 1)."""
    global RAND_TREE
    g = GN("CC_Rand")
    for name, d in (("X", 0), ("Y", 0), ("Channel", 0), ("Seed", 0), ("Mult", 1), ("K", 0), ("Min", 0), ("Max", 1)):
        g.inp(name, "INT", d, -2147483647, 2147483647)
    rid = g.iadd(g.imul(g.p("X"), g.p("Mult")), g.p("K"))
    seed = g.iadd(g.iadd(g.imul(g.p("Y"), 64), g.p("Channel")), g.imul(g.p("Seed"), 7919))
    g.out("Float", g.rand_f(rid, seed), "FLOAT")
    g.out("Int", g.rand_i(rid, seed, g.p("Min"), g.p("Max")), "INT")
    RAND_TREE = g.finish()
    return RAND_TREE


class CityGraph:
    """Shared building blocks; every method mirrors a function in layout.js."""

    def __init__(self, g):
        self.g = g

    # ------------------------------------------------------------- hashing
    def _rand(self, x, y, ch, mult=1, k=0, lo=0, hi=1, out="Float"):
        g = self.g
        n = g.group(RAND_TREE, label=f"rand {ch}", X=x, Y=y, Channel=CH[ch], Seed=g.p("Seed"),
                    Mult=mult, K=k, Min=lo, Max=hi)
        return g.o(n, out)

    def R(self, x, y, ch):
        return self._rand(x, y, ch)

    def RI(self, x, y, ch, lo, hi):
        return self._rand(x, y, ch, lo=lo, hi=hi, out="Int")

    def RItem(self, lx, ly, k, ch):
        return self._rand(lx, ly, ch, mult=16, k=k)

    def RIItem(self, lx, ly, k, ch, lo, hi):
        return self._rand(lx, ly, ch, mult=16, k=k, lo=lo, hi=hi, out="Int")

    # ------------------------------------------------------------- grid
    def pitch(self):
        g = self.g
        return g.add(g.p("Block Size"), g.p("Street Width"))

    def block_min(self, b):
        g = self.g
        return g.add(g.mul(b, self.pitch()), g.mul(g.p("Street Width"), 0.5))

    def district(self, bx, by):
        g = self.g
        D = g.p("District Size")
        cx, cy = g.idiv(bx, D), g.idiv(by, D)
        fx = g.div(g.add(g.isub(bx, g.imul(cx, D)), 0.5), D)
        fy = g.div(g.add(g.isub(by, g.imul(cy, D)), 0.5), D)
        cx1, cy1 = g.iadd(cx, 1), g.iadd(cy, 1)
        v00, v10 = self.R(cx, cy, "DIST"), self.R(cx1, cy, "DIST")
        v01, v11 = self.R(cx, cy1, "DIST"), self.R(cx1, cy1, "DIST")
        sx, sy = g.smooth(fx), g.smooth(fy)
        d = g.lerp(g.lerp(v00, v10, sx), g.lerp(v01, v11, sx), sy)
        return g.lerp(g.p("District Floor"), 1.0, d)

    def mega(self, bx, by):
        g = self.g
        return g.cmp("LESS_THAN", self.R(bx, by, "MEGA"), g.p("Mega Block Chance"))

    def lot_size(self, mega):
        g = self.g
        n = g.p("Lots Per Side")
        regular = g.div(g.sub(g.p("Block Size"), g.mul(g.isub(n, 1), g.p("Lot Gap"))), n)
        return g.switch("FLOAT", mega, regular, g.p("Block Size"))

    def lot_center(self, bmin, a, lot_size):
        g = self.g
        return g.add(bmin, g.add(g.mul(a, g.add(lot_size, g.p("Lot Gap"))), g.mul(lot_size, 0.5)))

    def mass(self, bx, by, lx, ly, mega):
        """Height / floors / tiers of the building on lot (lx, ly)."""
        g = self.g
        dist = self.district(bx, by)
        hmin, hmax = g.p("Height Min"), g.p("Height Max")
        base = g.add(hmin, g.mul(g.mul(g.sub(hmax, hmin), g.pow(self.R(lx, ly, "H"), g.p("Height Power"))), dist))
        landmark = g.cmp("LESS_THAN", self.R(lx, ly, "LANDMARK"), g.mul(g.p("Landmark Chance"), dist))
        h1 = g.switch("FLOAT", landmark, base, g.mul(base, g.p("Landmark Boost")))
        h2 = g.switch("FLOAT", mega, h1, g.mul(h1, 1.3))
        floors = g.imax(g.to_int(g.add(g.div(h2, g.p("Floor Height")), 0.5)), 3)
        tr = self.R(lx, ly, "TIER")
        tc = g.p("Tier Chance")
        t_raw = g.iadd(g.iadd(1, g.switch("INT", g.cmp("LESS_THAN", tr, tc), 0, 1)),
                       g.switch("INT", g.cmp("LESS_THAN", tr, g.mul(tc, 0.45)), 0, 1))
        tiers = g.switch("INT", g.cmp("LESS_THAN", floors, 10, "INT"), t_raw, 1)
        return dict(dist=dist, landmark=landmark, floors=floors, tiers=tiers)

    def boundary(self, i, tiers):
        """Fraction of the height where tier i starts (i = tiers -> 1)."""
        g = self.g
        three = g.switch("FLOAT", g.cmp("EQUAL", i, 1, "INT"), 0.78, 0.5)
        mid = g.switch("FLOAT", g.cmp("EQUAL", tiers, 2, "INT"), three, 0.62)
        v = g.switch("FLOAT", g.cmp("GREATER_EQUAL", i, tiers, "INT"), mid, 1.0)
        return g.switch("FLOAT", g.cmp("LESS_EQUAL", i, 0, "INT"), v, 0.0)

    def floor_at(self, i, floors, tiers):
        g = self.g
        return g.to_int(g.add(g.mul(floors, self.boundary(i, tiers)), 0.5))

    def t0_top(self, bx, by, a, b):
        """Height of the first tier of lot (a, b) of block (bx, by) - used by skybridges."""
        g = self.g
        mega = self.mega(bx, by)
        a = g.switch("INT", mega, a, 0)
        b = g.switch("INT", mega, b, 0)
        n = g.p("Lots Per Side")
        lx, ly = g.iadd(g.imul(bx, n), a), g.iadd(g.imul(by, n), b)
        m = self.mass(bx, by, lx, ly, mega)
        return g.mul(self.floor_at(g.const_i(1), m["floors"], m["tiers"]), g.p("Floor Height"))

    # facade frame helpers (exact, no trig): side 0=-Y 1=+X 2=+Y 3=-X
    def side_vectors(self, side):
        g = self.g
        e = [g.cmp("EQUAL", side, k, "INT") for k in range(4)]
        outx = g.sub(e[1], e[3])
        outy = g.sub(e[2], e[0])
        tanx = g.sub(e[0], e[2])
        tany = g.sub(e[1], e[3])
        even = g.bor(e[0], e[2])
        return outx, outy, tanx, tany, even


def build_city_tree(colls):
    build_rand_tree()
    g = GN("CC_CityGenerator")
    for name, t, d, lo, hi, desc, panel, sub in PARAMS:
        g.inp(name, t, d, lo, hi, desc, sub, panel)
    pal = [(1.00, 0.08, 0.58, 1), (0.00, 0.80, 1.00, 1), (0.55, 0.18, 1.00, 1), (1.00, 0.50, 0.08, 1)]
    for i, c in enumerate(pal):
        g.inp(f"Neon {i + 1}", "COLOR", c, desc="Neon palette colour (instance attribute 'hue' indexes it)", panel="Palette")
    C = CityGraph(g)

    # ================================================================ lots
    with g.frame("1 - Lot grid", (0.18, 0.12, 0.25)):
        NB = g.p("Preview Blocks")
        n = g.p("Lots Per Side")
        per = g.imul(n, n)
        idx = g.index()
        blk = g.idiv(idx, per)
        li = g.imod(idx, per)
        a, b = g.imod(li, n), g.idiv(li, n)
        bx = g.iadd(g.imod(blk, NB), g.p("Preview Origin X"))
        by = g.iadd(g.idiv(blk, NB), g.p("Preview Origin Y"))
        mega = C.mega(bx, by)
        lots = g.points(g.imul(g.imul(NB, NB), per))
        lots = g.store(lots, "bx", bx, "INT")
        lots = g.store(lots, "by", by, "INT")
        lots = g.store(lots, "a", a, "INT")
        lots = g.store(lots, "b", b, "INT")
        lots = g.store(lots, "mega", mega, "BOOLEAN")
        root = g.band(g.cmp("EQUAL", a, 0, "INT"), g.cmp("EQUAL", b, 0, "INT"))
        lots = g.delete(lots, g.band(mega, g.bnot(root)))

    with g.frame("2 - Building massing", (0.12, 0.18, 0.25)):
        bx, by = g.named("bx", "INT"), g.named("by", "INT")
        a, b = g.named("a", "INT"), g.named("b", "INT")
        mega = g.named("mega", "BOOLEAN")
        lx = g.iadd(g.imul(bx, n), a)
        ly = g.iadd(g.imul(by, n), b)
        ls = C.lot_size(mega)
        cx = C.lot_center(C.block_min(bx), a, ls)
        cy = C.lot_center(C.block_min(by), b, ls)
        I = g.p("Max Inset")
        w = g.fmax(g.sub(ls, g.mul(g.mul(C.R(lx, ly, "INSET_X"), I), 2.0)), 6.0)
        d = g.fmax(g.sub(ls, g.mul(g.mul(C.R(lx, ly, "INSET_Y"), I), 2.0)), 6.0)
        style = C.RI(lx, ly, "STYLE", 0, N_STYLES - 1)
        roundish = g.index_switch("BOOLEAN", style, [i in ROUND_STYLES for i in range(N_STYLES)])
        wd = g.fmin(w, d)
        w = g.switch("FLOAT", roundish, w, wd)
        d = g.switch("FLOAT", roundish, d, wd)
        m = C.mass(bx, by, lx, ly, mega)
        H = g.mul(m["floors"], g.p("Floor Height"))
        lots = g.store(lots, "lx", lx, "INT")
        lots = g.store(lots, "ly", ly, "INT")
        lots = g.store(lots, "cx", cx)
        lots = g.store(lots, "cy", cy)
        lots = g.store(lots, "w", w)
        lots = g.store(lots, "d", d)
        lots = g.store(lots, "style", style, "INT")
        lots = g.store(lots, "floors", m["floors"], "INT")
        lots = g.store(lots, "tiers", m["tiers"], "INT")
        lots = g.store(lots, "landmark", m["landmark"], "BOOLEAN")
        lots = g.store(lots, "H", H)

    # shorthand readers for lot attributes (valid on lots and everything duplicated from them)
    def L(name, dt="FLOAT"):
        return g.named(name, dt)

    with g.frame("3 - Tiers (setbacks)", (0.12, 0.22, 0.18)):
        tiers_geo, t = g.dup(lots, L("tiers", "INT"))
        lx, ly = L("lx", "INT"), L("ly", "INT")
        floors, tiers = L("floors", "INT"), L("tiers", "INT")
        FH = g.p("Floor Height")
        z0 = g.mul(C.floor_at(t, floors, tiers), FH)
        z1 = g.mul(C.floor_at(g.iadd(t, 1), floors, tiers), FH)
        st = g.pow(g.sub(1.0, g.p("Setback")), t)
        w, d = L("w"), L("d")
        wt, dt_ = g.mul(w, st), g.mul(d, st)
        ox = g.mul(g.sub(C.R(lx, ly, "OFF_X"), 0.5), g.sub(w, wt))
        oy = g.mul(g.sub(C.R(lx, ly, "OFF_Y"), 0.5), g.sub(d, dt_))
        tx, ty = g.add(L("cx"), ox), g.add(L("cy"), oy)
        tiers_geo = g.set_pos(tiers_geo, pos=g.vec(tx, ty, z0))
        tiers_geo = g.store(tiers_geo, "t", t, "INT")
        tiers_geo = g.store(tiers_geo, "z0", z0)
        tiers_geo = g.store(tiers_geo, "z1", z1)
        tiers_geo = g.store(tiers_geo, "wt", wt)
        tiers_geo = g.store(tiers_geo, "dt", dt_)
        towers = g.instance(tiers_geo, g.coll(colls["CC_Kit_Towers"]), pick=True, index=L("style", "INT"),
                            scale=g.vec(wt, dt_, g.sub(z1, z0)))
        trim_on = g.cmp("LESS_THAN", C.R(lx, ly, "TRIM"), g.p("Trim Chance"))
        towers = g.store(towers, "hue", C.RI(lx, ly, "TRIM_HUE", 0, 3), "FLOAT", "INSTANCE")
        towers = g.store(towers, "trim", trim_on, "FLOAT", "INSTANCE")
        towers = g.store(towers, "seed", C.R(lx, ly, "BSEED"), "FLOAT", "INSTANCE")
        towers = g.store(towers, "wstyle", C.RI(lx, ly, "WSTYLE", 0, 3), "FLOAT", "INSTANCE")

    with g.frame("4 - Neon trims", (0.3, 0.08, 0.22)):
        lx, ly = L("lx", "INT"), L("ly", "INT")
        style = L("style", "INT")
        has_corners = g.index_switch("BOOLEAN", style, [i in BOXY_STYLES for i in range(N_STYLES)])
        trim_on = g.band(g.cmp("LESS_THAN", C.R(lx, ly, "TRIM"), g.p("Trim Chance")), has_corners)
        bars, j = g.dup(tiers_geo, 8)
        TT = g.p("Trim Thickness")
        wt, dt_, z0, z1 = L("wt"), L("dt"), L("z0"), L("z1")
        px, py, _ = g.sep(g.position())
        # corners j=0..3: (-,-) (+,-) (+,+) (-,+);  edges j=4..7: -Y, +X, +Y, -X
        e = [g.cmp("EQUAL", j, k, "INT") for k in range(8)]
        sx = g.sub(g.add(g.add(e[1], e[2]), e[5]), g.add(g.add(e[0], e[3]), e[7]))
        sy = g.sub(g.add(g.add(e[2], e[3]), e[6]), g.add(g.add(e[0], e[1]), e[4]))
        vertical = g.cmp("LESS_THAN", j, 4, "INT")
        alongx = g.bor(e[4], e[6])
        bx_ = g.add(px, g.mul(sx, g.mul(wt, 0.5)))
        by_ = g.add(py, g.mul(sy, g.mul(dt_, 0.5)))
        bz = g.switch("FLOAT", vertical, g.sub(z1, TT), z0)
        sclx = g.switch("FLOAT", alongx, TT, wt)
        scly = g.switch("FLOAT", g.bor(e[5], e[7]), TT, dt_)
        sclz = g.switch("FLOAT", vertical, TT, g.sub(z1, z0))
        bars = g.set_pos(bars, pos=g.vec(bx_, by_, bz))
        neon_bars = g.instance(bars, g.coll(colls["CC_Kit_Street"]), sel=trim_on, pick=True, index=3,
                               scale=g.vec(sclx, scly, sclz))
        neon_bars = g.store(neon_bars, "hue", C.RI(lx, ly, "TRIM_HUE", 0, 3), "FLOAT", "INSTANCE")

    with g.frame("5 - Roofscape", (0.2, 0.2, 0.1)):
        lx, ly = L("lx", "INT"), L("ly", "INT")
        floors, tiers = L("floors", "INT"), L("tiers", "INT")
        T = g.isub(tiers, 1)
        stT = g.pow(g.sub(1.0, g.p("Setback")), T)
        w, d = L("w"), L("d")
        wT, dT = g.mul(w, stT), g.mul(d, stT)
        oxT = g.mul(g.sub(C.R(lx, ly, "OFF_X"), 0.5), g.sub(w, wT))
        oyT = g.mul(g.sub(C.R(lx, ly, "OFF_Y"), 0.5), g.sub(d, dT))
        rx, ry = g.add(L("cx"), oxT), g.add(L("cy"), oyT)
        H = L("H")
        lots = g.store(lots, "rx", rx)
        lots = g.store(lots, "ry", ry)
        lots = g.store(lots, "wT", wT)
        lots = g.store(lots, "dT", dT)
        # clutter items k = 0..Roof Clutter-1
        items, k = g.dup(lots, g.p("Roof Clutter"))
        lx, ly = L("lx", "INT"), L("ly", "INT")
        wT, dT = L("wT"), L("dT")
        ok = g.band(g.cmp("GREATER_EQUAL", wT, 10.0), g.cmp("GREATER_EQUAL", dT, 10.0))
        ipx = g.mul(g.sub(C.RItem(lx, ly, k, "ROOF_PX"), 0.5), g.sub(wT, 6.0))
        ipy = g.mul(g.sub(C.RItem(lx, ly, k, "ROOF_PY"), 0.5), g.sub(dT, 6.0))
        items = g.set_pos(items, pos=g.vec(g.add(L("rx"), ipx), g.add(L("ry"), ipy), L("H")))
        rot = g.vec(0, 0, g.mul(C.RIItem(lx, ly, k, "ROOF_ROT", 0, 3), PI / 2))
        clutter = g.instance(items, g.coll(colls["CC_Kit_Roof"]), sel=ok, pick=True,
                             index=C.RIItem(lx, ly, k, "ROOF_TYPE", 0, N_ROOF - 1), rot=rot)

    with g.frame("6 - Landmarks, holograms, roof signs", (0.25, 0.1, 0.1)):
        lx, ly = L("lx", "INT"), L("ly", "INT")
        wT, dT, H = L("wT"), L("dT"), L("H")
        landmark = L("landmark", "BOOLEAN")
        holo = g.band(landmark, g.cmp("LESS_THAN", C.R(lx, ly, "HOLO"), g.p("Hologram Chance")))
        spire_on = g.band(landmark, g.bnot(holo))
        top = g.set_pos(lots, pos=g.vec(L("rx"), L("ry"), H))
        s = g.mul(g.fmin(wT, dT), 0.3)
        spires = g.instance(top, g.coll(colls["CC_Kit_Landmark"]), sel=spire_on, pick=True, index=0,
                            scale=g.vec(s, s, g.mul(H, 0.22)))
        spires = g.store(spires, "hue", C.RI(lx, ly, "TRIM_HUE", 0, 3), "FLOAT", "INSTANCE")
        s2 = g.mul(g.fmin(wT, dT), 0.9)
        htop = g.set_pos(lots, pos=g.vec(L("rx"), L("ry"), g.add(g.add(H, g.mul(s2, 0.6)), 6.0)))
        holos = g.instance(htop, g.coll(colls["CC_Kit_Holo"]), sel=holo, pick=True,
                           index=C.RI(lx, ly, "HOLO_TYPE", 0, 1), scale=g.vec(s2, s2, s2))
        holos = g.store(holos, "hue", C.RI(lx, ly, "TRIM_HUE", 0, 3), "FLOAT", "INSTANCE")
        rs_on = g.band(g.band(g.bnot(landmark), g.cmp("LESS_THAN", C.R(lx, ly, "RSIGN"), g.p("Roof Sign Chance"))),
                       g.band(g.cmp("GREATER_EQUAL", wT, 14.0), g.cmp("GREATER_EQUAL", dT, 8.0)))
        rside = C.RI(lx, ly, "RSIGN_SIDE", 0, 3)
        _, _, _, _, even = C.side_vectors(rside)
        face = g.switch("FLOAT", even, dT, wT)
        rsc = g.fmin(1.0, g.div(face, 15.0))
        rsigns = g.instance(top, g.coll(colls["CC_Kit_Signs"]), sel=rs_on, pick=True, index=3,
                            rot=g.vec(0, 0, g.mul(rside, PI / 2)), scale=g.vec(rsc, 1.0, 1.0))
        rsigns = g.store(rsigns, "hue", C.RI(lx, ly, "RSIGN_HUE", 0, 3), "FLOAT", "INSTANCE")
        rsigns = g.store(rsigns, "atlas", C.RI(lx, ly, "RSIGN_ATLAS", 0, N_ATLAS - 1), "FLOAT", "INSTANCE")

    with g.frame("7 - Facade signs", (0.1, 0.25, 0.25)):
        sg, k = g.dup(lots, g.p("Sign Density"))
        lx, ly = L("lx", "INT"), L("ly", "INT")
        floors, tiers = L("floors", "INT"), L("tiers", "INT")
        h0 = g.mul(C.floor_at(g.const_i(1), floors, tiers), g.p("Floor Height"))
        w, d = L("w"), L("d")
        side = C.RIItem(lx, ly, k, "SIGN_SIDE", 0, 3)
        outx, outy, tanx, tany, even = C.side_vectors(side)
        half_perp = g.switch("FLOAT", even, g.mul(w, 0.5), g.mul(d, 0.5))
        half_along = g.switch("FLOAT", even, g.mul(d, 0.5), g.mul(w, 0.5))
        along = g.mul(g.mul(g.sub(C.RItem(lx, ly, k, "SIGN_ALONG"), 0.5), 2.0), g.fmax(g.sub(half_along, 3.0), 0.0))
        tr = C.RItem(lx, ly, k, "SIGN_TYPE")
        # 0 blade, 1 wide, 2 tall, 4 neon disc, 5 hanging banner (3 = roof sign)
        stype = g.switch("INT", g.cmp("LESS_THAN", tr, 0.38),
                         g.switch("INT", g.cmp("LESS_THAN", tr, 0.53),
                                  g.switch("INT", g.cmp("LESS_THAN", tr, 0.66),
                                           g.switch("INT", g.cmp("LESS_THAN", tr, 0.82), 5, 4), 2), 1), 0)
        SS = g.p("Sign Scale")
        z = g.add(4.0, g.mul(C.RItem(lx, ly, k, "SIGN_Z"), g.fmin(g.sub(h0, g.add(g.mul(SS, 9.0), 8.0)), 90.0)))
        scl = g.mul(g.add(0.75, g.mul(C.RItem(lx, ly, k, "SIGN_SCALE"), 0.6)), SS)
        sx_ = g.add(L("cx"), g.add(g.mul(outx, half_perp), g.mul(tanx, along)))
        sy_ = g.add(L("cy"), g.add(g.mul(outy, half_perp), g.mul(tany, along)))
        scl = g.switch("FLOAT", g.cmp("EQUAL", stype, 5, "INT"), scl, g.mul(scl, 0.6))
        sg = g.set_pos(sg, pos=g.vec(sx_, sy_, z))
        signs = g.instance(sg, g.coll(colls["CC_Kit_Signs"]), sel=g.cmp("GREATER_THAN", h0, 20.0), pick=True,
                           index=stype, rot=g.vec(0, 0, g.mul(side, PI / 2)), scale=g.vec(scl, scl, scl))
        signs = g.store(signs, "hue", C.RIItem(lx, ly, k, "SIGN_HUE", 0, 3), "FLOAT", "INSTANCE")
        signs = g.store(signs, "atlas", C.RIItem(lx, ly, k, "SIGN_ATLAS", 0, N_ATLAS - 1), "FLOAT", "INSTANCE")

    with g.frame("7b - Facade clutter", (0.15, 0.2, 0.12)):
        cl, k = g.dup(lots, g.p("Facade Clutter"))
        lx, ly = L("lx", "INT"), L("ly", "INT")
        floors, tiers = L("floors", "INT"), L("tiers", "INT")
        FH = g.p("Floor Height")
        h0 = g.mul(C.floor_at(g.const_i(1), floors, tiers), FH)
        w, d = L("w"), L("d")
        boxy = g.index_switch("BOOLEAN", L("style", "INT"), [i in BOXY_STYLES for i in range(N_STYLES)])
        side = C.RIItem(lx, ly, k, "CLUT_SIDE", 0, 3)
        outx, outy, tanx, tany, even = C.side_vectors(side)
        half_perp = g.switch("FLOAT", even, g.mul(w, 0.5), g.mul(d, 0.5))
        half_along = g.switch("FLOAT", even, g.mul(d, 0.5), g.mul(w, 0.5))
        along = g.mul(g.mul(g.sub(C.RItem(lx, ly, k, "CLUT_ALONG"), 0.5), 2.0), g.fmax(g.sub(half_along, 2.5), 0.0))
        ctype = C.RIItem(lx, ly, k, "CLUT_TYPE", 0, 9)
        piece = g.switch("INT", g.cmp("LESS_THAN", ctype, 6, "INT"), g.switch("INT", g.cmp("LESS_THAN", ctype, 9, "INT"), 2, 1), 0)
        is_pipe = g.cmp("EQUAL", piece, 2, "INT")
        fl = g.floor(g.mul(C.RItem(lx, ly, k, "CLUT_Z"), g.fmin(g.sub(g.div(h0, FH), 1.0), 18.0)))
        z = g.switch("FLOAT", is_pipe, g.add(g.mul(fl, FH), 1.2), 0.0)
        cx_ = g.add(L("cx"), g.add(g.mul(outx, half_perp), g.mul(tanx, along)))
        cy_ = g.add(L("cy"), g.add(g.mul(outy, half_perp), g.mul(tany, along)))
        cl = g.set_pos(cl, pos=g.vec(cx_, cy_, z))
        clutter_ok = g.band(boxy, g.cmp("GREATER_THAN", h0, 12.0))
        clutter_f = g.instance(cl, g.coll(colls["CC_Kit_Facade"]), sel=clutter_ok, pick=True, index=piece,
                               rot=g.vec(0, 0, g.mul(side, PI / 2)), scale=g.vec(1.0, 1.0, g.switch("FLOAT", is_pipe, 1.0, h0)))

    with g.frame("8 - LED billboards", (0.22, 0.1, 0.3)):
        lx, ly = L("lx", "INT"), L("ly", "INT")
        floors, tiers = L("floors", "INT"), L("tiers", "INT")
        h0 = g.mul(C.floor_at(g.const_i(1), floors, tiers), g.p("Floor Height"))
        w, d = L("w"), L("d")
        on = g.band(g.cmp("LESS_THAN", C.R(lx, ly, "BB"), g.p("Billboard Chance")), g.cmp("GREATER_THAN", h0, 40.0))
        side = C.RI(lx, ly, "BB_SIDE", 0, 3)
        outx, outy, _, _, even = C.side_vectors(side)
        face = g.switch("FLOAT", even, d, w)
        half_perp = g.switch("FLOAT", even, g.mul(w, 0.5), g.mul(d, 0.5))
        s = g.fmin(g.div(g.mul(face, 0.8), 16.0), g.add(0.6, g.mul(C.R(lx, ly, "BB_SCALE"), 1.6)))
        z = g.add(10.0, g.mul(C.R(lx, ly, "BB_Z"), g.fmax(g.sub(g.sub(h0, g.mul(s, 9.0)), 16.0), 0.0)))
        bpos = g.vec(g.add(L("cx"), g.mul(outx, half_perp)), g.add(L("cy"), g.mul(outy, half_perp)), z)
        bb = g.set_pos(lots, pos=bpos)
        boards = g.instance(bb, g.coll(colls["CC_Kit_Screens"]), sel=on, pick=True, index=0,
                            rot=g.vec(0, 0, g.mul(side, PI / 2)), scale=g.vec(s, s, s))
        boards = g.store(boards, "content", C.RI(lx, ly, "BB_CONTENT", 0, N_SCREEN - 1), "FLOAT", "INSTANCE")

    # ================================================================ blocks / street level
    with g.frame("9 - Blocks, sidewalks, lamps", (0.15, 0.15, 0.15)):
        NB = g.p("Preview Blocks")
        idx = g.index()
        bxv = g.iadd(g.imod(idx, NB), g.p("Preview Origin X"))
        byv = g.iadd(g.idiv(idx, NB), g.p("Preview Origin Y"))
        blocks = g.points(g.imul(NB, NB))
        blocks = g.store(blocks, "bx", bxv, "INT")
        blocks = g.store(blocks, "by", byv, "INT")
        bx, by = L("bx", "INT"), L("by", "INT")
        B = g.p("Block Size")
        bcx = g.add(C.block_min(bx), g.mul(B, 0.5))
        bcy = g.add(C.block_min(by), g.mul(B, 0.5))
        blocks = g.set_pos(blocks, pos=g.vec(bcx, bcy, 0.0))
        walks = g.instance(blocks, g.coll(colls["CC_Kit_Street"]), pick=True, index=0, scale=g.vec(B, B, 0.3))
        m = g.imax(g.to_int(g.div(B, 18.0)), 1)
        lamps_pts, q = g.dup(blocks, g.imul(m, 4))
        side = g.idiv(q, m)
        jj = g.imod(q, m)
        outx, outy, tanx, tany, _ = C.side_vectors(side)
        along = g.sub(g.mul(g.add(jj, 0.5), g.div(B, m)), g.mul(B, 0.5))
        hp = g.sub(g.mul(B, 0.5), 0.8)
        px, py, _ = g.sep(g.position())
        lamps_pts = g.set_pos(lamps_pts, pos=g.vec(g.add(px, g.add(g.mul(outx, hp), g.mul(tanx, along))),
                                                     g.add(py, g.add(g.mul(outy, hp), g.mul(tany, along))), 0.3))
        lamps = g.instance(lamps_pts, g.coll(colls["CC_Kit_Street"]), pick=True, index=1,
                           rot=g.vec(0, 0, g.mul(side, PI / 2)))

    with g.frame("10 - Skybridges", (0.1, 0.2, 0.3)):
        bx, by = L("bx", "INT"), L("by", "INT")
        n = g.p("Lots Per Side")
        ls = C.lot_size(False)
        span = g.add(g.p("Street Width"), g.mul(g.add(g.p("Max Inset"), 2.0), 2.0))
        # across the +X street: lot (n-1, row) of this block <-> lot (0, row) of block bx+1
        row = C.RI(bx, by, "BRX_ROW", 0, 8)
        row = g.imod(row, n)
        bx1 = g.iadd(bx, 1)
        tA = C.t0_top(bx, by, g.isub(n, 1), row)
        tB = C.t0_top(bx1, by, 0, row)
        zx = g.add(10.0, g.mul(C.R(bx, by, "BRX_Z"), g.fmax(g.sub(g.fmin(tA, tB), 18.0), 0.0)))
        yx = C.lot_center(C.block_min(by), row, ls)
        onx = g.cmp("LESS_THAN", C.R(bx, by, "BRX"), g.p("Skybridge Chance"))
        bpx = g.set_pos(blocks, pos=g.vec(g.mul(bx1, C.pitch()), yx, zx))
        brx = g.instance(bpx, g.coll(colls["CC_Kit_Street"]), sel=onx, pick=True, index=2, scale=g.vec(span, 1.0, 1.0))
        brx = g.store(brx, "hue", C.RI(bx, by, "BRX_HUE", 0, 3), "FLOAT", "INSTANCE")
        # across the +Y street
        col = g.imod(C.RI(bx, by, "BRY_COL", 0, 8), n)
        by1 = g.iadd(by, 1)
        tC = C.t0_top(bx, by, col, g.isub(n, 1))
        tD = C.t0_top(bx, by1, col, 0)
        zy = g.add(10.0, g.mul(C.R(bx, by, "BRY_Z"), g.fmax(g.sub(g.fmin(tC, tD), 18.0), 0.0)))
        xy = C.lot_center(C.block_min(bx), col, ls)
        ony = g.cmp("LESS_THAN", C.R(bx, by, "BRY"), g.p("Skybridge Chance"))
        bpy = g.set_pos(blocks, pos=g.vec(xy, g.mul(by1, C.pitch()), zy))
        bry = g.instance(bpy, g.coll(colls["CC_Kit_Street"]), sel=ony, pick=True, index=2,
                         rot=(0, 0, PI / 2), scale=g.vec(span, 1.0, 1.0))
        bry = g.store(bry, "hue", C.RI(bx, by, "BRY_HUE", 0, 3), "FLOAT", "INSTANCE")

    g.out("Geometry", g.join(towers, neon_bars, clutter, spires, holos, rsigns, signs, clutter_f, boards, walks, lamps, brx, bry))
    return g.finish()
