import * as THREE from 'three';

/**
 * Procedural 2D Skeletal Rig for sprite-sheet fighters.
 * Drives a subdivided PlaneGeometry with hierarchical Hip -> Spine -> Head bone transforms,
 * squash-and-stretch, anticipation/follow-through, landing impact, and hit-stun whip.
 */
export class FighterRig {
  constructor(mesh) {
    this.mesh = mesh;
    const pos = mesh.geometry.attributes.position;
    this.basePos = new Float32Array(pos.array.length);
    this.basePos.set(pos.array);

    this.wasGrounded = true;
    this.landSquash = 0;
    this.prevState = 'idle';
    this.phase = Math.random() * Math.PI * 2;
  }

  update(f, dt, timeSec) {
    // Detect landing for squash impact
    if (!this.wasGrounded && f.grounded) {
      this.landSquash = 0.22;
    }
    this.wasGrounded = f.grounded;
    this.landSquash = Math.max(0, this.landSquash - dt * 1.4);

    if (f.state !== this.prevState) {
      this.prevState = f.state;
    }

    const t = timeSec + this.phase;

    // Bone parameters
    let squashX = 1.0;
    let squashY = 1.0;
    let hipY = 0.0;
    let spineLean = 0.0; // positive = lean forward (in facing direction)
    let spineStretch = 1.0;
    let headTilt = 0.0;
    let headBobX = 0.0;

    if (f.state === 'idle') {
      const breath = Math.sin(t * 5.2);
      squashY = 1.0 + breath * 0.028;
      squashX = 1.0 - breath * 0.02;
      spineStretch = 1.0 + Math.sin(t * 5.2 - 0.5) * 0.022;
      spineLean = Math.sin(t * 2.6) * 0.025;
      headTilt = Math.sin(t * 5.2 - 1.0) * 0.04;
    } else if (f.state === 'run') {
      const stride = Math.abs(Math.sin(t * 16));
      hipY = stride * 0.14;
      squashY = 0.95 + stride * 0.08;
      squashX = 1.04 - stride * 0.05;
      spineLean = 0.14 + Math.sin(t * 16) * 0.04;
      headTilt = -0.06;
    } else if (f.state === 'jump') {
      if (f.vy > 1.5) {
        squashY = 1.14;
        squashX = 0.89;
        spineLean = 0.08;
      } else if (f.vy < -1.5) {
        squashY = 1.08;
        squashX = 0.93;
        spineLean = -0.06;
      } else {
        squashY = 0.94;
        squashX = 1.06;
      }
    } else if (f.state === 'punch') {
      const p = Math.min(1, f.stateTimer / 0.28);
      if (p < 0.22) {
        // Anticipation wind-up
        squashX = 0.92;
        squashY = 1.05;
        spineLean = -0.10;
      } else if (p < 0.6) {
        // Explosive strike
        squashX = 1.14;
        squashY = 0.93;
        spineLean = 0.18;
        headBobX = 0.08;
      } else {
        // Settle
        squashX = 1.03;
        squashY = 0.98;
        spineLean = 0.06;
      }
    } else if (f.state === 'kick') {
      const p = Math.min(1, f.stateTimer / 0.40);
      if (p < 0.25) {
        squashY = 0.92;
        squashX = 1.06;
        spineLean = -0.12;
      } else if (p < 0.7) {
        squashX = 1.16;
        squashY = 0.94;
        spineLean = 0.14;
        hipY = 0.08;
      } else {
        spineLean = 0.04;
      }
    } else if (f.state === 'special') {
      const pulse = Math.sin(t * 28);
      squashY = 1.08 + pulse * 0.04;
      squashX = 1.06 - pulse * 0.03;
      spineLean = 0.16;
      headTilt = -0.08;
    } else if (f.state === 'hit') {
      const p = Math.min(1, f.stateTimer / 0.34);
      const whip = (1 - p);
      squashX = 0.90;
      squashY = 1.08;
      spineLean = -0.26 * whip;
      headTilt = -0.22 * whip;
      headBobX = Math.sin(t * 45) * 0.06 * whip;
    } else if (f.state === 'ko') {
      squashY = 0.88;
      squashX = 1.12;
      spineLean = -0.22;
    }

    // Apply landing squash on top
    if (this.landSquash > 0) {
      squashY *= 1.0 - this.landSquash;
      squashX *= 1.0 + this.landSquash * 0.75;
    }

    // Deform mesh vertices using normalized height weights (feet = 0, top = 1)
    const pos = this.mesh.geometry.attributes.position;
    const arr = pos.array;
    const base = this.basePos;
    const halfH = 1.35; // PlaneGeometry height is 2.7 (-1.35 .. +1.35)

    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i];
      const by = base[i + 1];
      const bz = base[i + 2];

      // Normalize vertical coordinate from feet (0.0) to head top (1.0)
      const ny = Math.max(0, Math.min(1, (by + halfH) / (halfH * 2)));

      // Smooth bone weights
      const wSpine = Math.max(0, Math.min(1, (ny - 0.15) / 0.55));
      const wHead = Math.max(0, Math.min(1, (ny - 0.62) / 0.30));

      // Anchor feet near bottom (-halfH) while stretching upwards
      const anchoredY = -halfH + (by + halfH) * squashY * (1 + (spineStretch - 1) * wSpine);

      // Apply horizontal squash & skeletal lean
      let nx = bx * squashX;
      nx += spineLean * wSpine * 1.15;
      nx += headTilt * wHead * 0.55 + headBobX * wHead;

      const finalY = anchoredY + hipY * Math.min(1, ny * 2.5);

      arr[i] = nx;
      arr[i + 1] = finalY;
      arr[i + 2] = bz;
    }
    pos.needsUpdate = true;
  }
}
