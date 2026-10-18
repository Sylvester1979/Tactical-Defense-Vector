import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ENEMY_TYPES } from '../constants';
import { makeHullDetail } from './textures';
import { useAuthoredModels } from './towers';

// Enemy models. Local frame: +X is forward (direction of travel), +Y up.

export interface EnemyModel {
  root: THREE.Group;
  hover: number;            // height above the road
  animate: (t: number) => void;
}

const hull = makeHullDetail();
const glow = (color: THREE.ColorRepresentation, intensity: number) =>
  new THREE.MeshStandardMaterial({ color: '#05070a', emissive: color, emissiveIntensity: intensity, roughness: 0.3 });
const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse(c => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
};

// Recon drone: lifting body, two ducted rotors, glowing sensor canopy
const buildScout = (): EnemyModel => {
  const color = ENEMY_TYPES.SCOUT.color;
  const shell = new THREE.MeshStandardMaterial({ color: '#8d97a4', metalness: 0.55, roughness: 0.32, normalMap: hull.normalMap });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1f27', metalness: 0.8, roughness: 0.4 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 16), shell);
  body.scale.set(1.35, 0.45, 0.8);
  root.add(body);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glow(color, 2.2));
  canopy.position.set(0.35, 0.22, 0);
  root.add(canopy);
  const rotors: THREE.Group[] = [];
  for (const z of [-0.95, 0.95]) {
    const duct = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.09, 10, 28), dark);
    duct.rotation.x = Math.PI / 2;
    duct.position.set(-0.1, 0.05, z);
    root.add(duct);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.025, 6, 28), glow(color, 1.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-0.1, 0.12, z);
    root.add(ring);
    const rotor = new THREE.Group();
    rotor.position.set(-0.1, 0.05, z);
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.02, 0.1), dark);
      blade.rotation.y = (k / 3) * Math.PI;
      rotor.add(blade);
    }
    root.add(rotor);
    rotors.push(rotor);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.5), shell);
    strut.position.set(-0.1, 0, z * 0.6);
    root.add(strut);
  }
  const thruster = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), glow(color, 3));
  thruster.rotation.y = -Math.PI / 2;
  thruster.position.x = -1.02;
  root.add(thruster);
  return {
    root: shadowed(root), hover: 3.2,
    animate: t => { rotors.forEach((r, k) => { r.rotation.y = t * 40 * (k ? -1 : 1); }); root.rotation.z = Math.sin(t * 3) * 0.06; },
  };
};

// Bastion: armoured hex hull on tracks with a domed turret and amber running lights
const buildGuardian = (): EnemyModel => {
  const steel = new THREE.MeshStandardMaterial({ color: '#5d6875', metalness: 0.85, roughness: 0.4, normalMap: hull.normalMap, roughnessMap: hull.roughnessMap });
  const plate = new THREE.MeshStandardMaterial({ color: '#7f8a97', metalness: 0.9, roughness: 0.32 });
  const track = new THREE.MeshStandardMaterial({ color: '#111418', metalness: 0.3, roughness: 0.9 });
  const root = new THREE.Group();
  for (const z of [-1.15, 1.15]) {
    const tr = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.8, 0.6, 3, 0.3), track);
    tr.position.set(0, 0.4, z);
    root.add(tr);
    for (let k = 0; k < 4; k++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.64, 14), steel);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(-1.1 + k * 0.73, 0.38, z);
      root.add(wheel);
    }
  }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.6, 1.0, 6), steel);
  body.scale.set(1.15, 1, 0.92);
  body.position.y = 1.15;
  root.add(body);
  const glacis = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.5, 1.9, 2, 0.12), plate);
  glacis.position.set(1.15, 1.0, 0);
  glacis.rotation.z = -0.35;
  root.add(glacis);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.75, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), plate);
  dome.position.set(-0.15, 1.65, 0);
  root.add(dome);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.5, 12), new THREE.MeshStandardMaterial({ color: '#15191f', metalness: 0.9, roughness: 0.3 }));
  gun.rotation.z = -Math.PI / 2;
  gun.position.set(0.85, 1.85, 0);
  root.add(gun);
  const amber = glow('#ffb000', 5);
  for (const z of [-0.55, 0.55]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.32), amber);
    l.position.set(1.62, 1.12, z);
    root.add(l);
  }
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.7), glow('#94a3b8', 3));
  visor.position.set(0.55, 1.88, 0);
  visor.rotation.z = -0.25;
  root.add(visor);
  return { root: shadowed(root), hover: 0, animate: () => {} };
};

