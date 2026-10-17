import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TowerType } from '../types';
import { TOWER_STATS } from '../constants';
import { makeHullDetail } from './textures';

// Tower models built from primitives. Shared anatomy: octagonal plinth → body → glowing energy
// band → yaw ring → turret (yaw) → gun cradle (pitch). Each family gets its own turret.
// Local turret frame: +X is the barrel axis.

export interface TowerModel {
  root: THREE.Group;
  yaw: THREE.Group;        // rotates around Y to face the target
  pitch: THREE.Group;      // tilts the guns up/down
  spin?: THREE.Group;      // rotary barrel cluster (Vulcan)
  muzzles: THREE.Object3D[]; // world positions shots come from
  band: THREE.MeshStandardMaterial; // energy band, pulses on fire
  family: 'vulcan' | 'railgun' | 'mortar';
  recoil: THREE.Group;     // slides back along -X when firing
}

const hull = makeHullDetail();
const mat = {
  hull: new THREE.MeshStandardMaterial({ color: '#2c333d', metalness: 0.55, roughness: 0.5, normalMap: hull.normalMap, roughnessMap: hull.roughnessMap }),
  armor: new THREE.MeshStandardMaterial({ color: '#46505d', metalness: 0.35, roughness: 0.45, normalMap: hull.normalMap }),
  steel: new THREE.MeshStandardMaterial({ color: '#9aa4b0', metalness: 1, roughness: 0.3 }),
  gun: new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.85, roughness: 0.32 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#0b0d10', metalness: 0.1, roughness: 0.85 }),
  hazard: new THREE.MeshStandardMaterial({ color: '#c9900a', metalness: 0.3, roughness: 0.55 }),
};
const glow = (color: THREE.ColorRepresentation, intensity: number) =>
  new THREE.MeshStandardMaterial({ color: '#05070a', emissive: color, emissiveIntensity: intensity, metalness: 0.2, roughness: 0.3 });

const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
};

const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  return o;
};

// Cylinder lying along +X
const barrel = (r: number, len: number, m: THREE.Material, seg = 16) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  return new THREE.Mesh(g, m);
};

const baseAnatomy = (color: string, bodyH: number) => {
  const root = new THREE.Group();
  root.add(mesh(new THREE.CylinderGeometry(2.25, 2.55, 0.7, 8), mat.hull, 0, 0.35));
  root.add(mesh(new THREE.CylinderGeometry(2.0, 2.25, 0.18, 8), mat.steel, 0, 0.79));
  // Corner bolts on the plinth
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    root.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8), mat.steel, Math.cos(a) * 1.95, 0.9, Math.sin(a) * 1.95));
  }
  const body = mesh(new THREE.CylinderGeometry(1.15, 1.55, bodyH, 6), mat.armor, 0, 0.88 + bodyH / 2);
  root.add(body);
  // Vertical armour ribs
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const rib = mesh(new THREE.BoxGeometry(0.14, bodyH * 0.8, 0.3), mat.hull, Math.cos(a) * 1.3, 0.88 + bodyH * 0.45, Math.sin(a) * 1.3);
    rib.rotation.y = -a;
    root.add(rib);
  }
  const band = glow(color, 3.2);
  const ring = mesh(new THREE.TorusGeometry(1.32, 0.09, 8, 40), band, 0, 0.88 + bodyH * 0.72);
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  // Coloured light above the turret: spills a pool of the tower's colour onto the deck
  const pool = new THREE.PointLight(color, 40, 15, 2);
  pool.position.set(0, 0.88 + bodyH + 2.6, 0);
  root.add(pool);
  // Yaw bearing
  const topY = 0.88 + bodyH;
  root.add(mesh(new THREE.CylinderGeometry(1.25, 1.2, 0.3, 24), mat.steel, 0, topY + 0.15));
  const yaw = new THREE.Group();
  yaw.position.y = topY + 0.3;
  root.add(yaw);
  return { root, yaw, band };
};

