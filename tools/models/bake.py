"""Weathering + texture baking for the procedural models.

bake_model(root) runs after a model is built and before it is exported. For every mesh under
`root` it:
  1. unwraps a fresh UV map ('Bake') for the painted/metal faces;
  2. layers a procedural weathering shader on each non-emissive material: worn edges (chipped
     paint showing bare metal, polished steel), grime in crevices (ambient occlusion), vertical
     streaks on walls and a large-scale tone variation;
  3. bakes that to textures with Cycles: base colour, and an ORM map (R = ambient occlusion,
     G = roughness, B = metallic — the glTF layout);
  4. swaps the painted materials for one textured material per mesh. Emissive materials (Glow,
     Lens, EnemyGlow, ...) are left alone so the game can still recolour and pulse them.

Pass --no-bake to a build script to skip this (fast iteration on shapes).
"""
import math
import sys
import zlib

import bmesh
import bpy
import numpy as np

BAKE_UV = 'Bake'


def enabled():
    return '--no-bake' not in sys.argv


# ── Wear profiles ───────────────────────────────────────────────────────────
# edge: how much edge wear; edge_color/edge_metal/edge_rough: what the worn edge looks like
# (None = brighten the base colour); grime: crevice dirt; streaks: vertical run-off on walls.
PAINT = dict(edge=0.95, edge_color=(0.42, 0.45, 0.48), edge_metal=0.9, edge_rough=0.32, grime=0.85, streaks=0.5, dust=0.45)
METAL = dict(edge=0.8, edge_color=None, edge_metal=None, edge_rough=0.2, grime=0.7, streaks=0.35, dust=0.3)
RUBBER = dict(edge=0.0, edge_color=None, edge_metal=None, edge_rough=None, grime=0.4, streaks=0.0, dust=0.5)
DUST = (0.16, 0.15, 0.135, 1.0)  # pale grey-brown, linear


def _profile(bsdf):
    metal = bsdf.inputs['Metallic'].default_value
    rough = bsdf.inputs['Roughness'].default_value
    if metal < 0.2 and rough >= 0.7:
        return RUBBER
    return METAL if metal >= 0.8 else PAINT


def _is_emissive(mat):
    bsdf = mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
    return bsdf is None or bsdf.inputs['Emission Strength'].default_value > 0


# ── Weathering shader ───────────────────────────────────────────────────────
def _sock(sockets, identifier):
    return next(x for x in sockets if x.identifier == identifier)


