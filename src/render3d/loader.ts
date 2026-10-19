import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// One glTF loader for every model. Models are Meshopt-compressed by tools/models/optimize.mjs,
// so the loader needs the decoder. Download progress is pooled across all files so the game can
// show a single loading bar.

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

const loaded = new Map<string, number>();
const total = new Map<string, number>();
let listener: ((fraction: number) => void) | null = null;

const report = () => {
  if (!listener) return;
  let have = 0, want = 0;
  for (const [url, size] of total) { want += size; have += Math.min(size, loaded.get(url) ?? 0); }
  // Until every file has announced its size, count files instead of bytes
  const known = [...loaded.keys()].every(url => (total.get(url) ?? 0) > 0);
  const byFiles = [...loaded.keys()].filter(url => loaded.get(url) === Infinity).length / Math.max(1, loaded.size);
  listener(known && want > 0 ? have / want : byFiles);
};

export const onLoadProgress = (cb: ((fraction: number) => void) | null) => { listener = cb; };

export const loadModel = (url: string): Promise<GLTF> => {
  loaded.set(url, 0);
  return loader.loadAsync(url, e => {
    loaded.set(url, e.loaded);
    if (e.total) total.set(url, e.total);
    report();
  }).finally(() => {
    loaded.set(url, Infinity);
    report();
  });
};
