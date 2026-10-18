"""Colossus — boss hover-dreadnought enemy, procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_colossus.py <out_dir>
    blender -b -P tools/models/build_colossus.py -- <out_dir>

Writes <out_dir>/colossus.glb (game asset) and <out_dir>/colossus.blend (model + render stage).
Hierarchy: Colossus > Hull, Superstructure, Engine_L / Engine_C / Engine_R
Origin at the bottom of the hull; +X is forward. Emissive parts use the material `EnemyGlow`.
"""
import math
import os
import sys

import bpy
import bmesh  # noqa: E402  (bpy must be imported first when run as a module)
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (reset_scene, material, empty, box, cylinder, torus, cut, join,  # noqa: E402
                    setup_render_stage, _finish)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else '.')
os.makedirs(OUT, exist_ok=True)

reset_scene()

# ── Materials ───────────────────────────────────────────────────────────────
HULL = material('HullSteel', '#3e4957', metallic=0.6, roughness=0.42)
PLATE = material('HullPlate', '#55606e', metallic=0.55, roughness=0.38)
DECK = material('HullDeck', '#252d37', metallic=0.6, roughness=0.5)
MARK = material('HullMarking', '#7a2329', metallic=0.3, roughness=0.45)   # dark red faction paint
TRIM = material('Trim', '#8a95a3', metallic=1.0, roughness=0.3)
GUN = material('Gunmetal', '#15191f', metallic=0.9, roughness=0.3)
GLOW = material('EnemyGlow', '#05070a', roughness=0.3, emission='#ef4444', emission_strength=8)

root = empty('Colossus')


