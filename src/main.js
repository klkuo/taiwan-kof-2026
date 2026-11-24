import { ROSTER, ROSTER_BY_ID, getRivalIntro, pickRandomLine } from './roster.js';
import { sound } from './audio.js';
import { CombatEngine } from './physics.js';
import { FighterAI } from './ai.js';
import { ArenaRenderer } from './renderer.js';

const el = (id) => document.getElementById(id);

const titleScreen = el('title-screen');
const selectScreen = el('select-screen');
const hud = el('hud');
const pauseModal = el('pause-modal');
const resultModal = el('result-modal');

const rosterGrid = el('roster-grid');
const selectPrompt = el('select-prompt');
const arcadeBadge = el('arcade-badge');
const btnFight = el('btn-fight');

const announcer = el('announcer');
const specialBanner = el('special-banner');
const rivalBanner = el('rival-banner');
const speechBubbles = [el('speech-p1'), el('speech-p2')];
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
let matchPhase = 'idle'; // dialogue | intro | fighting | roundOver | matchOver
let phaseTimer = 0;
let bannerTimer = 0;
let paused = false;
let introStep = 0; // tracks 3 -> 2 -> 1 -> FIGHT! steps
let introSeqId = 0;

// Double-tap dash tracking
const lastTapTime = {};
const dashTriggers = new Set();

// Keyboard & Touch state
const keysDown = new Set();
const keysJustPressed = new Set();
const touchHeld = { left: false, right: false, up: false };
const touchJustPressed = { punch: false, kick: false, special: false };

window.addEventListener(
  'touchstart',
  () => {
    document.body.classList.add('has-touch');
  },
  { once: true, passive: true }
);

document.querySelectorAll('.t-btn').forEach((btn) => {
  const action = btn.dataset.action;
  const press = (e) => {
    e.preventDefault();
    btn.classList.add('active');
    if (action in touchHeld) {
      touchHeld[action] = true;
    } else if (action in touchJustPressed) {
      touchJustPressed[action] = true;
    }
  };
  const release = (e) => {
    e.preventDefault();
    btn.classList.remove('active');
    if (action in touchHeld) {
      touchHeld[action] = false;
    }
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', release);
  btn.addEventListener('pointerleave', release);
});

window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault();
  }
  if (e.code === 'Escape' && engine && matchPhase !== 'matchOver') {
    togglePause();
    return;
  }
  if (!keysDown.has(e.code)) {
    keysJustPressed.add(e.code);
    if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      const now = performance.now();
      if (lastTapTime[e.code] && now - lastTapTime[e.code] < 240) {
        dashTriggers.add(e.code);
        lastTapTime[e.code] = 0;
      } else {
        lastTapTime[e.code] = now;
      }
    }
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

function consumeTouch(action) {
  if (touchJustPressed[action]) {
    touchJustPressed[action] = false;
    return true;
  }
  return false;
}

function consumeDash(code) {
  if (dashTriggers.has(code)) {
    dashTriggers.delete(code);
    return true;
  }
  return false;
}

function getP1Input() {
  return {
    left: keysDown.has('KeyA') || touchHeld.left,
    right: keysDown.has('KeyD') || touchHeld.right,
    up: keysDown.has('KeyW') || touchHeld.up,
    dashLeft: consumeDash('KeyA'),
    dashRight: consumeDash('KeyD'),
    punch: consumePress(['KeyJ']) || consumeTouch('punch'),
    kick: consumePress(['KeyK']) || consumeTouch('kick'),
    special: consumePress(['KeyL', 'KeyU']) || consumeTouch('special'),
  };
}

function getP2Input() {
  return {
    left: keysDown.has('ArrowLeft'),
    right: keysDown.has('ArrowRight'),
    up: keysDown.has('ArrowUp'),
    dashLeft: consumeDash('ArrowLeft'),
    dashRight: consumeDash('ArrowRight'),
    punch: consumePress(['Numpad1', 'Digit1', 'KeyI']),
    kick: consumePress(['Numpad2', 'Digit2', 'KeyO']),
    special: consumePress(['Numpad3', 'Digit3', 'KeyP']),
  };
}

function showScreen(target) {
  [titleScreen, selectScreen, pauseModal, resultModal].forEach((s) => s.classList.remove('active'));
  if (target) target.classList.add('active');
}

