import * as THREE from 'three';
import { buildCharacterStage } from './stages.js';
import { FighterRig } from './rig.js';

/**
 * 2.5D WebGL Arena Renderer powered by Three.js.
 * Renders a stylized Taipei night-skyline 3D stage with 2D billboarded sprite fighters.
 */
export class ArenaRenderer {
  constructor(canvas, spriteManifest) {
    this.canvas = canvas;
    this.manifest = spriteManifest;
    this.textures = new Map();
    this.textureLoader = new THREE.TextureLoader();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#070b18');
    this.scene.fog = new THREE.FogExp2('#070b18', 0.032);

    this.camera = new THREE.PerspectiveCamera(
      42,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 2.3, 10.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.shake = 0;
    this.particles = [];
    this.projMeshes = new Map();
    this.fighterMeshes = [null, null];
    this.fighterRigs = [null, null];
    this.shadowMeshes = [null, null];
    this.afterimages = [];
    this.afterimageTimers = [0, 0];
    this.flashLights = [];
    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);
    this.stageController = null;

    this._initLights();
    this.setupStage('li');
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  _handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _initLights() {
    const ambient = new THREE.AmbientLight('#a5b4fc', 0.85);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight('#ffffff', 1.2);
    keyLight.position.set(0, 12, 8);
    this.scene.add(keyLight);

    const p1Light = new THREE.PointLight('#22d3ee', 2.2, 16);
    p1Light.position.set(-5, 3, 2);
    this.scene.add(p1Light);

    const p2Light = new THREE.PointLight('#f43f5e', 2.2, 16);
    p2Light.position.set(5, 3, 2);
    this.scene.add(p2Light);
    this.flashLights = [p1Light, p2Light];
  }

  setupStage(charId) {
    while (this.stageGroup.children.length > 0) {
      const obj = this.stageGroup.children.pop();
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    }
    this.stageController = buildCharacterStage(this.stageGroup, charId);
    const pal = this.stageController.palette;
    this.scene.background = new THREE.Color(pal.bg);
    this.scene.fog = new THREE.FogExp2(pal.bg, 0.032);
    this.flashLights[0].color.set(pal.light1);
    this.flashLights[1].color.set(pal.light2);
  }

  _getTexture(charId) {
    if (this.textures.has(charId)) return this.textures.get(charId);
    const meta = this.manifest[charId];
    const tex = this.textureLoader.load(meta.sheet);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.repeat.set(1 / meta.frameCount, 1);
    this.textures.set(charId, tex);
    return tex;
  }

  setupFighters(p1Id, p2Id) {
    for (let i = 0; i < 2; i++) {
      if (this.fighterMeshes[i]) this.scene.remove(this.fighterMeshes[i]);
      if (this.shadowMeshes[i]) this.scene.remove(this.shadowMeshes[i]);
    }
    for (const m of this.projMeshes.values()) this.scene.remove(m);
    this.projMeshes.clear();

    [p1Id, p2Id].forEach((charId, slot) => {
      const tex = this._getTexture(charId).clone();
      tex.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
      });
      // Subdivided plane (4x10) for smooth 2D skeletal bone deformation
      const geo = new THREE.PlaneGeometry(3.15, 2.7, 4, 10);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(slot === 0 ? -3.2 : 3.2, 1.35, 0);
      this.scene.add(mesh);
      this.fighterMeshes[slot] = mesh;
      this.fighterRigs[slot] = new FighterRig(mesh);

      const shadowGeo = new THREE.CircleGeometry(0.85, 24);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.48,
      });
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(mesh.position.x, 0.02, 0);
      this.scene.add(shadow);
      this.shadowMeshes[slot] = shadow;
    });
  }

  _resolveFrameName(charId, f) {
    const frames = this.manifest[charId].frames;
    if (f.state === 'ko' || f.state === 'hit') return 'hit';
    if (f.state === 'special') return 'special';
    if (f.state === 'punch') return 'punch';
    if (f.state === 'kick') return 'kick';
    if (f.state === 'jump') return 'kick';
    if (f.state === 'run') {
      if (frames.dash && Math.floor(performance.now() / 130) % 2 === 1) {
        return 'dash';
      }
      return 'run';
    }
    return 'idle';
  }

  _spawnAfterimage(sourceMesh, color, offsetX, facing) {
    const tex = sourceMesh.material.map.clone();
    tex.offset.x = offsetX;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color,
      transparent: true,
      opacity: 0.36,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ghost = new THREE.Mesh(sourceMesh.geometry.clone(), mat);
    ghost.position.copy(sourceMesh.position);
    ghost.position.z -= 0.04;
    ghost.scale.x = facing;
    this.scene.add(ghost);
    this.afterimages.push({ mesh: ghost, life: 0.22, maxLife: 0.22 });
  }

  spawnSparks(x, y, color, count = 14) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.06, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, 0.25);
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 6;
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed + 2,
        vz: (Math.random() - 0.5) * 3,
        life: 0.35 + Math.random() * 0.2,
        maxLife: 0.55,
      });
    }
  }

  render(engine, dt) {
    if (this.stageController) {
      this.stageController.update(performance.now() * 0.001);
    }
    // Consume combat events for sparks & camera shake
    for (const ev of engine.events) {
      if (ev.type === 'hit') {
        this.spawnSparks(ev.x, ev.y, ev.color, ev.heavy ? 20 : 12);
        this.shake = Math.max(this.shake, ev.heavy ? 0.26 : 0.12);
      } else if (ev.type === 'block') {
        this.spawnSparks(ev.x, ev.y, '#93c5fd', 8);
        this.shake = Math.max(this.shake, 0.06);
      } else if (ev.type === 'specialCast') {
        this.shake = Math.max(this.shake, 0.2);
        this.flashLights[ev.slot].color.set(ev.color);
        this.flashLights[ev.slot].intensity = 6;
      } else if (ev.type === 'ko') {
        this.shake = 0.45;
      }
    }

    // Decay flash lights
    for (const l of this.flashLights) {
      l.intensity += (2.2 - l.intensity) * Math.min(1, dt * 6);
    }

    // Update fighters & 2D skeletal rigs
    const nowSec = performance.now() * 0.001;
    engine.fighters.forEach((f, slot) => {
      const mesh = this.fighterMeshes[slot];
      const rig = this.fighterRigs[slot];
      const shadow = this.shadowMeshes[slot];
      if (!mesh || !shadow) return;

      const meta = this.manifest[f.config.id];
      const frameName = this._resolveFrameName(f.config.id, f);
      const frame = meta.frames[frameName] || meta.frames.idle;

      mesh.material.map.offset.x = frame.index / meta.frameCount;
      mesh.scale.x = f.facing;

      if (rig) {
        rig.update(f, dt, nowSec);
      }

      const koTilt = f.state === 'ko' ? -f.facing * 0.55 : 0;
      mesh.rotation.z = koTilt;
      mesh.position.set(f.x, f.y + 1.32 - (f.state === 'ko' ? 0.45 : 0), slot * 0.02);

      // Spawn tinted ghost afterimage during fast/special moves
      this.afterimageTimers[slot] -= dt;
      if ((f.state === 'special' || f.state === 'kick' || f.state === 'run') && this.afterimageTimers[slot] <= 0) {
        this.afterimageTimers[slot] = f.state === 'special' ? 0.055 : 0.095;
        this._spawnAfterimage(mesh, f.config.color, frame.index / meta.frameCount, f.facing);
      }

      // Hit flash white/red tint
      if (f.hitFlash > 0) {
        mesh.material.color.set('#ff9999');
      } else if (f.blocking) {
        mesh.material.color.set('#93c5fd');
      } else {
        mesh.material.color.set('#ffffff');
      }

      // Shadow scales down when airborne
      const shadowScale = Math.max(0.4, 1 - f.y * 0.14);
      shadow.position.x = f.x;
      shadow.scale.set(shadowScale, shadowScale, 1);
    });

    // Update ghost afterimages
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const ag = this.afterimages[i];
      ag.life -= dt;
      if (ag.life <= 0) {
        this.scene.remove(ag.mesh);
        ag.mesh.geometry.dispose();
        ag.mesh.material.dispose();
        this.afterimages.splice(i, 1);
      } else {
        ag.mesh.material.opacity = (ag.life / ag.maxLife) * 0.36;
      }
    }

    // Update projectiles
    const activeSet = new Set(engine.projectiles);
    for (const [p, m] of this.projMeshes.entries()) {
      if (!activeSet.has(p)) {
        this.scene.remove(m);
        this.projMeshes.delete(p);
      }
    }
    for (const p of engine.projectiles) {
      let group = this.projMeshes.get(p);
      if (!group) {
        group = new THREE.Group();
        const coreGeo =
          p.type === 'beam'
            ? new THREE.BoxGeometry(p.radius * 2.1, 0.55, 0.4)
            : p.type === 'pillar'
            ? new THREE.ConeGeometry(p.radius * 0.6, 3.2, 8)
            : new THREE.SphereGeometry(p.radius * 0.55, 14, 14);
        const coreMat = new THREE.MeshBasicMaterial({
          color: p.accent,
          transparent: true,
          opacity: 0.9,
        });
        const outerMat = new THREE.MeshBasicMaterial({
          color: p.color,
          transparent: true,
          opacity: 0.42,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        const outer = new THREE.Mesh(coreGeo, outerMat);
        outer.scale.set(1.35, 1.35, 1.35);
        group.add(core);
        group.add(outer);
        this.scene.add(group);
        this.projMeshes.set(p, group);
      }
      group.position.set(p.x, p.y, 0.18);
      if (p.type === 'projectile') group.rotation.z += dt * 10;
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      pt.vy -= 14 * dt;
      pt.mesh.position.x += pt.vx * dt;
      pt.mesh.position.y += pt.vy * dt;
      pt.mesh.position.z += pt.vz * dt;
      pt.mesh.material.opacity = pt.life / pt.maxLife;
    }

    // Dynamic fighting camera
    const f0 = engine.fighters[0];
    const f1 = engine.fighters[1];
    const midX = (f0.x + f1.x) * 0.5;
    const dist = Math.abs(f0.x - f1.x);
    const targetZ = Math.max(8.4, Math.min(13.2, 7.6 + dist * 0.52));
    const targetX = midX * 0.55;

    this.camera.position.x += (targetX - this.camera.position.x) * Math.min(1, dt * 8);
    this.camera.position.z += (targetZ - this.camera.position.z) * Math.min(1, dt * 6);

    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    this.camera.position.y = 2.25 + sy;
    this.camera.lookAt(this.camera.position.x + sx, 1.45 + sy, 0);

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