# ── Local helpers ───────────────────────────────────────────────────────────
def offset_poly(pts, d):
    """Offset a CCW polygon outward by d (negative = inset), keeping edges parallel."""
    n = len(pts)
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        nx, ny = dy / ln, -dx / ln
        lines.append(((x0 + nx * d, y0 + ny * d), (dx, dy)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


def loft(name, rings, mat=None, bevel=0.0, segments=3, angle=40):
    """Closed solid through horizontal rings [(ccw_points, z), ...] with equal point counts."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    loops = [[bm.verts.new((x, y, z)) for x, y in pts] for pts, z in rings]
    n = len(loops[0])
    for a, b in zip(loops, loops[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return _finish(obj, mat, bevel, segments, angle)


def prism(pts, z0, z1, mat=None, bevel=0.0):
    return loft('prism', [(pts, z0), (pts, z1)], mat, bevel)


def obox(size, center, xdir, ydir, mat=None, bevel=0.0):
    """Box whose local X/Y axes point along xdir/ydir (Z completes the frame)."""
    x = Vector(xdir).normalized()
    z = x.cross(Vector(ydir)).normalized()
    y = z.cross(x)
    o = box(size, loc=center, mat=mat, bevel=bevel)
    o.rotation_euler = Matrix((x, y, z)).transposed().to_euler()
    return o


def xcyl(r, length, loc, mat=None, verts=24, bevel=0.0, r2=None):
    """Cylinder (or cone) lying along X."""
    return cylinder(r, length, loc=loc, rot=(0, math.pi / 2, 0), verts=verts, mat=mat, bevel=bevel, radius2=r2)


def edges(pts):
    for i in range(len(pts)):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % len(pts)])
        d = b - a
        yield a, b, d.normalized(), Vector((d.y, -d.x)).normalized(), d.length


# ── Hull: arrowhead wedge, narrow belly, vertical side band, sloped upper deck ──
OUTLINE = [(4.0, 0.0), (1.0, 2.2), (-2.4, 2.75), (-3.3, 1.6), (-3.3, -1.6), (-2.4, -2.75), (1.0, -2.2)]
Z_BELLY, Z_SIDE0, Z_SIDE1, Z_DECK = 0.0, 0.5, 1.2, 1.75
INSET_TOP = 0.75
hull_parts = []
hull = loft('Hull', [(offset_poly(OUTLINE, -0.75), Z_BELLY), (OUTLINE, Z_SIDE0), (OUTLINE, Z_SIDE1),
                     (offset_poly(OUTLINE, -INSET_TOP), Z_DECK)], mat=HULL, bevel=0.1, angle=30)
# Horizontal seam around the side band
SEAM_Z = 0.78
ring = prism(offset_poly(OUTLINE, 0.4), SEAM_Z - 0.025, SEAM_Z + 0.025)
cut(ring, prism(offset_poly(OUTLINE, -0.045), SEAM_Z - 0.2, SEAM_Z + 0.2))
cut(hull, ring)
# Vertical panel seams on the side band
for x in (0.2, -1.4):
    slot = box((0.045, 7.0, Z_SIDE1 - Z_SIDE0 + 0.2), loc=(x, 0, (Z_SIDE0 + Z_SIDE1) / 2))
    cut(slot, prism(offset_poly(OUTLINE, -0.045), -1, 3))
    cut(hull, slot)
hull_parts.append(hull)

# Raised armour deck over the top of the hull
deck_pts = offset_poly(OUTLINE, -INSET_TOP - 0.18)
deck = prism(deck_pts, Z_DECK - 0.05, Z_DECK + 0.09, mat=DECK, bevel=0.04)
for x in (2.75, 0.55):  # panel lines across the fore deck
    cut(deck, box((0.04, 6.0, 0.08), loc=(x, 0, Z_DECK + 0.09)))
for k in range(4):  # intake grille ahead of the main battery
    cut(deck, box((0.5, 0.08, 0.1), loc=(2.95, -0.36 + k * 0.24, Z_DECK + 0.09)))
hull_parts.append(deck)

# Sloped armour plates along the forward flanks, with red faction paint on the front pair
slope_rise, slope_run = Z_DECK - Z_SIDE1, INSET_TOP
for i, (a, b, d, n, ln) in enumerate(edges(OUTLINE)):
    if i in (2, 3, 4):  # stern and its short corner edges stay bare
        continue
    up = Vector((-n.x * slope_run, -n.y * slope_run, slope_rise)).normalized()
    d3 = Vector((d.x, d.y, 0))
    normal = d3.cross(up)
    if normal.dot(Vector((n.x, n.y, 1))) < 0:
        normal = -normal
    # Keep plates clear of the nose, where the two flank slopes meet
    t0, t1 = (0.3, 1.0) if i == 0 else (0.0, 0.7) if i == 6 else (0.0, 1.0)
    span = ln * (t1 - t0)
    count = max(1, round(span / 1.6))
    for k in range(count):
        t = t0 + (t1 - t0) * (k + 0.5) / count
        p = a.lerp(b, t)
        mid = Vector((p.x - n.x * slope_run * 0.5, p.y - n.y * slope_run * 0.5, (Z_SIDE1 + Z_DECK) / 2))
        size = (span / count - 0.18, 0.62, 0.07)
        paint = MARK if (i, k) in ((0, 0), (6, count - 1)) else PLATE
        hull_parts.append(obox(size, mid + normal * 0.045, d3, up, mat=paint, bevel=0.025))

# Glowing light strips along the side band, above the seam
for i, (a, b, d, n, ln) in enumerate(edges(OUTLINE)):
    if i not in (0, 1, 5, 6):
        continue
    p = (a + b) / 2
    hull_parts.append(obox((ln * 0.55, 0.05, 0.05), (p.x + n.x * 0.02, p.y + n.y * 0.02, 1.0), (d.x, d.y, 0), (n.x, n.y, 0), mat=GLOW))

# Prow: a steel ram blade under the nose
hull_parts.append(loft('ram', [([(4.25, 0.0), (2.6, 0.55), (2.4, 0.0), (2.6, -0.55)], 0.3),
                               ([(4.15, 0.0), (2.6, 0.5), (2.5, 0.0), (2.6, -0.5)], 0.75)], mat=TRIM, bevel=0.03))

# Engine block at the stern: three nozzles with glowing cores
ENGINE_Z = 0.86
hull_parts.append(box((0.7, 3.4, 0.95), loc=(-3.35, 0, ENGINE_Z), mat=DECK, bevel=0.08))
engines = []
for name, y in (('Engine_L', 1.12), ('Engine_C', 0.0), ('Engine_R', -1.12)):
    nozzle = xcyl(0.36, 0.75, (-3.85, y, ENGINE_Z), mat=GUN, verts=32, bevel=0.03, r2=0.44)
    cut(nozzle, xcyl(0.3, 0.6, (-4.15, y, ENGINE_Z), verts=32))
    hull_parts.append(nozzle)
    hull_parts.append(torus(0.4, 0.035, loc=(-3.6, y, ENGINE_Z), rot=(0, math.pi / 2, 0), mat=TRIM, minor_seg=8))
    hull_parts.append(xcyl(0.29, 0.08, (-3.88, y, ENGINE_Z), mat=GLOW, verts=32))
    hull_parts.append(cylinder(0.08, 0.12, loc=(-3.95, y, ENGINE_Z), rot=(0, math.pi / 2, 0), verts=12, mat=GUN))
    engines.append((name, (-4.25, y, ENGINE_Z)))

# Repulsor pads under the belly
for x, y in ((2.0, 0.0), (-0.6, 1.2), (-0.6, -1.2), (-2.4, 0.0)):
    hull_parts.append(cylinder(0.55, 0.12, loc=(x, y, 0.02), verts=32, mat=GUN, bevel=0.02))
    hull_parts.append(cylinder(0.42, 0.03, loc=(x, y, -0.045), verts=32, mat=GLOW))

# Weapon sponsons on the flanks, each with a twin cannon
for side in (-1, 1):
    y = side * 2.62
    hull_parts.append(box((1.5, 0.6, 0.62), loc=(-0.7, y, 0.95), mat=PLATE, bevel=0.08))
    hull_parts.append(box((1.1, 0.12, 0.4), loc=(-0.7, y + side * 0.33, 0.95), mat=MARK, bevel=0.03))
    hull_parts.append(box((0.5, 0.04, 0.05), loc=(-0.85, y + side * 0.4, 1.07), mat=GLOW))
    hull_parts.append(cylinder(0.34, 0.2, loc=(0.2, y, 0.95), rot=(0, math.pi / 2, 0), verts=24, mat=GUN, bevel=0.03))
    for dz in (-0.12, 0.12):
        hull_parts.append(xcyl(0.07, 1.3, (0.9, y, 0.95 + dz), mat=GUN, verts=12))
        hull_parts.append(xcyl(0.1, 0.18, (1.5, y, 0.95 + dz), mat=TRIM, verts=12, bevel=0.01))

join('Hull', hull_parts, parent=root)

# ── Superstructure: stepped citadel, bridge, main battery, missile pods ─────
sup = []
TOP1 = Z_DECK + 0.09
# Lower citadel: wider, sloped front
S1_Z1 = TOP1 + 0.85
S1_RINGS = [([(0.8, 1.3), (-2.55, 1.3), (-2.55, -1.3), (0.8, -1.3)], TOP1),
            ([(0.15, 1.1), (-2.35, 1.1), (-2.35, -1.1), (0.15, -1.1)], S1_Z1)]
s1 = loft('s1', S1_RINGS, mat=HULL, bevel=0.08, angle=30)
seam = box((4.0, 3.0, 0.04), loc=(-0.9, 0, TOP1 + 0.5))  # panel seam around the citadel
cut(seam, loft('inner', [(offset_poly(pts, -0.04), z) for pts, z in S1_RINGS]))
cut(s1, seam)
for k in range(5):  # cooling vents on the roof
    cut(s1, box((0.6, 0.08, 0.3), loc=(-1.75, -0.5 + k * 0.25, S1_Z1)))
sup.append(s1)
for side in (-1, 1):  # side armour skirts on the citadel
    sup.append(obox((2.6, 0.6, 0.08), (-0.95, side * 1.24, TOP1 + 0.42), (1, 0, 0), (0, side * 0.12, 1), mat=PLATE, bevel=0.025))
for y in (-0.55, 0.55):  # sensor slits on the citadel's sloped front
    sup.append(obox((0.5, 0.08, 0.05), (0.62, y, TOP1 + 0.3), (0, 1, 0), (-0.65, 0, 0.85), mat=GLOW))
for side in (-1, 1):  # running lights along the citadel
    sup.append(box((2.2, 0.04, 0.05), loc=(-1.05, side * 1.31, TOP1 + 0.08), mat=GLOW))
# Upper tower with the bridge
S2_Z1 = S1_Z1 + 0.72
s2 = loft('s2', [([(-0.15, 0.82), (-2.15, 0.82), (-2.15, -0.82), (-0.15, -0.82)], S1_Z1),
                 ([(-0.6, 0.62), (-1.95, 0.62), (-1.95, -0.62), (-0.6, -0.62)], S2_Z1)], mat=PLATE, bevel=0.06, angle=30)
# Bridge window: a recessed slot across the sloped front face
front_up = Vector((-0.45, 0, 0.72)).normalized()
win_c = Vector((-0.375, 0, (S1_Z1 + S2_Z1) / 2 + 0.05))
cut(s2, obox((0.3, 0.16, 1.5), win_c, (0, 0, 1), (1, 0, 0)))
win_n = Vector((0, 1, 0)).cross(front_up).normalized()
if win_n.x < 0:
    win_n = -win_n
sup.append(obox((1.15, 0.12, 0.05), win_c - win_n * 0.04, (0, 1, 0), front_up, mat=GLOW))
sup.append(s2)
# Sensor mast: radar drum, antennas, red beacon
sup.append(cylinder(0.22, 0.25, loc=(-1.35, 0, S2_Z1 + 0.12), verts=20, mat=GUN, bevel=0.02))
sup.append(cylinder(0.32, 0.12, loc=(-1.35, 0, S2_Z1 + 0.3), verts=24, mat=TRIM, bevel=0.02))
sup.append(cylinder(0.025, 0.55, loc=(-1.75, 0.4, S2_Z1 + 0.27), verts=8, mat=TRIM))
sup.append(cylinder(0.025, 0.4, loc=(-1.75, -0.4, S2_Z1 + 0.2), verts=8, mat=TRIM))
sup.append(cylinder(0.06, 0.06, loc=(-1.75, 0.4, S2_Z1 + 0.57), verts=10, mat=GLOW))
# Main battery: a heavy twin cannon turret on the fore deck
TUR = Vector((1.55, 0.0, TOP1))
sup.append(cylinder(0.75, 0.16, loc=TUR + Vector((0, 0, 0.08)), verts=32, mat=TRIM, bevel=0.03))
turret = loft('turret', [([(0.75, 0.55), (-0.55, 0.7), (-0.7, 0.0), (-0.55, -0.7), (0.75, -0.55)], 0.0),
                         ([(0.5, 0.42), (-0.5, 0.55), (-0.62, 0.0), (-0.5, -0.55), (0.5, -0.42)], 0.5)], mat=PLATE, bevel=0.05)
turret.location = TUR + Vector((0, 0, 0.16))
sup.append(turret)
sup.append(box((0.5, 0.75, 0.06), loc=TUR + Vector((-0.1, 0, 0.67)), mat=MARK, bevel=0.02))
for y in (-0.24, 0.24):
    sup.append(xcyl(0.13, 0.4, (TUR.x + 0.75, y, TUR.z + 0.4), mat=GUN, verts=16, bevel=0.02))
    barrel = xcyl(0.085, 1.6, (TUR.x + 1.55, y, TUR.z + 0.4), mat=GUN, verts=14)
    sup.append(barrel)
    brake = xcyl(0.13, 0.28, (TUR.x + 2.35, y, TUR.z + 0.4), mat=GUN, verts=16, bevel=0.02)
    cut(brake, xcyl(0.06, 0.5, (TUR.x + 2.4, y, TUR.z + 0.4), verts=12))
    sup.append(brake)
# Missile pods either side of the citadel, red tubes
for side in (-1, 1):
    pod = box((0.9, 0.42, 0.45), loc=(-1.65, side * 1.6, TOP1 + 0.24), mat=DECK, bevel=0.04)
    for ix in range(2):
        for iz in range(2):
            cut(pod, xcyl(0.07, 0.3, (-1.2, side * 1.6 + (ix - 0.5) * 0.2, TOP1 + 0.14 + iz * 0.2), verts=12))
    sup.append(pod)
    for ix in range(2):
        for iz in range(2):
            sup.append(xcyl(0.05, 0.05, (-1.28, side * 1.6 + (ix - 0.5) * 0.2, TOP1 + 0.14 + iz * 0.2), mat=GLOW, verts=10))

join('Superstructure', sup, parent=root)

for name, loc in engines:
    empty(name, parent=root, loc=loc)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
glb = os.path.join(OUT, 'colossus.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
print('exported', glb, os.path.getsize(glb), 'bytes')

mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))

root.location.z = 0.6  # it hovers
setup_render_stage(target_height=2.2)
bpy.context.scene.camera.data.ortho_scale = 10.5
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'colossus.blend'))
print('saved', os.path.join(OUT, 'colossus.blend'))
