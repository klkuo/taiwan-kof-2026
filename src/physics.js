import { sound } from './audio.js';

export const ARENA_HALF_W = 7.4;
const GRAVITY = -38;
const JUMP_VEL = 15.2;

export class FighterState {
  constructor(charConfig, slot, startX) {
    this.config = charConfig;
    this.slot = slot; // 0 = P1, 1 = P2
    this.x = startX;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.facing = slot === 0 ? 1 : -1;

    this.maxHp = charConfig.hp;
    this.hp = charConfig.hp;
    this.energy = 50; // 0..100
    this.maxEnergy = 100;

    this.state = 'idle'; // idle | run | jump | punch | kick | special | hit | ko
    this.stateTimer = 0;
    this.hitHasConnected = false;
    this.hitFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.blocking = false;
    this.roundsWon = 0;
  }

  get grounded() {
    return this.y <= 0.001;
  }

  get busy() {
    return ['punch', 'kick', 'special', 'hit', 'ko'].includes(this.state);
  }
}

export class Projectile {
  constructor({ ownerSlot, x, y, vx, radius, damage, color, accent, type, maxLife = 1.6 }) {
    this.ownerSlot = ownerSlot;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.radius = radius;
    this.damage = damage;
    this.color = color;
    this.accent = accent;
    this.type = type; // projectile | beam | wave | pillar
    this.life = maxLife;
    this.maxLife = maxLife;
    this.alive = true;
    this.hitTargets = new Set();
  }
}

export class CombatEngine {
  constructor(p1Config, p2Config) {
    this.fighters = [
      new FighterState(p1Config, 0, -3.2),
      new FighterState(p2Config, 1, 3.2),
    ];
    this.projectiles = [];
    this.events = []; // visual/camera events consumed by renderer
    this.hitstop = 0;
    this.roundTime = 99;
    this.finished = false;
    this.winnerSlot = null; // 0, 1, or 'draw'
  }

  resetRound(preserveWins = true) {
    const wins = this.fighters.map((f) => f.roundsWon);
    this.fighters = [
      new FighterState(this.fighters[0].config, 0, -3.2),
      new FighterState(this.fighters[1].config, 1, 3.2),
    ];
    if (preserveWins) {
      this.fighters[0].roundsWon = wins[0];
      this.fighters[1].roundsWon = wins[1];
    }
    this.projectiles = [];
    this.events = [];
    this.hitstop = 0;
    this.roundTime = 99;
    this.finished = false;
    this.winnerSlot = null;
  }

  step(dt, inputs) {
    this.events.length = 0;

    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }

    if (!this.finished) {
      this.roundTime = Math.max(0, this.roundTime - dt);
      if (this.roundTime <= 0) {
        this._resolveTimeOver();
      }
    }

    for (let i = 0; i < 2; i++) {
      const f = this.fighters[i];
      const opp = this.fighters[1 - i];
      const inp = this.finished ? {} : inputs[i];
      this._updateFighter(f, opp, inp, dt);
    }