function togglePause(force) {
  if (!engine) return;
  paused = typeof force === 'boolean' ? force : !paused;
  if (paused) {
    sound._pauseBGM();
    showScreen(pauseModal);
  } else {
    showScreen(null);
    if (!sound.muted && p2Pick) sound.playBGM(p2Pick.id);
  }
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
  paused = false;
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

function hideSpeechBubbles() {
  speechBubbles.forEach((b) => b.classList.add('hidden'));
}

function showSpeech(slot, charConfig, text, speak = true) {
  const b = speechBubbles[slot];
  b.textContent = `${charConfig.name}：「${text}」`;
  b.classList.remove('hidden');
  if (speak) {
    sound.speak(text, { gender: charConfig.gender, pitch: charConfig.voicePitch });
  }
}

async function runIntroDialogue(seqId) {
  const p1Line = pickRandomLine(p1Pick.introLines);
  showSpeech(0, p1Pick, p1Line, false);
  await sound.speakAsync(p1Line, { gender: p1Pick.gender, pitch: p1Pick.voicePitch });
  if (seqId !== introSeqId || !engine) return;

  await new Promise((r) => setTimeout(r, 250));
  if (seqId !== introSeqId || !engine) return;

  const p2Line = pickRandomLine(p2Pick.introLines);
  showSpeech(1, p2Pick, p2Line, false);
  await sound.speakAsync(p2Line, { gender: p2Pick.gender, pitch: p2Pick.voicePitch });
  if (seqId !== introSeqId || !engine) return;

  await new Promise((r) => setTimeout(r, 250));
  if (seqId !== introSeqId || !engine) return;

  // Start 3-second countdown after both characters finish speaking
  matchPhase = 'intro';
  phaseTimer = 3.45;
  introStep = 3;
  showAnnouncer('3');
  sound.tick();
}

function startRound() {
  introSeqId += 1;
  sound.cancelSpeech();
  engine.resetRound(true);
  updateWinStars();
  hideSpeechBubbles();
  hideAnnouncer();
  el('hud-round').textContent =
    mode === 'arcade' ? `STAGE ${arcadeStage + 1}/4 • ROUND ${roundNum}` : `ROUND ${roundNum}`;

  const rivalText = roundNum === 1 ? getRivalIntro(p1Pick.id, p2Pick.id) : null;
  if (rivalText) {
    rivalBanner.textContent = rivalText;
    rivalBanner.classList.remove('hidden');
  } else {
    rivalBanner.classList.add('hidden');
  }

  if (roundNum === 1) {
    matchPhase = 'dialogue';
    runIntroDialogue(introSeqId);
  } else {
    matchPhase = 'intro';
    phaseTimer = 1.45;
    introStep = 0;
    showAnnouncer(`ROUND ${roundNum}`);
    sound.roundStart();
  }
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

el('btn-pause').addEventListener('click', () => togglePause(true));
el('btn-resume').addEventListener('click', () => togglePause(false));
el('btn-pause-rematch').addEventListener('click', startMatch);
el('btn-pause-select').addEventListener('click', () => {
  introSeqId += 1;
  sound.cancelSpeech();
  paused = false;
  sound.stopBGM();
  hud.classList.add('hidden');
  engine = null;
  showScreen(selectScreen);
});

el('btn-close-hint').addEventListener('click', () => {
  el('portrait-hint').classList.add('dismissed');
});

function syncVolumeUI() {
  const pct = Math.round(sound.volume * 100);
  el('volume-slider').value = String(pct);
  el('pause-volume-slider').value = String(pct);
  el('volume-label').textContent = `${pct}%`;
  el('pause-volume-label').textContent = `${pct}%`;
  el('btn-mute').textContent = sound.muted || pct === 0 ? '🔇 靜音' : '🔊 音效';
}

function handleVolumeInput(e) {
  const val = Number(e.target.value) / 100;
  sound.setVolume(val);
  if (val > 0 && sound.muted) {
    sound.setMuted(false);
  }
  syncVolumeUI();
}

el('volume-slider').addEventListener('input', handleVolumeInput);
el('pause-volume-slider').addEventListener('input', handleVolumeInput);

el('btn-mute').addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  syncVolumeUI();
});

syncVolumeUI();

el('btn-quit').addEventListener('click', () => {
  introSeqId += 1;
  sound.cancelSpeech();
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
    if (paused) {
      renderer.renderer.render(renderer.scene, renderer.camera);
      return;
    }
    if (matchPhase === 'dialogue') {
      engine.step(dt, [{}, {}]);
    } else if (matchPhase === 'intro') {
      phaseTimer -= dt;
      if (roundNum === 1) {
        if (phaseTimer <= 2.45 && introStep === 3) {
          introStep = 2;
          showAnnouncer('2');
          sound.tick();
        } else if (phaseTimer <= 1.45 && introStep === 2) {
          introStep = 1;
          showAnnouncer('1');
          sound.tick();
        } else if (phaseTimer <= 0.45 && introStep === 1) {
          introStep = 0;
          hideSpeechBubbles();
          showAnnouncer('FIGHT!');
          sound.roundStart();
        } else if (phaseTimer <= 0) {
          hideAnnouncer();
          rivalBanner.classList.add('hidden');
          matchPhase = 'fighting';
        }
      } else {
        if (phaseTimer <= 0.45 && phaseTimer > 0) {
          showAnnouncer('FIGHT!');
        } else if (phaseTimer <= 0) {
          hideAnnouncer();
          matchPhase = 'fighting';
        }
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
        phaseTimer = 2.6;
        showAnnouncer(engine.winnerSlot === 'draw' ? 'DRAW!' : 'K.O.!');
        if (engine.winnerSlot === 0 || engine.winnerSlot === 1) {
          const winner = engine.fighters[engine.winnerSlot].config;
          showSpeech(engine.winnerSlot, winner, pickRandomLine(winner.koLines));
        }
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
