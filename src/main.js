import { ROSTER, ROSTER_BY_ID } from './roster.js';
import { sound } from './audio.js';
import { CombatEngine } from './physics.js';
import { FighterAI } from './ai.js';
import { ArenaRenderer } from './renderer.js';

const el = (id) => document.getElementById(id);

const titleScreen = el('title-screen');
const selectScreen = el('select-screen');
const hud = el('hud');
const resultModal = el('result-modal');

const rosterGrid = el('roster-grid');
const selectPrompt = el('select-prompt');
const arcadeBadge = el('arcade-badge');
const btnFight = el('btn-fight');

const announcer = el('announcer');
const specialBanner = el('special-banner');
const comboBadges = [el('combo-p1'), el('combo-p2')];

let manifest = null;
let renderer = null;
let engine = null;
let ai = null;

let mode = 'arcade'; // arcade | vscpu | pvp
let pickTurn = 1; // 1 or 2
let p1Pick = null;
let p2Pick = null;

let arcadeLadder = [];
let arcadeStage = 0;
let roundNum = 1;
let matchPhase = 'idle'; // intro | fighting | roundOver | matchOver
let phaseTimer = 0;
let bannerTimer = 0;

// Keyboard state
const keysDown = new Set();
const keysJustPressed = new Set();

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  if (!keysDown.has(e.code)) {
    keysJustPressed.add(e.code);
  }
  keysDown.add(e.code);
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

function consumePress(codes) {
  for (const c of codes) {
    if (keysJustPressed.has(c)) {
      keysJustPressed.delete(c);
      return true;
    }
  }
  return false;
}

function getP1Input() {
  return {
    left: keysDown.has('KeyA'),
    right: keysDown.has('KeyD'),
    up: keysDown.has('KeyW'),
    punch: consumePress(['KeyJ']),
    kick: consumePress(['KeyK']),
    special: consumePress(['KeyL', 'KeyU']),
  };
}

function getP2Input() {
  return {
    left: keysDown.has('ArrowLeft'),
    right: keysDown.has('ArrowRight'),
    up: keysDown.has('ArrowUp'),
    punch: consumePress(['Numpad1', 'Digit1', 'KeyI']),
    kick: consumePress(['Numpad2', 'Digit2', 'KeyO']),
    special: consumePress(['Numpad3', 'Digit3', 'KeyP']),
  };
}

function showScreen(target) {
  [titleScreen, selectScreen, resultModal].forEach((s) => s.classList.remove('active'));
  if (target) target.classList.add('active');
}

function updatePreview(slot, char) {
  const prefix = slot === 1 ? 'p1' : 'p2';
  const img = el(`${prefix}-preview-img`);
  if (!char) {
    img.removeAttribute('src');
    img.style.visibility = 'hidden';
    el(`${prefix}-preview-name`).textContent = '尚未選擇';
    el(`${prefix}-preview-title`).textContent = '-';
    el(`${prefix}-preview-special`).textContent = '-';
    return;
  }
  img.src = manifest[char.id].portrait;
  img.style.visibility = 'visible';
  el(`${prefix}-preview-name`).textContent = char.name;
  el(`${prefix}-preview-title`).textContent = char.title;
  el(`${prefix}-preview-special`).textContent = `必殺技：${char.specialName}`;
}

function renderRosterGrid() {
  rosterGrid.innerHTML = '';
  for (const char of ROSTER) {
    const locked = mode === 'arcade' && char.isBoss;
    const card = document.createElement('div');
    card.className = 'char-card';
    if (locked) card.classList.add('locked');
    if (p1Pick?.id === char.id) card.classList.add('selected-p1');
    if (p2Pick?.id === char.id) card.classList.add('selected-p2');

    card.innerHTML = `
      <img src="${manifest[char.id].portrait}" alt="${char.name}" />
      <div class="c-name">${char.name}</div>
    `;

    if (!locked) {
      card.addEventListener('click', () => handleCharClick(char));
    }
    rosterGrid.appendChild(card);
  }
}

