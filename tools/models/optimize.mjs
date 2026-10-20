// Shrinks Blender-exported models for the web: Meshopt-compressed, quantized geometry
// (EXT_meshopt_compression + KHR_mesh_quantization) and ORM maps (occlusion / roughness /
// metallic) scaled down to 512px — they hold smooth gradients that don't need the colour map's
// resolution. Colour maps keep their size, re-encoded at WebP quality 80.
//
//   node tools/models/optimize.mjs <in.glb> [more.glb ...] <out_dir>
//
// The game's GLTFLoader is set up with the Meshopt decoder (src/render3d/loader.ts).
import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: node tools/models/optimize.mjs <in.glb> [more.glb ...] <out_dir>');
  process.exit(1);
}
const outDir = args.pop();
mkdirSync(outDir, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

for (const input of args) {
  const output = join(outDir, basename(input));
  const doc = await io.read(input);
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true }), // empty leaf nodes (Muzzle, Engine_*) are anchors the game looks up
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, slots: /^(metallicRoughness|occlusion)Texture$/, resize: [512, 512] }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, slots: /^baseColorTexture$/ }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(output, doc);
  const kb = f => Math.round(statSync(f).size / 1024);
  console.log(`${basename(input)}: ${kb(input)} KB → ${kb(output)} KB`);
}
