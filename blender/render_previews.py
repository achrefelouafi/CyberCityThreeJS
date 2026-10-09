"""
render_previews.py - press renders of the Blender side of the pipeline.

    blender -b blender/cybercity.blend --python blender/render_previews.py

docs/blender_city.png  the CC_CityGenerator preview window (EEVEE, volumetric haze)
docs/blender_kit.png   the modular Geometry Nodes kit on its shelf
"""
import os
import math
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs")
sc = bpy.context.scene


def look(cam, target):
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


# ---------------------------------------------------------------- preview look (renders only, not exported)
for name, strength in (("CC_Glass", 2.2), ("CC_Neon", 9.0), ("CC_Sign", 5.0), ("CC_Screen", 3.0), ("CC_Light", 6.0)):
    principled(bpy.data.materials[name]).inputs["Emission Strength"].default_value = strength
w = sc.world
vol = w.node_tree.nodes.new("ShaderNodeVolumeScatter")
vol.inputs["Density"].default_value = 0.0018
vol.inputs["Color"].default_value = (0.75, 0.55, 1.0, 1)
vol.inputs["Anisotropy"].default_value = 0.3
out = next(n for n in w.node_tree.nodes if n.type == "OUTPUT_WORLD")
w.node_tree.links.new(vol.outputs[0], out.inputs["Volume"])
ee = sc.eevee
for attr, val in (("volumetric_end", 1400.0), ("volumetric_samples", 48), ("taa_render_samples", 48)):
    try:
        setattr(ee, attr, val)
    except Exception:
        pass
sc.view_settings.exposure = -0.4
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080

# ---------------------------------------------------------------- city
pitch = 58.0 + 28.0
cam = bpy.data.objects["CC_Cam"]
cam.data.lens = 20
cam.location = (3.0 * pitch, -0.6 * pitch, 135)
look(cam, (4.6 * pitch, 6 * pitch, 40))
kit_root = bpy.data.collections["CC_Kit"]
kit_root.hide_render = True
sc.render.filepath = os.path.join(OUT, "blender_city.png")
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath)

# ---------------------------------------------------------------- kit shelf
kit_root.hide_render = False
bpy.data.collections["CC_City"].hide_render = True
vol.inputs["Density"].default_value = 0.0
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
for name, loc, energy in (("ShelfKey", (-700, -420, 260), 2.5e6), ("ShelfRim", (-1000, 0, 200), 1.5e6)):
    l = bpy.data.lights.new(name, "AREA")
    l.energy = energy
    l.size = 120
    o = bpy.data.objects.new(name, l)
    o.location = loc
    look(o, (-760, -200, 20))
    sc.collection.objects.link(o)
cam.data.lens = 24
cam.location = (-640, -470, 150)
look(cam, (-760, -190, 10))
sc.view_settings.exposure = 0.0
sc.render.filepath = os.path.join(OUT, "blender_kit.png")
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath)
