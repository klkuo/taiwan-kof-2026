import * as THREE from 'three';

const STAGE_PALETTES = {
  li:     { bg: '#061310', floor: '#0a1f18', grid: '#22c55e', grid2: '#14532d', accent: '#4ade80', light1: '#22c55e', light2: '#facc15' },
  tsai:   { bg: '#041214', floor: '#081e22', grid: '#10b981', grid2: '#0f3d3e', accent: '#5eead4', light1: '#10b981', light2: '#38bdf8' },
  hsiao:  { bg: '#07111e', floor: '#0c1b2e', grid: '#14b8a6', grid2: '#164e63', accent: '#99f6e4', light1: '#14b8a6', light2: '#60a5fa' },
  chen:   { bg: '#051220', floor: '#082038', grid: '#38bdf8', grid2: '#0c4a6e', accent: '#4ade80', light1: '#16a34a', light2: '#38bdf8' },
  han:    { bg: '#100c1e', floor: '#1b1530', grid: '#facc15', grid2: '#1e3a8a', accent: '#fde047', light1: '#facc15', light2: '#3b82f6' },
  ho:     { bg: '#070f24', floor: '#0d1b3e', grid: '#3b82f6', grid2: '#1e293b', accent: '#93c5fd', light1: '#2563eb', light2: '#f43f5e' },
  ma:     { bg: '#071926', floor: '#0f2d42', grid: '#7dd3fc', grid2: '#0e7490', accent: '#e0f2fe', light1: '#38bdf8', light2: '#bae6fd' },
  ko:     { bg: '#04131c', floor: '#082230', grid: '#06b6d4', grid2: '#164e63', accent: '#67e8f9', light1: '#06b6d4', light2: '#22d3ee' },
  lu:     { bg: '#1b0816', floor: '#2b0f23', grid: '#ec4899', grid2: '#701a75', accent: '#fbcfe8', light1: '#ec4899', light2: '#f59e0b' },
  san:    { bg: '#07101f', floor: '#0e1d36', grid: '#22d3ee', grid2: '#1e3a8a', accent: '#a5f3fc', light1: '#22d3ee', light2: '#f8fafc' },
  huan:   { bg: '#1a1004', floor: '#291a08', grid: '#f59e0b', grid2: '#78350f', accent: '#fde047', light1: '#f59e0b', light2: '#ef4444' },
  mo:     { bg: '#1a0406', floor: '#2a070b', grid: '#ef4444', grid2: '#7f1d1d', accent: '#fca5a5', light1: '#ef4444', light2: '#facc15' },
};

/**
 * Builds a dedicated 3D WebGL stage for the given character ID.
 * Returns { palette, update(t) } for per-frame stage animations.
 */