// Dreadnought: bevelled wedge hull, stepped superstructure, red bridge and engine glow
const buildColossus = (): EnemyModel => {
  const color = ENEMY_TYPES.COLOSSUS.color;
  const steel = new THREE.MeshStandardMaterial({ color: '#2f3946', metalness: 0.9, roughness: 0.38, normalMap: hull.normalMap, roughnessMap: hull.roughnessMap });
  const deck = new THREE.MeshStandardMaterial({ color: '#1c232c', metalness: 0.8, roughness: 0.5, normalMap: hull.normalMap });
  const root = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(3.6, 0); shape.lineTo(-2.6, -2.4); shape.lineTo(-3.0, -1.4); shape.lineTo(-3.0, 1.4); shape.lineTo(-2.6, 2.4); shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.35, bevelSegments: 3 });
  hullGeo.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(hullGeo, steel);
  body.position.y = 0.6;
  root.add(body);
  const s1 = new THREE.Mesh(new RoundedBoxGeometry(3.2, 0.9, 2.4, 2, 0.2), deck);
  s1.position.set(-0.9, 2.5, 0);
  const s2 = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.8, 1.5, 2, 0.18), steel);
  s2.position.set(-1.2, 3.3, 0);
  root.add(s1, s2);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 1.1), glow(color, 6));
  bridge.position.set(-0.28, 3.35, 0);
  root.add(bridge);
  for (const z of [-0.9, 0, 0.9]) {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.6, 16), deck);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(-3.45, 1.45, z);
    root.add(nozzle);
    const flame = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), glow(color, 7));
    flame.rotation.y = -Math.PI / 2;
    flame.position.set(-3.76, 1.45, z);
    root.add(flame);
  }
  for (const z of [-1.6, 1.6]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.06), glow(color, 3));
    strip.position.set(0.2, 2.12, z * 0.95);
    strip.rotation.y = z > 0 ? -0.36 : 0.36;
    root.add(strip);
  }
  return { root: shadowed(root), hover: 0.4, animate: t => { root.position.y += Math.sin(t * 1.2) * 0.003; } };
};

// ── Authored models (built in Blender by tools/models/build_*.py) ──────────
type EnemyKind = 'SCOUT' | 'GUARDIAN' | 'COLOSSUS';
const templates: Partial<Record<EnemyKind, THREE.Group>> = {};
const HOVER: Record<EnemyKind, number> = { SCOUT: 3.2, GUARDIAN: 0, COLOSSUS: 0.4 };

export const loadEnemyModels = async () => {
  if (!useAuthoredModels()) return;
  const loader = new GLTFLoader();
  const kinds: EnemyKind[] = ['SCOUT', 'GUARDIAN', 'COLOSSUS'];
  const results = await Promise.allSettled(kinds.map(k => loader.loadAsync(`/models/${k.toLowerCase()}.glb`)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') templates[kinds[i]] = r.value.scene;
    else console.warn(`enemy model ${kinds[i]} not loaded, using procedural`, r.reason);
  });
};

const instantiate = (type: EnemyKind): EnemyModel | null => {
  const template = templates[type];
  if (!template) return null;
  // The outer group is steered by the game (position, heading); the inner one bobs and banks
  const body = shadowed(template.clone(true));
  const rotors: THREE.Object3D[] = [];
  body.traverse(o => { if (o.name.startsWith('Rotor_')) rotors.push(o); });
  const root = new THREE.Group();
  root.add(body);
  const phase = Math.random() * Math.PI * 2;
  const animate = type === 'SCOUT'
    ? (t: number) => { rotors.forEach((r, k) => { r.rotation.y = t * 40 * (k % 2 ? -1 : 1); }); body.rotation.x = Math.sin(t * 3 + phase) * 0.06; }
    : type === 'COLOSSUS'
      ? (t: number) => { body.position.y = Math.sin(t * 1.2 + phase) * 0.12; }
      : () => {};
  return { root, hover: HOVER[type], animate };
};

export const buildEnemy = (type: EnemyKind): EnemyModel =>
  instantiate(type) ?? (type === 'SCOUT' ? buildScout() : type === 'GUARDIAN' ? buildGuardian() : buildColossus());