function handleCharClick(char) {
  sound.select();
  if (mode === 'arcade') {
    p1Pick = char;
    const pool = ROSTER.filter((c) => !c.isBoss && c.id !== char.id).sort(
      () => Math.random() - 0.5
    );
    arcadeLadder = [...pool.slice(0, 3), ROSTER_BY_ID.mo];
    arcadeStage = 0;
    p2Pick = arcadeLadder[0];
    btnFight.disabled = false;
  } else {
    if (pickTurn === 1) {
      p1Pick = char;
      pickTurn = 2;
      selectPrompt.textContent =
        mode === 'pvp' ? 'SELECT P2 FIGHTER' : 'SELECT CPU OPPONENT';
    } else {
      p2Pick = char;
      pickTurn = 1;
      selectPrompt.textContent = 'READY! CLICK FIGHT OR RE-PICK P1';
      btnFight.disabled = false;
    }
  }
  updatePreview(1, p1Pick);
  updatePreview(2, p2Pick);
  renderRosterGrid();
}

function openSelect(selectedMode) {
  sound.confirm();
  mode = selectedMode;
  pickTurn = 1;
  p1Pick = null;
  p2Pick = null;
  btnFight.disabled = true;
  arcadeBadge.textContent =
    mode === 'arcade' ? 'ARCADE LADDER' : mode === 'vscpu' ? 'VS CPU' : '2P VERSUS';
  selectPrompt.textContent = 'SELECT YOUR FIGHTER (P1)';
  updatePreview(1, null);
  updatePreview(2, null);
  renderRosterGrid();
  showScreen(selectScreen);
}

function showAnnouncer(text) {
  announcer.textContent = text;
  announcer.classList.remove('hidden');
}

function hideAnnouncer() {
  announcer.classList.add('hidden');
}

function updateWinStars() {
  [0, 1].forEach((slot) => {
    const container = el(`hud-p${slot + 1}-wins`);
    const wins = engine.fighters[slot].roundsWon;
    container.innerHTML = [0, 1]
      .map((i) => `<span class="win-star ${i < wins ? 'won' : ''}"></span>`)
      .join('');
  });
}

function startMatch() {
  sound.confirm();
  showScreen(null);
  hud.classList.remove('hidden');

  roundNum = 1;
  engine = new CombatEngine(p1Pick, p2Pick);
  renderer.setupStage(p2Pick.id);
  renderer.setupFighters(p1Pick.id, p2Pick.id);
  sound.playBGM(p2Pick.id);

  if (mode === 'pvp') {
    ai = null;
  } else {
    const diff =
      mode === 'arcade' ? Math.min(0.95, 0.55 + arcadeStage * 0.13) : 0.72;
    ai = new FighterAI(diff);
  }

  el('hud-p1-portrait').src = manifest[p1Pick.id].portrait;
  el('hud-p2-portrait').src = manifest[p2Pick.id].portrait;
  el('hud-p1-name').textContent = p1Pick.name;
  el('hud-p2-name').textContent =
    mode === 'arcade' && arcadeStage === 3 ? `BOSS ${p2Pick.name}` : p2Pick.name;
  el('hud-stage-info').textContent = `🏟️ ${p2Pick.stageName}  ♪ ${p2Pick.bgmName}`;

  startRound();
}

function startRound() {
  engine.resetRound(true);
  updateWinStars();
  el('hud-round').textContent =
    mode === 'arcade' ? `STAGE ${arcadeStage + 1}/4 • ROUND ${roundNum}` : `ROUND ${roundNum}`;
  matchPhase = 'intro';
  phaseTimer = 1.35;
  showAnnouncer(`ROUND ${roundNum}`);
  sound.roundStart();
}

function updateHUD() {
  if (!engine) return;
  engine.fighters.forEach((f, slot) => {
    const p = slot + 1;
    const hpPct = Math.max(0, (f.hp / f.maxHp) * 100);
    el(`hud-p${p}-hp`).style.width = `${hpPct}%`;
    el(`hud-p${p}-hp-trail`).style.width = `${hpPct}%`;

    const enPct = Math.round(f.energy);
    el(`hud-p${p}-energy`).style.width = `${enPct}%`;
    el(`hud-p${p}-energy-txt`).textContent = `${enPct}%`;

    if (f.comboCount >= 2) {
      comboBadges[slot].textContent = `${f.comboCount} HITS!`;
      comboBadges[slot].classList.remove('hidden');
    } else {
      comboBadges[slot].classList.add('hidden');
    }
  });

  el('hud-timer').textContent = String(Math.ceil(engine.roundTime)).padStart(2, '0');
}