export function buildCharacterStage(stageGroup, charId) {
  const pal = STAGE_PALETTES[charId] || STAGE_PALETTES.li;
  const animated = [];

  // Shared floor & neon grid
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 16),
    new THREE.MeshStandardMaterial({ color: pal.floor, roughness: 0.35, metalness: 0.65 })
  );
  floor.rotation.x = -Math.PI / 2;
  stageGroup.add(floor);

  const grid = new THREE.GridHelper(34, 34, pal.grid, pal.grid2);
  grid.position.y = 0.01;
  stageGroup.add(grid);

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(15.6, 0.14),
    new THREE.MeshBasicMaterial({ color: pal.accent })
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.015, 0.9);
  stageGroup.add(strip);

  const darkMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.75, metalness: 0.25 });
  const glowMat = (color, opacity = 0.85) =>
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });

  // Character-specific 3D landmarks
  if (charId === 'li') {
    // Presidential Office Building silhouette + central tower
    const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 3.2, 1.8), new THREE.MeshStandardMaterial({ color: '#7f1d1d', roughness: 0.8 }));
    wing.position.set(0, 1.6, -10.5);
    stageGroup.add(wing);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.6, 2.2), new THREE.MeshStandardMaterial({ color: '#991b1b', roughness: 0.7 }));
    tower.position.set(0, 3.8, -10.2);
    stageGroup.add(tower);

    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 4), glowMat(pal.accent));
    spire.rotation.y = Math.PI / 4;
    spire.position.set(0, 8.8, -10.2);
    stageGroup.add(spire);
  } else if (charId === 'tsai') {
    // Cyber Matrix: rotating holographic rings + data pillars
    for (let i = -4; i <= 4; i += 2) {
      if (i === 0) continue;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8, 8), glowMat(pal.grid, 0.5));
      p.position.set(i * 2.1, 4, -8.5);
      stageGroup.add(p);
    }
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.08, 12, 48), glowMat(pal.accent));
    ring1.position.set(0, 4.2, -9.5);
    stageGroup.add(ring1);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 12, 36), glowMat(pal.grid));
    ring2.position.set(0, 4.2, -9.5);
    stageGroup.add(ring2);
    animated.push((t) => {
      ring1.rotation.z = t * 0.45;
      ring2.rotation.z = -t * 0.7;
      ring2.rotation.y = Math.sin(t * 0.6) * 0.4;
    });
  } else if (charId === 'hsiao') {
    // Washington-Taipei Diplomatic Bridge & Obelisk
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 9.5, 4), glowMat(pal.accent, 0.85));
    obelisk.rotation.y = Math.PI / 4;
    obelisk.position.set(0, 4.75, -10.5);
    stageGroup.add(obelisk);
    for (let i = -6; i <= 6; i += 2) {
      if (i === 0) continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.8 + (Math.abs(i) % 3) * 1.3, 1.2), darkMat);
      b.position.set(i * 1.5, 1.4, -9.5);
      stageGroup.add(b);
    }
  } else if (charId === 'chen') {
    // Kaohsiung 85 Sky Tower + harbor waves
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5.0, 1.4), darkMat);
    leftLeg.position.set(-1.1, 2.5, -11);
    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5.0, 1.4), darkMat);
    rightLeg.position.set(1.1, 2.5, -11);
    const topTower = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5.4, 1.6), new THREE.MeshStandardMaterial({ color: '#0f2942', emissive: '#0ea5e9', emissiveIntensity: 0.25 }));
    topTower.position.set(0, 7.2, -11);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.15, 2.2, 8), glowMat(pal.accent));
    spire.position.set(0, 11.0, -11);
    stageGroup.add(leftLeg, rightLeg, topTower, spire);
  } else if (charId === 'han') {
    // Giant Rotating Golden Ferris Wheel
    const wheel = new THREE.Group();
    wheel.position.set(0, 5.0, -10.5);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.12, 10, 48), glowMat('#facc15'));
    wheel.add(rim);
    for (let k = 0; k < 8; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.06, 0.06), glowMat('#60a5fa', 0.7));
      spoke.rotation.z = (k * Math.PI) / 8;
      wheel.add(spoke);
    }
    stageGroup.add(wheel);
    animated.push((t) => {
      wheel.rotation.z = t * 0.35;
    });
  } else if (charId === 'ho') {
    // New Taipei Christmas-Cone Spire & Steel Towers
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.0, 8.8, 12), new THREE.MeshStandardMaterial({ color: '#1d4ed8', emissive: '#38bdf8', emissiveIntensity: 0.35 }));
    cone.position.set(0, 4.4, -10.5);
    stageGroup.add(cone);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), glowMat('#facc15'));
    star.position.set(0, 9.2, -10.5);
    stageGroup.add(star);
    animated.push((t) => {
      star.rotation.y = t * 1.8;
    });
  } else if (charId === 'ma') {
    // Frost Sanctuary: Rising Ice Crystal Spires
    for (let i = -5; i <= 5; i++) {
      const h = i === 0 ? 7.5 : 3.2 + (Math.abs(i * 3) % 4);
      const crystal = new THREE.Mesh(
        new THREE.ConeGeometry(0.65, h, 5),
        new THREE.MeshStandardMaterial({ color: '#7dd3fc', emissive: '#0284c7', emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.3 })
      );
      crystal.position.set(i * 1.9, h / 2, -9.5 - (Math.abs(i) % 2));
      stageGroup.add(crystal);
    }
  } else if (charId === 'ko') {
    // SOP Hologram Lab: Floating Wireframe Cubes
    for (let i = -3; i <= 3; i++) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 1.4, 1.4),
        new THREE.MeshBasicMaterial({ color: pal.accent, wireframe: true })
      );
      cube.position.set(i * 2.5, 3.2 + (Math.abs(i) % 2) * 1.4, -8.5);
      stageGroup.add(cube);
      animated.push((t) => {
        cube.rotation.x = t * 0.5 + i;
        cube.rotation.y = t * 0.7 + i;
      });
    }
  } else if (charId === 'lu') {
    // Taichung Opera House: Illuminated Pink Curved Arches
    for (let i = -2; i <= 2; i++) {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(2.2 + Math.abs(i) * 0.4, 0.14, 10, 32, Math.PI),
        glowMat(i === 0 ? '#fbcfe8' : '#ec4899', 0.85)
      );
      arch.position.set(i * 2.8, 0.2, -9.5);
      stageGroup.add(arch);
    }
  } else if (charId === 'san') {
    // Taipei Dome Neon Arena
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#22d3ee', wireframe: true, transparent: true, opacity: 0.45 })
    );
    dome.scale.set(1.4, 0.75, 1.0);
    dome.position.set(0, 0, -11.5);
    stageGroup.add(dome);
  } else if (charId === 'huan') {
    // Parliament Thunder Roar Chamber: Columns + Pulsing Golden Pillars
    for (let i = -4; i <= 4; i += 2) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.52, 8.5, 12), darkMat);
      col.position.set(i * 2.0, 4.25, -9.5);
      stageGroup.add(col);
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 8.5, 6), glowMat('#fde047'));
      bolt.position.set(i * 2.0, 4.25, -8.9);
      stageGroup.add(bolt);
      animated.push((t) => {
        bolt.material.opacity = 0.5 + 0.5 * Math.sin(t * 9 + i);
      });
    }
  } else if (charId === 'mo') {
    // Crimson Star Citadel: Giant Glowing Red Star + Fortress Towers
    const starGroup = new THREE.Group();
    starGroup.position.set(0, 5.2, -10.8);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.15, 10, 36), glowMat('#ef4444'));
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), glowMat('#facc15', 0.9));
    starGroup.add(halo, core);
    stageGroup.add(starGroup);
    for (let i = -4; i <= 4; i += 2) {
      if (i === 0) continue;
      const fort = new THREE.Mesh(new THREE.BoxGeometry(1.8, 6.2, 1.8), new THREE.MeshStandardMaterial({ color: '#450a0a', roughness: 0.8 }));
      fort.position.set(i * 2.2, 3.1, -10.2);
      stageGroup.add(fort);
    }
    animated.push((t) => {
      core.rotation.y = t * 1.5;
      core.rotation.z = t * 0.9;
      halo.rotation.z = -t * 0.4;
    });
  }

  return {
    palette: pal,
    update(t) {
      for (const fn of animated) fn(t);
    },
  };
}