const buildVulcan = (color: string): TowerModel => {
  const { root, yaw, band } = baseAnatomy(color, 2.2);
  yaw.add(mesh(new RoundedBoxGeometry(2.3, 1.15, 2.0, 3, 0.28), mat.hull, -0.2, 0.62));
  // Ammo drum on the side, armour cheek plates
  const drum = barrel(0.45, 1.0, mat.armor, 20);
  drum.rotation.y = Math.PI / 2; drum.position.set(-0.5, 0.6, -1.05);
  yaw.add(drum);
  yaw.add(mesh(new RoundedBoxGeometry(1.6, 0.8, 0.18, 2, 0.06), mat.armor, 0.1, 0.62, 1.07));
  // Sensor eye
  yaw.add(mesh(new THREE.SphereGeometry(0.22, 16, 12), glow(color, 6), 0.95, 0.95, 0.55));
  const pitch = new THREE.Group();
  pitch.position.set(0.9, 0.6, 0);
  yaw.add(pitch);
  const recoil = new THREE.Group();
  pitch.add(recoil);
  // Rotary cluster: six barrels around the axis, a shroud and a muzzle collar
  const spin = new THREE.Group();
  recoil.add(spin);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const b = barrel(0.09, 2.3, mat.gun, 10);
    b.position.set(0, Math.cos(a) * 0.26, Math.sin(a) * 0.26);
    spin.add(b);
  }
  const shroud = barrel(0.42, 0.7, mat.steel, 20);
  recoil.add(shroud);
  const collar = barrel(0.4, 0.18, mat.hull, 20);
  collar.position.x = 1.95;
  spin.add(collar);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(2.4, 0, 0);
  recoil.add(muzzle);
  return { root: shadowed(root), yaw, pitch, spin, muzzles: [muzzle], band, family: 'vulcan', recoil };
};

const buildRailgun = (color: string): TowerModel => {
  const { root, yaw, band } = baseAnatomy(color, 2.8);
  yaw.add(mesh(new RoundedBoxGeometry(2.6, 0.9, 1.5, 3, 0.22), mat.hull, -0.5, 0.5));
  // Capacitor bank with glowing cells at the back
  const cap = mesh(new RoundedBoxGeometry(1.0, 1.0, 1.8, 2, 0.15), mat.armor, -1.7, 0.75);
  yaw.add(cap);
  for (let k = 0; k < 3; k++) yaw.add(mesh(new THREE.BoxGeometry(0.05, 0.6, 0.32), glow(color, 4), -2.21, 0.75, -0.55 + k * 0.55));
  const pitch = new THREE.Group();
  pitch.position.set(0.5, 0.55, 0);
  yaw.add(pitch);
  const recoil = new THREE.Group();
  pitch.add(recoil);
  // Twin rails with charge coils wrapped around them
  for (const z of [-0.3, 0.3]) {
    const rail = mesh(new THREE.BoxGeometry(4.2, 0.22, 0.16), mat.gun, 2.0, 0, z);
    recoil.add(rail);
    recoil.add(mesh(new THREE.BoxGeometry(4.0, 0.05, 0.05), mat.steel, 2.0, 0.13, z));
  }
  const coilMat = glow(color, 4.5);
  for (let k = 0; k < 4; k++) {
    const coil = mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 24), coilMat, 0.9 + k * 0.85, 0, 0);
    coil.rotation.y = Math.PI / 2;
    recoil.add(coil);
  }
  const core = barrel(0.08, 4.0, glow(color, 2.5), 8);
  recoil.add(core);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(4.2, 0, 0);
  recoil.add(muzzle);
  return { root: shadowed(root), yaw, pitch, muzzles: [muzzle], band, family: 'railgun', recoil };
};

