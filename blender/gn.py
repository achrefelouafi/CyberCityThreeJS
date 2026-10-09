"""
gn.py - a tiny Python DSL for authoring Geometry Nodes trees.

Every node tree in this project (the modular kit, the hover car and the city
generator itself) is written with this module, so the .blend stays fully
procedural and readable: node trees are laid out automatically and grouped
into labelled frames, and group inputs are organised into panels that the
export pipeline later turns into Three.js GUI folders.

    g = GN("CC_Example")
    g.inp("Width", "FLOAT", 10, 1, 100, panel="Shape")
    geo = g.cube(g.vec(g.p("Width"), 1, 1))
    g.out("Geometry", geo)
    g.finish()
"""

import bpy

SOCKET_TYPES = {
    "GEO": "NodeSocketGeometry",
    "FLOAT": "NodeSocketFloat",
    "INT": "NodeSocketInt",
    "BOOL": "NodeSocketBool",
    "VEC": "NodeSocketVector",
    "COLOR": "NodeSocketColor",
    "MAT": "NodeSocketMaterial",
    "COLL": "NodeSocketCollection",
    "OBJ": "NodeSocketObject",
}

COLUMN_W = 230
ROW_PAD = 26


def is_sock(v):
    return isinstance(v, bpy.types.NodeSocket)


def _enabled(sockets):
    return [s for s in sockets if getattr(s, "enabled", True)]


