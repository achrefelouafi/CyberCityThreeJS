"""
render_kit_sheet.py - asset catalogue of every Geometry Nodes kit piece.

    blender -b blender/cybercity.blend --python blender/render_kit_sheet.py

Renders each piece isolated and auto-framed to docs/kit/<name>.png; the sheet is
assembled by scripts/kit_sheet.py (Pillow) into docs/kit_sheet.png.
"""
import os
import math
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "kit")
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
sc.render.resolution_x = sc.render.resolution_y = 520
sc.render.film_transparent = False
sc.view_settings.exposure = 0.0
sc.render.use_compositing = False

KIT = ["CC_Kit_Towers", "CC_Kit_Roof", "CC_Kit_Landmark", "CC_Kit_Signs", "CC_Kit_Screens", "CC_Kit_Facade", "CC_Kit_Street", "CC_Kit_Holo", "CC_Kit_Vehicles", "CC_Kit_Dressing", "CC_Kit_HoloArt"]
pieces = [o for c in KIT for o in sorted(bpy.data.collections[c].objects, key=lambda o: o.name)]
for o in sc.objects:
    o.hide_render = True

w = bpy.data.worlds.new("KitStudio")
sc.world = w
w.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.02, 0.05, 1)
cam = bpy.data.objects.new("KitCam", bpy.data.cameras.new("KitCam"))
cam.data.lens = 50
sc.collection.objects.link(cam)
sc.camera = cam
lights = []
for name, d, e, col in (("K", (1, -1.2, 1.4), 1.0, (0.85, 0.9, 1.0)), ("R", (-1.4, 1, 0.8), 1.3, (1.0, 0.35, 0.75)), ("F", (1.2, 1.2, 0.3), 0.5, (0.3, 0.85, 1.0))):
    l = bpy.data.objects.new("KitL" + name, bpy.data.lights.new("KitL" + name, "AREA"))
    l.data.color = col
    sc.collection.objects.link(l)
    lights.append((l, Vector(d).normalized(), e))

dg = bpy.context.evaluated_depsgraph_get()
for ob in pieces:
    ob.hide_render = False
    ev = ob.evaluated_get(dg)
    pts = [ob.matrix_world @ Vector(c) for c in ev.bound_box]
    center = sum(pts, Vector()) / 8
    radius = max((p - center).length for p in pts)
    dist = radius / math.sin(math.radians(18)) * 1.05
    az, el = math.radians(-40), math.radians(22)
    cam.location = center + Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el))) * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = dist * 4
    cam.data.clip_start = dist * 0.01
    for l, d, e in lights:
        l.location = center + d * radius * 3
        l.rotation_euler = (center - l.location).to_track_quat("-Z", "Y").to_euler()
        l.data.size = radius * 2
        l.data.energy = e * 120 * radius * radius
    sc.render.filepath = os.path.join(OUT, f"{ob.name}.png")
    bpy.ops.render.render(write_still=True)
    ob.hide_render = True
print("KIT SHEET RENDERS", len(pieces))
