"""Turntable renders of a model .blend (any model built by tools/models/build_*.py).

With Blender:
    blender -b vulcan.blend -P render_turntable.py -- <out_dir> [angles] [samples]
With Blender as a Python module (pip install bpy):
    python render_turntable.py <out_dir> [angles] [samples] --blend vulcan.blend

Renders `angles` views (default 8) around the model at the game's camera elevation, plus a
close-up of the gun. Output: <out_dir>/<name>_turn_00.png … and <name>_closeup.png
"""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if '--blend' in args:
    i = args.index('--blend')
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args[i + 1]))
    args = args[:i] + args[i + 2:]
out = os.path.abspath(args[0] if args else 'renders')
angles = int(args[1]) if len(args) > 1 else 8
samples = int(args[2]) if len(args) > 2 else 96
os.makedirs(out, exist_ok=True)

scene = bpy.context.scene
scene.cycles.samples = samples
# The model root is the top-level object that isn't part of the render stage
root = next(o for o in scene.objects if o.parent is None and not o.name.startswith(('Stage_', 'Key', 'Rim', 'Fill', 'Camera')))
name = root.name.lower()

for k in range(angles):
    root.rotation_euler = (0, 0, math.radians(k * 360 / angles))
    scene.render.filepath = os.path.join(out, f'{name}_turn_{k:02d}.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)

# Close-up on the turret from the front three-quarter
root.rotation_euler = (0, 0, math.radians(200))
cam = scene.camera
cam.data.ortho_scale *= 0.55
target = scene.objects.get('Stage_Target')
if target:
    target.location = Vector((0, 0, 4.2))
scene.render.filepath = os.path.join(out, f'{name}_closeup.png')
bpy.ops.render.render(write_still=True)
print('rendered', scene.render.filepath)
