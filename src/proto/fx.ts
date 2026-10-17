import * as THREE from 'three';

// Combat effects: tracers, rail beams, lobbed shells, explosions, muzzle flashes.
// Bright parts use HDR colours (>1) so only they pass the bloom threshold. Flashes borrow from a
// fixed pool of point lights — a constant light count avoids shader recompiles mid-fight.

const hdr = (c: THREE.ColorRepresentation, k: number) => new THREE.Color(c).multiplyScalar(k);
const additive = (color: THREE.Color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

interface Flash { light: THREE.PointLight; life: number; max: number; peak: number }
interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }
interface Beam { mesh: THREE.Mesh; life: number }
interface Shell { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; apex: number; color: THREE.Color }
interface Blast { core: THREE.Mesh; ring: THREE.Mesh; life: number }

export const createFx = (scene: THREE.Scene) => {
  const flashes: Flash[] = Array.from({ length: 8 }, () => {
    const light = new THREE.PointLight('#ffffff', 0, 14, 2);
    scene.add(light);
    return { light, life: 0, max: 1, peak: 0 };
  });
  const flash = (pos: THREE.Vector3, color: THREE.ColorRepresentation, peak: number, dur: number) => {
    const f = flashes.reduce((a, b) => (a.life < b.life ? a : b));
    f.light.position.copy(pos);
    f.light.color.set(color);
    f.light.distance = peak > 300 ? 26 : 14;
    f.life = f.max = dur;
    f.peak = peak;
  };

  const tracers: Tracer[] = [], beams: Beam[] = [], shells: Shell[] = [], blasts: Blast[] = [];
  const tracerGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6);
  tracerGeo.rotateZ(Math.PI / 2);
  const shellGeo = new THREE.SphereGeometry(0.28, 14, 10);
  const blastGeo = new THREE.SphereGeometry(1, 20, 14);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);

  const muzzleFlash = (pos: THREE.Vector3, color: string, size: number) => {
    const m = new THREE.Mesh(blastGeo, additive(hdr('#ffffff', 6), 0.9));
    m.position.copy(pos);
    m.scale.setScalar(size);
    scene.add(m);
    blasts.push({ core: m, ring: new THREE.Mesh(), life: 0.06 });
    flash(pos, color, 90, 0.08);
  };

  return {
    tracer(from: THREE.Vector3, to: THREE.Vector3, color: string) {
      const mesh = new THREE.Mesh(tracerGeo, additive(hdr(color, 8)));
      scene.add(mesh);
      tracers.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: from.distanceTo(to) / 70 });
      muzzleFlash(from, color, 0.35);
    },
    beam(from: THREE.Vector3, to: THREE.Vector3, color: string) {
      const len = from.distanceTo(to);
      const geo = new THREE.CylinderGeometry(0.09, 0.09, len, 8, 1, true);
      geo.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, additive(hdr(color, 10)));
      mesh.position.copy(from).lerp(to, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), to.clone().sub(from).normalize());
      scene.add(mesh);
      beams.push({ mesh, life: 0.16 });
      muzzleFlash(from, color, 0.5);
      flash(to, color, 120, 0.15);
    },
    shell(from: THREE.Vector3, to: THREE.Vector3, color: string) {
      const c = new THREE.Color(color);
      const mesh = new THREE.Mesh(shellGeo, additive(hdr(color, 6)));
      mesh.position.copy(from);
      scene.add(mesh);
      shells.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur: 0.9, apex: 6 + from.distanceTo(to) * 0.25, color: c });
      muzzleFlash(from, color, 0.7);
    },
    update(dt: number) {
      flashes.forEach(f => {
        f.life = Math.max(0, f.life - dt);
        f.light.intensity = f.peak * (f.life / f.max) ** 2;
      });
      for (let i = tracers.length - 1; i >= 0; i--) {
        const tr = tracers[i];
        tr.t += dt / tr.dur;
        tr.mesh.position.lerpVectors(tr.from, tr.to, Math.min(1, tr.t));
        tr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tr.to.clone().sub(tr.from).normalize());
        if (tr.t >= 1) { scene.remove(tr.mesh); tracers.splice(i, 1); }
      }
      for (let i = beams.length - 1; i >= 0; i--) {
        const b = beams[i];
        b.life -= dt;
        (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.16);
        b.mesh.scale.set(1, 1 + (1 - b.life / 0.16) * 2, 1 + (1 - b.life / 0.16) * 2);
        if (b.life <= 0) { scene.remove(b.mesh); b.mesh.geometry.dispose(); beams.splice(i, 1); }
      }
      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        s.t += dt / s.dur;
        const f = Math.min(1, s.t);
        s.mesh.position.lerpVectors(s.from, s.to, f);
        s.mesh.position.y += s.apex * 4 * f * (1 - f);
        if (s.t >= 1) {
          scene.remove(s.mesh);
          shells.splice(i, 1);
          const core = new THREE.Mesh(blastGeo, additive(hdr(s.color, 5), 0.9));
          core.position.copy(s.to);
          const ring = new THREE.Mesh(ringGeo, additive(hdr(s.color, 4), 0.8));
          ring.position.copy(s.to).setY(s.to.y + 0.05);
          scene.add(core, ring);
          blasts.push({ core, ring, life: 0.55 });
          flash(s.to.clone().setY(s.to.y + 1.5), s.color, 700, 0.5);
        }
      }
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        const max = b.ring.parent ? 0.55 : 0.06;
        b.life -= dt;
        const k = 1 - Math.max(0, b.life) / max;
        if (b.ring.parent) {
          b.core.scale.setScalar(0.6 + k * 2.6);
          b.ring.scale.setScalar(0.5 + k * 6.5);
          (b.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        }
        (b.core.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
        if (b.life <= 0) { scene.remove(b.core, b.ring); blasts.splice(i, 1); }
      }
    },
  };
};
