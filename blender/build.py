"""
build.py - builds blender/cybercity.blend from scratch.

    blender -b --factory-startup --python blender/build.py

Creates the material library, the Geometry Nodes kit, the hover car and the
CC_CityGenerator tree, assembles a preview scene (city window, wet street,
camera, world, bloom compositor) and saves the .blend.
"""

import os
import sys
import math
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import materials  # noqa: E402
import kit  # noqa: E402
import car  # noqa: E402
import city  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def new_collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def setup_world():
    w = bpy.data.worlds.get("CC_Night") or bpy.data.worlds.new("CC_Night")
    bpy.context.scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    mapping = nt.nodes.new("ShaderNodeMapping")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    mapping.inputs["Rotation"].default_value = (0, -math.pi / 2, 0)
    nt.links.new(mapping.outputs["Vector"], grad.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.10, 0.02, 0.12, 1)
    ramp.color_ramp.elements[1].color = (0.004, 0.004, 0.012, 1)
    ramp.color_ramp.elements[1].position = 0.55
    nt.links.new(grad.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0


def setup_render(scene):
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            break
        except Exception:
            continue
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except Exception:
        pass
    scene.view_settings.exposure = 0.4
    ee = scene.eevee
    for attr, val in (("taa_render_samples", 32), ("use_raytracing", True), ("volumetric_tile_size", "8")):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    # bloom lives in the compositor since EEVEE Next; Blender 5 uses compositor node groups
    try:
        ng = bpy.data.node_groups.new("CC_Compositor", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        gi = ng.nodes.new("CompositorNodeRLayers")
        go = ng.nodes.new("NodeGroupOutput")
        glare = ng.nodes.new("CompositorNodeGlare")
        for v in ("Bloom", "BLOOM"):
            try:
                glare.inputs["Type"].default_value = v
                break
            except Exception:
                try:
                    glare.glare_type = v
                    break
                except Exception:
                    pass
        for name, v in (("Threshold", 0.8), ("Strength", 0.9), ("Size", 0.9)):
            if name in glare.inputs:
                try:
                    glare.inputs[name].default_value = v
                except Exception:
                    pass
        ng.links.new(gi.outputs[0], glare.inputs[0])
        ng.links.new(glare.outputs[0], go.inputs[0])
        scene.compositing_node_group = ng
    except Exception as e:
        print("compositor setup skipped:", e)


def road_material():
    m = bpy.data.materials.get("CC_Road") or bpy.data.materials.new("CC_Road")
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.012, 0.012, 0.016, 1)
    bsdf.inputs["Roughness"].default_value = 0.12
    bsdf.inputs["Metallic"].default_value = 0.0
    noise = m.node_tree.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.08
    ramp = m.node_tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.04, 0.04, 0.04, 1)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (0.5, 0.5, 0.5, 1)
    m.node_tree.links.new(noise.outputs["Fac"], ramp.inputs[0])
    m.node_tree.links.new(ramp.outputs[0], bsdf.inputs["Roughness"])
    return m


def main():
    reset_scene()
    scene = bpy.context.scene
    scene.name = "CyberCity"
    scene.unit_settings.system = "METRIC"
    mats = materials.build_materials()

    kit_root = new_collection("CC_Kit")
    colls = kit.build_kit(kit_root)
    # move the kit shelf away from the city preview
    for c in colls.values():
        for ob in c.objects:
            ob.location.x -= 900
            ob.location.y -= 300

    veh = colls["CC_Kit_Vehicles"]
    hero = car.build_car(veh, "V0_HoverCar", (-900 + 160, -300 + 130, 0))
    kit.KIT["V0_HoverCar"] = {"collection": "CC_Kit_Vehicles", "tree": None, "object": hero}

    city_coll = new_collection("CC_City")
    tree = city.build_city_tree(colls)
    me = bpy.data.meshes.new("CC_City_mesh")
    cob = bpy.data.objects.new("CC_City", me)
    city_coll.objects.link(cob)
    mod = cob.modifiers.new("CityGenerator", "NODES")
    mod.node_group = tree

    # wet street plane under the preview window
    nb = 10
    pitch = 60.0 + 26.0
    bpy.ops.mesh.primitive_plane_add(size=1, location=(nb * pitch / 2, nb * pitch / 2, -0.02))
    road = bpy.context.active_object
    road.name = "CC_Street"
    road.scale = (nb * pitch + 400, nb * pitch + 400, 1)
    road.data.materials.append(road_material())
    bpy.context.scene.collection.objects.unlink(road)
    city_coll.objects.link(road)

    # a hero car cruising up an avenue (same node group as the kit car)
    cam_target = (3 * pitch, 2.2 * pitch, 42)
    car_ob = bpy.data.objects.new("Kestrel", hero.data)
    city_coll.objects.link(car_ob)
    car_ob.location = cam_target
    car_ob.rotation_euler = (0, 0, math.pi / 2)
    cam_data = bpy.data.cameras.new("CC_Cam")
    cam_data.lens = 24
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new("CC_Cam", cam_data)
    city_coll.objects.link(cam)
    cam.location = (3 * pitch + 6, 2.2 * pitch - 22, 46)
    direction = (cam_target[0] - cam.location.x + 0, cam_target[1] + 300 - cam.location.y, 70 - cam.location.z)
    from mathutils import Vector
    cam.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    setup_world()
    setup_render(scene)

    out = os.path.join(HERE, "cybercity.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("SAVED", out)

    render = arg("--render")
    if render:
        scene.render.filepath = os.path.abspath(render)
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


if __name__ == "__main__":
    main()
