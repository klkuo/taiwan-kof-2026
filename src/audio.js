/**
 * Zero-dependency Web Audio API arcade sound effects synthesizer.
 */
const BGM_TRACKS = {
  li:   { bpm: 136, wave: 'sawtooth', bass: [43,0,43,55, 43,0,46,48, 43,0,43,55, 50,0,48,46], lead: [67,0,70,72, 74,0,72,70, 67,0,74,72, 70,67,65,0] },
  tsai: { bpm: 128, wave: 'triangle', bass: [45,45,57,45, 48,48,60,48, 43,43,55,43, 41,41,53,43], lead: [69,72,76,0, 72,76,79,0, 67,71,74,0, 72,71,69,0] },
  hsiao:{ bpm: 142, wave: 'square',   bass: [47,0,59,47, 50,0,62,50, 45,0,57,45, 47,50,52,54], lead: [71,74,78,79, 0,78,74,71, 69,71,74,76, 78,0,74,71] },
  chen: { bpm: 138, wave: 'sawtooth', bass: [40,40,52,40, 43,43,55,43, 45,45,57,45, 47,47,59,47], lead: [64,67,71,72, 74,0,72,71, 69,71,72,76, 74,72,71,67] },
  han:  { bpm: 134, wave: 'square',   bass: [48,0,60,48, 43,0,55,43, 45,0,57,45, 43,48,52,55], lead: [72,76,79,84, 79,76,72,0, 74,77,81,79, 76,74,72,0] },
  ho:   { bpm: 126, wave: 'sawtooth', bass: [38,38,38,50, 38,38,41,43, 38,38,38,50, 45,43,41,40], lead: [62,0,65,67, 69,0,67,65, 62,0,69,67, 65,62,60,0] },
  ma:   { bpm: 120, wave: 'triangle', bass: [45,0,52,57, 48,0,55,60, 43,0,50,55, 41,0,48,53], lead: [76,0,74,72, 71,0,72,74, 72,0,69,67, 69,0,64,0] },
  ko:   { bpm: 144, wave: 'square',   bass: [42,54,42,54, 45,57,45,57, 47,59,47,59, 44,56,42,54], lead: [78,74,71,78, 74,71,78,81, 79,76,72,79, 78,74,71,69] },
  lu:   { bpm: 124, wave: 'triangle', bass: [48,0,55,60, 45,0,52,57, 41,0,48,53, 43,0,50,55], lead: [72,74,76,0, 79,76,74,72, 69,72,74,0, 76,74,72,67] },
  san:  { bpm: 146, wave: 'sawtooth', bass: [44,44,56,44, 47,47,59,47, 49,49,61,49, 47,47,59,47], lead: [68,71,75,76, 80,0,76,75, 73,75,76,80, 78,76,75,71] },
  huan: { bpm: 154, wave: 'sawtooth', bass: [36,36,48,36, 39,39,51,39, 41,41,53,41, 43,43,55,43], lead: [72,75,79,82, 84,0,82,79, 77,79,82,84, 86,84,82,79] },
  mo:   { bpm: 158, wave: 'sawtooth', bass: [36,36,36,48, 37,37,37,49, 36,36,36,48, 43,41,39,37], lead: [72,73,76,79, 84,83,79,76, 72,73,76,81, 79,76,73,72] },
};

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    const savedVol = Number(localStorage.getItem('tkof_volume'));
    this.volume = Number.isFinite(savedVol) ? Math.max(0, Math.min(1, savedVol)) : 0.75;
    this.muted = localStorage.getItem('tkof_muted') === '1';
    this._bgmTimer = null;
    this._bgmStep = 0;
    this._bgmNextTime = 0;
    this._currentTrackId = null;
    this._voices = [];
    this._speechResolve = null;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this._refreshVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this._refreshVoices());
    }
  }

  _refreshVoices() {
    try {
      this._voices = window.speechSynthesis.getVoices() || [];
    } catch {
      this._voices = [];
    }
  }

  _pickVoice(gender) {
    if (!this._voices.length) this._refreshVoices();
    const zhVoices = this._voices.filter((v) => /zh[-_]?tw|cmn[-_]?hant|zh/i.test(v.lang));
    const pool = zhVoices.length ? zhVoices : this._voices;
    if (!pool.length) return { voice: null, matchedGender: false };

    // Prefer reliable Taiwanese Mandarin voices; avoid novelty voices that may fail silently
    const maleRe = /yunjhe|kangkang|yunxi|yunyang|\bmale\b/i;
    const femaleRe = /meijia|tingting|sinji|hsiaochen|hsiaoyu|yating|xiaoxiao|\bfemale\b/i;

    const twPool = pool.filter((v) => /tw|hant/i.test(v.lang));
    const searchPool = twPool.length ? twPool : pool;

    const targetRe = gender === 'male' ? maleRe : femaleRe;
    const match =
      searchPool.find((v) => targetRe.test(v.name) && v.localService !== false) ||
      searchPool.find((v) => targetRe.test(v.name)) ||
      pool.find((v) => targetRe.test(v.name));
    if (match) return { voice: match, matchedGender: true };

    const reliableDefault = searchPool.find((v) => /meijia|tingting|sinji|google/i.test(v.name));
    return { voice: reliableDefault || searchPool[0], matchedGender: false };
  }

  cancelSpeech() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (this._speechResolve) {
      const res = this._speechResolve;
      this._speechResolve = null;
      res();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    localStorage.setItem('tkof_volume', String(this.volume));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
    }
  }

  setMuted(val) {
    this.muted = val;
    localStorage.setItem('tkof_muted', val ? '1' : '0');
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(val ? 0 : this.volume, this.ctx.currentTime);
    }
    if (val) {
      this._pauseBGM();
      this.cancelSpeech();
    } else if (this._currentTrackId) {
      this.playBGM(this._currentTrackId);
    }
  }

  speak(text, { gender = 'male', pitch = 1.0 } = {}) {
    if (this.muted || this.volume <= 0 || !window.speechSynthesis || !text) return;
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        this.cancelSpeech();
      }
      const u = new SpeechSynthesisUtterance(text);
      this._activeUtterance = u;
      const { voice, matchedGender } = this._pickVoice(gender);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'zh-TW';
      u.rate = 1.18;
      const adjPitch = !matchedGender && gender === 'male' ? pitch * 0.84 : pitch;
      u.pitch = Math.max(0.45, Math.min(1.6, adjPitch));
      u.volume = this.volume;
      window.speechSynthesis.speak(u);
    } catch {
      // Ignore speech synthesis errors on restricted browsers
    }
  }

  speakAsync(text, opts = {}) {
    return new Promise((resolve) => {
      if (this.muted || this.volume <= 0 || !window.speechSynthesis || !text) {
        setTimeout(resolve, 1400);
        return;
      }
      try {
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
        }
        const startTime = performance.now();
        const u = new SpeechSynthesisUtterance(text);
        this._activeUtterance = u;
        const { voice, matchedGender } = this._pickVoice(opts.gender || 'male');
        if (voice) u.voice = voice;
        u.lang = voice?.lang || 'zh-TW';
        u.rate = 1.18;
        const basePitch = opts.pitch ?? 1.0;
        const adjPitch = !matchedGender && opts.gender === 'male' ? basePitch * 0.84 : basePitch;
        u.pitch = Math.max(0.45, Math.min(1.6, adjPitch));
        u.volume = this.volume;

        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          this._speechResolve = null;
          clearTimeout(fallbackTimer);
          const elapsed = performance.now() - startTime;
          const minDisplay = Math.max(0, 900 - elapsed);
          setTimeout(resolve, minDisplay);
        };
        this._speechResolve = done;
        u.onend = done;
        u.onerror = done;
        const fallbackTimer = setTimeout(done, Math.max(1800, text.length * 180));
        // Speak directly without redundant cancel() when queue is already clear
        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
          setTimeout(() => {
            if (!settled) window.speechSynthesis.speak(u);
          }, 50);
        } else {
          window.speechSynthesis.speak(u);
        }
      } catch {
        setTimeout(resolve, 1400);
      }
    });
  }

  tick() {
    this._tone(660, 440, 0.08, 'triangle', 0.14);
  }

  playBGM(charId) {
    this._currentTrackId = charId;
    this._pauseBGM();
    if (this.muted) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const track = BGM_TRACKS[charId] || BGM_TRACKS.li;
    this._bgmStep = 0;
    this._bgmNextTime = ctx.currentTime + 0.05;

    const stepDur = 60 / track.bpm / 4; // 16th note
    this._bgmTimer = setInterval(() => {
      if (this.muted || !this.ctx) return;
      while (this._bgmNextTime < this.ctx.currentTime + 0.12) {
        this._scheduleBgmStep(track, this._bgmStep, this._bgmNextTime, stepDur);
        this._bgmNextTime += stepDur;
        this._bgmStep = (this._bgmStep + 1) % 16;
      }
    }, 35);
  }

  _pauseBGM() {
    if (this._bgmTimer) {
      clearInterval(this._bgmTimer);
      this._bgmTimer = null;
    }
  }

  stopBGM() {
    this._currentTrackId = null;
    this._pauseBGM();
  }

  _scheduleBgmStep(track, step, time, stepDur) {
    const ctx = this.ctx;
    const bassNote = track.bass[step];
    const leadNote = track.lead[step];

    if (bassNote > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToHz(bassNote), time);
      gain.gain.setValueAtTime(0.09, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + stepDur * 0.9);
      osc.connect(gain);
      gain.connect(this.masterGain || ctx.destination);
      osc.start(time);
      osc.stop(time + stepDur * 0.92);
    }

    if (leadNote > 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = track.wave;
      osc.frequency.setValueAtTime(midiToHz(leadNote), time);
      gain.gain.setValueAtTime(0.045, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + stepDur * 1.4);
      osc.connect(gain);
      gain.connect(this.masterGain || ctx.destination);
      osc.start(time);
      osc.stop(time + stepDur * 1.45);
    }

    // Kick on 0, 4, 8, 12; Snare/hat on 4, 12 & offbeats
    if (step % 4 === 0) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(125, time);
      osc.frequency.exponentialRampToValueAtTime(38, time + 0.09);
      gain.gain.setValueAtTime(0.11, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      osc.connect(gain);
      gain.connect(this.masterGain || ctx.destination);
      osc.start(time);
      osc.stop(time + 0.11);
    }
  }

  _ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _tone(freqStart, freqEnd, duration, type = 'square', gainVal = 0.14) {
    const ctx = this._ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.masterGain || ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  _noise(duration, gainVal = 0.2, cutoff = 1200) {
    const ctx = this._ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain || ctx.destination);
    src.start(now);
  }

  select() {
    this._tone(520, 740, 0.06, 'triangle', 0.12);
  }

  confirm() {
    this._tone(440, 880, 0.12, 'square', 0.14);
    setTimeout(() => this._tone(660, 1180, 0.16, 'triangle', 0.12), 70);
  }

  whoosh() {
    this._noise(0.09, 0.12, 2400);
    this._tone(340, 120, 0.08, 'sine', 0.08);
  }

  hit(heavy = false) {
    this._noise(heavy ? 0.22 : 0.12, heavy ? 0.34 : 0.22, heavy ? 1600 : 1200);
    this._tone(heavy ? 180 : 240, 42, heavy ? 0.18 : 0.1, 'sawtooth', heavy ? 0.22 : 0.15);
  }

  block() {
    this._tone(900, 320, 0.07, 'square', 0.12);
    this._noise(0.05, 0.1, 3000);
  }

  special() {
    this._tone(220, 960, 0.25, 'sawtooth', 0.16);
    setTimeout(() => this._noise(0.26, 0.24, 2800), 80);
  }

  ko() {
    this._noise(0.55, 0.38, 900);
    this._tone(240, 36, 0.55, 'sawtooth', 0.26);
  }

  roundStart() {
    this._tone(523, 523, 0.1, 'square', 0.14);
    setTimeout(() => this._tone(659, 659, 0.1, 'square', 0.14), 120);
    setTimeout(() => this._tone(784, 1046, 0.22, 'square', 0.16), 240);
  }
}

export const sound = new SoundEngine();