class _Graph:
    """Tiny helper to build node graphs without the boilerplate."""

    def __init__(self, tree):
        self.t = tree
        self.n = tree.nodes
        self.l = tree.links

    def node(self, kind, **props):
        nd = self.n.new(kind)
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    def link(self, a, b):
        self.l.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        nd = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                nd.inputs[i].default_value = v
            else:
                self.link(v, nd.inputs[i])
        return nd.outputs[0]

    def remap(self, v, a, b, lo=0.0, hi=1.0):
        nd = self.node('ShaderNodeMapRange', clamp=True)
        self.link(v, nd.inputs['Value'])
        nd.inputs['From Min'].default_value = a
        nd.inputs['From Max'].default_value = b
        nd.inputs['To Min'].default_value = lo
        nd.inputs['To Max'].default_value = hi
        return nd.outputs['Result']

    def noise(self, vector, scale, detail=4.0, roughness=0.55):
        nd = self.node('ShaderNodeTexNoise')
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = roughness
        self.link(vector, nd.inputs['Vector'])
        return nd.outputs['Fac']

    def mix_color(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX', clamp_factor=True)
        self.link(fac, nd.inputs['Factor'])
        for sock, v in ((_sock(nd.inputs, 'A_Color'), a), (_sock(nd.inputs, 'B_Color'), b)):
            if isinstance(v, tuple):
                sock.default_value = v
            else:
                self.link(v, sock)
        return _sock(nd.outputs, 'Result_Color')

    def mix_float(self, fac, a, b):
        nd = self.node('ShaderNodeMix', data_type='FLOAT', clamp_factor=True)
        self.link(fac, nd.inputs['Factor'])
        for sock, v in ((_sock(nd.inputs, 'A_Float'), a), (_sock(nd.inputs, 'B_Float'), b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            else:
                self.link(v, sock)
        return _sock(nd.outputs, 'Result_Float')


def _weathering(mat):
    """Add weathering nodes to `mat`; return the (color, roughness, metallic) output sockets."""
    g = _Graph(mat.node_tree)
    bsdf = g.n['Principled BSDF']
    base = tuple(bsdf.inputs['Base Color'].default_value)
    rough = bsdf.inputs['Roughness'].default_value
    metal = bsdf.inputs['Metallic'].default_value
    p = _profile(bsdf)

    geo = g.node('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    # Different materials get different noise so neighbouring parts don't wear in lockstep
    offset = g.node('ShaderNodeVectorMath', operation='ADD')
    g.link(pos, offset.inputs[0])
    seed = (zlib.crc32(mat.name.encode()) % 997) * 0.37
    offset.inputs[1].default_value = (seed, seed * 0.7, seed * 0.3)
    p0 = offset.outputs[0]

    # Edges: where a rounded (bevel) normal departs from the true normal
    bevel = g.node('ShaderNodeBevel', samples=8)
    bevel.inputs['Radius'].default_value = 0.03
    dot = g.node('ShaderNodeVectorMath', operation='DOT_PRODUCT')
    g.link(bevel.outputs['Normal'], dot.inputs[0])
    g.link(geo.outputs['Normal'], dot.inputs[1])
    # Only the crest of each edge wears, not the whole bevel strip
    edge_raw = g.remap(g.math('SUBTRACT', 1.0, dot.outputs['Value']), 0.01, 0.07)
    chips = g.remap(g.noise(p0, 7.0, detail=8.0, roughness=0.65), 0.38, 0.62)
    edge = g.math('MULTIPLY', g.math('MULTIPLY', edge_raw, chips), p['edge'], clamp=True)

    # Grime: crevices (ambient occlusion) broken up by noise, plus vertical streaks on walls
    ao = g.node('ShaderNodeAmbientOcclusion', samples=16, only_local=False)
    ao.inputs['Distance'].default_value = 0.4
    cavity = g.remap(ao.outputs['AO'], 0.85, 0.25)
    blotch = g.remap(g.noise(p0, 2.2, detail=6.0), 0.35, 0.7, 0.35, 1.0)
    grime = g.math('MULTIPLY', cavity, blotch)
    stretch = g.node('ShaderNodeVectorMath', operation='MULTIPLY')
    g.link(p0, stretch.inputs[0])
    stretch.inputs[1].default_value = (9.0, 9.0, 0.7)
    streak = g.remap(g.noise(stretch.outputs[0], 1.0, detail=3.0), 0.5, 0.78)
    sep = g.node('ShaderNodeSeparateXYZ')
    g.link(geo.outputs['Normal'], sep.inputs[0])
    wall = g.math('SUBTRACT', 1.0, g.math('ABSOLUTE', sep.outputs['Z']))
    streak = g.math('MULTIPLY', g.math('MULTIPLY', streak, wall), p['streaks'])
    grime = g.math('MULTIPLY', g.math('ADD', grime, streak), p['grime'], clamp=True)

    # Dust settles on upward-facing surfaces, in patches, and not on worn edges
    up = g.remap(sep.outputs['Z'], 0.35, 0.95)
    patches = g.remap(g.noise(p0, 3.5, detail=6.0), 0.42, 0.68)
    dust = g.math('MULTIPLY', g.math('MULTIPLY', up, patches), p['dust'], clamp=True)
    dust = g.math('MULTIPLY', dust, g.math('SUBTRACT', 1.0, edge), clamp=True)

    # Large-scale tone variation and fine roughness breakup
    tone = g.remap(g.noise(p0, 0.9, detail=3.0), 0.3, 0.7, 0.9, 1.08)
    fine = g.remap(g.noise(p0, 28.0, detail=2.0), 0.3, 0.7, -0.06, 0.06)

    toned = g.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY', clamp_factor=True)
    toned.inputs['Factor'].default_value = 1.0
    _sock(toned.inputs, 'A_Color').default_value = base
    tone_rgb = g.node('ShaderNodeCombineColor')
    for i in range(3):
        g.link(tone, tone_rgb.inputs[i])
    g.link(tone_rgb.outputs[0], _sock(toned.inputs, 'B_Color'))
    dirty = (base[0] * 0.42, base[1] * 0.4, base[2] * 0.36, 1.0)
    color = g.mix_color(grime, _sock(toned.outputs, 'Result_Color'), dirty)
    color = g.mix_color(dust, color, DUST)
    if p['edge']:
        worn = p['edge_color'] or tuple(min(1.0, c * 1.3 + 0.02) for c in base[:3])
        color = g.mix_color(edge, color, tuple(worn[:3]) + (1.0,))

    r = g.math('ADD', g.math('ADD', rough, fine), g.math('MULTIPLY', g.math('ADD', grime, dust), 0.25), clamp=True)
    if p['edge_rough'] is not None:
        r = g.mix_float(edge, r, p['edge_rough'])
    m = g.mix_float(edge, metal, p['edge_metal']) if p['edge_metal'] is not None else g.math('ADD', metal, 0.0)
    dull = g.math('MULTIPLY', g.math('ADD', grime, dust), 0.5, clamp=True)
    m = g.mix_float(dull, m, max(0.0, metal - 0.3))  # dirt and dust dull metal
    return color, r, m


# ── Baking ──────────────────────────────────────────────────────────────────
def _unwrap(obj):
    """Fresh UV map for the painted faces; emissive faces collapse to a point (they bake nothing)."""
    me = obj.data
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    me.uv_layers.new(name=BAKE_UV)
    emissive = {i for i, m in enumerate(obj.material_slots) if _is_emissive(m.material)}
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(me)
    layer = bm.loops.layers.uv.active
    for f in bm.faces:
        f.select = f.material_index not in emissive
        if not f.select:
            for loop in f.loops:
                loop[layer].uv = (0.0, 0.0)
    bmesh.update_edit_mesh(me)
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.006, rotate=True)
    bpy.ops.object.mode_set(mode='OBJECT')


def _painted_area(obj):
    emissive = {i for i, m in enumerate(obj.material_slots) if _is_emissive(m.material)}
    return sum(p.area for p in obj.data.polygons if p.material_index not in emissive)


def _image(name, size, non_color):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=non_color)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def _bake_pass(obj, mats, outputs, image, kind):
    """Bake one channel: route `outputs[mat]` into an emission shader (or bake AO directly)."""
    for mat in mats:
        nt = mat.node_tree
        target = nt.nodes.get('BakeTarget') or nt.nodes.new('ShaderNodeTexImage')
        target.name = 'BakeTarget'
        target.image = image
        nt.nodes.active = target
        out = nt.nodes['Material Output']
        if kind != 'AO' and mat in outputs:
            emit = nt.nodes.get('BakeEmit') or nt.nodes.new('ShaderNodeEmission')
            emit.name = 'BakeEmit'
            sock = outputs[mat]
            if sock.type == 'VALUE':  # grey from a scalar
                comb = nt.nodes.new('ShaderNodeCombineColor')
                for i in range(3):
                    nt.links.new(sock, comb.inputs[i])
                sock = comb.outputs[0]
            nt.links.new(sock, emit.inputs['Color'])
            nt.links.new(emit.outputs[0], out.inputs['Surface'])
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='EMIT' if kind != 'AO' else 'AO', margin=8, margin_type='EXTEND', use_clear=True)


def _baked_material(name, color_img, orm_img):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = BAKE_UV
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = color_img
    orm = nt.nodes.new('ShaderNodeTexImage')
    orm.image = orm_img
    for t in (col, orm):
        nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(orm.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    # The glTF exporter reads ambient occlusion from this custom group's "Occlusion" input
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gnode = nt.nodes.new('ShaderNodeGroup')
    gnode.node_tree = grp
    nt.links.new(sep.outputs['Red'], gnode.inputs['Occlusion'])
    return mat


def bake_model(root, samples=32, ao_samples=64):
    """Weather and bake every mesh under `root` (see module docstring).

    --bake-preview bakes small and noisy, for quick looks at the weathering.
    """
    if not enabled():
        print('bake: skipped (--no-bake)')
        return
    preview = '--bake-preview' in sys.argv
    if preview:
        samples, ao_samples = 8, 16
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    if scene.world is None:
        scene.world = bpy.data.worlds.new('BakeWorld')
    scene.world.light_settings.distance = 0.6  # AO reach for the occlusion pass

    meshes = [o for o in root.children_recursive if o.type == 'MESH']
    # Weathering outputs per source material (built once, shared by every mesh using it)
    weathered = {}
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat and not _is_emissive(mat) and mat not in weathered:
                weathered[mat] = _weathering(mat)

    for obj in meshes:
        painted = [s.material for s in obj.material_slots if s.material and not _is_emissive(s.material)]
        if not painted:
            continue
        size = 1024 if _painted_area(obj) > 12 else 512
        if preview:
            size //= 2
        print(f'bake: {obj.name} ({size}px)', [s.material.name if s.material else None for s in obj.material_slots])
        _unwrap(obj)
        mats = [s.material for s in obj.material_slots if s.material]
        color = _image(f'{obj.name}_color', size, non_color=False)
        rough = _image(f'{obj.name}_rough', size, non_color=True)
        metal = _image(f'{obj.name}_metal', size, non_color=True)
        ao = _image(f'{obj.name}_ao', size, non_color=True)
        scene.cycles.samples = samples
        _bake_pass(obj, mats, {m: weathered[m][0] for m in painted}, color, 'COLOR')
        _bake_pass(obj, mats, {m: weathered[m][1] for m in painted}, rough, 'ROUGH')
        _bake_pass(obj, mats, {m: weathered[m][2] for m in painted}, metal, 'METAL')
        scene.cycles.samples = ao_samples
        _bake_pass(obj, mats, {}, ao, 'AO')

        # Pack R = AO, G = roughness, B = metallic
        px = np.empty(size * size * 4, dtype=np.float32)
        orm_px = np.ones((size * size, 4), dtype=np.float32)
        for ch, img in ((0, ao), (1, rough), (2, metal)):
            img.pixels.foreach_get(px)
            orm_px[:, ch] = px.reshape(-1, 4)[:, 0]
        orm = _image(f'{obj.name}_orm', size, non_color=True)
        orm.pixels.foreach_set(orm_px.ravel())
        for img in (rough, metal, ao):
            bpy.data.images.remove(img)
        for img in (color, orm):
            img.pack()

        # One textured material replaces the painted ones on this mesh; emissive slots stay
        baked = _baked_material(f'{obj.name}_Surface', color, orm)
        obj.data.materials.append(baked)
        new_index = len(obj.material_slots) - 1
        painted_idx = {i for i, s in enumerate(obj.material_slots) if s.material in painted}
        for poly in obj.data.polygons:
            if poly.material_index in painted_idx:
                poly.material_index = new_index
        # Drop the now-unused slots
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.material_slot_remove_unused()

    # The source materials keep their bake nodes otherwise; they're no longer used by the model
    for mat in weathered:
        if mat.users == 0:
            bpy.data.materials.remove(mat)


EXPORT_IMAGES = dict(export_image_format='WEBP', export_image_quality=88)
