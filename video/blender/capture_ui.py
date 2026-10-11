# Screenshots of the real Blender UI for the "built in Blender" beat of the video.
#
#   blender --window-geometry 0 0 1920 1080 blender/cybercity.blend --python video/blender/capture_ui.py -- <out_dir>
#
# Opens the Geometry Nodes workspace on CC_City, points the 3D viewport through an aerial
# camera (EEVEE, rendered), shows the 1,133-node CC_CityGenerator tree and the modifier
# panel, then steps the Seed slider and grabs the whole window after each regeneration.
# Ends on the browser's seed with the viewport maximised, and writes the on-screen rect of
# the camera frame (cam.json) so the video can wipe from Blender to the browser render of
# the exact same view.
import bpy, sys, os, json
from mathutils import Vector
from bpy_extras.view3d_utils import location_3d_to_region_2d

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.abspath('video/assets/blender')
os.makedirs(OUT, exist_ok=True)
SEEDS = [int(s) for s in os.environ.get('CC_SEEDS', '7,21,33,58,90,7').split(',')]
FINAL_SEED = SEEDS[-1]
SETTLE = float(os.environ.get('CC_SETTLE', '6'))

# aerial camera: whole 10x10-block preview patch (0..860 m), seen from its south-west corner
CAM = dict(loc=(-205.0, -260.0, 330.0), target=(470.0, 420.0, 40.0), lens=30.0)

sc = bpy.context.scene
city = bpy.data.objects['CC_City']
mod = city.modifiers['CityGenerator']
ident = {it.name: it.identifier for it in mod.node_group.interface.items_tree if getattr(it, 'item_type', '') == 'SOCKET' and it.in_out == 'INPUT'}


def make_camera():
    cam = bpy.data.objects.get('CC_VidCam')
    if not cam:
        cam = bpy.data.objects.new('CC_VidCam', bpy.data.cameras.new('CC_VidCam'))
        sc.collection.objects.link(cam)
    cam.location = CAM['loc']
    d = Vector(CAM['target']) - Vector(CAM['loc'])
    cam.rotation_mode = 'XYZ'
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = CAM['lens']
    cam.data.sensor_width = 36
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.clip_end = 6000
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    return cam


def areas(win):
    return {a.type: a for a in win.screen.areas}


def ctx(win, area=None):
    region = next((r for r in area.regions if r.type == 'WINDOW'), None) if area else None
    return bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region)


def shot(win, name):
    path = os.path.join(OUT, name)
    with ctx(win, areas(win).get('VIEW_3D')):
        bpy.ops.screen.screenshot(filepath=path, check_existing=False)
    print('SHOT', path, flush=True)


def set_seed(s):
    mod[ident['Seed']] = s
    city.update_tag()
    bpy.context.view_layer.update()


def redraw(win):
    for a in win.screen.areas:
        a.tag_redraw()


def steps():
    win = bpy.context.window_manager.windows[0]
    win.workspace = bpy.data.workspaces['Geometry Nodes']
    yield 2.0
    cam = make_camera()
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name not in ('CC_City', 'CC_Street'):
            o.hide_set(True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    city.select_set(True)
    bpy.context.view_layer.objects.active = city
    city.modifiers.active = mod
    A = areas(win)
    print('AREAS', {k: (v.width, v.height) for k, v in A.items()}, 'WIN', win.width, win.height, flush=True)
    v3d = A['VIEW_3D'].spaces.active
    v3d.shading.type = 'RENDERED'
    try:
        v3d.shading.use_compositor = 'ALWAYS'
    except Exception:
        pass
    v3d.overlay.show_floor = False
    v3d.overlay.show_axis_x = v3d.overlay.show_axis_y = False
    v3d.overlay.show_extras = False
    v3d.overlay.show_outline_selected = False
    v3d.region_3d.view_perspective = 'CAMERA'
    v3d.camera = cam
    v3d.lock_camera = False
    if 'PROPERTIES' in A:
        try:
            A['PROPERTIES'].spaces.active.context = 'MODIFIER'
        except Exception as e:
            print('props', e)
    if 'NODE_EDITOR' in A:
        ne = A['NODE_EDITOR'].spaces.active
        try:
            ne.geometry_nodes_type = 'MODIFIER'
        except Exception:
            pass
    yield 1.0
    with ctx(win, A['VIEW_3D']):
        bpy.ops.view3d.view_center_camera()
    if 'NODE_EDITOR' in A:
        with ctx(win, A['NODE_EDITOR']):
            bpy.ops.node.view_all()
    redraw(win)
    yield SETTLE
    for k, s in enumerate(SEEDS[:-1]):
        set_seed(s)
        redraw(win)
        yield SETTLE
        shot(win, f'ui_{k:02d}_seed{s}.png')
    # last beat: browser seed, viewport maximised, through the same camera
    set_seed(FINAL_SEED)
    with ctx(win, A['VIEW_3D']):
        bpy.ops.screen.screen_full_area()
    yield 1.5
    A = areas(win)
    area = A['VIEW_3D']
    with ctx(win, area):
        bpy.ops.view3d.view_center_camera()
    redraw(win)
    yield SETTLE + 2
    shot(win, f'full_seed{FINAL_SEED}.png')
    # camera frame -> window pixels (screenshot origin is top-left)
    region = next(r for r in area.regions if r.type == 'WINDOW')
    rv3d = area.spaces.active.region_3d
    frame = [cam.matrix_world @ p for p in cam.data.view_frame(scene=sc)]
    pts = [location_3d_to_region_2d(region, rv3d, p) for p in frame]
    xs = [region.x + p.x for p in pts]
    ys = [win.height - (region.y + p.y) for p in pts]
    info = {
        'window': [win.width, win.height], 'frame': [min(xs), min(ys), max(xs), max(ys)],
        'cam': {'loc': list(cam.location), 'target': list(CAM['target']), 'lens': CAM['lens'], 'sensor': 36},
        'seed': FINAL_SEED, 'seeds': SEEDS,
    }
    with open(os.path.join(OUT, 'cam.json'), 'w') as f:
        json.dump(info, f, indent=1)
    print('CAMJSON', info, flush=True)
    yield 0.5
    bpy.ops.wm.quit_blender()


_it = steps()


def tick():
    try:
        return next(_it)
    except StopIteration:
        return None
    except Exception as e:
        import traceback
        traceback.print_exc()
        bpy.ops.wm.quit_blender()
        return None


bpy.app.timers.register(tick, first_interval=3.0)
