"""
materials.py - material library for the kit.

Every material carries a `cc_role` id. The Three.js side merges all primitives of
a kit piece into one geometry with a per-vertex `aRole` attribute and shades the
whole city with a single TSL uber-material that switches on that role. The
Blender node setups here are a faithful *preview* of the same looks (window grid,
neon palette, LED screens) so the .blend renders like the web build.
"""

import bpy

# role id, name, preview colour, emission colour, emission strength, metallic, roughness
ROLES = [
    (0, "CC_Facade", (0.020, 0.021, 0.028), None, 0.0, 0.35, 0.62),
    (1, "CC_Glass", (0.010, 0.012, 0.020), None, 0.0, 0.85, 0.10),
    (2, "CC_Neon", (0.0, 0.0, 0.0), (1.0, 0.1, 0.6), 18.0, 0.0, 0.4),
    (3, "CC_Metal", (0.045, 0.047, 0.055), None, 0.0, 1.0, 0.32),
    (4, "CC_Concrete", (0.050, 0.050, 0.058), None, 0.0, 0.0, 0.85),
    (5, "CC_Sign", (0.0, 0.0, 0.0), (0.0, 0.85, 1.0), 10.0, 0.0, 0.3),
    (6, "CC_Screen", (0.0, 0.0, 0.0), (0.4, 0.2, 1.0), 6.0, 0.0, 0.2),
    (7, "CC_Light", (0.0, 0.0, 0.0), (1.0, 0.78, 0.55), 12.0, 0.0, 0.3),
    (8, "CC_Beacon", (0.0, 0.0, 0.0), (1.0, 0.05, 0.05), 40.0, 0.0, 0.3),
    (9, "CC_Holo", (0.0, 0.0, 0.0), (0.2, 0.9, 1.0), 4.0, 0.0, 0.3),
    (10, "CC_CarPaint", (0.012, 0.012, 0.016), None, 0.0, 0.9, 0.28),
    (11, "CC_CarGlass", (0.005, 0.006, 0.010), None, 0.0, 0.2, 0.04),
    (12, "CC_CarNeon", (0.0, 0.0, 0.0), (0.0, 0.9, 1.0), 25.0, 0.0, 0.3),
    (13, "CC_HeadLight", (0.0, 0.0, 0.0), (0.85, 0.95, 1.0), 40.0, 0.0, 0.2),
    (14, "CC_TailLight", (0.0, 0.0, 0.0), (1.0, 0.02, 0.18), 30.0, 0.0, 0.2),
    (15, "CC_Thruster", (0.0, 0.0, 0.0), (0.35, 0.75, 1.0), 30.0, 0.0, 0.2),
    (16, "CC_CarTrim", (0.006, 0.006, 0.008), None, 0.0, 0.4, 0.5),
]

# Neon palette shared with the city generator (Palette panel) and the web build.
PALETTE = [
    (1.00, 0.08, 0.58),  # hot magenta
    (0.00, 0.80, 1.00),  # electric cyan
    (0.55, 0.18, 1.00),  # ultraviolet
    (1.00, 0.50, 0.08),  # sodium amber
]

MATS = {}


def _principled(nt):
    return next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def _new_mat(name):
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m


def _instancer_attr(nt, name):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "INSTANCER"
    a.attribute_name = name
    return a


def _palette_ramp(nt, index_socket):
    """Pick a palette colour from an integer index (0..3) stored on the instance."""
    div = nt.nodes.new("ShaderNodeMath")
    div.operation = "MULTIPLY_ADD"
    nt.links.new(index_socket, div.inputs[0])
    div.inputs[1].default_value = 0.25
    div.inputs[2].default_value = 0.01
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    els[0].position = 0.0
    els[0].color = (*PALETTE[0], 1)
    els[1].position = 0.25
    els[1].color = (*PALETTE[1], 1)
    e = els.new(0.5)
    e.color = (*PALETTE[2], 1)
    e = els.new(0.75)
    e.color = (*PALETTE[3], 1)
    nt.links.new(div.outputs[0], ramp.inputs[0])
    return ramp.outputs[0]


