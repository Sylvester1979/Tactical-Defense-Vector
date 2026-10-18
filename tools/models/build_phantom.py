"""Phantom (Ghost Stalker) enemy — procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_phantom.py <out_dir>
    blender -b -P tools/models/build_phantom.py -- <out_dir>

Writes <out_dir>/phantom.glb (game asset) and <out_dir>/phantom.blend (model + render stage).
Hierarchy: Phantom > Hull, Cloak, Rotor_Core > CoreRing
Origin is the centre of mass (the game glides and bobs the root); +X is the direction of travel.
`EnemyCloak` is a translucent (alpha-blended) material: the stealth sails and the dome.
"""
import math
import os
import sys

import bpy
import bmesh  # noqa: E402  (bmesh is only importable once bpy is loaded)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, sphere, join,  # noqa: E402
                    curve_tube, setup_render_stage, _finish)
from bake import bake_model, EXPORT_IMAGES  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
VIOLET = '#c084fc'
HULL = material('PhantomHull', '#2b2634', metallic=0.8, roughness=0.34)  # metal profile: less dust, the ghost stays dark
PANEL = material('PhantomPanel', '#8d879c', metallic=0.5, roughness=0.36)
TRIM = material('PhantomTrim', '#141219', metallic=0.7, roughness=0.45)
STEEL = material('PhantomSteel', '#9aa4b0', metallic=1.0, roughness=0.28)
GLOW = material('EnemyGlow', '#05070a', roughness=0.25, emission=VIOLET, emission_strength=3.5)
GLOW_SOFT = material('EnemyGlowSoft', '#120a1a', roughness=0.08, metallic=0.3, emission=VIOLET, emission_strength=1.2)
# Translucent stealth cloak. The faint emission keeps bake.py from baking it into an opaque texture.
CLOAK = material('EnemyCloak', '#a78bfa', metallic=0.1, roughness=0.12, emission=VIOLET, emission_strength=0.45)
CLOAK.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 0.4
CLOAK.surface_render_method = 'BLENDED'
CLOAK.use_backface_culling = False

# ── Hull planform: stations (x, half-width, height) from nose to tail ───────
# A manta/blade wing: widest just behind the middle, swept wingtips, notched trailing edge.
STATIONS = [
    (1.00, 0.20, 0.09),
    (0.70, 0.44, 0.14),
    (0.35, 0.78, 0.18),
    (0.00, 1.04, 0.19),
    (-0.30, 1.10, 0.17),
    (-0.48, 0.78, 0.15),
    (-0.66, 0.42, 0.13),
    (-0.86, 0.26, 0.10),
    (-1.00, 0.20, 0.07),
]
NOSE = (1.22, 0.0, 0.02)


def section(w, h):
    """Faceted cross-section: thin drooping wing edges, raised spine, shallow keel. (y, z) pairs."""
    droop = -0.05 * w
    # A slight ridge at 80% span marks off a narrow light panel along each wing edge
    ridge = 0.85 * h + (droop - 0.85 * h) * 0.655 + 0.012
    return [
        (w, droop), (0.8 * w, ridge), (0.42 * w, 0.85 * h), (0.0, 1.15 * h), (-0.42 * w, 0.85 * h),
        (-0.8 * w, ridge), (-w, droop), (-0.4 * w, -0.45 * h), (0.0, -0.55 * h), (0.4 * w, -0.45 * h),
    ]


# Segment j joins section points j → j+1: 0 and 5 are the light edge panels, 1–4 the dark
# upper hull, 6–9 the underside.
SEG_MAT = [1, 0, 0, 0, 0, 1, 2, 2, 2, 2]


def lerp_station(x):
    """Half-width and height of the hull at x (linear between stations)."""
    pts = [(NOSE[0], 0.0, 0.03)] + STATIONS
    for (x0, w0, h0), (x1, w1, h1) in zip(pts, pts[1:]):
        if x1 <= x <= x0:
            t = (x0 - x) / (x0 - x1)
            return w0 + (w1 - w0) * t, h0 + (h1 - h0) * t
    return STATIONS[-1][1], STATIONS[-1][2]


def top_z(x, y):
    """Approximate height of the hull's upper surface at (x, y)."""
    w, h = lerp_station(x)
    if w <= 1e-6:
        return 0.0
    u = abs(y) / w
    if u < 0.42:
        return 1.15 * h + (0.85 * h - 1.15 * h) * u / 0.42
    return 0.85 * h + (-0.05 * w - 0.85 * h) * (u - 0.42) / 0.58


