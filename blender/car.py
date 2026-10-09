"""
car.py - "KX-9 Kestrel" hover car, fully procedural in Geometry Nodes.

The body is a loft: a grid is wrapped into super-elliptical cross sections whose
half-width, roof line and belly line along the car are driven by Float Curve
nodes (editable in the node editor). Material zones (neon waist line, light
bars, glass, trim) are selected from the stored loft parameters, so they follow
any change to the sliders or curves.

Vehicle faces +X (Blender), becomes +X in three.js after the Y-up conversion.
"""

import math
from gn import GN
from materials import MATS

PI = math.pi
TAU = 2 * PI


def _loft(g, nx, ns, w_curve, top_curve, bot_curve, length, width, height, x0, z0, expo, prefix):
    """Loft along X. Stores <prefix>_t, <prefix>_px, <prefix>_pz on points for material zoning."""
    geo = g.grid(1.0, 1.0, nx, ns)
    geo = g.flip(geo)  # wrapping the grid turns its normals inwards
    gx, gy, _ = g.sep(g.position())
    t = g.add(gx, 0.5)
    theta = g.mul(g.add(gy, 0.5), TAU)
    c, s = g.cos(theta), g.sin(theta)
    pe = g.div(2.0, expo)
    px = g.mul(g.math("SIGN", c), g.pow(g.absf(c), pe))
    pz = g.mul(g.math("SIGN", s), g.pow(g.absf(s), pe))
    geo = g.store(geo, prefix + "_t", t)
    geo = g.store(geo, prefix + "_px", px)
    geo = g.store(geo, prefix + "_pz", pz)

    # caps: collapse the first/last ring onto the neighbouring ring's centre
    eps = g.div(0.5, g.sub(nx, 1))
    is_tail = g.cmp("LESS_THAN", t, eps)
    is_nose = g.cmp("GREATER_THAN", t, g.sub(1.0, eps))
    is_cap = g.bor(is_tail, is_nose)
    tc = g.switch("FLOAT", is_tail, g.switch("FLOAT", is_nose, t, g.sub(1.0, g.mul(eps, 2.0))), g.mul(eps, 2.0))

    hw = g.mul(g.float_curve(tc, w_curve), g.mul(width, 0.5))
    top = g.float_curve(tc, top_curve)
    bot = g.float_curve(tc, bot_curve)
    zc = g.mul(g.add(top, bot), 0.5)
    hh = g.mul(g.sub(top, bot), 0.5)
    k = g.switch("FLOAT", is_cap, 1.0, 0.0)
    y = g.mul(g.mul(hw, px), k)
    z = g.add(g.mul(g.add(zc, g.mul(g.mul(hh, pz), k)), height), z0)
    x = g.add(g.mul(g.sub(tc, 0.5), length), x0)
    geo = g.set_pos(geo, pos=g.vec(x, y, z))
    geo = g.merge(geo, 0.0005)
    return geo


