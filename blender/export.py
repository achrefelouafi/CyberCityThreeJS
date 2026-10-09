"""
export.py - Blender -> Three.js pipeline.

    blender -b blender/cybercity.blend --python blender/export.py -- --out public/assets

Writes:
  kit.glb              every modular piece (modifiers applied, one node per piece)
  car.glb              the KX-9 hover car
  manifest.json        node-group interfaces (the sliders), current modifier values,
                       per-piece stats, material parameters, palette, random channels
  parity.json          the evaluated city preview (instance transforms) so the JS
                       port can be verified against Geometry Nodes (npm run parity)
"""

import os
import sys
import json
import time
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from gn import iface_inputs  # noqa: E402
import materials  # noqa: E402
import city  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1]) if "--out" in ARGS else os.path.join(HERE, "..", "public", "assets")
os.makedirs(OUT, exist_ok=True)

KIT_COLLS = ["CC_Kit_Towers", "CC_Kit_Roof", "CC_Kit_Landmark", "CC_Kit_Signs", "CC_Kit_Screens", "CC_Kit_Dressing", "CC_Kit_HoloArt",
             "CC_Kit_Street", "CC_Kit_Holo", "CC_Kit_Facade", "CC_Kit_Vehicles"]


def modifier_values(ob):
    mod = next((m for m in ob.modifiers if m.type == "NODES"), None)
    if not mod:
        return None, {}
    vals = {}
    for item in mod.node_group.interface.items_tree:
        if item.item_type != "SOCKET" or item.in_out != "INPUT":
            continue
        try:
            v = mod[item.identifier]
        except Exception:
            continue
        if hasattr(v, "to_list"):
            v = v.to_list()
        elif hasattr(v, "__len__") and not isinstance(v, str):
            v = list(v)
        if isinstance(v, (int, float, bool, list, str)):
            vals[item.name] = v
    return mod.node_group, vals


def mesh_stats(ob, dg):
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    if me is None or len(me.vertices) == 0:
        return {}
    xs = [v.co for v in me.vertices]
    mn = [min(c[i] for c in xs) for i in range(3)]
    mx = [max(c[i] for c in xs) for i in range(3)]
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    mats = sorted({ev.material_slots[p.material_index].material.name for p in me.polygons
                   if p.material_index < len(ev.material_slots) and ev.material_slots[p.material_index].material})
    ev.to_mesh_clear()
    # Blender Z-up -> glTF Y-up: (x, y, z) -> (x, z, -y)
    return {"boundsMin": [mn[0], mn[2], -mx[1]], "boundsMax": [mx[0], mx[2], -mn[1]],
            "triangles": tris, "materials": mats}


def export_glb(objects, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.hide_set(False)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_extras=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_animations=False, export_draco_mesh_compression_enable=False)
    print("WROTE", path, os.path.getsize(path), "bytes")


def apply_overrides():
    """--set "Seed=42;Preview Origin X=-53" overrides city modifier inputs (parity testing)."""
    if "--set" not in ARGS:
        return
    cob = bpy.data.objects["CC_City"]
    mod = next(m for m in cob.modifiers if m.type == "NODES")
    by_name = {i.name: i for i in mod.node_group.interface.items_tree if i.item_type == "SOCKET" and i.in_out == "INPUT"}
    for kv in ARGS[ARGS.index("--set") + 1].split(";"):
        k, v = kv.split("=")
        item = by_name[k.strip()]
        mod[item.identifier] = type(mod[item.identifier])(float(v) if "." in v else int(v))
    cob.update_tag()


def export_parity(dg, path, vals):
    inst = []
    for oi in dg.object_instances:
        if oi.is_instance and oi.parent and oi.parent.original.name == "CC_City":
            m = oi.matrix_world
            inst.append({"piece": oi.object.original.name,
                         "m": [round(m[r][c], 4) for c in range(4) for r in range(4)]})  # column-major
    with open(path, "w") as f:
        json.dump({"values": vals, "instances": inst}, f)
    return inst


def main():
    t0 = time.time()
    apply_overrides()
    dg = bpy.context.evaluated_depsgraph_get()
    if "--parity-only" in ARGS:
        _, vals = modifier_values(bpy.data.objects["CC_City"])
        inst = export_parity(dg, ARGS[ARGS.index("--parity-only") + 1], vals)
        print(f"PARITY EXPORT {len(inst)} instances")
        return

    # ------------------------------------------------------------ kit pieces
    pieces, kit_objs, car_obj = [], [], None
    for cname in KIT_COLLS:
        coll = bpy.data.collections[cname]
        for ob in sorted(coll.objects, key=lambda o: o.name):
            tree, vals = modifier_values(ob)
            rec = {"name": ob.name, "collection": cname, "nodeGroup": tree.name if tree else None,
                   "inputs": iface_inputs(tree) if tree else [], "values": vals}
            rec.update(mesh_stats(ob, dg))
            pieces.append(rec)
            if ob.name == "V0_HoverCar":
                car_obj = ob
            else:
                kit_objs.append(ob)

    export_glb(kit_objs, os.path.join(OUT, "kit.glb"))
    # the car is exported alone, at the origin
    loc = car_obj.location.copy()
    car_obj.location = (0, 0, 0)
    export_glb([car_obj], os.path.join(OUT, "car.glb"))
    car_obj.location = loc

    # ------------------------------------------------------------ city generator
    cob = bpy.data.objects["CC_City"]
    tree, vals = modifier_values(cob)
    city_rec = {"nodeGroup": tree.name, "object": cob.name, "inputs": iface_inputs(tree), "values": vals}

    mats = {m.name: materials.material_record(m) for m in bpy.data.materials if m.name.startswith("CC_") and "cc_role" in m}

    manifest = {
        "generator": f"Blender {bpy.app.version_string}",
        "blend": os.path.basename(bpy.data.filepath),
        "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "coordinateSystem": "glTF Y-up; layout computed in Blender space (x, y, z) -> three (x, z, -y)",
        "city": city_rec,
        "channels": city.CH,
        "counts": {"styles": city.N_STYLES, "roof": city.N_ROOF, "atlas": city.N_ATLAS, "screens": city.N_SCREEN},
        "pieces": pieces,
        "materials": mats,
        "palette": [list(c) for c in materials.PALETTE],
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    # ------------------------------------------------------------ parity reference
    inst = export_parity(dg, os.path.join(OUT, "parity.json"), vals)
    print(f"EXPORT DONE {len(pieces)} pieces, {len(inst)} city instances in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
