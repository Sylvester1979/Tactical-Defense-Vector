import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PATH } from '../constants';
import { toWorld, FIELD_W, FIELD_D, ROAD_H, ROAD_W } from './coords';
import { makeDeckPlating, makeRoadSurface, makeHullDetail } from './textures';

// Static set: platform, road, entry gate, core reactor, rim pylons and the void below.
// Returns an `update` that animates the few moving parts (road flow, gate field, reactor, beacons).

const RIM = 4;            // non-buildable margin around the field
const DECK_DEPTH = 6;     // platform thickness

const emissive = (color: THREE.ColorRepresentation, intensity: number) =>
  new THREE.MeshStandardMaterial({ color: '#000', emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });

const glowBasic = (color: THREE.ColorRepresentation, hdr: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(hdr), transparent: opacity < 1, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

export const buildWorld = (scene: THREE.Scene) => {
  const hull = makeHullDetail();
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#232a33', metalness: 0.85, roughness: 0.5, normalMap: hull.normalMap, roughnessMap: hull.roughnessMap });
  const trim = new THREE.MeshStandardMaterial({ color: '#56606d', metalness: 0.9, roughness: 0.32 });

  // ── Platform ──
  const W = FIELD_W + RIM * 2, D = FIELD_D + RIM * 2;
  const deck = makeDeckPlating(1);
  for (const t of [deck.map, deck.normalMap, deck.roughnessMap]) t.repeat.set(W / 26, D / 26);
  const deckMat = new THREE.MeshStandardMaterial({ ...deck, color: '#5d6672', metalness: 0.5, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), deckMat);
  top.rotation.x = -Math.PI / 2;
  top.receiveShadow = true;
  scene.add(top);

  const body = new THREE.Mesh(new THREE.BoxGeometry(W, DECK_DEPTH, D), darkSteel);
  body.position.y = -DECK_DEPTH / 2 - 0.01;
  body.receiveShadow = true;
  scene.add(body);

  // Bevelled steel lip around the deck edge
  const lipMat = trim;
  for (const [w, d, x, z] of [[W, 0.6, 0, D / 2], [W, 0.6, 0, -D / 2], [0.6, D, W / 2, 0], [0.6, D, -W / 2, 0]] as const) {
    const lip = new THREE.Mesh(new RoundedBoxGeometry(w + 0.6, 0.5, d, 2, 0.12), lipMat);
    lip.position.set(x, 0.1, z);
    lip.castShadow = lip.receiveShadow = true;
    scene.add(lip);
  }
  // Light strips along the two walls facing the camera
  const stripCyan = emissive('#00e5ff', 2.2), stripAmber = emissive('#ffb000', 2.2);
  for (let i = 0; i < 26; i++) {
    const f = (i + 0.5) / 26;
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.05), i % 6 === 0 ? stripAmber : stripCyan);
    a.position.set(-W / 2 + f * W, -DECK_DEPTH * 0.45, D / 2 + 0.03);
    scene.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 1.4), i % 6 === 3 ? stripAmber : stripCyan);
    b.position.set(W / 2 + 0.03, -DECK_DEPTH * 0.45, -D / 2 + f * D);
    scene.add(b);
  }

  // ── Road ──
  const road = makeRoadSurface();
  const roadSide = new THREE.MeshStandardMaterial({ color: '#141920', metalness: 0.8, roughness: 0.55, normalMap: hull.normalMap });
  const flowMaps: THREE.Texture[] = [];
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = toWorld(PATH[i].x, PATH[i].y), b = toWorld(PATH[i + 1].x, PATH[i + 1].y);
    const len = a.distanceTo(b);
    const maps = { map: road.map.clone(), normalMap: road.normalMap.clone(), roughnessMap: road.roughnessMap.clone(), emissiveMap: road.emissiveMap.clone() };
    for (const t of Object.values(maps)) { t.repeat.set(1, len / ROAD_W); t.needsUpdate = true; }
    flowMaps.push(maps.emissiveMap);
    const topMat = new THREE.MeshStandardMaterial({ ...maps, emissive: '#ffffff', emissiveIntensity: 1.6, metalness: 0.55, roughness: 1 });
    // Box: X = width, Z = length, so the texture's v axis runs along the road
    const seg = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W, ROAD_H, len), [roadSide, roadSide, topMat, roadSide, roadSide, roadSide]);
    seg.position.copy(a.clone().add(b).multiplyScalar(0.5)).setY(ROAD_H / 2);
    seg.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    seg.castShadow = seg.receiveShadow = true;
    scene.add(seg);
  }
  const jointTop = new THREE.MeshStandardMaterial({ color: '#1d232b', metalness: 0.6, roughness: 0.7, normalMap: hull.normalMap });
  PATH.forEach(p => {
    const j = new THREE.Mesh(new THREE.CylinderGeometry(ROAD_W / 2, ROAD_W / 2, ROAD_H, 40), [roadSide, jointTop, jointTop]);
    j.position.copy(toWorld(p.x, p.y)).setY(ROAD_H / 2 - 0.005);
    j.castShadow = j.receiveShadow = true;
    scene.add(j);
  });

  // ── Entry gate ──
  const gateAt = toWorld(PATH[0].x, PATH[0].y);
  const gate = new THREE.Group();
  gate.position.copy(gateAt);
  const pillarGeo = new RoundedBoxGeometry(1.4, 6.2, 1.4, 2, 0.18);
  for (const z of [-4.2, 4.2]) {
    const p = new THREE.Mesh(pillarGeo, darkSteel);
    p.position.set(0, 3.1, z);
    p.castShadow = p.receiveShadow = true;
    gate.add(p);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.6, 0.3), emissive('#00e5ff', 1.8));
    light.position.set(0.72, 3.2, z);
    gate.add(light);
  }
  const lintel = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.9, 10.2, 2, 0.2), darkSteel);
  lintel.position.set(0, 6.5, 0);
  lintel.castShadow = true;
  gate.add(lintel);
  const lintelLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 8.6), emissive('#00e5ff', 2.2));
  lintelLight.position.set(0.92, 6.5, 0);
  gate.add(lintelLight);
  const fieldMat = glowBasic('#00d8ff', 0.9, 0.18);
  fieldMat.side = THREE.DoubleSide;
  const field = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 4.6), fieldMat);
  field.rotation.y = Math.PI / 2;
  field.position.set(0, ROAD_H + 2.3, 0);
  gate.add(field);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.12), glowBasic('#00f2ff', 3, 0.9));
  scan.rotation.y = Math.PI / 2;
  gate.add(scan);
  const gateLight = new THREE.PointLight('#00d8ff', 60, 22, 2);
  gateLight.position.set(1.5, 4, 0);
  gate.add(gateLight);
  scene.add(gate);

  // ── Core reactor ──
  const coreAt = toWorld(PATH[PATH.length - 1].x, PATH[PATH.length - 1].y);
  const core = new THREE.Group();
  core.position.copy(coreAt);
  const tier1 = new THREE.Mesh(new RoundedBoxGeometry(7, 1.2, 7, 2, 0.25), darkSteel);
  tier1.position.y = ROAD_H + 0.6;
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.2, 8), trim);
  tier2.position.y = ROAD_H + 1.8;
  for (const m of [tier1, tier2]) { m.castShadow = m.receiveShadow = true; core.add(m); }
  const coreColumnMat = new THREE.MeshStandardMaterial({ color: '#001015', emissive: '#00e5ff', emissiveIntensity: 3.5, roughness: 0.2, transparent: true, opacity: 0.92 });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5.5, 32), coreColumnMat);
  column.position.y = ROAD_H + 2.4 + 2.75;
  core.add(column);
  const cageMat = trim;
  for (let k = 0; k < 4; k++) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), cageMat);
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    rod.position.set(Math.cos(a) * 1.7, ROAD_H + 2.4 + 3, Math.sin(a) * 1.7);
    rod.castShadow = true;
    core.add(rod);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.9, 0.6, 8), trim);
  cap.position.y = ROAD_H + 2.4 + 6.1;
  cap.castShadow = true;
  core.add(cap);
  const ringMat = emissive('#00e5ff', 2.5);
  const coreRings = [0, 1].map(() => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.08, 10, 48), ringMat);
    r.rotation.x = Math.PI / 2;
    core.add(r);
    return r;
  });
  const coreLight = new THREE.PointLight('#00e5ff', 160, 30, 2);
  coreLight.position.y = ROAD_H + 5;
  core.add(coreLight);
  scene.add(core);

  // ── Rim pylons with beacons ──
  const beaconMats: THREE.MeshStandardMaterial[] = [];
  ([[FIELD_W / 2 + 2, -2, 9], [FIELD_W / 2 + 2, FIELD_D / 2 - 10, 11], [-6, FIELD_D / 2 + 2, 8], [-FIELD_W / 2 - 2, -FIELD_D / 2 - 2, 7.5]] as const)
    .forEach(([x, z, h], i) => {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const base = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.6, 1.8, 2, 0.15), darkSteel);
      base.position.y = 0.3;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, h, 8), trim);
      mast.position.y = h / 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.18), trim);
      arm.position.y = h * 0.7;
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), darkSteel);
      dish.position.set(0.9, h * 0.82, 0);
      dish.rotation.z = -Math.PI / 2.5;
      for (const m of [base, mast, arm, dish]) { m.castShadow = true; g.add(m); }
      const beaconMat = emissive(i % 2 ? '#ff3b3b' : '#ffb000', 6);
      beaconMats.push(beaconMat);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), beaconMat);
      beacon.position.y = h + 0.2;
      g.add(beacon);
      scene.add(g);
    });

  // ── The void: distant platforms and lights far below ──
  const voidMat = new THREE.MeshStandardMaterial({ color: '#0b1018', metalness: 0.7, roughness: 0.8 });
  const voidLights = emissive('#3fd0ff', 2.5), voidWarm = emissive('#ffb000', 2.5);
  ([[-120, -90, -90, 30, 20], [125, -100, 30, 26, 34], [-80, -110, 115, 40, 22], [80, -95, -115, 22, 22]] as const)
    .forEach(([x, y, z, w, d]) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d), voidMat);
      p.position.set(x, y, z);
      scene.add(p);
      for (let k = 0; k < 8; k++) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), k % 3 ? voidLights : voidWarm);
        l.position.set(x + (Math.sin(k * 12.9) * 0.45) * w, y + 1.6, z + (Math.cos(k * 7.3) * 0.45) * d);
        scene.add(l);
      }
    });

  // Core integrity tints the reactor: cyan when healthy, through amber, to red; it flickers when critical
  const healthy = new THREE.Color('#00e5ff'), warning = new THREE.Color('#ffb000'), critical = new THREE.Color('#ff2a2a');
  const coreColor = new THREE.Color();
  let integrity = 1;

  let t = 0;
  return {
    setIntegrity(value: number) {
      integrity = Math.max(0, Math.min(1, value));
      if (integrity > 0.5) coreColor.copy(warning).lerp(healthy, (integrity - 0.5) / 0.5);
      else coreColor.copy(critical).lerp(warning, integrity / 0.5);
      coreColumnMat.emissive.copy(coreColor);
      ringMat.emissive.copy(coreColor);
      coreLight.color.copy(coreColor);
    },
    update(dt: number) {
      t += dt;
      // Energy flowing along the road towards the core
      flowMaps.forEach(m => { m.offset.y = -t * 0.35; });
      // Gate: field shimmer + a scan line sweeping up
      fieldMat.opacity = 0.14 + Math.sin(t * 3.1) * 0.04;
      const s = (t * 0.7) % 1;
      scan.position.set(0, ROAD_H + 0.1 + s * 4.5, 0);
      (scan.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - s);
      // Reactor: breathing column, rings riding up and down
      const flicker = integrity < 0.3 && Math.sin(t * 23) * Math.sin(t * 7.3) > 0.55 ? 0.35 : 1;
      coreColumnMat.emissiveIntensity = (1.05 + Math.sin(t * 2.2) * 0.25) * flicker;
      coreRings.forEach((r, k) => { r.position.y = ROAD_H + 3 + ((Math.sin(t * 1.4 + k * Math.PI) + 1) / 2) * 4.6; });
      coreLight.intensity = (90 + Math.sin(t * 2.2) * 20) * flicker;
      // Beacons blink out of phase
      beaconMats.forEach((m, k) => { m.emissiveIntensity = ((t + k * 0.37) % 1.6) < 0.25 ? 8 : 0.4; });
    },
  };
};