def lofted_hull():
    me = bpy.data.meshes.new('PhantomHullBody')
    obj = bpy.data.objects.new('PhantomHullBody', me)
    bpy.context.scene.collection.objects.link(obj)
    for m in (HULL, PANEL, TRIM):
        me.materials.append(m)
    bm = bmesh.new()
    rings = []
    for x, w, h in STATIONS:
        rings.append([bm.verts.new((x, y, z)) for y, z in section(w, h)])
    nose = bm.verts.new(NOSE)
    n = len(rings[0])
    for j in range(n):  # nose cone
        f = bm.faces.new((nose, rings[0][j], rings[0][(j + 1) % n]))
        f.material_index = SEG_MAT[j]
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            f = bm.faces.new((a[j], b[j], b[(j + 1) % n], a[(j + 1) % n]))
            f.material_index = SEG_MAT[j]
    tail = bm.faces.new(list(reversed(rings[-1])))
    tail.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for e in bm.edges:  # crisp stealth facets: every crease stays sharp through smooth-by-angle
        e.smooth = False
    bm.to_mesh(me)
    bm.free()
    return _finish(obj, None, 0.012, 2, 25)


def prism_xz(points, thickness, mat):
    """Flat plate from an (x, z) outline, `thickness` along Y, centred on y=0."""
    me = bpy.data.meshes.new('plate')
    obj = bpy.data.objects.new('plate', me)
    bpy.context.scene.collection.objects.link(obj)
    bm = bmesh.new()
    front = [bm.verts.new((x, -thickness / 2, z)) for x, z in points]
    back = [bm.verts.new((x, thickness / 2, z)) for x, z in points]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    k = len(points)
    for i in range(k):
        bm.faces.new((front[i], front[(i + 1) % k], back[(i + 1) % k], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return _finish(obj, mat, 0, 0, 0)


def place(obj, loc=(0, 0, 0), rot=(0, 0, 0)):
    obj.location = loc
    obj.rotation_euler = rot
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def scaled_sphere(radius, scale, loc=(0, 0, 0), mat=None, segments=24, rings=12):
    s = sphere(radius, loc=loc, mat=mat, segments=segments, rings=rings)
    s.scale = scale
    bpy.context.view_layer.objects.active = s
    bpy.ops.object.select_all(action='DESELECT')
    s.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return s


root = empty('Phantom')

# ── Hull ────────────────────────────────────────────────────────────────────
hull = [lofted_hull()]
# Angry eye slits either side of the nose ridge
for side in (-1, 1):
    x, y = 0.76, side * 0.12
    hull.append(box((0.3, 0.05, 0.03), loc=(x, y, top_z(x, y) + 0.002),
                    rot=(side * math.radians(-12), 0, side * math.radians(-28)), mat=GLOW))
# Chin sensor under the nose
hull.append(scaled_sphere(0.07, (1.6, 1.0, 0.7), loc=(0.92, 0, -0.05), mat=TRIM))
hull.append(sphere(0.03, loc=(1.02, 0, -0.05), mat=GLOW, segments=10, rings=6))
# Raised armour plates on the spine and wings (light panels with dark trim borders)
for x, y, sx, sy, a in ((0.25, 0.0, 0.38, 0.16, 0), (-0.12, 0.0, 0.3, 0.2, 0)):
    hull.append(box((sx, sy, 0.03), loc=(x, y, top_z(x, y) + 0.004), mat=TRIM, bevel=0.01))
for side in (-1, 1):
    for x, yf in ((0.05, 0.62), (-0.22, 0.7)):
        w, _ = lerp_station(x)
        y = side * yf * w
        slope = math.atan2(top_z(x, side * 0.42 * w) - top_z(x, side * 0.95 * w), 0.53 * w)
        hull.append(box((0.24, 0.22, 0.022), loc=(x, y, top_z(x, y) + 0.008), rot=(side * slope, 0, 0), mat=PANEL, bevel=0.008))
# Core dome: glowing heart under a translucent canopy
CORE = (0.02, 0.0, top_z(0.02, 0.0))
hull.append(scaled_sphere(0.12, (1.25, 1.0, 0.8), loc=(CORE[0], 0, CORE[2]), mat=GLOW, segments=20, rings=10))
hull.append(torus(0.17, 0.022, loc=(CORE[0], 0, CORE[2] + 0.005), mat=STEEL, minor_seg=6, major_seg=32))
# Wingtip lights
for side in (-1, 1):
    hull.append(sphere(0.03, loc=(-0.3, side * 1.11, -0.055), mat=GLOW, segments=10, rings=6))
# Tail: twin thruster slots in a dark nozzle block
hull.append(box((0.12, 0.34, 0.11), loc=(-1.0, 0, 0.0), mat=TRIM, bevel=0.02))
for side in (-1, 1):
    hull.append(box((0.02, 0.1, 0.04), loc=(-1.065, side * 0.08, 0.0), mat=GLOW))
# Trailing tendrils: three drooping cables with glowing tips
for y0, y1 in ((0.0, 0.0), (0.12, 0.26), (-0.12, -0.26)):
    pts = [(-1.0, y0, -0.02), (-1.2, (y0 + y1) / 2, -0.06), (-1.42, y1, -0.1)]
    hull.append(curve_tube('Tendril', pts, 0.03, TRIM))
    hull.append(sphere(0.035, loc=pts[-1], mat=GLOW, segments=10, rings=6))
# Levitator mount under the belly
hull.append(cylinder(0.09, 0.08, loc=(-0.08, 0, -0.13), verts=16, mat=TRIM, bevel=0.01))
join('Hull', hull, parent=root)

# ── Cloak: translucent stealth sails and dome (alpha-blended, not baked) ────
cloak = []
for side in (-1, 1):
    # Swept sail rising off each wing, canted outwards, with a glowing leading edge
    sail = prism_xz([(0.18, 0.0), (-0.5, 0.0), (-0.78, 0.5), (-0.62, 0.52)], 0.02, CLOAK)
    x0, y0 = -0.1, side * 0.5
    place(sail, loc=(x0, y0, top_z(x0, y0) - 0.01), rot=(side * math.radians(-28), 0, 0))
    cloak.append(sail)
cloak.append(scaled_sphere(0.17, (1.25, 1.0, 0.75), loc=(CORE[0], 0, CORE[2]), mat=CLOAK, segments=24, rings=12))
join('Cloak', cloak, parent=root)
# The sails' leading edges glow (on the hull mesh so they stay opaque and bloom)
edges = []
for side in (-1, 1):
    c, s = math.cos(math.radians(-28 * side)), math.sin(math.radians(-28 * side))
    x0, y0 = -0.1, side * 0.5
    z0 = top_z(x0, y0) - 0.01
    pts = []
    for px, pz in ((0.18, 0.0), (-0.62, 0.52)):
        # rotate (0, 0, pz) about X by the cant, then offset
        pts.append((x0 + px, y0 - s * pz, z0 + c * pz))
    edges.append(curve_tube(f'SailEdge_{side}', pts, 0.012, GLOW))
hull_obj = bpy.data.objects['Hull']
extra = join('SailEdges', edges, parent=root)
bpy.ops.object.select_all(action='DESELECT')
hull_obj.select_set(True)
extra.select_set(True)
bpy.context.view_layer.objects.active = hull_obj
bpy.ops.object.join()

# ── Levitation ring under the belly (spins in game) ─────────────────────────
RING = (-0.08, 0.0, -0.2)
rotor = empty('Rotor_Core', parent=root, loc=RING)
ring = [torus(0.36, 0.025, loc=RING, mat=GLOW_SOFT, minor_seg=6, major_seg=40),
        cylinder(0.07, 0.05, loc=RING, verts=16, mat=STEEL, bevel=0.01)]
for k in range(3):
    a = math.radians(k * 120)
    ring.append(box((0.32, 0.04, 0.025), loc=(RING[0] + math.cos(a) * 0.19, math.sin(a) * 0.19, RING[2]),
                    rot=(0, 0, a), mat=TRIM, bevel=0.006, segments=1))
    ring.append(box((0.07, 0.05, 0.04), loc=(RING[0] + math.cos(a) * 0.36, math.sin(a) * 0.36, RING[2]),
                    rot=(0, 0, a), mat=GLOW))
join('CoreRing', ring, parent=rotor)

# ── Weather and bake textures (skip with --no-bake) ───────────────────────
bake_model(root)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'phantom.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, **EXPORT_IMAGES)
print('exported', os.path.join(OUT, 'phantom.glb'), os.path.getsize(os.path.join(OUT, 'phantom.glb')), 'bytes')

# It hovers in the game: lift it off the review floor so its shadow reads
root.location = (0, 0, 1.2)
setup_render_stage(target_height=1.2)
bpy.context.scene.camera.data.ortho_scale = 3.6
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'phantom.blend'))
print('saved', os.path.join(OUT, 'phantom.blend'))
mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))
