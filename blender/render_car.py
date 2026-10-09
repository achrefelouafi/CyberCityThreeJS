"""Studio turntable stills of the KX-9 hover car (docs/car_*.png)."""
import bpy, math, os, sys
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs")
sc = bpy.context.scene
car = bpy.data.objects["V0_HoverCar"]
for ob in sc.objects:
    ob.hide_render = ob is not car
car.location = (0, 0, 0)
car.scale = (1, 1, 1)
car.hide_render = False
w = bpy.data.worlds.new("Studio"); sc.world = w
w.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.03, 1)
for name, loc, energy, col in (("Key", (4, -5, 6), 900, (0.8, 0.9, 1.0)), ("Rim", (-6, 4, 3), 1200, (1.0, 0.3, 0.7)), ("Fill", (6, 6, 2), 300, (0.3, 0.8, 1.0))):
    l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = 4; l.color = col
    o = bpy.data.objects.new(name, l); o.location = loc
    o.rotation_euler = (Vector((0, 0, 0.6)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(o)
cam_d = bpy.data.cameras.new("C"); cam_d.lens = 50
cam = bpy.data.objects.new("C", cam_d); sc.collection.objects.link(cam); sc.camera = cam
sc.render.resolution_x, sc.render.resolution_y = 1200, 675
sc.render.use_compositing = False
for i, (az, el, dist) in enumerate(((35, 14, 10), (90, 4, 10), (160, 18, 10), (0, 70, 11))):
    a, e = math.radians(az), math.radians(el)
    cam.location = Vector((math.cos(a) * math.cos(e), -math.sin(a) * math.cos(e), math.sin(e))) * dist + Vector((0, 0, 0.8))
    cam.rotation_euler = (Vector((0, 0, 0.8)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUT, f"car_{i}.png")
    bpy.ops.render.render(write_still=True)
print("CAR RENDERS DONE")