const buildMortar = (color: string): TowerModel => {
  const { root, yaw, band } = baseAnatomy(color, 1.6);
  yaw.add(mesh(new RoundedBoxGeometry(2.6, 1.0, 2.6, 3, 0.3), mat.hull, 0, 0.5));
  // Hazard-striped skirt
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const s = mesh(new THREE.BoxGeometry(0.5, 0.28, 0.12), k % 2 ? mat.hazard : mat.rubber, Math.cos(a) * 1.36, 0.16, Math.sin(a) * 1.36);
    s.rotation.y = -a + Math.PI / 2;
    yaw.add(s);
  }
  // Trunnions holding the tube
  for (const z of [-0.95, 0.95]) yaw.add(mesh(new RoundedBoxGeometry(0.9, 1.3, 0.3, 2, 0.08), mat.armor, 0.2, 1.3, z));
  const pitch = new THREE.Group();
  pitch.position.set(0.2, 1.55, 0);
  pitch.rotation.z = 0.9; // lobbing elevation
  yaw.add(pitch);
  const recoil = new THREE.Group();
  pitch.add(recoil);
  const tube = barrel(0.62, 2.4, mat.gun, 24);
  tube.position.x = -0.6;
  recoil.add(tube);
  for (const x of [0.2, 1.1]) {
    const ring = barrel(0.7, 0.16, mat.steel, 24);
    ring.position.x = x;
    recoil.add(ring);
  }
  // Glowing bore
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.48, 24), glow(color, 5));
  bore.rotation.y = Math.PI / 2;
  bore.position.x = 1.81;
  recoil.add(bore);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(1.9, 0, 0);
  recoil.add(muzzle);
  return { root: shadowed(root), yaw, pitch, muzzles: [muzzle], band, family: 'mortar', recoil };
};

// ── Authored models (built in Blender by tools/models/build_*.py) ──────────
const templates: Partial<Record<TowerModel['family'], THREE.Group>> = {};

export const loadTowerModels = async () => {
  // ?vulcan=procedural keeps the primitive-built Vulcan for comparison
  if (new URLSearchParams(location.search).get('vulcan') === 'procedural') return;
  const gltf = await new GLTFLoader().loadAsync('/models/vulcan.glb');
  templates.vulcan = gltf.scene;
};

const instantiate = (family: TowerModel['family'], color: string): TowerModel | null => {
  const template = templates[family];
  if (!template) return null;
  const root = template.clone(true);
  const node = (name: string) => {
    const n = root.getObjectByName(name);
    if (!n) throw new Error(`model "${family}" is missing node ${name}`);
    return n as THREE.Group;
  };
  // Each tower pulses its own energy band, so it needs its own copy of the glow material
  let band: THREE.MeshStandardMaterial | null = null;
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const swapped = mats.map(m => {
      if (m.name !== 'Glow') return m;
      band ??= (m as THREE.MeshStandardMaterial).clone();
      return band;
    });
    mesh.material = Array.isArray(mesh.material) ? swapped : swapped[0];
  });
  const pool = new THREE.PointLight(color, 40, 15, 2);
  pool.position.set(0, 6.2, 0);
  root.add(pool);
  const group = new THREE.Group();
  group.add(root);
  return {
    root: group, yaw: node('Yaw'), pitch: node('Pitch'), recoil: node('Recoil'), spin: node('Spin'),
    muzzles: [node('Muzzle')], band: band ?? glow(color, 3), family,
  };
};

export const buildTower = (type: TowerType): TowerModel => {
  const color = TOWER_STATS[type].color;
  const base = TOWER_STATS[type].type;
  if (base === TowerType.SNIPER || type === TowerType.RAILGUN_HYPER || type === TowerType.RAILGUN_PIERCER) return buildRailgun(color);
  if (base === TowerType.SPLASH || type === TowerType.MORTAR_CRYO || type === TowerType.MORTAR_BOMBER) return buildMortar(color);
  return instantiate('vulcan', color) ?? buildVulcan(color);
};