    this._resolvePushbox();
    this._checkMeleeHits();
    this._updateProjectiles(dt);
    this._checkKO();
  }

  _updateFighter(f, opp, inp, dt) {
    if (f.hitFlash > 0) f.hitFlash = Math.max(0, f.hitFlash - dt);
    if (f.comboTimer > 0) {
      f.comboTimer -= dt;
      if (f.comboTimer <= 0) f.comboCount = 0;
    }

    // Passive energy gain
    if (f.state !== 'ko') {
      f.energy = Math.min(f.maxEnergy, f.energy + dt * 6.5);
    }

    if (f.state === 'ko') {
      f.vx *= Math.pow(0.05, dt);
      this._applyPhysics(f, dt);
      return;
    }

    // Auto-face opponent when idle/run/jump
    if (!f.busy && Math.abs(opp.x - f.x) > 0.15) {
      f.facing = opp.x >= f.x ? 1 : -1;
    }

    // Handle active states
    if (f.busy) {
      f.stateTimer += dt;

      if (f.state === 'hit') {
        f.vx *= Math.pow(0.02, dt);
        if (f.stateTimer >= 0.34) {
          f.state = f.grounded ? 'idle' : 'jump';
          f.stateTimer = 0;
        }
      } else if (f.state === 'punch') {
        f.vx *= Math.pow(0.01, dt);
        if (f.stateTimer >= 0.28) {
          f.state = f.grounded ? 'idle' : 'jump';
          f.stateTimer = 0;
        }
      } else if (f.state === 'kick') {
        if (f.grounded) f.vx *= Math.pow(0.04, dt);
        if (f.stateTimer >= 0.40) {
          f.state = f.grounded ? 'idle' : 'jump';
          f.stateTimer = 0;
        }
      } else if (f.state === 'special') {
        if (f.config.specialType === 'rush' && f.stateTimer < 0.35) {
          f.vx = f.facing * 14.5;
        } else {
          f.vx *= Math.pow(0.01, dt);
        }
        if (f.stateTimer >= 0.56) {
          f.state = f.grounded ? 'idle' : 'jump';
          f.stateTimer = 0;
        }
      }

      this._applyPhysics(f, dt);
      return;
    }

    // Neutral / movement state
    const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    f.blocking = f.grounded && moveDir !== 0 && moveDir !== f.facing;

    if (inp.special && f.energy >= 35) {
      this._startSpecial(f);
    } else if (inp.kick) {
      f.state = 'kick';
      f.stateTimer = 0;
      f.hitHasConnected = false;
      if (f.grounded) f.vx = f.facing * 3.8;
      sound.whoosh();
    } else if (inp.punch) {
      f.state = 'punch';
      f.stateTimer = 0;
      f.hitHasConnected = false;
      f.vx = f.facing * 1.8;
      sound.whoosh();
    } else {
      if (inp.up && f.grounded) {
        f.vy = JUMP_VEL;
        f.state = 'jump';
      }
      const speedMult = f.blocking ? 0.65 : 1.0;
      f.vx = moveDir * f.config.speed * speedMult;
      if (f.grounded) {
        f.state = Math.abs(moveDir) > 0 ? 'run' : 'idle';
      } else {
        f.state = 'jump';
      }
    }

    this._applyPhysics(f, dt);
  }

  _startSpecial(f) {
    const isMax = f.energy >= 98;
    const cost = isMax ? 100 : 35;
    f.energy = Math.max(0, f.energy - cost);
    f.state = 'special';
    f.stateTimer = 0;
    f.hitHasConnected = false;
    f.vx = 0;
    sound.special();

    const dmgScale = (isMax ? 1.4 : 1.0) * f.config.power;
    const st = f.config.specialType;

    this.events.push({
      type: 'specialCast',
      slot: f.slot,
      x: f.x,
      y: f.y + 1.3,
      color: f.config.color,
      name: f.config.specialName,
      isMax,
    });

    if (st === 'projectile') {
      this.projectiles.push(
        new Projectile({
          ownerSlot: f.slot,
          x: f.x + f.facing * 1.15,
          y: f.y + 1.25,
          vx: f.facing * (isMax ? 13.5 : 10.8),
          radius: isMax ? 0.95 : 0.72,
          damage: Math.round(135 * dmgScale),
          color: f.config.color,
          accent: f.config.accent,
          type: 'projectile',
          maxLife: 1.5,
        })
      );
    } else if (st === 'beam') {
      this.projectiles.push(
        new Projectile({
          ownerSlot: f.slot,
          x: f.x + f.facing * 3.2,
          y: f.y + 1.25,
          vx: f.facing * 2.5,
          radius: isMax ? 2.8 : 2.3,
          damage: Math.round(150 * dmgScale),
          color: f.config.color,
          accent: f.config.accent,
          type: 'beam',
          maxLife: 0.42,
        })
      );
    } else if (st === 'wave') {
      this.projectiles.push(
        new Projectile({
          ownerSlot: f.slot,
          x: f.x + f.facing * 0.9,
          y: f.y + 1.2,
          vx: f.facing * 5.2,
          radius: isMax ? 1.85 : 1.45,
          damage: Math.round(135 * dmgScale),
          color: f.config.color,
          accent: f.config.accent,
          type: 'wave',
          maxLife: 0.55,
        })
      );
    } else if (st === 'pillar') {
      this.projectiles.push(
        new Projectile({
          ownerSlot: f.slot,
          x: f.x + f.facing * 2.6,
          y: 1.3,
          vx: f.facing * 1.4,
          radius: isMax ? 1.6 : 1.25,
          damage: Math.round(155 * dmgScale),
          color: f.config.color,
          accent: f.config.accent,
          type: 'pillar',
          maxLife: 0.5,
        })
      );
    }
  }

  _applyPhysics(f, dt) {
    f.x += f.vx * dt;
    f.vy += GRAVITY * dt;
    f.y += f.vy * dt;

    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
    }

    f.x = Math.max(-ARENA_HALF_W, Math.min(ARENA_HALF_W, f.x));
  }

  _resolvePushbox() {
    const a = this.fighters[0];
    const b = this.fighters[1];
    if (a.state === 'ko' || b.state === 'ko') return;
    if (Math.abs(a.y - b.y) > 1.4) return;

    const minDist = 1.05;
    const dx = b.x - a.x;
    if (Math.abs(dx) < minDist) {
      const push = (minDist - Math.abs(dx)) * 0.5;
      const sign = dx >= 0 ? 1 : -1;
      a.x = Math.max(-ARENA_HALF_W, a.x - sign * push);
      b.x = Math.min(ARENA_HALF_W, b.x + sign * push);
    }
  }

  _checkMeleeHits() {
    for (let i = 0; i < 2; i++) {
      const atk = this.fighters[i];
      const def = this.fighters[1 - i];
      if (atk.hitHasConnected || def.state === 'ko') continue;

      let active = false;
      let range = 1.7;
      let damage = 50;
      let heavy = false;

      if (atk.state === 'punch' && atk.stateTimer >= 0.06 && atk.stateTimer <= 0.18) {
        active = true;
        range = 1.75;
        damage = Math.round(58 * atk.config.power);
      } else if (atk.state === 'kick' && atk.stateTimer >= 0.10 && atk.stateTimer <= 0.28) {
        active = true;
        range = 2.15;
        damage = Math.round(88 * atk.config.power);
        heavy = true;
      } else if (
        atk.state === 'special' &&
        atk.config.specialType === 'rush' &&
        atk.stateTimer >= 0.08 &&
        atk.stateTimer <= 0.40
      ) {
        active = true;
        range = 2.05;
        damage = Math.round(145 * atk.config.power);
        heavy = true;
      }

      if (!active) continue;

      const dx = (def.x - atk.x) * atk.facing;
      const dy = Math.abs(def.y - atk.y);
      if (dx >= -0.35 && dx <= range && dy <= 1.7) {
        atk.hitHasConnected = true;
        this._applyHit(atk, def, damage, heavy, atk.facing);
      }
    }
  }

  _updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.x += p.vx * dt;
      p.life -= dt;
      if (p.life <= 0 || Math.abs(p.x) > ARENA_HALF_W + 2.5) {
        p.alive = false;
        continue;
      }

      const def = this.fighters[1 - p.ownerSlot];
      const atk = this.fighters[p.ownerSlot];
      if (def.state === 'ko' || p.hitTargets.has(def.slot)) continue;

      const hitX = Math.abs(def.x - p.x) <= p.radius + 0.55;
      const hitY = Math.abs(def.y + 1.1 - p.y) <= 1.55;
      if (hitX && hitY) {
        p.hitTargets.add(def.slot);
        if (p.type === 'projectile') p.alive = false;
        const dir = p.vx >= 0 ? 1 : -1;
        this._applyHit(atk, def, p.damage, true, dir);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  _applyHit(atk, def, rawDamage, heavy, dir) {
    const blocked = def.blocking && def.state !== 'hit';
    const damage = blocked ? Math.max(6, Math.round(rawDamage * 0.25)) : rawDamage;

    def.hp = Math.max(0, def.hp - damage);
    def.hitFlash = blocked ? 0.06 : 0.14;
    def.vx = dir * (blocked ? 3.5 : heavy ? 8.2 : 4.8);

    atk.energy = Math.min(atk.maxEnergy, atk.energy + (blocked ? 6 : 14));
    def.energy = Math.min(def.maxEnergy, def.energy + 8);

    if (!blocked) {
      def.state = 'hit';
      def.stateTimer = 0;
      atk.comboCount += 1;
      atk.comboTimer = 1.6;
      sound.hit(heavy);
    } else {
      sound.block();
    }

    this.hitstop = blocked ? 0.03 : heavy ? 0.09 : 0.05;
    this.events.push({
      type: blocked ? 'block' : 'hit',
      x: (atk.x + def.x) * 0.5,
      y: def.y + 1.25,
      color: blocked ? '#93c5fd' : atk.config.accent,
      heavy,
      damage,
      attackerSlot: atk.slot,
      combo: atk.comboCount,
    });
  }

  _checkKO() {
    if (this.finished) return;
    const f0 = this.fighters[0];
    const f1 = this.fighters[1];
    if (f0.hp <= 0 || f1.hp <= 0) {
      this.finished = true;
      sound.ko();
      if (f0.hp <= 0 && f1.hp <= 0) {
        f0.state = 'ko';
        f1.state = 'ko';
        this.winnerSlot = 'draw';
      } else if (f0.hp <= 0) {
        f0.state = 'ko';
        f1.roundsWon += 1;
        this.winnerSlot = 1;
      } else {
        f1.state = 'ko';
        f0.roundsWon += 1;
        this.winnerSlot = 0;
      }
      this.events.push({ type: 'ko', winnerSlot: this.winnerSlot });
    }
  }

  _resolveTimeOver() {
    this.finished = true;
    const p0 = this.fighters[0].hp / this.fighters[0].maxHp;
    const p1 = this.fighters[1].hp / this.fighters[1].maxHp;
    if (Math.abs(p0 - p1) < 0.001) {
      this.winnerSlot = 'draw';
    } else if (p0 > p1) {
      this.fighters[0].roundsWon += 1;
      this.winnerSlot = 0;
    } else {
      this.fighters[1].roundsWon += 1;
      this.winnerSlot = 1;
    }
    this.events.push({ type: 'timeOver', winnerSlot: this.winnerSlot });
  }
}
