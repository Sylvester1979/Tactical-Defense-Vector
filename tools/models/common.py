"""Shared helpers for the procedural Blender model scripts.

Conventions (match the Three.js renderer):
  * Blender units = game 3D units (1 unit = 10 game px). Z is up in Blender; the glTF exporter
    converts to Y-up. Turret/barrel axis is +X, which stays +X after export.
  * Moving parts are Empties named Yaw / Pitch / Recoil / Spin / Muzzle; the game looks them
    up by name. Meshes are joined per moving part to keep draw calls low.
"""
import math
import bpy
from mathutils import Vector


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def material(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = hex_color(color)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if emission:
        bsdf.inputs['Emission Color'].default_value = hex_color(emission)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    return m


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.4
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def _finish(obj, mat, bevel, segments, angle):
    if mat is not None:
        obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(angle)
        mod.harden_normals = True
    return obj


def apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bevel=0.0, segments=3, angle=40):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, mat, bevel, segments, angle)


def cylinder(radius, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=32, mat=None, bevel=0.0, segments=3, angle=40, radius2=None):
    if radius2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=radius2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, mat, bevel, segments, angle)


def torus(major, minor, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, major_seg=48, minor_seg=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=major_seg, minor_segments=minor_seg)
    return _finish(bpy.context.active_object, mat, 0, 0, 0)


def sphere(radius, loc=(0, 0, 0), mat=None, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=loc, segments=segments, ring_count=rings)
    return _finish(bpy.context.active_object, mat, 0, 0, 0)


