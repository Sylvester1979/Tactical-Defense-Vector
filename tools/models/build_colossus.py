"""Colossus — boss hover-dreadnought enemy, procedural hard-surface model.

Run (Blender as a Python module, or inside Blender):
    python tools/models/build_colossus.py <out_dir>
    blender -b -P tools/models/build_colossus.py -- <out_dir>

Writes <out_dir>/colossus.glb (game asset) and <out_dir>/colossus.blend (model + render stage).
Hierarchy: Colossus > Hull, Superstructure, Engine_L / Engine_C / Engine_R
A dreadnought: wedge hull with an armour belt, superfiring twin turrets, a stepped command tower
with a red bridge band and a tall sensor mast.
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
from bake import bake_model, EXPORT_IMAGES  # noqa: E402

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

# Armour belt: thick plates proud of the side band, below the light strips
BELT_Z0, BELT_Z1 = 0.54, 0.9
for i, (a, b, d, n, ln) in enumerate(edges(OUTLINE)):
    if i not in (0, 1, 5, 6):
        continue
    # Skip the stretch where the flank sponsons sit (x ≈ -1.5 … 0.1)
    t0, t1 = (0.12, 0.92) if i in (0, 6) else (0.05, 0.95)
    count = max(1, round(ln * (t1 - t0) / 1.25))
    for k in range(count):
        t = t0 + (t1 - t0) * (k + 0.5) / count
        p = a.lerp(b, t)
        if -1.6 < p.x < 0.2:
            continue
        hull_parts.append(obox((ln * (t1 - t0) / count - 0.1, 0.1, BELT_Z1 - BELT_Z0),
                               (p.x + n.x * 0.06, p.y + n.y * 0.06, (BELT_Z0 + BELT_Z1) / 2),
                               (d.x, d.y, 0), (n.x, n.y, 0), mat=PLATE, bevel=0.025))

join('Hull', hull_parts, parent=root)

# ── Superstructure: battleship layout — superfiring main turrets forward, a stepped
#    command tower with a glowing bridge, a tall sensor mast, and an aft turret ─────────
sup = []
TOP1 = Z_DECK + 0.09


def main_turret(x, z, scale=1.0, facing=1, barrel=1.9):
    """Twin-barrelled turret on a barbette whose roof is at height z; facing +1 = bow, -1 = stern."""
    parts = []
    r = 0.62 * scale
    parts.append(cylinder(r, z - TOP1 + 0.02, loc=(x, 0, (TOP1 + z) / 2), verts=32, mat=HULL, bevel=0.03))
    parts.append(torus(r, 0.03, loc=(x, 0, z - 0.02), mat=TRIM, minor_seg=6, major_seg=40))
    f = facing
    house = [(0.62, 0.42), (0.2, 0.62), (-0.55, 0.62), (-0.7, 0.35), (-0.7, -0.35), (-0.55, -0.62), (0.2, -0.62), (0.62, -0.42)]
    top = [(0.32, 0.34), (0.05, 0.5), (-0.5, 0.5), (-0.62, 0.3), (-0.62, -0.3), (-0.5, -0.5), (0.05, -0.5), (0.32, -0.34)]
    sc = lambda pts: [(x + px * scale * f, py * scale) for px, py in (pts if f > 0 else list(reversed(pts)))]
    h = 0.5 * scale
    parts.append(loft('turret', [(sc(house), z), (sc(top), z + h)], mat=PLATE, bevel=0.04))
    parts.append(box((0.42 * scale, 0.7 * scale, 0.04), loc=(x - 0.18 * scale * f, 0, z + h + 0.02), mat=MARK, bevel=0.015))
    # Rangefinder ears on the turret's rear corners
    for side in (-1, 1):
        parts.append(xcyl(0.06 * scale, 0.3 * scale, (x - 0.45 * scale * f, side * 0.66 * scale, z + h * 0.7), mat=GUN, verts=10))
    bz = z + h * 0.45
    for y in (-0.2 * scale, 0.2 * scale):
        parts.append(xcyl(0.12 * scale, 0.36 * scale, (x + 0.72 * scale * f, y, bz), mat=GUN, verts=16, bevel=0.02))
        parts.append(xcyl(0.07 * scale, barrel, (x + (0.85 * scale + barrel / 2) * f, y, bz), mat=GUN, verts=12,
                          r2=0.06 * scale))
        tip = x + (0.85 * scale + barrel) * f
        brake = xcyl(0.1 * scale, 0.22 * scale, (tip, y, bz), mat=GUN, verts=14, bevel=0.015)
        cut(brake, xcyl(0.05 * scale, 0.5, (tip + 0.1 * f, y, bz), verts=10))
        parts.append(brake)
    return parts


# Main battery: A turret low on the fore deck, B superfiring over it from a tall barbette
sup += main_turret(2.05, TOP1 + 0.16, scale=0.82, barrel=1.35)
sup += main_turret(0.8, TOP1 + 0.72, scale=1.0, barrel=1.9)
# Aft turret, facing the stern
sup += main_turret(-2.45, TOP1 + 0.3, scale=0.78, facing=-1, barrel=1.1)

# Command tower: four stepped decks, narrowing and set back as they rise
T0, T1, T2, T3 = TOP1 + 0.68, TOP1 + 1.42, TOP1 + 2.16, TOP1 + 2.5
levels = [
    ([(-0.05, 1.2), (-1.95, 1.2), (-1.95, -1.2), (-0.05, -1.2)], [(-0.22, 1.14), (-1.92, 1.14), (-1.92, -1.14), (-0.22, -1.14)], TOP1, T0, HULL),
    ([(-0.4, 0.92), (-1.85, 0.92), (-1.85, -0.92), (-0.4, -0.92)], [(-0.52, 0.86), (-1.82, 0.86), (-1.82, -0.86), (-0.52, -0.86)], T0, T1, PLATE),
    ([(-0.72, 0.7), (-1.76, 0.7), (-1.76, -0.7), (-0.72, -0.7)], [(-0.82, 0.64), (-1.72, 0.64), (-1.72, -0.64), (-0.82, -0.64)], T1, T2, HULL),
]
for k, (lo, hi, z0, z1, mat) in enumerate(levels):
    blk = loft(f'tower{k}', [(lo, z0), (hi, z1)], mat=mat, bevel=0.05, angle=30)
    if k == 0:  # panel seam and roof vents on the broad lower deckhouse
        for vx in range(4):
            cut(blk, box((0.08, 0.5, 0.2), loc=(-1.75 + vx * 0.15, 0.75, T0)))
            cut(blk, box((0.08, 0.5, 0.2), loc=(-1.75 + vx * 0.15, -0.75, T0)))
    sup.append(blk)
    # Glowing port lights along each deck's sides
    for side in (-1, 1):
        y = hi[0][1] + (lo[0][1] - hi[0][1]) * 0.35
        sup.append(box((abs(lo[1][0] - lo[0][0]) * 0.55, 0.04, 0.045), loc=((lo[0][0] + lo[1][0]) / 2, side * (y + 0.005), z0 + (z1 - z0) * 0.62), mat=GLOW))

# Bridge: a wide flying deck on top of the tower, wings out to the sides, red windows all round
bridge = loft('bridge', [([(-0.62, 1.08), (-1.68, 1.08), (-1.68, -1.08), (-0.62, -1.08)], T2),
                         ([(-0.84, 1.0), (-1.64, 1.0), (-1.64, -1.0), (-0.84, -1.0)], T3)], mat=PLATE, bevel=0.04)
sup.append(bridge)
# Window band: front and both wings
win_z = (T2 + T3) / 2 + 0.01
front_up = Vector((-0.22, 0, 0.34)).normalized()
sup.append(obox((1.9, 0.13, 0.06), (-0.71, 0, win_z), (0, 1, 0), front_up, mat=GLOW))
for side in (-1, 1):
    sup.append(box((0.75, 0.05, 0.12), loc=(-1.24, side * 1.045, win_z), mat=GLOW))
# Roof of the bridge with a slight overhang
sup.append(box((1.05, 2.25, 0.07), loc=(-1.24, 0, T3 + 0.035), mat=DECK, bevel=0.02))

# Sensor mast: a tapered pylon with yardarms, radar, dish and a red beacon at the top
MAST_X = -1.3
mast_top = T3 + 1.5
# A tapered pylon base, then the mast proper
sup.append(loft('mastbase', [([(MAST_X + 0.28, 0.3), (MAST_X - 0.3, 0.3), (MAST_X - 0.3, -0.3), (MAST_X + 0.28, -0.3)], T3 + 0.06),
                             ([(MAST_X + 0.1, 0.12), (MAST_X - 0.12, 0.12), (MAST_X - 0.12, -0.12), (MAST_X + 0.1, -0.12)], T3 + 0.55)],
                 mat=HULL, bevel=0.02))
sup.append(cylinder(0.1, mast_top - T3 - 0.5, radius2=0.05, loc=(MAST_X, 0, (T3 + 0.5 + mast_top) / 2), verts=12, mat=TRIM))
for z, half in ((T3 + 0.95, 0.75), (T3 + 1.25, 0.48)):  # yardarms
    sup.append(box((0.06, half * 2, 0.05), loc=(MAST_X, 0, z), mat=TRIM))
    for side in (-1, 1):
        sup.append(cylinder(0.035, 0.06, loc=(MAST_X, side * half, z + 0.05), verts=8, mat=GLOW))
sup.append(cylinder(0.22, 0.12, loc=(MAST_X, 0, T3 + 0.62), verts=20, mat=GUN, bevel=0.02))  # radar drum
sup.append(box((0.08, 0.9, 0.16), loc=(MAST_X + 0.05, 0, T3 + 0.76), mat=DECK, bevel=0.02))     # radar bar
sup.append(cylinder(0.06, 0.08, loc=(MAST_X, 0, mast_top + 0.04), verts=10, mat=GLOW))         # beacon
sup.append(cylinder(0.015, 0.4, loc=(MAST_X, 0, mast_top + 0.25), verts=6, mat=TRIM))           # whip
# Sensor dish on a short stalk at the back of the bridge roof, tilted up and forward
dish = cylinder(0.24, 0.05, radius2=0.1, loc=(-1.5, 0.7, T3 + 0.36), verts=24, mat=TRIM, bevel=0.012)
dish.rotation_euler = (math.radians(-35), math.radians(-25), 0)
sup.append(dish)
sup.append(cylinder(0.035, 0.28, loc=(-1.5, 0.7, T3 + 0.18), verts=8, mat=GUN))

# Heat-sink stacks behind the tower (the ship's 'funnels'), with glowing vent slots
for y in (-0.42, 0.42):
    stack = loft('stack', [([(-1.85, y + 0.22), (-2.25, y + 0.2), (-2.25, y - 0.2), (-1.85, y - 0.22)], T0),
                           ([(-1.95, y + 0.17), (-2.2, y + 0.16), (-2.2, y - 0.16), (-1.95, y - 0.17)], T1 + 0.25)], mat=DECK, bevel=0.03)
    for k in range(3):
        cut(stack, box((0.06, 0.5, 0.08), loc=(-1.9, y, T0 + 0.25 + k * 0.22)))
    sup.append(stack)
    sup.append(box((0.04, 0.3, 0.5), loc=(-1.86, y, T0 + 0.47), mat=GLOW))

# Secondary point-defence turrets on the corners of the lower deckhouse
for x, y in ((-0.25, 1.0), (-0.25, -1.0), (-1.8, 1.0), (-1.8, -1.0)):
    sup.append(cylinder(0.18, 0.12, loc=(x, y, T0 + 0.06), verts=16, mat=GUN, bevel=0.015))
    sup.append(box((0.24, 0.22, 0.12), loc=(x, y, T0 + 0.18), mat=PLATE, bevel=0.02))
    for dy in (-0.05, 0.05):
        sup.append(xcyl(0.025, 0.4, (x + (0.3 if x > -1 else -0.3), y + dy, T0 + 0.2), mat=GUN, verts=8))

join('Superstructure', sup, parent=root)

for name, loc in engines:
    empty(name, parent=root, loc=loc)

# ── Weather and bake textures (skip with --no-bake) ───────────────────────
bake_model(root)

# ── Export the model, then add the render stage and save the .blend ────────
bpy.ops.object.select_all(action='DESELECT')
for o in [root] + list(root.children_recursive):
    o.select_set(True)
glb = os.path.join(OUT, 'colossus.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, **EXPORT_IMAGES)
print('exported', glb, os.path.getsize(glb), 'bytes')

mesh_objs = [o for o in root.children_recursive if o.type == 'MESH']
for o in mesh_objs:
    o.data.calc_loop_triangles()
print('triangles:', sum(len(o.data.loop_triangles) for o in mesh_objs))

root.location.z = 0.6  # it hovers
setup_render_stage(target_height=2.6)
bpy.context.scene.camera.data.ortho_scale = 11.5
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'colossus.blend'))
print('saved', os.path.join(OUT, 'colossus.blend'))