class GN:
    """Builder for a single node group."""

    def __init__(self, name, tree_type="GeometryNodeTree"):
        old = bpy.data.node_groups.get(name)
        if old is not None:
            bpy.data.node_groups.remove(old)
        self.name = name
        self.tree = bpy.data.node_groups.new(name, tree_type)
        self.nodes = self.tree.nodes
        self.links = self.tree.links
        self._gout = self.nodes.new("NodeGroupOutput")
        self._panels = {}
        self._iface = {}
        self._frame = None
        self._frames = []
        self._frame_gin = {}
        self._order = []

    # ------------------------------------------------------------------ interface
    def panel(self, name):
        if name not in self._panels:
            self._panels[name] = self.tree.interface.new_panel(name)
        return self._panels[name]

    def inp(self, name, stype, default=None, vmin=None, vmax=None, desc="", subtype=None, panel=None):
        if isinstance(vmin, str):  # inp(name, type, default, "description", ...)
            desc, vmin = vmin, None
        kw = {}
        if panel:
            kw["parent"] = self.panel(panel)
        item = self.tree.interface.new_socket(name, in_out="INPUT", socket_type=SOCKET_TYPES[stype], **kw)
        if subtype:
            try:
                item.subtype = subtype
            except Exception:
                pass
        if default is not None and hasattr(item, "default_value"):
            item.default_value = default
        if vmin is not None and hasattr(item, "min_value"):
            item.min_value = vmin
        if vmax is not None and hasattr(item, "max_value"):
            item.max_value = vmax
        item.description = desc
        self._iface[name] = item
        return item

    def out(self, name, sock, stype="GEO"):
        item = self.tree.interface.new_socket(name, in_out="OUTPUT", socket_type=SOCKET_TYPES[stype])
        target = next(s for s in self._gout.inputs if s.identifier == item.identifier)
        self.links.new(sock, target)

    def p(self, name):
        """Socket of a group input. Each frame gets its own Group Input node."""
        key = self._frame.name if self._frame else None
        gin = self._frame_gin.get(key)
        if gin is None:
            gin = self.nodes.new("NodeGroupInput")
            gin.parent = self._frame
            self._frame_gin[key] = gin
            self._order.append(gin)
        ident = self._iface[name].identifier
        return next(s for s in gin.outputs if s.identifier == ident)

    # ------------------------------------------------------------------ framing
    class _FrameCtx:
        def __init__(self, g, label, color):
            self.g, self.label, self.color = g, label, color

        def __enter__(self):
            f = self.g.nodes.new("NodeFrame")
            f.label = self.label
            f.name = "Frame_" + self.label
            f.label_size = 28
            if self.color:
                f.use_custom_color = True
                f.color = self.color
            self.prev = self.g._frame
            self.g._frame = f
            self.g._frames.append(f)
            return f

        def __exit__(self, *a):
            self.g._frame = self.prev

    def frame(self, label, color=None):
        return GN._FrameCtx(self, label, color)

    # ------------------------------------------------------------------ core
    def node(self, ntype, **props):
        n = self.nodes.new(ntype)
        for k, v in props.items():
            setattr(n, k, v)
        if self._frame is not None:
            n.parent = self._frame
        self._order.append(n)
        return n

    def set(self, sock, value):
        if value is None:
            return
        if is_sock(value):
            self.links.new(value, sock)
        else:
            if sock.type == "INT":
                value = int(round(value))
            elif sock.type == "BOOLEAN":
                value = bool(value)
            elif sock.type == "VALUE":
                value = float(value)
            elif sock.type == "VECTOR" and isinstance(value, (int, float)):
                value = (value, value, value)
            sock.default_value = value

    def i(self, node, key):
        """Input socket by index or by (enabled) name."""
        if isinstance(key, int):
            return node.inputs[key]
        for s in _enabled(node.inputs):
            if s.name == key or s.identifier == key:
                return s
        raise KeyError(f"{node.bl_idname} has no enabled input {key!r}: {[s.name for s in _enabled(node.inputs)]}")

    def o(self, node, key=0):
        if isinstance(key, int):
            return _enabled(node.outputs)[key]
        for s in _enabled(node.outputs):
            if s.name == key or s.identifier == key:
                return s
        raise KeyError(f"{node.bl_idname} has no enabled output {key!r}")

    def wire(self, node, **inputs):
        for k, v in inputs.items():
            self.set(self.i(node, k.replace("_", " ")), v)
        return node

    # ------------------------------------------------------------------ float math
    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        self.set(n.inputs[2], c)
        return n.outputs[0]

    def add(self, a, b): return self.math("ADD", a, b)
    def sub(self, a, b): return self.math("SUBTRACT", a, b)
    def mul(self, a, b): return self.math("MULTIPLY", a, b)
    def div(self, a, b): return self.math("DIVIDE", a, b)
    def madd(self, a, b, c): return self.math("MULTIPLY_ADD", a, b, c)
    def fmin(self, a, b): return self.math("MINIMUM", a, b)
    def fmax(self, a, b): return self.math("MAXIMUM", a, b)
    def pow(self, a, b): return self.math("POWER", a, b)
    def floor(self, a): return self.math("FLOOR", a)
    def round(self, a): return self.math("ROUND", a)
    def fract(self, a): return self.math("FRACT", a)
    def absf(self, a): return self.math("ABSOLUTE", a)
    def sin(self, a): return self.math("SINE", a)
    def cos(self, a): return self.math("COSINE", a)
    def lt(self, a, b): return self.math("LESS_THAN", a, b)
    def gt(self, a, b): return self.math("GREATER_THAN", a, b)

    def clamp(self, x, lo=0.0, hi=1.0):
        n = self.node("ShaderNodeClamp")
        self.set(n.inputs[0], x)
        self.set(n.inputs[1], lo)
        self.set(n.inputs[2], hi)
        return n.outputs[0]

    def lerp(self, a, b, t):
        # a + (b - a) * t  (same evaluation order as the JS port)
        return self.add(a, self.mul(self.sub(b, a), t))

    def smooth(self, x):
        # x * x * (3 - 2x)
        return self.mul(self.mul(x, x), self.sub(3.0, self.mul(2.0, x)))

    # ------------------------------------------------------------------ int math
    def imath(self, op, a, b=None):
        n = self.node("FunctionNodeIntegerMath", operation=op)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        return n.outputs[0]

    def iadd(self, a, b): return self.imath("ADD", a, b)
    def isub(self, a, b): return self.imath("SUBTRACT", a, b)
    def imul(self, a, b): return self.imath("MULTIPLY", a, b)
    def idiv(self, a, b): return self.imath("DIVIDE_FLOOR", a, b)
    def imod(self, a, b): return self.imath("FLOORED_MODULO", a, b)
    def imax(self, a, b): return self.imath("MAXIMUM", a, b)
    def imin(self, a, b): return self.imath("MINIMUM", a, b)

    def to_int(self, x, mode="FLOOR"):
        n = self.node("FunctionNodeFloatToInt", rounding_mode=mode)
        self.set(n.inputs[0], x)
        return n.outputs[0]

    def const_i(self, v):
        n = self.node("FunctionNodeInputInt", integer=int(v))
        return n.outputs[0]

    # ------------------------------------------------------------------ logic
    def cmp(self, op, a, b, dtype="FLOAT"):
        n = self.node("FunctionNodeCompare", data_type=dtype, operation=op)
        ins = [s for s in _enabled(n.inputs) if s.name in ("A", "B")]
        self.set(ins[0], a)
        self.set(ins[1], b)
        return n.outputs[0]

    def band(self, a, b): return self._bool("AND", a, b)
    def bor(self, a, b): return self._bool("OR", a, b)
    def bnot(self, a): return self._bool("NOT", a)

    def _bool(self, op, a, b=None):
        n = self.node("FunctionNodeBooleanMath", operation=op)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        return n.outputs[0]

    def switch(self, dtype, cond, if_false, if_true):
        n = self.node("GeometryNodeSwitch", input_type=dtype)
        self.set(self.i(n, "Switch"), cond)
        self.set(self.i(n, "False"), if_false)
        self.set(self.i(n, "True"), if_true)
        return n.outputs[0]

    def index_switch(self, dtype, index, values):
        """Index Switch node: values[index] (python constants or sockets)."""
        n = self.node("GeometryNodeIndexSwitch", data_type=dtype)
        while len([s for s in n.inputs if s.name.isdigit()]) < len(values):
            n.index_switch_items.new()
        self.set(n.inputs[0], index)
        slots = [s for s in n.inputs if s.name.isdigit()]
        for sock, v in zip(slots, values):
            self.set(sock, v)
        return n.outputs[0]

    # ------------------------------------------------------------------ random (Blender hash, mirrored in JS)
    def rand_f(self, rid, seed, lo=0.0, hi=1.0):
        n = self.node("FunctionNodeRandomValue", data_type="FLOAT")
        ins = _enabled(n.inputs)
        self.set(ins[0], lo)
        self.set(ins[1], hi)
        self.set(self.i(n, "ID"), rid)
        self.set(self.i(n, "Seed"), seed)
        return self.o(n)

    def rand_i(self, rid, seed, lo, hi):
        n = self.node("FunctionNodeRandomValue", data_type="INT")
        ins = _enabled(n.inputs)
        self.set(ins[0], lo)
        self.set(ins[1], hi)
        self.set(self.i(n, "ID"), rid)
        self.set(self.i(n, "Seed"), seed)
        return self.o(n)

    def group(self, tree, label=None, **inputs):
        n = self.node("GeometryNodeGroup")
        n.node_tree = tree
        if label:
            n.label = label
        for k, v in inputs.items():
            self.set(self.i(n, k.replace("_", " ")), v)
        return n

    # ------------------------------------------------------------------ vectors
    def vec(self, x=0.0, y=0.0, z=0.0):
        n = self.node("ShaderNodeCombineXYZ")
        self.set(n.inputs[0], x)
        self.set(n.inputs[1], y)
        self.set(n.inputs[2], z)
        return n.outputs[0]

    def sep(self, v):
        n = self.node("ShaderNodeSeparateXYZ")
        self.set(n.inputs[0], v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def vmath(self, op, a, b=None, scale=None):
        n = self.node("ShaderNodeVectorMath", operation=op)
        self.set(n.inputs[0], a)
        if b is not None:
            self.set(n.inputs[1], b)
        if scale is not None:
            self.set(self.i(n, "Scale"), scale)
        out = self.o(n)
        return out

    def vadd(self, a, b): return self.vmath("ADD", a, b)
    def vmul(self, a, b): return self.vmath("MULTIPLY", a, b)
    def vscale(self, a, s): return self.vmath("SCALE", a, scale=s)

    def euler(self, x=0.0, y=0.0, z=0.0):
        n = self.node("FunctionNodeEulerToRotation")
        self.set(n.inputs[0], self.vec(x, y, z) if any(is_sock(v) for v in (x, y, z)) else (x, y, z))
        return n.outputs[0]

    # ------------------------------------------------------------------ fields
    def index(self): return self.node("GeometryNodeInputIndex").outputs[0]
    def position(self): return self.node("GeometryNodeInputPosition").outputs[0]
    def normal(self): return self.node("GeometryNodeInputNormal").outputs[0]

    def named(self, name, dtype="FLOAT"):
        n = self.node("GeometryNodeInputNamedAttribute", data_type=dtype)
        self.set(n.inputs[0], name)
        return n.outputs[0]

    # ------------------------------------------------------------------ geometry
    def store(self, geo, name, value, dtype="FLOAT", domain="POINT", sel=None):
        n = self.node("GeometryNodeStoreNamedAttribute", data_type=dtype, domain=domain)
        self.set(self.i(n, "Geometry"), geo)
        self.set(self.i(n, "Name"), name)
        self.set(self.i(n, "Value"), value)
        if sel is not None:
            self.set(self.i(n, "Selection"), sel)
        return n.outputs[0]

    def with_uv(self, node):
        """Store the primitive's UV Map output as 'UVMap' so it survives export."""
        return self.store(node.outputs[0], "UVMap", self.o(node, "UV Map"), "FLOAT2", "CORNER")

    def cube(self, size=(1, 1, 1), verts=None):
        n = self.node("GeometryNodeMeshCube")
        self.set(self.i(n, "Size"), size)
        if verts:
            for k, v in zip(("Vertices X", "Vertices Y", "Vertices Z"), verts):
                self.set(self.i(n, k), v)
        return self.with_uv(n)

    def cyl(self, verts=16, radius=1.0, depth=2.0, fill="NGON"):
        n = self.node("GeometryNodeMeshCylinder", fill_type=fill)
        self.set(self.i(n, "Vertices"), verts)
        self.set(self.i(n, "Radius"), radius)
        self.set(self.i(n, "Depth"), depth)
        return self.with_uv(n)

    def cone(self, verts=16, r_top=0.0, r_bottom=1.0, depth=2.0, fill="NGON"):
        n = self.node("GeometryNodeMeshCone", fill_type=fill)
        self.set(self.i(n, "Vertices"), verts)
        self.set(self.i(n, "Radius Top"), r_top)
        self.set(self.i(n, "Radius Bottom"), r_bottom)
        self.set(self.i(n, "Depth"), depth)
        return self.with_uv(n)

    def uvsphere(self, seg=16, rings=8, radius=1.0):
        n = self.node("GeometryNodeMeshUVSphere")
        self.wire(n, Segments=seg, Rings=rings, Radius=radius)
        return self.with_uv(n)

    def ico(self, radius=1.0, subdiv=1):
        n = self.node("GeometryNodeMeshIcoSphere")
        self.wire(n, Radius=radius, Subdivisions=subdiv)
        return self.with_uv(n)

    def grid(self, sx, sy, vx, vy):
        n = self.node("GeometryNodeMeshGrid")
        self.set(self.i(n, "Size X"), sx)
        self.set(self.i(n, "Size Y"), sy)
        self.set(self.i(n, "Vertices X"), vx)
        self.set(self.i(n, "Vertices Y"), vy)
        return self.with_uv(n)

    def mesh_line(self, count, start, offset):
        n = self.node("GeometryNodeMeshLine", mode="OFFSET", count_mode="TOTAL")
        self.set(self.i(n, "Count"), count)
        self.set(self.i(n, "Start Location"), start)
        self.set(self.i(n, "Offset"), offset)
        return n.outputs[0]

    def points(self, count, pos=None):
        n = self.node("GeometryNodePoints")
        self.set(self.i(n, "Count"), count)
        self.set(self.i(n, "Position"), pos)
        return n.outputs[0]

    def transform(self, geo, t=None, r=None, s=None):
        n = self.node("GeometryNodeTransform")
        self.set(self.i(n, "Geometry"), geo)
        if t is not None:
            self.set(self.i(n, "Translation"), t)
        if r is not None:
            self.set(self.i(n, "Rotation"), r)
        if s is not None:
            self.set(self.i(n, "Scale"), s)
        return n.outputs[0]

    def join(self, *geos):
        n = self.node("GeometryNodeJoinGeometry")
        for gsock in reversed([x for x in geos if x is not None]):
            self.links.new(gsock, n.inputs[0])
        return n.outputs[0]

    def set_mat(self, geo, mat, sel=None):
        n = self.node("GeometryNodeSetMaterial")
        self.set(self.i(n, "Geometry"), geo)
        self.i(n, "Material").default_value = mat
        if sel is not None:
            self.set(self.i(n, "Selection"), sel)
        return n.outputs[0]

    def set_pos(self, geo, pos=None, offset=None, sel=None):
        n = self.node("GeometryNodeSetPosition")
        self.set(self.i(n, "Geometry"), geo)
        self.set(self.i(n, "Position"), pos)
        self.set(self.i(n, "Offset"), offset)
        if sel is not None:
            self.set(self.i(n, "Selection"), sel)
        return n.outputs[0]

    def smooth_shade(self, geo, smooth=True, sel=None, domain="FACE"):
        n = self.node("GeometryNodeSetShadeSmooth", domain=domain)
        self.set(self.i(n, "Mesh"), geo)
        self.set(self.i(n, "Shade Smooth"), smooth)
        if sel is not None:
            self.set(self.i(n, "Selection"), sel)
        return n.outputs[0]

    def auto_smooth(self, geo, angle_deg=35.0):
        """Smooth faces, keep edges sharper than `angle_deg` hard (replacement for legacy auto smooth)."""
        geo = self.smooth_shade(geo, True)
        ang = self.node("GeometryNodeInputMeshEdgeAngle").outputs[0]
        sharp = self.gt(ang, angle_deg * 3.14159265 / 180.0)
        return self.smooth_shade(geo, False, sel=sharp, domain="EDGE")

    def realize(self, geo):
        n = self.node("GeometryNodeRealizeInstances")
        self.set(self.i(n, "Geometry"), geo)
        return n.outputs[0]

    def delete(self, geo, sel, domain="POINT"):
        n = self.node("GeometryNodeDeleteGeometry", domain=domain)
        self.set(self.i(n, "Geometry"), geo)
        self.set(self.i(n, "Selection"), sel)
        return n.outputs[0]

    def dup(self, geo, amount, domain="POINT"):
        n = self.node("GeometryNodeDuplicateElements", domain=domain)
        self.set(self.i(n, "Geometry"), geo)
        self.set(self.i(n, "Amount"), amount)
        return n.outputs[0], n.outputs[1]

    def merge(self, geo, dist=0.001):
        n = self.node("GeometryNodeMergeByDistance")
        self.set(self.i(n, "Geometry"), geo)
        self.set(self.i(n, "Distance"), dist)
        return n.outputs[0]

    def subdiv(self, geo, level=1):
        n = self.node("GeometryNodeSubdivisionSurface")
        self.set(self.i(n, "Mesh"), geo)
        self.set(self.i(n, "Level"), level)
        return n.outputs[0]

    def union(self, *geos, solver="EXACT"):
        """Mesh Boolean union: merges overlapping closed parts and deletes the coincident /
        buried faces between them (the source of Z-fighting on caps, crowns and pillars).
        Material indices are kept per face."""
        from materials import MATS
        # The exact solver keeps per-face material indices but not the material list, so
        # tag every face with its material first and re-assign the materials afterwards.
        geo = self.join(*geos)
        mats = list(MATS.values())
        mid = None
        for k, mat in enumerate(mats):
            sel = self.node("GeometryNodeMaterialSelection")
            self.i(sel, "Material").default_value = mat
            term = self.mul(self.o(sel), float(k + 1))
            mid = term if mid is None else self.add(mid, term)
        geo = self.store(geo, "cc_mid", mid, "FLOAT", "FACE")
        n = self.node("GeometryNodeMeshBoolean", operation="UNION")
        try:
            n.solver = solver
        except TypeError:
            pass
        # operands are joins of overlapping primitives: let the exact solver resolve them
        self.set(next(s for s in n.inputs if s.name == "Self Intersection"), True)
        self.links.new(geo, self.i(n, "Mesh 2"))
        out = n.outputs[0]
        tag = self.named("cc_mid")
        for k, mat in enumerate(mats):
            out = self.set_mat(out, mat, sel=self.cmp("EQUAL", tag, float(k + 1)))
        return out

    def flip(self, geo):
        n = self.node("GeometryNodeFlipFaces")
        self.set(self.i(n, "Mesh"), geo)
        return n.outputs[0]

    def coll(self, collection):
        n = self.node("GeometryNodeCollectionInfo", transform_space="ORIGINAL")
        self.i(n, "Collection").default_value = collection
        self.set(self.i(n, "Separate Children"), True)
        self.set(self.i(n, "Reset Children"), True)
        return n.outputs[0]

    def instance(self, points, inst, sel=None, pick=False, index=None, rot=None, scale=None):
        n = self.node("GeometryNodeInstanceOnPoints")
        self.set(self.i(n, "Points"), points)
        self.set(self.i(n, "Instance"), inst)
        if sel is not None:
            self.set(self.i(n, "Selection"), sel)
        self.set(self.i(n, "Pick Instance"), pick)
        if index is not None:
            # "Instance Index" is an implicit-field input: constants must be linked, not typed in
            self.set(self.i(n, "Instance Index"), index if is_sock(index) else self.const_i(index))
        if rot is not None:
            self.set(self.i(n, "Rotation"), rot)
        if scale is not None:
            self.set(self.i(n, "Scale"), scale)
        return n.outputs[0]

    def float_curve(self, x, pts):
        """Float Curve node; pts = [(x, y), ...] in 0..1. Editable afterwards in the UI."""
        n = self.node("ShaderNodeFloatCurve")
        self.set(self.i(n, "Value"), x)
        curve = n.mapping.curves[0]
        while len(curve.points) > 2:
            curve.points.remove(curve.points[-1])
        curve.points[0].location = pts[0]
        curve.points[1].location = pts[-1]
        for px, py in pts[1:-1]:
            curve.points.new(px, py)
        for pt in curve.points:
            pt.handle_type = "AUTO"
        n.mapping.use_clip = False
        n.mapping.update()
        return n.outputs[0]

    # ------------------------------------------------------------------ finalisation / layout
    def finish(self):
        self._layout()
        for gin in self._frame_gin.values():
            for s in gin.outputs:
                if not s.is_linked:
                    s.hide = True
        return self.tree

    def _layout(self):
        nodes = [n for n in self.nodes if n.bl_idname != "NodeFrame"]
        preds = {n: [] for n in nodes}
        for l in self.links:
            if l.to_node in preds and l.from_node in preds:
                preds[l.to_node].append(l.from_node)
        depth = {}

        def d(n, stack=()):
            if n in depth:
                return depth[n]
            if n in stack:
                return 0
            v = 0 if not preds[n] else 1 + max(d(p, stack + (n,)) for p in preds[n])
            depth[n] = v
            return v

        for n in nodes:
            d(n)

        # group nodes per frame (None = unframed); frames are stacked top-to-bottom
        groups = {}
        for n in nodes:
            groups.setdefault(n.parent.name if n.parent else None, []).append(n)
        order_idx = {n: i for i, n in enumerate(self._order)}
        y_cursor = 0.0
        frame_names = [None] + [f.name for f in self._frames]
        for fname in frame_names:
            members = groups.get(fname)
            if not members:
                continue
            members = [m for m in members if m is not self._gout]
            if not members:
                continue
            base = min(depth[m] for m in members)
            cols = {}
            for m in sorted(members, key=lambda m: order_idx.get(m, 0)):
                cols.setdefault(depth[m] - base, []).append(m)
            tallest = 0.0
            for c, ms in cols.items():
                y = y_cursor
                for m in ms:
                    h = 40 + 22 * (len(_enabled(m.inputs)) + len(_enabled(m.outputs)))
                    if m.bl_idname == "NodeGroupInput":
                        h = 40 + 22 * sum(1 for s in m.outputs if s.is_linked)
                    m.location_absolute = (depth[m] * COLUMN_W, y)
                    y -= h + ROW_PAD
                tallest = max(tallest, y_cursor - y)
            y_cursor -= tallest + 160
        maxd = max(depth.values()) if depth else 0
        self._gout.location_absolute = ((maxd + 1) * COLUMN_W, 0)


def iface_inputs(tree):
    """Serialise a node group's input interface (used by the exporter)."""
    out = []
    for item in tree.interface.items_tree:
        if item.item_type != "SOCKET" or item.in_out != "INPUT":
            continue
        rec = {
            "name": item.name,
            "identifier": item.identifier,
            "socketType": item.socket_type,
            "description": item.description,
            "panel": item.parent.name if item.parent and item.parent.name else None,
        }
        if hasattr(item, "default_value"):
            dv = item.default_value
            rec["default"] = list(dv) if hasattr(dv, "__len__") and not isinstance(dv, str) else (dv if isinstance(dv, (int, float, bool, str)) else None)
        if hasattr(item, "min_value"):
            rec["min"] = item.min_value
            rec["max"] = item.max_value
        if hasattr(item, "subtype"):
            rec["subtype"] = item.subtype
        out.append(rec)
    return out