def hover_car():
    g = GN("CC_HoverCar")
    P = "Body"
    g.inp("Length", "FLOAT", 5.7, 3.5, 8.0, "Overall length (m)", "DISTANCE", P)
    g.inp("Width", "FLOAT", 2.25, 1.5, 3.2, "Overall width (m)", "DISTANCE", P)
    g.inp("Height", "FLOAT", 1.16, 0.8, 2.0, "Body height (m)", "DISTANCE", P)
    g.inp("Ride Height", "FLOAT", 0.38, 0.1, 1.0, "Belly clearance (m)", "DISTANCE", P)
    g.inp("Squareness", "FLOAT", 4.8, 2.0, 8.0, "Super-ellipse exponent of the cross section", panel=P)
    g.inp("Resolution", "INT", 44, 12, 96, "Loft rings along the body", panel=P)
    g.inp("Subdivision", "INT", 1, 0, 3, panel=P)
    P = "Canopy"
    g.inp("Canopy Start", "FLOAT", 0.36, 0.0, 1.0, "Canopy start along the body (0 = tail)", "FACTOR", P)
    g.inp("Canopy End", "FLOAT", 0.73, 0.0, 1.0, "Canopy end along the body", "FACTOR", P)
    g.inp("Canopy Height", "FLOAT", 0.3, 0.1, 0.9, "Canopy bulge (m)", "DISTANCE", P)
    g.inp("Canopy Width", "FLOAT", 0.6, 0.3, 0.95, "Canopy width (fraction of body)", "FACTOR", P)
    P = "Propulsion"
    g.inp("Pod Radius", "FLOAT", 0.36, 0.2, 0.8, "Ducted fan radius (m)", "DISTANCE", P)
    g.inp("Pod Spread", "FLOAT", 0.32, 0.15, 0.45, "Pod position along the body (fraction)", "FACTOR", P)
    g.inp("Thruster Radius", "FLOAT", 0.15, 0.08, 0.4, "Rear thruster radius (m)", "DISTANCE", P)
    g.inp("Spoiler", "BOOL", False, "Raised rear wing on struts (off = integrated ducktail)", panel=P)
    P = "Lights"
    g.inp("Waist Line", "FLOAT", -0.16, -0.8, 0.8, "Height of the neon waist line on the cross section", panel=P)
    g.inp("Strip Width", "FLOAT", 0.05, 0.005, 0.2, "Neon strip thickness", panel=P)

    with g.frame("Body loft"):
        L, W, H, RH = g.p("Length"), g.p("Width"), g.p("Height"), g.p("Ride Height")
        res = g.p("Resolution")
        body = _loft(
            g, res, 40,
            # half width along the car (tail -> nose)
            # coke-bottle planform: rear fenders, pinched waist, front fenders, knife nose
            [(0.0, 0.78), (0.06, 0.93), (0.17, 1.0), (0.33, 0.88), (0.52, 0.85), (0.7, 0.91), (0.82, 0.95), (0.92, 0.7), (1.0, 0.36)],
            # roof line: high tail deck, cockpit hump, long falling hood, knife nose
            [(0.0, 0.6), (0.1, 0.66), (0.3, 0.74), (0.46, 0.8), (0.62, 0.7), (0.8, 0.46), (0.93, 0.3), (1.0, 0.24)],
            # belly line
            [(0.0, 0.2), (0.1, 0.07), (0.5, 0.02), (0.85, 0.06), (1.0, 0.14)],
            L, W, H, 0.0, RH, g.p("Squareness"), "body")
        body = g.subdiv(body, g.p("Subdivision"))
        body = g.smooth_shade(body)

    with g.frame("Material zones"):
        bt, bpx, bpz = g.named("body_t"), g.named("body_px"), g.named("body_pz")
        wl, sw = g.p("Waist Line"), g.p("Strip Width")
        band = g.cmp("LESS_THAN", g.absf(g.sub(bpz, wl)), sw)
        side = g.cmp("GREATER_THAN", g.absf(bpx), 0.6)
        span = g.band(g.cmp("GREATER_THAN", bt, 0.07), g.cmp("LESS_THAN", bt, 0.93))
        neon = g.band(g.band(band, side), span)
        mid = g.cmp("LESS_THAN", g.absf(g.sub(bpz, 0.05)), 0.2)
        head = g.band(g.cmp("GREATER_THAN", bt, 0.955), mid)
        tail = g.band(g.cmp("LESS_THAN", bt, 0.04), g.cmp("LESS_THAN", g.absf(g.sub(bpz, 0.2)), 0.18))
        belly = g.cmp("LESS_THAN", bpz, -0.8)
        body = g.set_mat(body, MATS["CC_CarPaint"])
        body = g.set_mat(body, MATS["CC_CarTrim"], belly)
        body = g.set_mat(body, MATS["CC_CarNeon"], neon)
        body = g.set_mat(body, MATS["CC_HeadLight"], head)
        body = g.set_mat(body, MATS["CC_TailLight"], tail)

    with g.frame("Canopy loft"):
        cs, ce = g.p("Canopy Start"), g.p("Canopy End")
        clen = g.mul(g.sub(ce, cs), L)
        cx0 = g.mul(g.sub(g.mul(g.add(cs, ce), 0.5), 0.5), L)
        ch = g.p("Canopy Height")
        canopy = _loft(
            g, 28, 32,
            [(0.0, 0.2), (0.2, 0.8), (0.45, 1.0), (0.75, 0.8), (1.0, 0.15)],
            [(0.0, 0.0), (0.25, 0.85), (0.45, 1.0), (0.7, 0.65), (1.0, 0.0)],
            [(0.0, -0.5), (0.5, -0.5), (1.0, -0.5)],
            clen, g.mul(W, g.p("Canopy Width")), ch, cx0,
            g.add(RH, g.mul(H, 0.66)), 2.8, "canopy")
        canopy = g.smooth_shade(g.subdiv(canopy, 1))
        frame_band = g.cmp("LESS_THAN", g.absf(g.sub(g.named("canopy_pz"), 0.15)), 0.035)
        canopy = g.set_mat(canopy, MATS["CC_CarGlass"])
        canopy = g.set_mat(canopy, MATS["CC_CarNeon"], frame_band)

    with g.frame("Hover pods"):
        pr = g.p("Pod Radius")
        ring_c = g.node("GeometryNodeCurvePrimitiveCircle")
        g.wire(ring_c, Resolution=32, Radius=pr)
        prof = g.node("GeometryNodeCurvePrimitiveCircle")
        g.wire(prof, Resolution=8, Radius=0.075)
        c2m = g.node("GeometryNodeCurveToMesh")
        g.wire(c2m, Curve=ring_c.outputs[0], Profile_Curve=prof.outputs[0])
        rim = g.set_mat(g.smooth_shade(c2m.outputs[0]), MATS["CC_CarNeon"])
        housing = g.set_mat(g.auto_smooth(g.cyl(32, g.mul(pr, 1.15), 0.2), 40), MATS["CC_CarTrim"])
        fan = g.set_mat(g.transform(g.cyl(32, g.mul(pr, 0.82), 0.04), t=(0, 0, -0.09)), MATS["CC_Thruster"])
        pod = g.join(housing, fan, g.transform(rim, t=(0, 0, -0.08)))
        spread = g.mul(g.p("Pod Spread"), L)
        py = g.mul(W, 0.36)
        pz = g.add(RH, 0.02)
        pods = g.join(*[g.transform(pod, t=g.vec(g.mul(spread, sx), g.mul(py, sy), pz))
                        for sx in (1, -1) for sy in (1, -1)])

    with g.frame("Thrusters & wing"):
        tr = g.p("Thruster Radius")
        tx = g.add(g.mul(L, -0.5), 0.12)
        tz = g.add(RH, g.mul(H, 0.36))
        house = g.set_mat(g.auto_smooth(g.cyl(24, g.mul(tr, 1.3), 0.6), 40), MATS["CC_CarTrim"])
        glow = g.set_mat(g.transform(g.cyl(24, g.mul(tr, 0.85), 0.02), t=(0, 0, -0.27)), MATS["CC_Thruster"])
        thr = g.transform(g.join(house, glow), r=(0, PI / 2, 0))
        thrusters = g.join(g.transform(thr, t=g.vec(tx, g.mul(W, 0.22), tz)),
                           g.transform(thr, t=g.vec(tx, g.mul(W, -0.22), tz)))
        wz = g.add(RH, g.mul(H, 0.98))
        wing = g.set_mat(g.transform(g.cube(g.vec(0.55, g.mul(W, 1.02), 0.05)), t=g.vec(g.mul(L, -0.43), 0, wz), r=(0, -0.08, 0)), MATS["CC_CarPaint"])
        lip = g.set_mat(g.transform(g.cube(g.vec(0.05, g.mul(W, 1.02), 0.05)), t=g.vec(g.sub(g.mul(L, -0.43), 0.28), 0, g.add(wz, 0.02))), MATS["CC_TailLight"])
        strut = g.cube(g.vec(0.2, 0.06, g.mul(H, 0.3)))
        struts = g.join(g.transform(strut, t=g.vec(g.mul(L, -0.42), g.mul(W, 0.3), g.sub(wz, g.mul(H, 0.14)))),
                        g.transform(strut, t=g.vec(g.mul(L, -0.42), g.mul(W, -0.3), g.sub(wz, g.mul(H, 0.14)))))
        struts = g.set_mat(struts, MATS["CC_CarTrim"])
        raised = g.join(wing, lip, struts)
        # integrated ducktail: a thin lip flush with the rear deck, tail-light edge
        dz = g.add(RH, g.mul(H, 0.62))
        duck = g.set_mat(g.transform(g.cube(g.vec(0.42, g.mul(W, 0.86), 0.045)), t=g.vec(g.mul(L, -0.475), 0, dz), r=(0, -0.12, 0)), MATS["CC_CarPaint"])
        duck_lip = g.set_mat(g.transform(g.cube(g.vec(0.03, g.mul(W, 0.86), 0.035)), t=g.vec(g.sub(g.mul(L, -0.475), 0.21), 0, g.add(dz, 0.03))), MATS["CC_TailLight"])
        spoiler = g.switch("GEOMETRY", g.p("Spoiler"), g.join(duck, duck_lip), raised)

    g.out("Geometry", g.join(body, canopy, pods, thrusters, spoiler))
    return g.finish()
