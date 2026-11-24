/**
 * Reactive fighting game AI controller.
 */
export class FighterAI {
  constructor(difficulty = 0.65) {
    this.difficulty = difficulty; // 0.3 (easy) .. 1.0 (boss)
    this.decisionTimer = 0;
    this.currentAction = 'approach';
  }

  getInput(self, opp, projectiles, dt) {
    const inp = {
      left: false,
      right: false,
      up: false,
      punch: false,
      kick: false,
      special: false,
    };

    if (self.state === 'ko' || opp.state === 'ko') return inp;

    const dx = opp.x - self.x;
    const dist = Math.abs(dx);
    const towardLeft = dx < 0;

    // Check incoming projectile threat
    const incoming = projectiles.find(
      (p) =>
        p.ownerSlot !== self.slot &&
        Math.abs(p.x - self.x) < 3.6 &&
        Math.sign(p.vx) === Math.sign(self.x - p.x)
    );

    if (incoming && self.grounded && Math.random() < 0.08 * this.difficulty) {
      inp.up = true; // jump over projectile
      return inp;
    }

    // Reactive block when opponent attacks nearby
    if (
      (opp.state === 'punch' || opp.state === 'kick' || opp.state === 'special') &&
      dist < 2.6 &&
      Math.random() < this.difficulty * 0.55
    ) {
      if (towardLeft) inp.right = true;
      else inp.left = true;
      return inp;
    }

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.14 + Math.random() * (0.28 - this.difficulty * 0.14);
      const r = Math.random();

      if (dist > 3.6) {
        if (self.energy >= 35 && r < 0.35 * this.difficulty) {
          this.currentAction = 'special';
        } else {
          this.currentAction = r < 0.82 ? 'approach' : 'idle';
        }
      } else if (dist > 2.0) {
        if (self.energy >= 40 && r < 0.28 * this.difficulty) {
          this.currentAction = 'special';
        } else if (r < 0.45) {
          this.currentAction = 'kick';
        } else if (r < 0.78) {
          this.currentAction = 'approach';
        } else {
          this.currentAction = 'retreat';
        }
      } else {
        // Close range
        if (r < 0.38) this.currentAction = 'punch';
        else if (r < 0.68) this.currentAction = 'kick';
        else if (self.energy >= 35 && r < 0.85) this.currentAction = 'special';
        else this.currentAction = 'retreat';
      }
    }

    switch (this.currentAction) {
      case 'approach':
        if (towardLeft) inp.left = true;
        else inp.right = true;
        break;
      case 'retreat':
        if (towardLeft) inp.right = true;
        else inp.left = true;
        break;
      case 'punch':
        inp.punch = true;
        this.currentAction = 'idle';
        break;
      case 'kick':
        inp.kick = true;
        this.currentAction = 'idle';
        break;
      case 'special':
        inp.special = true;
        this.currentAction = 'idle';
        break;
      default:
        break;
    }

    return inp;
  }
}
