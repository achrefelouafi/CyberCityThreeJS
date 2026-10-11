"""
car.py - "KX-11 Kestrel" hover sedan, fully procedural (bmesh + modifiers).

Long low Spinner-style coupe: sculpted wedge hull with sharp sponson / shoulder
creases, a wraparound glass canopy, a long roof slab with a glass panel over the
cabin, side thruster nacelles and four hover pads. The hull's top is dished into
a real cockpit tub (seats, dashboard screens, steering yoke, console), so the car
also works as a first-person cockpit.

Surface details (panel gaps, light bars, neon lines, vents) are snapped onto the
subdivided hull with BVH ray casts, so they follow any change to the stations.

Blender space: +X forward, +Y left, +Z up.  three.js: (x, y, z) -> (x, z, -y).

  standalone:  blender -b --factory-startup --python blender/car.py -- OUT.glb [RENDER_DIR]
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import materials  # noqa: E402

MAT_NAMES = [
    "CC_CarPaint", "CC_CarGlass", "CC_CarTrim", "CC_CarNeon", "CC_HeadLight", "CC_TailLight",
    "CC_Thruster", "CC_CarChrome", "CC_CarInterior", "CC_CarSeat", "CC_CarScreen", "CC_CarMarker",
]
MI = {n: i for i, n in enumerate(MAT_NAMES)}


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------------------- stations
# x, half width, belly z, sponson crease z, waist z, shoulder crease z, top centre z
STATIONS = [
    (-2.84, 0.98, 0.60, 0.66, 0.86, 1.00, 1.03),
    (-2.62, 1.06, 0.48, 0.60, 0.84, 1.01, 1.05),
    (-2.20, 1.11, 0.40, 0.57, 0.82, 1.02, 1.05),
    (-1.50, 1.12, 0.37, 0.56, 0.80, 1.01, 1.04),
    (-0.70, 1.06, 0.36, 0.55, 0.78, 0.99, 1.02),
    (0.10, 1.05, 0.36, 0.55, 0.77, 0.98, 1.00),
    (0.80, 1.08, 0.37, 0.56, 0.77, 0.96, 0.95),
    (1.45, 1.10, 0.38, 0.56, 0.76, 0.92, 0.86),
    (2.05, 1.05, 0.40, 0.55, 0.72, 0.85, 0.77),
    (2.48, 0.94, 0.44, 0.54, 0.66, 0.76, 0.69),
    (2.72, 0.76, 0.49, 0.54, 0.61, 0.68, 0.64),
    (2.84, 0.52, 0.53, 0.56, 0.59, 0.63, 0.61),
]
X0, X1 = STATIONS[0][0], STATIONS[-1][0]
Z_FLOOR = 0.50     # cockpit floor
EYE = Vector((-0.50, 0.40, 1.17))  # driver's eye (Blender space)
YOKE_HUB = Vector((0.43, EYE.y, 0.95))
YOKE_UP = Vector((0.34, 0, 0.94)).normalized()
YOKE_RIGHT = Vector((0, -1, 0))
YOKE_AXIS = YOKE_RIGHT.cross(YOKE_UP).normalized()
if YOKE_AXIS.x > 0:
    YOKE_AXIS = -YOKE_AXIS  # towards the driver


def canopy_top(x):
    """Canopy crown (hidden inside the roof slab): low, falling gently to the tail."""
    return lerp(1.37, 1.27, smoothstep(-0.9, -2.7, x))


def station(x):
    """Catmull-Rom through the station table -> (hw, zb, zs, zw, zsh, zt)."""
    xs = [s[0] for s in STATIONS]
    x = min(max(x, xs[0]), xs[-1])
    i = max(0, min(len(xs) - 2, next(k for k in range(len(xs) - 1) if xs[k + 1] >= x)))
    t = (x - xs[i]) / (xs[i + 1] - xs[i])
    out = []
    for c in range(1, 7):
        p0 = STATIONS[max(i - 1, 0)][c]
        p1 = STATIONS[i][c]
        p2 = STATIONS[i + 1][c]
        p3 = STATIONS[min(i + 2, len(xs) - 1)][c]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


def cabin(x):
    """0 outside, 1 inside the cockpit tub."""
    return smoothstep(-1.45, -1.12, x) * (1 - smoothstep(0.80, 1.12, x))


def half_profile(x, c=None):
    hw, zb, zs, zw, zsh, zt = station(x)
    c = cabin(x) if c is None else c
    return [
        (0.0, zb),
        (0.74 * hw, zb),
        (0.95 * hw, zb + 0.06),
        (hw, zs),                       # sponson crease
        (0.95 * hw, zs + 0.05),
        (0.965 * hw, zw),
        (0.93 * hw, zsh),               # shoulder crease
        (0.81 * hw, zsh + 0.025),       # deck edge (canopy sits here)
        (0.71 * hw, lerp(lerp(zsh + 0.015, zt, 0.35), zsh - 0.035, c)),
        (lerp(0.42, 0.665, c) * hw, lerp(zt, Z_FLOOR + 0.07, c)),
        (0.0, lerp(zt, Z_FLOOR, c)),
    ]


def deck_z(x, y):
    """Height of the (non-dished) top surface at lateral offset y."""
    p = half_profile(x, 0.0)[6:]
    y = abs(y)
    if y >= p[0][0]:
        return p[0][1]
    for (y0, z0), (y1, z1) in zip(p, p[1:]):
        if y1 <= y <= y0:
            return lerp(z1, z0, (y - y1) / max(y0 - y1, 1e-6))
    return p[-1][1]


# ---------------------------------------------------------------------------- mesh helpers
def full_ring(half, mirror_open=False):
    """Half profile (centre -> side -> centre) -> full ring (+y side then -y side)."""
    ring = [Vector((0, y, z)) for y, z in half]
    back = [Vector((0, -y, z)) for y, z in reversed(half[1:-1])]
    return ring + back


def loft(bm, rings, closed=True, cap_start=False, cap_end=False):
    """rings: list of lists of Vector (same length). Returns (verts grid, faces)."""
    grid = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    faces = []
    for a, b in zip(grid, grid[1:]):
        for k in range(n if closed else n - 1):
            k2 = (k + 1) % n
            faces.append(bm.faces.new((a[k], a[k2], b[k2], b[k])))
    if cap_start:
        faces.append(bm.faces.new(list(reversed(grid[0]))))
    if cap_end:
        faces.append(bm.faces.new(grid[-1]))
    return grid, faces


def shrink(ring, f, dx=0.0):
    c = sum(ring, Vector()) / len(ring)
    return [c + (p - c) * f + Vector((dx, 0, 0)) for p in ring]


def set_crease(bm, edges, value):
    layer = bm.edges.layers.float.get("crease_edge") or bm.edges.layers.float.new("crease_edge")
    for e in edges:
        e[layer] = value


def edge_between(a, b):
    for e in a.link_edges:
        if e.other_vert(a) is b:
            return e
    return None


def obj_from_bm(name, bm, coll):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for n in MAT_NAMES:
        me.materials.append(materials.MATS[n])
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def subdivide(ob, levels=2):
    m = ob.modifiers.new("Subsurf", "SUBSURF")
    m.levels = m.render_levels = levels
    m.use_creases = True
    m.boundary_smooth = "PRESERVE_CORNERS"
    apply_modifiers(ob)


def auto_sharp(bm, angle=35):
    lim = math.radians(angle)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) > lim:
            e.smooth = False


def bm_of(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    return bm


class Surface:
    """BVH ray casts onto a finished part."""

    def __init__(self, bm):
        self.t = BVHTree.FromBMesh(bm)

    def cast(self, origin, direction):
        o, d = Vector(origin), Vector(direction).normalized()
        loc, n, _, _ = self.t.ray_cast(o, d, 20.0)
        if loc is None:
            return None
        if n.dot(d) > 0:
            n = -n
        return loc, n

    def side(self, x, z, s):
        return self.cast((x, 4 * s, z), (0, -s, 0))

    def top(self, x, y):
        return self.cast((x, y, 4), (0, 0, -1))

    def bottom(self, x, y):
        return self.cast((x, y, -2), (0, 0, 1))

    def front(self, y, z):
        return self.cast((6, y, z), (-1, 0, 0))

    def back(self, y, z):
        return self.cast((-6, y, z), (1, 0, 0))

    def inner(self, x, z, s):
        return self.cast((x, 0, z), (0, s, 0))


class Builder:
    """Accumulates low-poly hard-surface parts into one bmesh with material indices."""

    def __init__(self):
        self.bm = bmesh.new()

    def _tag(self, n0, mat, smooth=None):
        self.bm.faces.ensure_lookup_table()
        for f in self.bm.faces[n0:]:
            f.material_index = MI[mat]
        return self.bm.faces[n0:]

    def mark(self):
        self.bm.faces.ensure_lookup_table()
        return len(self.bm.faces)

    def ribbon(self, hits, width, mat, depth=0.012, lift=0.004, w_end=None):
        """Box-section strip along surface hits [(loc, normal)]."""
        hits = [h for h in hits if h]
        if len(hits) < 2:
            return
        n0 = self.mark()
        bm = self.bm
        rows = []
        for i, (p, n) in enumerate(hits):
            a = hits[max(i - 1, 0)][0]
            b = hits[min(i + 1, len(hits) - 1)][0]
            t = (b - a).normalized()
            side = n.cross(t).normalized()
            w = width if w_end is None else lerp(width, w_end, i / (len(hits) - 1))
            top = p + n * lift
            bot = p - n * depth
            rows.append([bm.verts.new(top + side * w / 2), bm.verts.new(top - side * w / 2),
                         bm.verts.new(bot - side * w / 2), bm.verts.new(bot + side * w / 2)])
        for r0, r1 in zip(rows, rows[1:]):
            for k in range(4):
                k2 = (k + 1) % 4
                bm.faces.new((r0[k], r1[k], r1[k2], r0[k2]))
        bm.faces.new(rows[0])
        bm.faces.new(list(reversed(rows[-1])))
        self._tag(n0, mat)

    def box(self, center, size, mat, rot=None, bevel=0.0, segs=2):
        m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
        if bevel <= 0:
            n0 = self.mark()
            bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
            return self._tag(n0, mat)
        # bevel deletes faces, and BMesh reuses freed slots for later elements, which
        # would break index-based material tagging: bevel in a scratch mesh, then append
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=m)
        bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel, segments=segs, affect="EDGES", profile=0.5)
        for f in tmp.faces:
            f.material_index = MI[mat]
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def cyl(self, p0, p1, r0, r1, mat, segs=24, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        n0 = self.mark()
        q = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m = Matrix.Translation((p0 + p1) / 2) @ q
        bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=d.length, matrix=m)
        return self._tag(n0, mat)

    def sphere(self, center, scale, mat, segs=16, rings=10, rot=None):
        n0 = self.mark()
        m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1))
        bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)
        return self._tag(n0, mat)

    def lathe(self, profile, axis_p, axis_d, mats, segs=32):
        """Revolve [(t, r)] around an axis; mats: per-segment material names (len(profile)-1)."""
        axis_p, axis_d = Vector(axis_p), Vector(axis_d).normalized()
        u = axis_d.orthogonal().normalized()
        v = axis_d.cross(u)
        rings = []
        for t, r in profile:
            c = axis_p + axis_d * t
            rings.append([self.bm.verts.new(c + (u * math.cos(a) + v * math.sin(a)) * r)
                          for a in (2 * math.pi * k / segs for k in range(segs))])
        for i, (a, b) in enumerate(zip(rings, rings[1:])):
            n0 = self.mark()
            for k in range(segs):
                k2 = (k + 1) % segs
                self.bm.faces.new((a[k], b[k], b[k2], a[k2]))
            self._tag(n0, mats[i])
        return rings

    def disc(self, center, normal, radius, mat, segs=32):
        n0 = self.mark()
        c, n = Vector(center), Vector(normal).normalized()
        u = n.orthogonal().normalized()
        v = n.cross(u)
        vs = [self.bm.verts.new(c + (u * math.cos(a) + v * math.sin(a)) * radius) for a in (2 * math.pi * k / segs for k in range(segs))]
        f = self.bm.faces.new(vs)
        if f.normal.dot(n) < 0:
            f.normal_flip()
        self._tag(n0, mat)

    def quad(self, corners, mat, uvs=None):
        n0 = self.mark()
        f = self.bm.faces.new([self.bm.verts.new(c) for c in corners])
        if uvs:
            uvl = self.bm.loops.layers.uv.get("UVMap") or self.bm.loops.layers.uv.new("UVMap")
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
        self._tag(n0, mat)
        return f

    def sweep(self, path, radius, mat, segs=10, closed=False):
        """Tube along a polyline."""
        n0 = self.mark()
        P = [Vector(p) for p in path]
        n = len(P)
        rings = []
        prev_u = None
        for i in range(n):
            a = P[(i - 1) % n] if (closed or i > 0) else P[i]
            b = P[(i + 1) % n] if (closed or i < n - 1) else P[i]
            t = (b - a).normalized()
            u = (prev_u - t * prev_u.dot(t)).normalized() if prev_u else t.orthogonal().normalized()
            prev_u = u
            v = t.cross(u)
            rings.append([self.bm.verts.new(P[i] + (u * math.cos(k * 2 * math.pi / segs) + v * math.sin(k * 2 * math.pi / segs)) * radius) for k in range(segs)])
        pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        for a, b in pairs:
            for k in range(segs):
                k2 = (k + 1) % segs
                self.bm.faces.new((a[k], b[k], b[k2], a[k2]))
        if not closed:
            self.bm.faces.new(list(reversed(rings[0])))
            self.bm.faces.new(rings[-1])
        self._tag(n0, mat)

    def to_object(self, name, coll, sharp=35):
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for f in self.bm.faces if len(f.verts) > 2 and not f.hide])
        auto_sharp(self.bm, sharp)
        ob = obj_from_bm(name, self.bm, coll)
        self.bm.free()
        return ob


def catmull(points, n_per=6, closed=False):
    """Smooth a control polyline (Catmull-Rom)."""
    P = [Vector(p) for p in points]
    out = []
    m = len(P)
    segs = m if closed else m - 1
    for i in range(segs):
        p0 = P[(i - 1) % m] if closed else P[max(i - 1, 0)]
        p1, p2 = P[i % m], P[(i + 1) % m]
        p3 = P[(i + 2) % m] if closed else P[min(i + 2, m - 1)]
        for k in range(n_per):
            t = k / n_per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(P[-1])
    return out


def linspace(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


# ---------------------------------------------------------------------------- parts
def build_hull(coll):
    bm = bmesh.new()
    bm.edges.layers.float.new("crease_edge")  # create layers before holding element refs
    NX = 72
    xs = [X0 + (X1 - X0) * (0.5 - 0.5 * math.cos(math.pi * i / (NX - 1))) for i in range(NX)]
    rings = []
    for x in xs:
        r = full_ring(half_profile(x))
        rings.append([Vector((x, p.y, p.z)) for p in r])
    tail = shrink(rings[0], 0.86, -0.012)
    nose = shrink(rings[-1], 0.5, 0.035)
    grid, _ = loft(bm, [tail] + rings + [nose], closed=True, cap_start=True, cap_end=True)
    # character lines: sponson (profile 3) and shoulder (profile 6) creases
    n = len(rings[0])
    sponson, shoulder, rear = [], [], []
    for a, b in zip(grid[1:-1], grid[2:-1]):
        for k, lst in ((3, sponson), (n - 3, sponson), (6, shoulder), (n - 6, shoulder)):
            e = edge_between(a[k], b[k])
            if e:
                lst.append(e)
    for k in range(n):
        e = edge_between(grid[0][k], grid[1][k])
        if e:
            rear.append(e)
    set_crease(bm, sponson, 0.92)
    set_crease(bm, shoulder, 0.75)
    set_crease(bm, rear, 0.85)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = obj_from_bm("hull", bm, coll)
    bm.free()
    subdivide(ob, 2)
    # material zones
    bm = bm_of(ob)
    for f in bm.faces:
        c = f.calc_center_median()
        hw, zb, zs, zw, zsh, zt = station(c.x)
        if cabin(c.x) > 0.5 and abs(c.y) < 0.78 * hw and Z_FLOOR - 0.03 < c.z < zsh - 0.01 and f.normal.z > -0.3:
            f.material_index = MI["CC_CarInterior"]
        elif f.normal.z < -0.6 and c.z < zb + 0.05:
            f.material_index = MI["CC_CarTrim"]
        else:
            f.material_index = MI["CC_CarPaint"]
        f.smooth = True
    bm.to_mesh(ob.data)
    return ob, bm


def windshield_top(x):
    if x >= 0.38:
        t = min(max((1.40 - x) / 1.02, 0.0), 1.0)
        e = math.sin(t * math.pi / 2) ** 0.85
        zc = deck_z(x, 0)
        return zc + (canopy_top(x) - zc) * e
    return canopy_top(x)


def build_canopy(coll):
    bm = bmesh.new()
    xs = linspace(1.40, -2.62, 46)
    rings = []
    for x in xs:
        hw = station(x)[0]
        yb = 0.80 * hw - 0.01
        yt = min(0.62, 0.58 * hw) * lerp(1.0, 0.86, smoothstep(-1.2, -2.6, x))
        zt = windshield_top(x)
        pts = [(yb, 0.0), (yb + 0.004, 0.18), (lerp(yb, yt, 0.35) + 0.015, 0.55), (lerp(yb, yt, 0.78), 0.86), (yt, 0.97), (yt * 0.55, 1.0), (0.0, 1.0)]
        half = []
        for y, fr in pts:
            zb = deck_z(x, y) - 0.05
            half.append((y, zb + fr * (zt - zb)))
        ring = [Vector((x, y, z)) for y, z in half] + [Vector((x, -y, z)) for y, z in reversed(half[:-1])]
        rings.append(ring)
    rear = shrink(rings[-1], 0.8, -0.03)
    grid, _ = loft(bm, rings + [rear], closed=False, cap_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = obj_from_bm("canopy", bm, coll)
    bm.free()
    subdivide(ob, 2)
    bm = bm_of(ob)
    for f in bm.faces:
        c = f.calc_center_median()
        hw = station(c.x)[0]
        base = deck_z(c.x, 0.8 * hw) - 0.05
        glass = c.x > -1.12 and c.z > base + 0.075 and abs(c.x + 0.27) > 0.03
        f.material_index = MI["CC_CarGlass"] if glass else MI["CC_CarPaint"]
        f.smooth = True
    bm.to_mesh(ob.data)
    return ob, bm


def roof_ring(x, a, b, zc, n=28, e=5.0):
    pts = []
    for i in range(n):
        th = 2 * math.pi * i / n
        c, s = math.cos(th), math.sin(th)
        pts.append(Vector((x, a * math.copysign(abs(c) ** (2 / e), c), zc + b * math.copysign(abs(s) ** (2 / e), s))))
    return pts


def roof_z(x):
    return canopy_top(x) + 0.025


def roof_w(x):
    return lerp(0.78, 0.66, smoothstep(-0.6, -2.8, x))


def build_roof(coll):
    bm = bmesh.new()
    B = 0.05
    spec = [(0.32, 0.90, 0.25), (0.30, 0.95, 0.65), (0.26, 0.98, 0.9)]
    spec += [(x, 1.0, 1.0) for x in linspace(0.20, -2.70, 30)]
    spec += [(-2.76, 0.98, 0.85), (-2.80, 0.94, 0.4)]
    rings = [roof_ring(x, roof_w(x) * fa, B * fb, roof_z(x)) for x, fa, fb in spec]
    loft(bm, rings, closed=True, cap_start=True, cap_end=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = obj_from_bm("roof", bm, coll)
    bm.free()
    subdivide(ob, 2)
    bm = bm_of(ob)
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.y) < 0.54 and -1.0 < c.x < 0.16:
            f.material_index = MI["CC_CarGlass"]  # panoramic glass roof over the cockpit
        elif f.normal.z < -0.5:
            f.material_index = MI["CC_CarInterior"]
        else:
            f.material_index = MI["CC_CarPaint"]
        f.smooth = True
    bm.to_mesh(ob.data)
    return ob, bm


def build_details(coll, hull, roof):
    B = Builder()
    for s in (1, -1):
        # ---- character lines
        B.ribbon([hull.side(x, station(x)[2] + 0.004, s) for x in linspace(-2.62, 2.55, 110)], 0.022, "CC_CarNeon", depth=0.01)
        B.ribbon([hull.side(x, station(x)[4] - 0.035, s) for x in linspace(-2.66, 2.70, 110)], 0.010, "CC_CarChrome", depth=0.008)
        # door shut lines + flush neon handle
        for xd in (1.0, -1.18):
            B.ribbon([hull.side(xd + (z - 0.6) * 0.12, z, s) for z in linspace(0.60, 0.93, 14)], 0.008, "CC_CarTrim", depth=0.01, lift=0.002)
        B.ribbon([hull.side(x, 0.86, s) for x in linspace(-1.02, -0.80, 6)], 0.012, "CC_CarNeon", depth=0.006)
        # fender vents
        for x0 in (1.12, 1.27, 1.42):
            B.ribbon([hull.side(x0 + t * 0.13, 0.63 + t * 0.15, s) for t in linspace(0, 1, 8)], 0.032, "CC_CarTrim", depth=0.02, lift=0.003)
            B.ribbon([hull.side(x0 + 0.004 + t * 0.13, 0.63 + t * 0.15, s) for t in linspace(0.1, 0.9, 7)], 0.008, "CC_CarNeon", depth=0.004, lift=0.005)
        # rear quarter intake slashes
        for x0 in (-2.05, -1.9):
            B.ribbon([hull.side(x0 - t * 0.2, 0.66 + t * 0.12, s) for t in linspace(0, 1, 8)], 0.026, "CC_CarTrim", depth=0.02, lift=0.003)
        # hood panel lines converging into the beak
        B.ribbon([hull.top(x, s * lerp(0.44, 0.17, smoothstep(1.3, 2.78, x)) * station(x)[0]) for x in linspace(1.25, 2.78, 40)], 0.008, "CC_CarTrim", depth=0.01, lift=0.002)
        # underglow + side skirt blade
        B.ribbon([hull.bottom(x, s * 0.70 * station(x)[0]) for x in linspace(-2.25, 2.25, 60)], 0.03, "CC_CarNeon", depth=0.01)
        hw = station(0.0)[0]
        B.box((0.05, s * (hw - 0.04), 0.42), (1.6, 0.11, 0.025), "CC_CarTrim", rot=Matrix.Rotation(-0.12 * s, 4, "X"), bevel=0.008)
        # roof edge neon
        B.ribbon([roof.side(x, roof_z(x), s) for x in linspace(0.24, -2.72, 80)], 0.012, "CC_CarNeon", depth=0.006)

    # ---- headlights: wraparound LED bars + DRL
    for s in (1, -1):
        B.ribbon([hull.front(s * y, 0.60) for y in linspace(0.10, 0.58, 24)], 0.03, "CC_HeadLight", depth=0.012)
        B.ribbon([hull.front(s * y, 0.576) for y in linspace(0.24, 0.54, 14)], 0.008, "CC_HeadLight", depth=0.008)
        B.ribbon([hull.front(s * y, 0.60) for y in linspace(0.58, 0.66, 5)], 0.026, "CC_CarMarker", depth=0.01)
    # ---- tail: full-width light bar, thin lower line, vertical end blades
    B.ribbon([hull.back(y, 0.86) for y in linspace(-0.92, 0.92, 48)], 0.045, "CC_TailLight", depth=0.012)
    B.ribbon([hull.back(y, 0.79) for y in linspace(-0.7, 0.7, 30)], 0.010, "CC_TailLight", depth=0.008)
    for s in (1, -1):
        B.ribbon([hull.back(s * 0.96, z) for z in linspace(0.70, 0.95, 8)], 0.02, "CC_TailLight", depth=0.01)
    B.ribbon([roof.back(y, roof_z(-2.8)) for y in linspace(-0.66, 0.66, 30)], 0.018, "CC_TailLight", depth=0.008)

    # ---- hood power bulge with twin vent slots
    bulge_rings = []
    xs = linspace(2.10, 1.28, 14)
    for x in xs:
        h = 0.05 * smoothstep(2.10, 1.55, x)
        row = []
        for y in linspace(-0.34, 0.34, 11):
            hz = hull.top(x, y)
            z0 = hz[0].z if hz else deck_z(x, y)
            bump = max(0.0, 1 - (abs(y) / 0.34) ** 4)
            row.append(Vector((x, y, z0 - 0.02 + (h + 0.02) * bump)))
        bulge_rings.append(row)
    grid = [[B.bm.verts.new(p) for p in r] for r in bulge_rings]
    n0 = B.mark()
    for a, b in zip(grid, grid[1:]):
        for k in range(len(a) - 1):
            B.bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
    B.bm.faces.new(grid[-1])  # rear wall
    B._tag(n0, "CC_CarPaint")

    def bulge_top(x, y):
        h = 0.05 * smoothstep(2.10, 1.55, x)
        hz = hull.top(x, y)
        z0 = hz[0].z if hz else deck_z(x, y)
        return (Vector((x, y, z0 - 0.02 + (h + 0.02) * max(0.0, 1 - (abs(y) / 0.34) ** 4))), Vector((0, 0, 1)))
    for y in (-0.13, 0.13):
        B.ribbon([bulge_top(x, y) for x in linspace(1.34, 1.66, 10)], 0.10, "CC_CarTrim", depth=0.02, lift=0.002)
        for x in linspace(1.37, 1.63, 6):
            B.box(bulge_top(x, y)[0] + Vector((0, 0, -0.002)), (0.01, 0.09, 0.008), "CC_CarChrome")
        B.ribbon([bulge_top(x, y) for x in linspace(1.36, 1.64, 8)], 0.006, "CC_CarNeon", depth=0.004, lift=0.006)

    # ---- hover pads (ducted fans flush with the belly)
    for px in (1.55, -1.75):
        for s in (1, -1):
            hw, zb = station(px)[0], station(px)[1]
            py = s * 0.62 * hw
            c = Vector((px, py, zb))
            B.cyl(c + Vector((0, 0, -0.05)), c + Vector((0, 0, 0.05)), 0.33, 0.31, "CC_CarTrim", segs=40)
            B.lathe([(0.0, 0.26), (-0.01, 0.30)], c + Vector((0, 0, -0.051)), (0, 0, -1), ["CC_CarNeon"], segs=40)
            B.disc(c + Vector((0, 0, -0.035)), (0, 0, -1), 0.255, "CC_Thruster", segs=40)
            for k in range(7):
                a = k * 2 * math.pi / 7
                B.box(c + Vector((math.cos(a) * 0.13, math.sin(a) * 0.13, -0.042)), (0.24, 0.035, 0.008), "CC_CarTrim", rot=Matrix.Rotation(a, 4, "Z") @ Matrix.Rotation(0.4, 4, "X"))
            B.cyl(c + Vector((0, 0, -0.05)), c + Vector((0, 0, -0.03)), 0.06, 0.06, "CC_CarChrome", segs=16)

    # ---- side thruster nacelles
    for s in (1, -1):
        ax = Vector((-1.86, s * 1.16, 0.80))
        prof = [(0.0, 0.13), (0.01, 0.19), (0.05, 0.215), (0.18, 0.228), (0.62, 0.232), (0.86, 0.222), (0.94, 0.21),
                (1.02, 0.205), (1.10, 0.19), (1.15, 0.178), (1.14, 0.15), (1.06, 0.13)]
        mats = ["CC_CarChrome", "CC_CarPaint", "CC_CarPaint", "CC_CarPaint", "CC_CarPaint", "CC_CarTrim", "CC_CarNeon",
                "CC_CarTrim", "CC_CarTrim", "CC_CarChrome", "CC_CarTrim"]
        B.lathe(prof, ax, (-1, 0, 0), mats, segs=36)
        B.disc(ax + Vector((-1.06, 0, 0)), (-1, 0, 0), 0.13, "CC_Thruster", segs=36)
        B.disc(ax + Vector((-0.02, 0, 0)), (1, 0, 0), 0.13, "CC_CarTrim", segs=36)  # intake fan face
        for k in range(9):
            a = k * 2 * math.pi / 9
            B.box(ax + Vector((-0.03, math.cos(a) * 0.065, math.sin(a) * 0.065)), (0.01, 0.12, 0.02), "CC_CarChrome", rot=Matrix.Rotation(a, 4, "X"))
        B.lathe([(0.0, 0.12), (0.0, 0.135)], ax + Vector((-0.012, 0, 0)), (1, 0, 0), ["CC_CarNeon"], segs=36)
        # pylon into the hull
        B.box((-2.35, s * 1.0, 0.80), (0.75, 0.30, 0.11), "CC_CarPaint", bevel=0.03)
        B.box((-2.95, s * 1.16, 0.80), (0.05, 0.02, 0.30), "CC_TailLight")  # vertical nozzle blade

    # ---- rear diffuser fins
    for y in (-0.5, -0.25, 0.0, 0.25, 0.5):
        zb = station(-2.6)[1]
        B.box((-2.62, y, zb + 0.02), (0.44, 0.016, 0.09), "CC_CarTrim", rot=Matrix.Rotation(-0.25, 4, "Y"))

    # ---- mirrors with amber markers
    for s in (1, -1):
        x = 1.02
        hw, zsh = station(x)[0], station(x)[4]
        base = Vector((x, s * 0.80 * hw, zsh + 0.03))
        tip = Vector((x - 0.02, s * (hw + 0.07), zsh + 0.10))
        B.sweep([base, (base + tip) / 2 + Vector((0, 0, 0.03)), tip], 0.016, "CC_CarTrim", segs=8)
        B.sphere(tip + Vector((-0.03, s * 0.04, 0)), (0.11, 0.07, 0.045), "CC_CarPaint", segs=20, rings=10)
        B.sphere(tip + Vector((0.025, s * 0.095, 0)), (0.035, 0.02, 0.018), "CC_CarMarker", segs=10, rings=6)
        B.box(tip + Vector((-0.09, s * 0.04, 0)), (0.004, 0.11, 0.06), "CC_CarChrome")

    # ---- roof: antennas, amber marker, sensor bar
    for s in (1, -1):
        p = Vector((-2.15, s * 0.3, roof_z(-2.15) + 0.05))
        B.box(p, (0.08, 0.04, 0.02), "CC_CarTrim", bevel=0.006)
        B.cyl(p, p + Vector((-0.16, 0, 0.36)), 0.012, 0.004, "CC_CarTrim", segs=8)
        B.sphere(p + Vector((-0.16, 0, 0.37)), (0.012, 0.012, 0.012), "CC_TailLight", segs=8, rings=5)
    B.box((0.27, 0, roof_z(0.27) + 0.015), (0.04, 0.22, 0.02), "CC_CarMarker", bevel=0.006)
    return B.to_object("details", coll)


def screen(B, center, width, height, up, uv_rect, tilt_n):
    """Emissive screen quad facing -X (towards the driver) with a bezel behind it."""
    c, upv = Vector(center), Vector(up).normalized()
    right = Vector((0, -1, 0))  # driver's right (seen from behind, facing +X)
    n = right.cross(upv).normalized()
    if n.x > 0:
        n = -n
    u0, v0, u1, v1 = uv_rect
    h, w = upv * height / 2, right * width / 2
    corners = [c - w - h, c + w - h, c + w + h, c - w + h]
    corners = [p + n * 0.004 for p in corners]
    f = B.quad(corners, "CC_CarScreen", uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    if f.normal.dot(n) < 0:
        f.normal_flip()
    rot = Matrix((right, upv, -n)).transposed().to_4x4()
    B.box(c - n * 0.01, (width + 0.025, height + 0.025, 0.02), "CC_CarTrim", rot=rot, bevel=0.006)


def build_interior(coll, hull):
    B = Builder()
    # ---- dashboard: lofted across the cabin, swept forward at the ends
    rings = []
    for y in linspace(-0.82, 0.82, 23):
        k = (abs(y) / 0.82) ** 2
        prof = [(1.18, 0.76), (0.80, 0.76), (0.67, 0.88), (0.665, 0.985), (0.78, 1.045), (1.22, 1.01)]
        rings.append([Vector((px + 0.10 * k, y, pz - 0.02 * k)) for px, pz in prof])
    bm = B.bm
    grid = [[bm.verts.new(p) for p in r] for r in rings]
    n0 = B.mark()
    for a, b in zip(grid, grid[1:]):
        for i in range(6):
            i2 = (i + 1) % 6
            bm.faces.new((a[i], b[i], b[i2], a[i2]))
    bm.faces.new(list(reversed(grid[0])))
    bm.faces.new(grid[-1])
    B._tag(n0, "CC_CarInterior")
    # dash ambient strip + passenger trim
    B.ribbon([(Vector((0.668 + 0.10 * (abs(y) / 0.82) ** 2, y, 0.93)), Vector((-1, 0, 0))) for y in linspace(-0.8, 0.8, 30)], 0.01, "CC_CarNeon", depth=0.004, lift=0.003)

    # ---- screens (UV atlas: cluster top strip, centre portrait, passenger strip)
    screen(B, (0.715, EYE.y, 1.075), 0.46, 0.14, (0.28, 0, 1), (0.0, 0.6875, 1.0, 1.0), None)
    screen(B, (0.645, 0.0, 0.93), 0.24, 0.30, (-0.30, 0, 0.95), (0.0, 0.1875, 0.40, 0.6875), None)
    screen(B, (0.70, -0.40, 1.02), 0.40, 0.10, (0.25, 0, 1), (0.41, 0.54, 1.0, 0.6875), None)

    # ---- steering yoke: its own object (pivot at the hub) so the game can turn it;
    # the column stays with the dash
    Y = Builder()
    loop2d = [(-0.17, 0.05), (-0.185, -0.03), (-0.15, -0.09), (-0.06, -0.10), (0.06, -0.10), (0.15, -0.09), (0.185, -0.03), (0.17, 0.05), (0.12, 0.075), (-0.12, 0.075)]
    path = catmull([YOKE_HUB + YOKE_RIGHT * u + YOKE_UP * v for u, v in loop2d], n_per=5, closed=True)
    Y.sweep(path, 0.018, "CC_CarTrim", segs=10, closed=True)
    for s in (-1, 1):
        Y.sweep(catmull([YOKE_HUB + YOKE_RIGHT * (s * 0.17) + YOKE_UP * 0.0, YOKE_HUB + YOKE_RIGHT * (s * 0.09) + YOKE_UP * -0.01, YOKE_HUB], n_per=4), 0.013, "CC_CarTrim", segs=8)
    nrm = YOKE_AXIS
    Y.cyl(YOKE_HUB - nrm * 0.02, YOKE_HUB + nrm * 0.03, 0.055, 0.05, "CC_CarTrim", segs=24)
    Y.lathe([(0.0, 0.05), (0.0, 0.058)], YOKE_HUB + nrm * 0.031, nrm, ["CC_CarNeon"], segs=24)
    for s in (-1, 1):  # paddle shifters
        Y.box(YOKE_HUB + YOKE_RIGHT * (s * 0.10) - nrm * 0.035 + YOKE_UP * 0.02, (0.012, 0.05, 0.07), "CC_CarChrome", bevel=0.004)
    B.cyl(YOKE_HUB - nrm * 0.02, Vector((0.74, EYE.y, 0.90)), 0.028, 0.035, "CC_CarTrim", segs=16)
    yoke = Y.to_object("Yoke", coll)
    yoke.data.transform(Matrix.Translation(-YOKE_HUB))
    yoke.location = YOKE_HUB

    # ---- seats
    for sy in (EYE.y, -EYE.y):
        x0 = -0.52
        tilt = Matrix.Rotation(-0.08, 4, "Y")
        B.box((x0, sy, 0.565), (0.54, 0.46, 0.12), "CC_CarSeat", rot=tilt, bevel=0.035, segs=3)
        for s in (-1, 1):
            B.box((x0 - 0.02, sy + s * 0.235, 0.64), (0.50, 0.08, 0.10), "CC_CarSeat", rot=tilt @ Matrix.Rotation(s * 0.25, 4, "X"), bevel=0.03, segs=3)
        back = Matrix.Rotation(-0.30, 4, "Y")
        B.box((x0 - 0.33, sy, 0.90), (0.12, 0.46, 0.64), "CC_CarSeat", rot=back, bevel=0.04, segs=3)
        for s in (-1, 1):
            B.box((x0 - 0.30, sy + s * 0.24, 0.88), (0.15, 0.08, 0.56), "CC_CarSeat", rot=back @ Matrix.Rotation(-s * 0.3, 4, "Z"), bevel=0.03, segs=3)
        B.box((x0 - 0.42, sy, 1.21), (0.10, 0.28, 0.15), "CC_CarSeat", rot=back, bevel=0.035, segs=3)
        # neon piping down the backrest + quilted ribs
        B.box((x0 - 0.265, sy, 0.90), (0.01, 0.012, 0.55), "CC_CarNeon", rot=back)
        for z in linspace(0.72, 1.08, 5):
            B.box((x0 - 0.28 - (z - 0.90) * 0.3, sy, z), (0.012, 0.36, 0.01), "CC_CarInterior", rot=back)

    # ---- centre console
    B.box((-0.15, 0, 0.62), (1.30, 0.20, 0.22), "CC_CarInterior", bevel=0.03, segs=3)
    B.box((-0.15, 0, 0.735), (1.10, 0.012, 0.008), "CC_CarNeon")
    for i, x in enumerate(linspace(0.05, 0.35, 4)):
        for s in (-1, 1):
            B.box((x, s * 0.05, 0.733), (0.035, 0.03, 0.012), "CC_CarMarker" if i == 0 else "CC_CarNeon", bevel=0.004)
    B.box((-0.25, 0, 0.75), (0.08, 0.05, 0.05), "CC_CarChrome", bevel=0.012, segs=3)  # flight stick / selector

    # ---- door-panel ambient light lines (on the tub walls)
    for s in (1, -1):
        B.ribbon([hull.inner(x, 0.86, s) for x in linspace(-1.05, 0.72, 40)], 0.012, "CC_CarNeon", depth=0.006, lift=0.004)
        B.ribbon([hull.inner(x, 0.75, s) for x in linspace(-0.95, 0.6, 30)], 0.06, "CC_CarSeat", depth=0.02, lift=0.004)
    # rear bulkhead logo strip
    B.box((-1.22, 0, 0.82), (0.02, 0.9, 0.012), "CC_CarNeon")
    return B.to_object("interior", coll), yoke


# ---------------------------------------------------------------------------- assembly
def three(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def build_car(coll, name="V0_HoverCar", location=(0, 0, 0)):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    hull_ob, hull_bm = build_hull(coll)
    canopy_ob, canopy_bm = build_canopy(coll)
    roof_ob, roof_bm = build_roof(coll)
    hull_s, roof_s = Surface(hull_bm), Surface(roof_bm)
    det_ob = build_details(coll, hull_s, roof_s)
    int_ob, yoke_ob = build_interior(coll, hull_s)
    for b in (hull_bm, canopy_bm, roof_bm):
        b.free()

    bpy.ops.object.select_all(action="DESELECT")
    parts = [hull_ob, canopy_ob, roof_ob, det_ob, int_ob]
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = hull_ob
    bpy.ops.object.join()
    car = hull_ob
    car.name = name
    car.data.name = name + "_mesh"
    car.location = location
    yoke_ob.parent = car
    yoke_ob.location = YOKE_HUB  # in the car's space (no parent inverse)
    # anchors in three.js space, read by src/vehicle/HoverCar.js
    anchors = {
        "eye": three(EYE),
        "nozzles": [three(Vector((-3.02, s * 1.16, 0.80))) for s in (1, -1)],
        "trails": [three(Vector((-2.78, s * 1.16, 1.06))) for s in (1, -1)],
        "head": three(Vector((2.80, 0, 0.64))),
        "tail": three(Vector((-2.9, 0, 0.86))),
        "cabin": three(Vector((0.0, 0, 1.15))),
        "yoke": {"hub": three(YOKE_HUB), "axis": three(YOKE_AXIS)},  # node "Yoke": turns about axis (points at the driver)
        "pads": [three(Vector((px, s * 0.62 * station(px)[0], station(px)[1] - 0.05))) for px in (1.55, -1.75) for s in (1, -1)],
        "screenAtlas": {"cluster": [0, 0, 1024, 320], "centre": [0, 320, 410, 832], "passenger": [420, 320, 1024, 470]},
    }
    car["anchors"] = json.dumps(anchors)
    tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
    print(f"CAR {name}: {len(car.data.polygons)} faces, ~{tris} tris")
    return car


# ---------------------------------------------------------------------------- standalone
def _studio(out_dir, car):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("Studio")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.03, 1)
    for nm, loc, energy, col in (("Key", (4, -5, 6), 1400, (0.8, 0.9, 1.0)), ("Rim", (-6, 4, 3), 1600, (1.0, 0.3, 0.7)), ("Fill", (6, 6, 2), 500, (0.3, 0.8, 1.0)), ("Top", (0, 0, 8), 600, (1, 1, 1))):
        l = bpy.data.lights.new(nm, "AREA")
        l.energy, l.size, l.color = energy, 5, col
        o = bpy.data.objects.new(nm, l)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0.8)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(o)
    cd = bpy.data.cameras.new("C")
    cd.lens = 50
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1200, 675
    for i, (az, el, dist, look) in enumerate(((35, 14, 9.5, (0, 0, 0.85)), (90, 3, 9.5, (0, 0, 0.85)), (155, 16, 9.5, (0, 0, 0.85)), (0, 75, 10, (0, 0, 0.85)), (210, 8, 8, (0, 0, 0.85)))):
        a, e = math.radians(az), math.radians(el)
        cam.location = Vector((math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e))) * dist + Vector(look)
        cam.rotation_euler = (Vector(look) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cd.lens = 50
        sc.render.filepath = os.path.join(out_dir, f"car_{i}.png")
        bpy.ops.render.render(write_still=True)
    # cockpit view from the driver's eye
    cam.location = EYE
    cam.rotation_euler = (Vector((4, EYE.y, 1.1)) - EYE).to_track_quat("-Z", "Y").to_euler()
    cd.lens = 18
    sc.render.filepath = os.path.join(out_dir, "car_cockpit.png")
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[0] if argv else os.path.join(HERE, "..", "public", "assets", "car.glb")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials.build_materials()
    car = build_car(bpy.context.scene.collection)
    bpy.ops.object.select_all(action="DESELECT")
    car.select_set(True)
    for ch in car.children:
        ch.select_set(True)
    bpy.context.view_layer.objects.active = car
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_extras=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_animations=False)
    print("WROTE", out, os.path.getsize(out))
    if len(argv) > 1:
        _studio(argv[1], car)
    print("CAR DONE")


if __name__ == "__main__":
    main()