def cut(target, cutter):
    """Boolean-subtract `cutter` from `target`, then delete the cutter."""
    mod = target.modifiers.new('cut', 'BOOLEAN')
    mod.object = cutter
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    # Apply it right away, ahead of any bevel, so the cut edges get bevelled too
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def join(name, objects, parent=None, loc=(0, 0, 0)):
    """Apply modifiers, smooth-shade and join objects into one mesh parented to `parent`."""
    for o in objects:
        apply_modifiers(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    # Hard-surface shading: smooth only across shallow angles (bevels, cylinders), keep flat faces
    # flat, then weight normals by face area so big panels shade cleanly next to their bevels
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35), keep_sharp_edges=True)
    wn = obj.modifiers.new('weighted', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    wn.weight = 100
    apply_modifiers(obj)
    # Origin at the part's pivot so it rotates correctly once parented
    bpy.context.view_layer.update()
    world_pivot = (parent.matrix_world.translation if parent else Vector((0, 0, 0))) + Vector(loc)
    bpy.context.scene.cursor.location = world_pivot
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    if parent:
        mw = obj.matrix_world.copy()
        obj.parent = parent
        obj.matrix_world = mw
    return obj


def curve_tube(name, points, radius, mat):
    """A smooth tube (hose/cable) through world-space points."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    return bpy.context.active_object


def setup_render_stage(target_height=3.0, resolution=1200):
    """Night hangar lighting, dark world, orthographic camera at the game's isometric angle."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = resolution
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'

    world = bpy.data.worlds.new('NightHangar')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = hex_color('#0b1119')
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world

    # Floor to catch shadows and reflections
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'Stage_Floor'
    floor.data.materials.append(material('Stage_Floor', '#1c2229', metallic=0.6, roughness=0.55))

    target = empty('Stage_Target', loc=(0, 0, target_height))

    def area(name, color, power, loc, size):
        light = bpy.data.lights.new(name, 'AREA')
        light.color = hex_color(color)[:3]
        light.energy = power
        light.size = size
        o = bpy.data.objects.new(name, light)
        scene.collection.objects.link(o)
        o.location = loc
        c = o.constraints.new('TRACK_TO')
        c.target = target
        return o

    # Review lighting: readable forms first, mood second
    area('Key', '#d6e0ff', 2600, (2, -9, 11), 7)      # cool key from the camera side, high
    area('Rim', '#ffc28a', 450, (-9, 6, 5), 3)        # warm rim from behind for silhouette
    area('Fill', '#5b74a8', 900, (9, 4, 3), 10)       # soft blue fill from the right

    cam_data = bpy.data.cameras.new('Camera')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = target_height * 3.1
    cam = bpy.data.objects.new('Camera', cam_data)
    scene.collection.objects.link(cam)
    # Game camera: 30° elevation, 45° azimuth, looking from +X / -Y (Blender) = +X / +Z (Three.js)
    d = Vector((math.cos(math.radians(30)) * math.sin(math.radians(45)),
                -math.cos(math.radians(30)) * math.cos(math.radians(45)),
                math.sin(math.radians(30))))
    cam.location = Vector((0, 0, target_height)) + d * 40
    c = cam.constraints.new('TRACK_TO')
    c.target = target
    scene.camera = cam
    return scene


# ── Shared tower parts ─────────────────────────────────────────────────────
PLINTH_H = 0.7
BODY_Z0 = 0.88   # top of the plinth step, where the body starts
BODY_R0, BODY_R1 = 1.62, 1.22  # tapered hex body: corner radius at bottom / top
HEX_APOTHEM = math.cos(math.radians(30))  # hex face distance / corner radius


def tower_materials(glow='#3b82f6'):
    """The tower family's paint and metal. `Glow` is the energy band the game recolours per tower."""
    return {
        'armor': material('Armor', '#47515f', metallic=0.35, roughness=0.45),
        'armor_light': material('ArmorLight', '#5b6676', metallic=0.3, roughness=0.42),
        'armor_dark': material('ArmorDark', '#262d36', metallic=0.55, roughness=0.5),
        'steel': material('Steel', '#9aa4b0', metallic=1.0, roughness=0.3),
        'gun': material('Gunmetal', '#2a2f36', metallic=0.85, roughness=0.32),
        'rubber': material('Rubber', '#0d0f12', metallic=0.0, roughness=0.8),
        'glow': material('Glow', '#05070a', roughness=0.3, emission=glow, emission_strength=8),
        'lens': material('Lens', '#05070a', roughness=0.1, emission='#8fbaff', emission_strength=10),
    }


def tower_base(root, M, body_h=2.3, seams=(0.55, 1.45), plate_z=1.0, plate_h=0.75, band_z=1.62):
    """Octagonal plinth with bolts, tapered armoured hex body, energy band and yaw bearing.

    Heights other than body_h are measured up from BODY_Z0. Returns the yaw pivot height.
    """
    body_r1 = BODY_R0 + (BODY_R1 - BODY_R0) * body_h / 2.3  # same taper angle at any height

    def body_apothem(z):
        return (BODY_R0 + (body_r1 - BODY_R0) * (z - BODY_Z0) / body_h) * HEX_APOTHEM

    base = [
        cylinder(2.5, PLINTH_H, loc=(0, 0, PLINTH_H / 2), rot=(0, 0, math.radians(22.5)), verts=8, mat=M['armor_dark'], bevel=0.1),
        cylinder(2.1, 0.18, loc=(0, 0, 0.79), rot=(0, 0, math.radians(22.5)), verts=8, mat=M['armor'], bevel=0.04),
    ]
    # Hex bolts with washers, one in each corner of the step: the corners have the most room
    # between the body and the step's edge (edge-midpoints are only ~0.5 from the body)
    for k in range(8):
        a = math.radians(22.5 + k * 45)
        x, y = math.cos(a) * 1.8, math.sin(a) * 1.8
        base.append(cylinder(0.14, 0.03, loc=(x, y, BODY_Z0 + 0.015), verts=16, mat=M['steel']))
        base.append(cylinder(0.095, 0.09, loc=(x, y, BODY_Z0 + 0.075), rot=(0, 0, a), verts=6, mat=M['steel'], bevel=0.015))
    body = cylinder(BODY_R0, body_h, radius2=body_r1, loc=(0, 0, BODY_Z0 + body_h / 2), verts=6, mat=M['armor'], bevel=0.07)
    # Horizontal panel seams cut into the body
    for dz in seams:
        z = BODY_Z0 + dz
        seam = cylinder(2.0, 0.05, loc=(0, 0, z), verts=6)
        inner = cylinder((body_apothem(z) - 0.04) / HEX_APOTHEM, 0.2, loc=(0, 0, z), verts=6)  # 4 cm deep groove
        cut(seam, inner)
        cut(body, seam)
    base.append(body)
    # Armour plates on each face, tilted with the taper
    slope = math.atan((BODY_R0 - body_r1) / body_h)
    for k in range(6):
        a = math.radians(30 + k * 60)
        r = body_apothem(BODY_Z0 + plate_z) + 0.05
        base.append(box((0.1, 0.95, plate_h), loc=(math.cos(a) * r, math.sin(a) * r, BODY_Z0 + plate_z),
                        rot=(0, -slope, a), mat=M['armor_light'], bevel=0.03))
    bz = BODY_Z0 + band_z
    corner_r = body_apothem(bz) / HEX_APOTHEM  # the band wraps just outside the hex corners
    base.append(torus(corner_r + 0.022, 0.075, loc=(0, 0, bz), mat=M['glow']))
    for dz in (-0.13, 0.13):
        base.append(torus(corner_r + 0.002, 0.04, loc=(0, 0, bz + dz), mat=M['steel'], minor_seg=8))
    top = BODY_Z0 + body_h
    base.append(cylinder(1.32, 0.16, loc=(0, 0, top + 0.04), verts=6, mat=M['armor_dark'], bevel=0.03))
    base.append(cylinder(1.2, 0.28, loc=(0, 0, top + 0.26), verts=40, mat=M['steel'], bevel=0.03))
    join('Base', base, parent=root)
    return top + 0.4