function showResultModal() {
  const f0 = engine.fighters[0];
  const f1 = engine.fighters[1];
  const p1Won = f0.roundsWon > f1.roundsWon;
  const winner = p1Won ? f0.config : f1.config;

  const btnNext = el('btn-next-match');
  if (mode === 'arcade' && p1Won && arcadeStage < arcadeLadder.length - 1) {
    el('result-tag').textContent = `STAGE ${arcadeStage + 1} CLEAR!`;
    el('result-title').textContent = `${winner.name} 勝出！`;
    btnNext.classList.remove('hidden');
    btnNext.textContent =
      arcadeStage + 1 === 3 ? '挑戰終極魔王！' : '下一關挑戰 →';
  } else if (mode === 'arcade' && p1Won && arcadeStage === arcadeLadder.length - 1) {
    el('result-tag').textContent = 'GRAND CHAMPION!';
    el('result-title').textContent = `${winner.name} 稱霸台灣！`;
    btnNext.classList.add('hidden');
  } else {
    el('result-tag').textContent = 'MATCH OVER';
    el('result-title').textContent = `${winner.name} WINS!`;
    btnNext.classList.add('hidden');
  }

  el('result-quote').textContent = `「${winner.quote}」`;
  showScreen(resultModal);
}

// Event bindings
document.querySelectorAll('.btn-mode').forEach((btn) => {
  btn.addEventListener('click', () => openSelect(btn.dataset.mode));
});

el('btn-back-title').addEventListener('click', () => {
  sound.select();
  showScreen(titleScreen);
});

btnFight.addEventListener('click', startMatch);

el('btn-mute').addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  el('btn-mute').textContent = sound.muted ? '🔇 靜音' : '🔊 音效';
});

el('btn-quit').addEventListener('click', () => {
  sound.stopBGM();
  hud.classList.add('hidden');
  engine = null;
  showScreen(selectScreen);
});

el('btn-rematch').addEventListener('click', startMatch);

el('btn-to-select').addEventListener('click', () => {
  sound.stopBGM();
  hud.classList.add('hidden');
  engine = null;
  showScreen(selectScreen);
});

el('btn-next-match').addEventListener('click', () => {
  arcadeStage += 1;
  p2Pick = arcadeLadder[arcadeStage];
  startMatch();
});

// Main 60fps loop
let lastTime = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) specialBanner.classList.add('hidden');
  }

  if (engine) {
    if (matchPhase === 'intro') {
      phaseTimer -= dt;
      if (phaseTimer <= 0.45 && phaseTimer > 0) {
        showAnnouncer('FIGHT!');
      } else if (phaseTimer <= 0) {
        hideAnnouncer();
        matchPhase = 'fighting';
      }
      engine.step(dt, [{}, {}]);
    } else if (matchPhase === 'fighting') {
      const i1 = getP1Input();
      const i2 = ai
        ? ai.getInput(engine.fighters[1], engine.fighters[0], engine.projectiles, dt)
        : getP2Input();
      keysJustPressed.clear();

      engine.step(dt, [i1, i2]);

      for (const ev of engine.events) {
        if (ev.type === 'specialCast') {
          specialBanner.textContent = `${ev.isMax ? 'MAX ' : ''}${ev.name}!!`;
          specialBanner.classList.remove('hidden');
          bannerTimer = 0.85;
        }
      }

      if (engine.finished) {
        updateWinStars();
        matchPhase = 'roundOver';
        phaseTimer = 1.9;
        showAnnouncer(engine.winnerSlot === 'draw' ? 'DRAW!' : 'K.O.!');
      }
    } else if (matchPhase === 'roundOver') {
      phaseTimer -= dt;
      engine.step(dt, [{}, {}]);
      if (phaseTimer <= 0) {
        hideAnnouncer();
        const f0 = engine.fighters[0];
        const f1 = engine.fighters[1];
        if (f0.roundsWon >= 2 || f1.roundsWon >= 2 || roundNum >= 3) {
          matchPhase = 'matchOver';
          showResultModal();
        } else {
          roundNum += 1;
          startRound();
        }
      }
    }

    updateHUD();
    renderer.render(engine, dt);
  } else if (renderer) {
    // Render idle background stage behind menus
    if (renderer.stageController) {
      renderer.stageController.update(now * 0.001);
    }
    renderer.renderer.render(renderer.scene, renderer.camera);
  }
}

async function init() {
  const res = await fetch('./sprites/sprites.json');
  manifest = await res.json();
  renderer = new ArenaRenderer(el('game-canvas'), manifest);
  requestAnimationFrame(loop);
}

init();