def window_grid_group():
    """CC_WindowGrid shader group - preview of the TSL window shader."""
    name = "CC_WindowGrid"
    old = bpy.data.node_groups.get(name)
    if old:
        bpy.data.node_groups.remove(old)
    ng = bpy.data.node_groups.new(name, "ShaderNodeTree")
    I = ng.interface
    for n, d in (("Floor Height", 4.0), ("Window Width", 2.6), ("Lit Ratio", 0.38), ("Seed", 0.0)):
        s = I.new_socket(n, in_out="INPUT", socket_type="NodeSocketFloat")
        s.default_value = d
    I.new_socket("Emission", in_out="OUTPUT", socket_type="NodeSocketColor")
    I.new_socket("Pane", in_out="OUTPUT", socket_type="NodeSocketFloat")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    geo = N.new("ShaderNodeNewGeometry")
    sp = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Position"], sp.inputs[0])
    sn = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sn.inputs[0])

    def m(op, a, b=None):
        n = N.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, bpy.types.NodeSocket):
                L.new(v, n.inputs[i])
            else:
                n.inputs[i].default_value = v
        return n.outputs[0]

    xdom = m("GREATER_THAN", m("ABSOLUTE", sn.outputs[0]), m("ABSOLUTE", sn.outputs[1]))
    mix = N.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    L.new(xdom, mix.inputs[0])
    L.new(sp.outputs[0], mix.inputs[2])
    L.new(sp.outputs[1], mix.inputs[3])
    u = m("DIVIDE", mix.outputs[0], gi.outputs["Window Width"])
    v = m("DIVIDE", sp.outputs[2], gi.outputs["Floor Height"])
    cx, cy = m("FLOOR", u), m("FLOOR", v)
    fx, fy = m("FRACT", u), m("FRACT", v)
    pane = m("MULTIPLY",
             m("MULTIPLY", m("GREATER_THAN", fx, 0.1), m("LESS_THAN", fx, 0.9)),
             m("MULTIPLY", m("GREATER_THAN", fy, 0.22), m("LESS_THAN", fy, 0.86)))
    cv = N.new("ShaderNodeCombineXYZ")
    L.new(cx, cv.inputs[0])
    L.new(cy, cv.inputs[1])
    L.new(m("MULTIPLY", gi.outputs["Seed"], 17.0), cv.inputs[2])
    wn = N.new("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    L.new(cv.outputs[0], wn.inputs["Vector"])
    lit = m("LESS_THAN", wn.outputs["Value"], gi.outputs["Lit Ratio"])
    ramp = N.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].color = (1.0, 0.62, 0.32, 1)
    els[1].color = (0.55, 0.75, 1.0, 1)
    e = els.new(0.85)
    e.color = (1.0, 0.3, 0.8, 1)
    sep = N.new("ShaderNodeSeparateColor")
    L.new(wn.outputs["Color"], sep.inputs[0])
    L.new(sep.outputs[0], ramp.inputs[0])
    k = m("MULTIPLY", lit, pane)
    k = m("MULTIPLY", k, m("ADD", m("MULTIPLY", sep.outputs[1], 1.6), 0.4))
    sc = N.new("ShaderNodeMix")
    sc.data_type = "RGBA"
    sc.blend_type = "MULTIPLY"
    sc.inputs[0].default_value = 1.0
    L.new(ramp.outputs[0], sc.inputs[6])
    cc = N.new("ShaderNodeCombineColor")
    for i in range(3):
        L.new(k, cc.inputs[i])
    L.new(cc.outputs[0], sc.inputs[7])
    L.new(sc.outputs[2], go.inputs["Emission"])
    L.new(pane, go.inputs["Pane"])
    return ng


def build_materials():
    wg = window_grid_group()
    for role, name, base, emit, strength, metal, rough in ROLES:
        m = _new_mat(name)
        m["cc_role"] = role
        nt = m.node_tree
        bsdf = _principled(nt)
        bsdf.inputs["Base Color"].default_value = (*base, 1)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
            bsdf.inputs["Emission Strength"].default_value = strength
        m.diffuse_color = (*(emit or base), 1)
        MATS[name] = m

    # --- glass: window grid preview
    nt = MATS["CC_Glass"].node_tree
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = wg
    seed = _instancer_attr(nt, "seed")
    nt.links.new(seed.outputs["Fac"], g.inputs["Seed"])
    bsdf = _principled(nt)
    nt.links.new(g.outputs["Emission"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 6.0

    # --- neon / signs: palette colour picked from the instance attribute "hue"
    for name, strength in (("CC_Neon", 18.0), ("CC_Sign", 9.0)):
        nt = MATS[name].node_tree
        hue = _instancer_attr(nt, "hue")
        col = _palette_ramp(nt, hue.outputs["Fac"])
        bsdf = _principled(nt)
        nt.links.new(col, bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = strength

    # --- LED screen preview: stripes of palette colour
    nt = MATS["CC_Screen"].node_tree
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 3.0
    wave.inputs["Distortion"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*PALETTE[2], 1)
    ramp.color_ramp.elements[1].color = (*PALETTE[1], 1)
    nt.links.new(wave.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], _principled(nt).inputs["Emission Color"])

    # --- car paint gets a clear coat
    bsdf = _principled(MATS["CC_CarPaint"].node_tree)
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.03

    # --- hologram: additive-ish emission
    m = MATS["CC_Holo"]
    bsdf = _principled(m.node_tree)
    bsdf.inputs["Alpha"].default_value = 0.35
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    return MATS


def material_record(m):
    """Serialisable parameters for the manifest."""
    bsdf = _principled(m.node_tree)
    rec = {
        "role": int(m.get("cc_role", 0)),
        "baseColor": list(bsdf.inputs["Base Color"].default_value)[:3],
        "metallic": bsdf.inputs["Metallic"].default_value,
        "roughness": bsdf.inputs["Roughness"].default_value,
        "emissive": list(bsdf.inputs["Emission Color"].default_value)[:3],
        "emissiveStrength": bsdf.inputs["Emission Strength"].default_value,
    }
    if m.name == "CC_Glass":
        g = next(n for n in m.node_tree.nodes if n.type == "GROUP")
        rec["windowGrid"] = {s.name: s.default_value for s in g.inputs if s.type == "VALUE" and not s.is_linked}
    return rec
