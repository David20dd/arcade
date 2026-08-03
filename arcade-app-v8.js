(() => {

"use strict";

let globalLeaderboard = null;
const pendingSecureGameOvers = [];

const GAME_STATES = Object.freeze({
  MENU: "MENU",
  PLAYING: "PLAYING",
  GAME_OVER: "GAME_OVER"
});

const GAME_CATALOG = Object.freeze({
  "space-invaders": {
    id: "space-invaders",
    title: "ALIEN INVADERS",
    genre: "NEON ORBITAL DEFENSE",
    accent: "#42f5ff",
    accentRgb: "66, 245, 255",
    secondary: "#ff3cf7",
    symbol: "INVADER GRID",
    hint: "Flechas izquierda/derecha para moverte. Mantén Espacio para disparar.",
    controls: "← → MOVER NAVE / SPACE DISPARAR / ENTER INICIAR",
    canvasWidth: 800,
    canvasHeight: 600,
    playable: true
  },
  "pac-man": {
    id: "pac-man",
    title: "NEON PAC-MAN",
    genre: "NEON MAZE",
    accent: "#ffbd3c",
    accentRgb: "255, 189, 60",
    secondary: "#7055ff",
    symbol: "MAZE CORE",
    hint: "Usa las cuatro flechas para moverte. Las píldoras grandes activan 7 segundos de poder.",
    controls: "FLECHAS: MOVER / POWER PELLET: FANTASMAS VULNERABLES 7s / SPACE: INICIAR",
    canvasWidth: 800,
    canvasHeight: 600,
    playable: true
  },
  "asteroids": {
    id: "asteroids",
    title: "NEON ASTEROIDS",
    genre: "VECTOR SURVIVAL",
    accent: "#00ff7f",
    accentRgb: "0, 255, 127",
    secondary: "#ff3cf7",
    symbol: "VECTOR FIELD",
    hint: "Gira con izquierda/derecha, acelera con arriba y dispara con Espacio.",
    controls: "← → ROTAR / ↑ EMPUJE / SPACE DISPARAR / ENTER INICIAR",
    canvasWidth: 800,
    canvasHeight: 600,
    playable: true
  }
});


class HighScoreStore {
  constructor(storageKey = "neonNexus.highScores.v1") {
    this.storageKey = storageKey;
    this.asteroidsStorageKey = "arcade_asteroids_highscore";
    this.scores = this.load();
    this.listeners = new Set();
    this.save();
  }

  load() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(this.storageKey) || "{}");
      const scores = parsed && typeof parsed === "object" ? parsed : {};
      const asteroidsScore = Number(window.localStorage.getItem("arcade_asteroids_highscore"));
      if (Number.isFinite(asteroidsScore) && asteroidsScore > Number(scores.asteroids || 0)) {
        scores.asteroids = Math.floor(asteroidsScore);
      }
      return scores;
    } catch (error) {
      return {};
    }
  }

  save() {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.scores));
      window.localStorage.setItem(this.asteroidsStorageKey, String(Math.max(0, Math.floor(Number(this.scores.asteroids) || 0))));
    } catch (error) {
      // The in-memory score still works when storage is unavailable.
    }
  }

  get(gameId) {
    const value = Number(this.scores[gameId]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  submit(gameId, score) {
    const normalizedScore = Math.max(0, Math.floor(Number(score) || 0));
    if (!gameId || normalizedScore <= this.get(gameId)) return false;
    this.scores[gameId] = normalizedScore;
    this.save();
    this.listeners.forEach((listener) => listener(gameId, normalizedScore));
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class ArcadeHaptics {
  constructor() {
    this.supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
    this.lastPulse = new Map();
  }

  vibrate(pattern, key = "generic", minimumInterval = 0) {
    if (!this.supported || document.visibilityState === "hidden") return false;
    const now = performance.now();
    const previous = this.lastPulse.get(key) ?? -Infinity;
    if (now - previous < minimumInterval) return false;
    this.lastPulse.set(key, now);
    try {
      return navigator.vibrate(pattern);
    } catch (error) {
      return false;
    }
  }

  shot() {
    return this.vibrate([50], "shot", 85);
  }

  damage() {
    return this.vibrate([100, 50, 150], "damage", 320);
  }

  stop() {
    if (!this.supported) return false;
    try {
      return navigator.vibrate(0);
    } catch (error) {
      return false;
    }
  }
}

class RetroAudio {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.enabled = this.readEnabledState();
    this.activeLoops = new Map();
    this.activeTransients = new Set();
    this.lastPlayedAt = new Map();
    this.noiseBuffers = new Map();
  }

  readEnabledState() {
    try {
      return window.localStorage.getItem("neonNexus.audio") !== "muted";
    } catch (error) {
      return true;
    }
  }

  persistEnabledState() {
    try {
      window.localStorage.setItem("neonNexus.audio", this.enabled ? "enabled" : "muted");
    } catch (error) {
      return;
    }
  }

  unlock() {
    if (!this.enabled) return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.context) {
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.22;
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.persistEnabledState();
    if (this.enabled) this.unlock();
    if (!this.enabled) this.stopAllSounds(0.025);
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.enabled ? 0.22 : 0.0001, now, 0.015);
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  normalizeGame(game) {
    const value = String(game || "").toLowerCase().replace(/_/g, "-");
    if (value.includes("pac")) return "pac-man";
    if (value.includes("invader") || value.includes("alien")) return "space-invaders";
    if (value.includes("asteroid")) return "asteroids";
    return value;
  }

  canPlay(key, minimumIntervalSeconds = 0) {
    const context = this.unlock();
    if (!context || !this.enabled) return false;
    const previous = this.lastPlayedAt.get(key) ?? -Infinity;
    if (context.currentTime - previous < minimumIntervalSeconds) return false;
    this.lastPlayedAt.set(key, context.currentTime);
    return true;
  }

  createNoiseBuffer(duration) {
    const context = this.context;
    const normalizedDuration = Math.max(0.05, Math.ceil(Number(duration || 0.1) * 20) / 20);
    const cacheKey = normalizedDuration.toFixed(2);
    const cached = this.noiseBuffers.get(cacheKey);
    if (cached) return cached;

    const frameCount = Math.max(1, Math.floor(context.sampleRate * normalizedDuration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) data[index] = Math.random() * 2 - 1;

    this.noiseBuffers.set(cacheKey, buffer);
    if (this.noiseBuffers.size > 12) {
      const oldestKey = this.noiseBuffers.keys().next().value;
      this.noiseBuffers.delete(oldestKey);
    }
    return buffer;
  }

  cleanupNodes(nodes) {
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch (error) {
        continue;
      }
    }
  }

  trackTransient(nodes, endTime) {
    if (!this.context) return;
    const record = {
      nodes: Array.from(new Set(nodes.filter(Boolean))),
      timer: null
    };
    const cleanup = () => {
      if (record.timer !== null) window.clearTimeout(record.timer);
      this.cleanupNodes(record.nodes);
      this.activeTransients.delete(record);
    };
    const delay = Math.max(0, (endTime - this.context.currentTime) * 1000 + 120);
    record.timer = window.setTimeout(cleanup, delay);
    this.activeTransients.add(record);
  }

  stopAllTransients(fadeSeconds = 0.02) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const record of Array.from(this.activeTransients)) {
      if (record.timer !== null) window.clearTimeout(record.timer);
      for (const node of record.nodes) {
        if (node?.gain && typeof node.gain.cancelScheduledValues === "function") {
          try {
            node.gain.cancelScheduledValues(now);
            node.gain.setTargetAtTime(0.0001, now, Math.max(0.005, fadeSeconds * 0.3));
          } catch (error) {
            continue;
          }
        }
      }
      window.setTimeout(() => {
        for (const node of record.nodes) {
          if (typeof node?.stop === "function") {
            try {
              node.stop();
            } catch (error) {
              continue;
            }
          }
        }
        this.cleanupNodes(record.nodes);
      }, Math.ceil(Math.max(0.01, fadeSeconds) * 1000));
      this.activeTransients.delete(record);
    }
  }

  stopLoop(key, fadeSeconds = 0.055) {
    const voice = this.activeLoops.get(key);
    if (!voice || !this.context) return;
    this.activeLoops.delete(key);
    const now = this.context.currentTime;
    const stopAt = now + Math.max(0.015, fadeSeconds);
    voice.output.gain.cancelScheduledValues(now);
    voice.output.gain.setTargetAtTime(0.0001, now, Math.max(0.008, fadeSeconds * 0.33));
    for (const source of voice.sources) {
      try {
        source.stop(stopAt + 0.025);
      } catch (error) {
        continue;
      }
    }
    window.setTimeout(() => this.cleanupNodes(voice.nodes), Math.ceil((fadeSeconds + 0.12) * 1000));
  }

  stopAllLoops(fadeSeconds = 0.055) {
    for (const key of Array.from(this.activeLoops.keys())) this.stopLoop(key, fadeSeconds);
  }

  stopAllSounds(fadeSeconds = 0.04) {
    this.stopAllLoops(fadeSeconds);
    this.stopAllTransients(fadeSeconds);
    this.lastPlayedAt.clear();
  }

  playArcadeSound(game, action, detail = {}) {
    const normalizedGame = this.normalizeGame(game);
    const normalizedAction = String(action || "").toLowerCase().replace(/-/g, "_");

    if (normalizedGame === "pac-man") {
      if (normalizedAction === "pacman_intro" || normalizedAction === "intro") return this.pacmanIntro(detail);
      if (normalizedAction === "waka_waka") return this.pacmanWaka(detail);
      if (normalizedAction === "pacman_death") return this.pacmanDeath(detail);
      if (normalizedAction === "ghost_vulnerable") return this.ghostVulnerable(detail);
    }

    if (normalizedGame === "space-invaders") {
      if (normalizedAction === "invader_march") return this.invaderMarch(detail);
      if (normalizedAction === "player_laser") return this.playerLaser(detail);
      if (normalizedAction === "invader_death") return this.invaderDeath(detail);
    }

    if (normalizedGame === "asteroids") {
      if (normalizedAction === "ship_thrust") return this.shipThrust(detail);
      if (normalizedAction === "asteroid_explosion") return this.asteroidExplosion(detail);
      if (normalizedAction === "player_laser") return this.genericLaser(detail);
    }

    if (normalizedAction === "laser" || normalizedAction === "player_laser") return this.genericLaser(detail);
    if (normalizedAction === "explosion") return this.genericExplosion(detail);
    if (normalizedAction === "game_over") return this.gameOver(detail);
    return false;
  }

  playSynthSound(action, detail = {}) {
    return this.playArcadeSound("global", action, detail);
  }

  pacmanIntro(detail = {}) {
    if (!this.canPlay("pacman:intro", 2.6)) return false;
    this.stopLoop("pacman:ghost-vulnerable", 0.025);
    const context = this.context;
    const startTime = context.currentTime + 0.035;
    const volume = Math.max(0.55, Math.min(1.15, Number(detail.volume) || 1));
    const sequence = [
      [493.88, 0.085], [987.77, 0.085], [739.99, 0.085], [622.25, 0.085],
      [987.77, 0.085], [739.99, 0.085], [622.25, 0.12], [523.25, 0.085],
      [1046.5, 0.085], [783.99, 0.085], [659.25, 0.085], [1046.5, 0.085],
      [783.99, 0.085], [659.25, 0.12], [493.88, 0.08], [587.33, 0.08],
      [659.25, 0.08], [698.46, 0.08], [739.99, 0.11], [659.25, 0.08],
      [587.33, 0.08], [554.37, 0.08], [523.25, 0.11], [493.88, 0.24]
    ];
    const filter = context.createBiquadFilter();
    const bus = context.createGain();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1450, startTime);
    filter.Q.value = 0.72;
    bus.gain.setValueAtTime(0.0001, startTime);
    bus.gain.exponentialRampToValueAtTime(0.78 * volume, startTime + 0.025);
    filter.connect(bus);
    bus.connect(this.masterGain);

    const nodes = [filter, bus];
    let cursor = startTime;
    for (let index = 0; index < sequence.length; index += 1) {
      const [frequency, duration] = sequence[index];
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const sub = context.createOscillator();
      const subGain = context.createGain();
      const noteEnd = cursor + duration;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, cursor);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.992, noteEnd);
      sub.type = "square";
      sub.frequency.setValueAtTime(frequency / 2, cursor);
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(0.12, cursor + 0.006);
      gain.gain.setValueAtTime(0.095, Math.max(cursor + 0.007, noteEnd - 0.026));
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      subGain.gain.setValueAtTime(0.0001, cursor);
      subGain.gain.exponentialRampToValueAtTime(0.025, cursor + 0.006);
      subGain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      sub.connect(subGain);
      gain.connect(filter);
      subGain.connect(filter);
      oscillator.start(cursor);
      sub.start(cursor);
      oscillator.stop(noteEnd + 0.01);
      sub.stop(noteEnd + 0.01);
      nodes.push(oscillator, gain, sub, subGain);
      cursor = noteEnd + (index % 7 === 6 ? 0.085 : 0.026);
    }
    bus.gain.setValueAtTime(0.78 * volume, Math.max(startTime + 0.03, cursor - 0.12));
    bus.gain.exponentialRampToValueAtTime(0.0001, cursor + 0.08);
    this.trackTransient(nodes, cursor + 0.12);
    return true;
  }

  pacmanWaka(detail = {}) {
    if (!this.canPlay("pacman:waka", 0.035)) return false;
    const context = this.context;
    const now = context.currentTime;
    const duration = 0.092;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const brightness = Math.max(0.7, Math.min(1.25, Number(detail.brightness) || 1));

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(400, now);
    oscillator.frequency.setValueAtTime(600, now + 0.018);
    oscillator.frequency.setValueAtTime(400, now + 0.038);
    oscillator.frequency.setValueAtTime(600, now + 0.058);
    oscillator.frequency.setValueAtTime(430, now + 0.078);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16 * brightness, now + 0.006);
    gain.gain.setValueAtTime(0.135 * brightness, now + 0.058);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
    this.trackTransient([oscillator, gain], now + duration + 0.02);
    return true;
  }

  pacmanDeath() {
    if (!this.canPlay("pacman:death", 0.35)) return false;
    this.stopLoop("pacman:ghost-vulnerable", 0.035);
    const context = this.context;
    const now = context.currentTime;
    const duration = 1.12;
    const carrier = context.createOscillator();
    const trill = context.createOscillator();
    const trillDepth = context.createGain();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    carrier.type = "sawtooth";
    carrier.frequency.setValueAtTime(800, now);
    carrier.frequency.exponentialRampToValueAtTime(100, now + duration);
    trill.type = "square";
    trill.frequency.setValueAtTime(27, now);
    trill.frequency.linearRampToValueAtTime(46, now + duration * 0.72);
    trillDepth.gain.setValueAtTime(90, now);
    trillDepth.gain.exponentialRampToValueAtTime(15, now + duration);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1500, now);
    filter.frequency.exponentialRampToValueAtTime(180, now + duration);
    filter.Q.value = 3.4;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.018);
    gain.gain.setValueAtTime(0.22, now + 0.72);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    trill.connect(trillDepth);
    trillDepth.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    carrier.start(now);
    trill.start(now);
    carrier.stop(now + duration + 0.02);
    trill.stop(now + duration + 0.02);
    this.trackTransient([carrier, trill, trillDepth, filter, gain], now + duration + 0.04);
    return true;
  }

  ghostVulnerable(detail = {}) {
    const key = "pacman:ghost-vulnerable";
    const active = detail.active !== false;
    if (!active || !this.enabled) {
      this.stopLoop(key, Number(detail.fade) || 0.06);
      return false;
    }
    if (this.activeLoops.has(key)) return true;
    const context = this.unlock();
    if (!context) return false;
    const now = context.currentTime;
    const carrier = context.createOscillator();
    const subCarrier = context.createOscillator();
    const lfo = context.createOscillator();
    const lfoDepth = context.createGain();
    const filter = context.createBiquadFilter();
    const output = context.createGain();

    carrier.type = "triangle";
    carrier.frequency.value = 235;
    subCarrier.type = "square";
    subCarrier.frequency.value = 117.5;
    lfo.type = "sine";
    lfo.frequency.value = 4.2;
    lfoDepth.gain.value = 58;
    filter.type = "lowpass";
    filter.frequency.value = 960;
    filter.Q.value = 1.8;
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.052, now + 0.08);

    lfo.connect(lfoDepth);
    lfoDepth.connect(carrier.frequency);
    carrier.connect(filter);
    subCarrier.connect(filter);
    filter.connect(output);
    output.connect(this.masterGain);
    carrier.start(now);
    subCarrier.start(now);
    lfo.start(now);

    this.activeLoops.set(key, {
      output,
      sources: [carrier, subCarrier, lfo],
      nodes: [carrier, subCarrier, lfo, lfoDepth, filter, output]
    });
    return true;
  }

  invaderMarch(detail = {}) {
    if (!this.canPlay("invaders:march", 0.055)) return false;
    const context = this.context;
    const now = context.currentTime;
    const notes = [80, 70, 60, 50];
    const step = Math.abs(Math.floor(Number(detail.step) || 0)) % notes.length;
    const duration = Math.max(0.055, Math.min(0.105, Number(detail.duration) || 0.078));
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = step % 2 === 0 ? "square" : "sawtooth";
    oscillator.frequency.setValueAtTime(notes[step], now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, notes[step] * 0.72), now + duration);
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.Q.value = 2.2;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
    this.trackTransient([oscillator, filter, gain], now + duration + 0.02);
    return true;
  }

  playerLaser() {
    if (!this.canPlay("invaders:laser", 0.055)) return false;
    const context = this.context;
    const now = context.currentTime;
    const duration = 0.085;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(900, now);
    oscillator.frequency.exponentialRampToValueAtTime(1500, now + 0.052);
    oscillator.frequency.exponentialRampToValueAtTime(1180, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
    this.trackTransient([oscillator, gain], now + duration + 0.02);
    return true;
  }

  invaderDeath(detail = {}) {
    if (!this.canPlay("invaders:death", 0.035)) return false;
    const context = this.context;
    const now = context.currentTime;
    const duration = 0.11;
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const metallic = context.createOscillator();
    const metallicGain = context.createGain();
    const intensity = Math.max(0.65, Math.min(1.35, Number(detail.intensity) || 1));

    noise.buffer = this.createNoiseBuffer(duration);
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2800, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(620, now + duration);
    noiseFilter.Q.value = 4.8;
    noiseGain.gain.setValueAtTime(0.28 * intensity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    metallic.type = "square";
    metallic.frequency.setValueAtTime(680, now);
    metallic.frequency.exponentialRampToValueAtTime(115, now + duration);
    metallicGain.gain.setValueAtTime(0.18 * intensity, now);
    metallicGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    metallic.connect(metallicGain);
    metallicGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration + 0.01);
    metallic.start(now);
    metallic.stop(now + duration + 0.01);
    this.trackTransient([noise, noiseFilter, noiseGain, metallic, metallicGain], now + duration + 0.03);
    return true;
  }

  shipThrust(detail = {}) {
    const key = "asteroids:ship-thrust";
    const active = detail.active !== false;
    const power = Math.max(0, Math.min(1, Number(detail.power) || (active ? 0.72 : 0)));
    if (!active || !this.enabled) {
      this.stopLoop(key, Number(detail.fade) || 0.045);
      return false;
    }

    const context = this.unlock();
    if (!context) return false;
    const now = context.currentTime;
    const existing = this.activeLoops.get(key);
    if (existing) {
      existing.filter.frequency.cancelScheduledValues(now);
      existing.filter.frequency.setTargetAtTime(150 + power * 560, now, 0.028);
      existing.output.gain.cancelScheduledValues(now);
      existing.output.gain.setTargetAtTime(0.055 + power * 0.105, now, 0.032);
      existing.sub.frequency.cancelScheduledValues(now);
      existing.sub.frequency.setTargetAtTime(48 + power * 35, now, 0.04);
      return true;
    }

    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const output = context.createGain();
    const sub = context.createOscillator();
    const subGain = context.createGain();
    const rumbleLfo = context.createOscillator();
    const rumbleDepth = context.createGain();

    noise.buffer = this.createNoiseBuffer(1.5);
    noise.loop = true;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(150 + power * 560, now);
    filter.Q.setValueAtTime(1.15 + power * 1.8, now);
    output.gain.setValueAtTime(0.0001, now);
    output.gain.exponentialRampToValueAtTime(0.055 + power * 0.105, now + 0.07);
    sub.type = "sine";
    sub.frequency.setValueAtTime(48 + power * 35, now);
    subGain.gain.setValueAtTime(0.035, now);
    rumbleLfo.type = "sine";
    rumbleLfo.frequency.setValueAtTime(7.5, now);
    rumbleDepth.gain.setValueAtTime(18, now);

    rumbleLfo.connect(rumbleDepth);
    rumbleDepth.connect(filter.frequency);
    noise.connect(filter);
    filter.connect(output);
    sub.connect(subGain);
    subGain.connect(output);
    output.connect(this.masterGain);
    noise.start(now);
    sub.start(now);
    rumbleLfo.start(now);

    this.activeLoops.set(key, {
      output,
      filter,
      sub,
      sources: [noise, sub, rumbleLfo],
      nodes: [noise, filter, output, sub, subGain, rumbleLfo, rumbleDepth]
    });
    return true;
  }

  asteroidExplosion(detail = {}) {
    const size = String(typeof detail === "string" ? detail : detail.size || "medium").toLowerCase();
    const profiles = {
      large: { duration: 0.56, gain: 0.44, noise: 0.34, filterStart: 1500 },
      medium: { duration: 0.34, gain: 0.35, noise: 0.28, filterStart: 1900 },
      small: { duration: 0.17, gain: 0.27, noise: 0.2, filterStart: 2500 }
    };
    const profile = profiles[size] || profiles.medium;
    if (!this.canPlay(`asteroids:explosion:${size}`, size === "small" ? 0.025 : 0.045)) return false;
    const context = this.context;
    const now = context.currentTime;
    const end = now + profile.duration;
    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(180, now);
    oscillator.frequency.exponentialRampToValueAtTime(20, end);
    oscillatorGain.gain.setValueAtTime(profile.gain, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, end);

    noise.buffer = this.createNoiseBuffer(profile.duration);
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(profile.filterStart, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(70, end);
    noiseFilter.Q.value = size === "large" ? 1.1 : 1.8;
    noiseGain.gain.setValueAtTime(profile.noise, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(this.masterGain);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    oscillator.start(now);
    noise.start(now);
    noise.stop(end + 0.02);
    oscillator.stop(end + 0.02);
    this.trackTransient([oscillator, oscillatorGain, noise, noiseFilter, noiseGain], end + 0.04);
    return true;
  }

  genericLaser() {
    if (!this.canPlay("global:laser", 0.05)) return false;
    const context = this.context;
    const now = context.currentTime;
    const duration = 0.13;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(280, now);
    oscillator.frequency.exponentialRampToValueAtTime(1350, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.34, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
    this.trackTransient([oscillator, gain], now + duration + 0.03);
    return true;
  }

  genericExplosion(detail = {}) {
    if (!this.canPlay("global:explosion", 0.04)) return false;
    const context = this.context;
    const now = context.currentTime;
    const duration = 0.34;
    const intensity = Math.max(0.25, Math.min(1.4, Number(detail.intensity ?? detail) || 1));
    const noise = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();

    noise.buffer = this.createNoiseBuffer(duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + duration);
    noiseGain.gain.setValueAtTime(0.42 * intensity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(190, now);
    oscillator.frequency.exponentialRampToValueAtTime(38, now + 0.28);
    oscillatorGain.gain.setValueAtTime(0.26 * intensity, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    oscillator.connect(oscillatorGain);
    oscillatorGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration + 0.01);
    oscillator.start(now);
    oscillator.stop(now + 0.31);
    this.trackTransient([noise, filter, noiseGain, oscillator, oscillatorGain], now + duration + 0.04);
    return true;
  }

  gameOver() {
    if (!this.canPlay("global:game-over", 0.5)) return false;
    this.stopAllLoops(0.045);
    const context = this.context;
    const now = context.currentTime + 0.03;
    const notes = [329.63, 261.63, 196.0];
    notes.forEach((frequency, index) => {
      const start = now + index * 0.3;
      const end = start + 0.29;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.94, start + 0.24);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.27);
      oscillator.connect(gain);
      gain.connect(this.masterGain);
      oscillator.start(start);
      oscillator.stop(end);
      this.trackTransient([oscillator, gain], end + 0.03);
    });
    return true;
  }

  laser() {
    return this.genericLaser();
  }

  explosion(intensity = 1) {
    return this.genericExplosion({ intensity });
  }
}
class InputManager {
  constructor() {
    this.keysDown = new Set();
    this.keysPressed = new Set();
    this.physicalKeysDown = new Set();
    this.virtualSources = new Map();
    this.enabled = false;
    this.controlCodes = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Enter"]);
    this.keys = Object.seal({
      ArrowLeft: false,
      ArrowRight: false,
      ArrowUp: false,
      ArrowDown: false,
      Space: false,
      " ": false,
      Enter: false
    });
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    window.addEventListener("keydown", this.handleKeyDown, { passive: false });
    window.addEventListener("keyup", this.handleKeyUp, { passive: false });
    window.addEventListener("blur", this.handleWindowBlur);
  }

  normalizeCode(code) {
    return code === " " ? "Space" : code;
  }

  syncKeyState(code) {
    const normalizedCode = this.normalizeCode(code);
    const active = this.keysDown.has(normalizedCode);
    if (normalizedCode === "Space") {
      this.keys.Space = active;
      this.keys[" "] = active;
    } else if (Object.prototype.hasOwnProperty.call(this.keys, normalizedCode)) {
      this.keys[normalizedCode] = active;
    }
  }

  syncAllKeyStates() {
    for (const code of this.controlCodes) this.syncKeyState(code);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.clear();
  }

  handleKeyDown(event) {
    if (!this.enabled) return;
    const code = this.normalizeCode(event.code || event.key);
    if (!this.controlCodes.has(code)) return;
    event.preventDefault();
    if (!this.physicalKeysDown.has(code) && !this.keysDown.has(code)) this.keysPressed.add(code);
    this.physicalKeysDown.add(code);
    this.keysDown.add(code);
    this.syncKeyState(code);
  }

  handleKeyUp(event) {
    if (!this.enabled) return;
    const code = this.normalizeCode(event.code || event.key);
    if (!this.controlCodes.has(code)) return;
    event.preventDefault();
    this.physicalKeysDown.delete(code);
    if (!this.hasVirtualSourceForCode(code)) this.keysDown.delete(code);
    this.syncKeyState(code);
  }

  setVirtualKey(code, isDown, sourceId = `virtual-${code}`) {
    const normalizedCode = this.normalizeCode(code);
    if (!this.controlCodes.has(normalizedCode)) return;
    if (!this.enabled && isDown) return;
    let sources = this.virtualSources.get(normalizedCode);
    if (!sources) {
      sources = new Set();
      this.virtualSources.set(normalizedCode, sources);
    }
    if (isDown) {
      const wasDown = this.keysDown.has(normalizedCode);
      sources.add(sourceId);
      this.keysDown.add(normalizedCode);
      if (!wasDown) this.keysPressed.add(normalizedCode);
      this.syncKeyState(normalizedCode);
      return;
    }
    sources.delete(sourceId);
    if (sources.size === 0) this.virtualSources.delete(normalizedCode);
    if (!this.physicalKeysDown.has(normalizedCode) && !this.hasVirtualSourceForCode(normalizedCode)) this.keysDown.delete(normalizedCode);
    this.syncKeyState(normalizedCode);
  }

  releaseVirtualSource(sourceId) {
    for (const [code, sources] of this.virtualSources.entries()) {
      if (!sources.delete(sourceId)) continue;
      if (sources.size === 0) this.virtualSources.delete(code);
      if (!this.physicalKeysDown.has(code) && !this.hasVirtualSourceForCode(code)) this.keysDown.delete(code);
      this.syncKeyState(code);
    }
  }

  hasVirtualSourceForCode(code) {
    return (this.virtualSources.get(this.normalizeCode(code))?.size || 0) > 0;
  }

  handleWindowBlur() {
    this.clear();
  }

  isDown(code) {
    return this.keysDown.has(this.normalizeCode(code));
  }

  wasPressed(code) {
    const normalizedCode = this.normalizeCode(code);
    if (!this.keysPressed.has(normalizedCode)) return false;
    this.keysPressed.delete(normalizedCode);
    return true;
  }

  endFrame() {
    this.keysPressed.clear();
  }

  clear() {
    this.keysDown.clear();
    this.keysPressed.clear();
    this.physicalKeysDown.clear();
    this.virtualSources.clear();
    this.syncAllKeyStates();
  }
}

class ResponsiveCanvasController {
  constructor(canvas, frame, modalElement) {
    this.canvas = canvas;
    this.frame = frame;
    this.modalElement = modalElement;
    this.logicalWidth = 800;
    this.logicalHeight = 600;
    this.resizeTimer = null;
    this.resizeCanvas = this.resizeCanvas.bind(this);
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener("resize", this.handleResize, { passive: true });
    window.addEventListener("orientationchange", this.handleResize, { passive: true });
    window.visualViewport?.addEventListener("resize", this.handleResize, { passive: true });
  }

  setLogicalSize() {
    this.logicalWidth = 800;
    this.logicalHeight = 600;
    if (this.canvas.width !== 800) this.canvas.width = 800;
    if (this.canvas.height !== 600) this.canvas.height = 600;
    this.canvas.style.aspectRatio = "4 / 3";
    this.frame.style.aspectRatio = "4 / 3";
    this.requestResize(true);
  }

  handleResize() {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.resizeCanvas();
    }, 100);
  }

  requestResize(immediate = false) {
    window.clearTimeout(this.resizeTimer);
    if (immediate) {
      this.resizeTimer = null;
      this.resizeCanvas();
      return;
    }
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = null;
      this.resizeCanvas();
    }, 100);
  }

  resizeCanvas() {
    const host = this.frame.parentElement;
    if (!host || !this.modalElement.classList.contains("is-open")) return;
    const viewportHeight = Math.max(1, window.visualViewport?.height || window.innerHeight);
    const hostWidth = Math.max(1, Math.floor(host.getBoundingClientRect().width));
    const frameTop = Math.max(0, this.frame.getBoundingClientRect().top);
    const touchPortrait = "ontouchstart" in window && window.innerHeight >= window.innerWidth;
    const controlsReserve = touchPortrait ? 184 : 18;
    const maxHeight = Math.max(1, Math.floor(viewportHeight - frameTop - controlsReserve));
    let visualWidth = Math.floor(Math.min(hostWidth, maxHeight * (4 / 3)));
    visualWidth = Math.max(4, visualWidth - (visualWidth % 4));
    const visualHeight = visualWidth * 0.75;
    this.canvas.style.width = `${visualWidth}px`;
    this.canvas.style.height = `${visualHeight}px`;
    this.frame.style.width = `${visualWidth}px`;
    this.frame.style.height = `${visualHeight}px`;
    this.frame.dataset.canvasScale = (visualWidth / 800).toFixed(4);
  }
}

class TouchArcadeControls {
  constructor(input, modalElement, onLayoutChange = null) {
    this.input = input;
    this.modalElement = modalElement;
    this.onLayoutChange = typeof onLayoutChange === "function" ? onLayoutChange : null;
    this.isTouchDevice = "ontouchstart" in window;
    this.root = null;
    this.joystick = null;
    this.knob = null;
    this.activeJoystickTouch = null;
    this.activeButtonTouches = new Map();
    this.directionState = {
      ArrowLeft: false,
      ArrowRight: false,
      ArrowUp: false,
      ArrowDown: false
    };
    this.boundReleaseAll = this.releaseAll.bind(this);

    if (!this.isTouchDevice) return;
    document.documentElement.classList.add("touch-arcade");
    this.inject();
    window.addEventListener("blur", this.boundReleaseAll);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
  }

  inject() {
    const root = document.createElement("div");
    root.id = "touchArcadeControls";
    root.className = "touch-arcade-controls";
    root.setAttribute("aria-label", "Controles táctiles del arcade");
    root.innerHTML = `
      <div class="touch-dpad-cluster">
        <div class="touch-joystick shadow-[0_0_20px_rgba(0,255,255,0.45)]" data-touch-joystick role="group" aria-label="Joystick direccional">
          <span class="touch-dpad-mark touch-dpad-up">▲</span>
          <span class="touch-dpad-mark touch-dpad-right">▶</span>
          <span class="touch-dpad-mark touch-dpad-down">▼</span>
          <span class="touch-dpad-mark touch-dpad-left">◀</span>
          <div class="touch-joystick-knob" data-touch-knob></div>
        </div>
        <span class="touch-control-caption">MOVE</span>
      </div>
      <div class="touch-action-cluster">
        <button class="touch-action-button touch-action-b shadow-[0_0_15px_#ff007f] active:shadow-[0_0_30px_#ff007f]" type="button" data-touch-button="Enter" aria-label="Botón B, iniciar o reiniciar">
          <strong>B</strong><small>ENTER</small>
        </button>
        <button class="touch-action-button touch-action-a shadow-[0_0_15px_#ff007f] active:shadow-[0_0_30px_#ff007f]" type="button" data-touch-button="Space" aria-label="Botón A, acción o disparo">
          <strong>A</strong><small>FIRE</small>
        </button>
      </div>
    `;
    this.modalElement.appendChild(root);
    this.root = root;
    this.joystick = root.querySelector("[data-touch-joystick]");
    this.knob = root.querySelector("[data-touch-knob]");
    this.bindJoystick();
    root.querySelectorAll("[data-touch-button]").forEach((button) => this.bindActionButton(button));
  }

  setVisible(visible) {
    if (!this.root) return;
    this.root.classList.toggle("is-visible", Boolean(visible));
    if (!visible) this.releaseAll();
    requestAnimationFrame(() => this.onLayoutChange?.());
  }

  bindJoystick() {
    const prevent = (event) => event.preventDefault();
    this.joystick.addEventListener("touchstart", (event) => {
      event.preventDefault();
      if (this.activeJoystickTouch !== null || event.changedTouches.length === 0) return;
      const touch = event.changedTouches[0];
      this.activeJoystickTouch = touch.identifier;
      this.joystick.classList.add("is-active");
      this.updateJoystickFromTouch(touch);
    }, { passive: false });

    this.joystick.addEventListener("touchmove", (event) => {
      event.preventDefault();
      const touch = Array.from(event.touches).find((item) => item.identifier === this.activeJoystickTouch);
      if (touch) this.updateJoystickFromTouch(touch);
    }, { passive: false });

    const finishJoystick = (event) => {
      event.preventDefault();
      const ended = Array.from(event.changedTouches).some((item) => item.identifier === this.activeJoystickTouch);
      if (!ended) return;
      this.activeJoystickTouch = null;
      this.resetJoystick();
    };

    this.joystick.addEventListener("touchend", finishJoystick, { passive: false });
    this.joystick.addEventListener("touchcancel", finishJoystick, { passive: false });
    this.joystick.addEventListener("gesturestart", prevent, { passive: false });
  }

  updateJoystickFromTouch(touch) {
    const rect = this.joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = touch.clientX - centerX;
    const rawY = touch.clientY - centerY;
    const radius = Math.max(1, rect.width * 0.31);
    const distance = Math.hypot(rawX, rawY);
    const clampFactor = distance > radius ? radius / distance : 1;
    const clampedX = rawX * clampFactor;
    const clampedY = rawY * clampFactor;
    const normalizedX = clampedX / radius;
    const normalizedY = clampedY / radius;
    const deadZone = 0.28;

    this.knob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    this.setDirection("ArrowLeft", normalizedX < -deadZone);
    this.setDirection("ArrowRight", normalizedX > deadZone);
    this.setDirection("ArrowUp", normalizedY < -deadZone);
    this.setDirection("ArrowDown", normalizedY > deadZone);
  }

  setDirection(code, active) {
    if (this.directionState[code] === active) return;
    this.directionState[code] = active;
    this.input.setVirtualKey(code, active, `touch-joystick-${code}`);
    const directionName = code.replace("Arrow", "").toLowerCase();
    this.joystick.classList.toggle(`is-${directionName}`, active);
  }

  resetJoystick() {
    for (const code of Object.keys(this.directionState)) this.setDirection(code, false);
    if (this.knob) this.knob.style.transform = "translate(0px, 0px)";
    if (this.joystick) this.joystick.classList.remove("is-active");
  }

  bindActionButton(button) {
    const code = button.dataset.touchButton;
    const sourcePrefix = `touch-button-${code}`;

    button.addEventListener("touchstart", (event) => {
      event.preventDefault();
      for (const touch of event.changedTouches) {
        const sourceId = `${sourcePrefix}-${touch.identifier}`;
        this.activeButtonTouches.set(touch.identifier, { code, sourceId, button });
        this.input.setVirtualKey(code, true, sourceId);
      }
      button.classList.add("is-active");
    }, { passive: false });

    button.addEventListener("touchmove", (event) => {
      event.preventDefault();
    }, { passive: false });

    const release = (event) => {
      event.preventDefault();
      for (const touch of event.changedTouches) {
        const active = this.activeButtonTouches.get(touch.identifier);
        if (!active || active.button !== button) continue;
        this.input.setVirtualKey(active.code, false, active.sourceId);
        this.activeButtonTouches.delete(touch.identifier);
      }
      const stillActive = Array.from(this.activeButtonTouches.values()).some((item) => item.button === button);
      button.classList.toggle("is-active", stillActive);
    };

    button.addEventListener("touchend", release, { passive: false });
    button.addEventListener("touchcancel", release, { passive: false });
  }

  releaseAll() {
    this.resetJoystick();
    for (const active of this.activeButtonTouches.values()) {
      this.input.setVirtualKey(active.code, false, active.sourceId);
      active.button.classList.remove("is-active");
    }
    this.activeButtonTouches.clear();
  }
}

class AlienInvadersGame {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.input = engine.input;
    this.width = engine.width;
    this.height = engine.height;
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.sessionTime = 0;
    this.alienAnimationFrame = 0;
    this.alienAnimationTimer = 0;
    this.alienMarchStep = 0;
    this.formationDirection = 1;
    this.formationBaseSpeed = 42;
    this.waveAlienCount = 0;
    this.enemyShotTimer = 1;
    this.waveTransition = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.playerBullets = [];
    this.enemyBullets = [];
    this.aliens = [];
    this.particles = [];
    this.player = {
      x: this.width / 2,
      y: this.height - 58,
      speed: 410,
      width: 54,
      height: 34,
      shotCooldown: 0,
      invulnerable: 0
    };
  }

  start() {
    this.state = GAME_STATES.PLAYING;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.sessionTime = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.alienMarchStep = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height - 58;
    this.player.shotCooldown = 0;
    this.player.invulnerable = 1.25;
    this.playerBullets.length = 0;
    this.enemyBullets.length = 0;
    this.particles.length = 0;
    this.spawnWave();
    this.engine.onGameStart();
  }

  resetToMenu() {
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.sessionTime = 0;
    this.waveTransition = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.alienMarchStep = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height - 58;
    this.player.shotCooldown = 0;
    this.player.invulnerable = 0;
    this.playerBullets.length = 0;
    this.enemyBullets.length = 0;
    this.aliens.length = 0;
    this.particles.length = 0;
  }

  endGame() {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.state = GAME_STATES.GAME_OVER;
    this.playerBullets.length = 0;
    this.enemyBullets.length = 0;
    this.createExplosion(this.player.x, this.player.y, "#42f5ff", 18);
    this.screenShake = 12;
    this.engine.audio.explosion(1.15);
    this.engine.onGameOver(this.score);
  }

  handlePrimaryAction() {
    if (this.state === GAME_STATES.MENU || this.state === GAME_STATES.GAME_OVER) {
      this.start();
    } else {
      this.endGame();
    }
  }

  spawnWave() {
    this.aliens.length = 0;
    this.playerBullets.length = 0;
    this.enemyBullets.length = 0;
    this.formationDirection = 1;
    this.alienAnimationFrame = 0;
    this.alienAnimationTimer = 0;
    this.alienMarchStep = 0;
    this.waveTransition = 0;
    this.enemyShotTimer = Math.max(0.45, 1.15 - this.wave * 0.045);
    this.formationBaseSpeed = 38 + this.wave * 6;

    const columns = Math.min(10, 8 + Math.floor((this.wave - 1) / 2));
    const rows = Math.min(5, 4 + Math.floor((this.wave - 1) / 3));
    const spacingX = 75;
    const spacingY = 54;
    const startX = (this.width - (columns - 1) * spacingX) / 2;
    const startY = 92;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const type = row === 0 || (this.wave >= 4 && row === 1 && column % 3 === 0) ? 2 : 1;
        this.aliens.push({
          type,
          x: startX + column * spacingX,
          y: startY + row * spacingY,
          width: type === 2 ? 50 : 44,
          height: type === 2 ? 32 : 36,
          column,
          phase: (column + row) % 2,
          alive: true
        });
      }
    }

    this.waveAlienCount = this.aliens.length;
  }

  update(deltaTime) {
    this.updateParticles(deltaTime);
    this.screenShake = Math.max(0, this.screenShake - deltaTime * 38);
    this.damageFlash = Math.max(0, this.damageFlash - deltaTime * 2.8);
    this.comboTimer = Math.max(0, this.comboTimer - deltaTime);
    if (this.comboTimer === 0) this.comboCount = 0;

    if (this.state === GAME_STATES.MENU) {
      this.alienAnimationTimer += deltaTime;
      if (this.alienAnimationTimer >= 0.42) {
        this.alienAnimationTimer = 0;
        this.alienAnimationFrame = 1 - this.alienAnimationFrame;
      }
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    if (this.state === GAME_STATES.GAME_OVER) {
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    this.sessionTime += deltaTime;
    this.player.invulnerable = Math.max(0, this.player.invulnerable - deltaTime);
    this.player.shotCooldown = Math.max(0, this.player.shotCooldown - deltaTime);

    if (this.waveTransition > 0) {
      this.waveTransition -= deltaTime;
      if (this.waveTransition <= 0) {
        this.wave += 1;
        this.player.invulnerable = 1.2;
        this.spawnWave();
      }
      return;
    }

    this.updatePlayer(deltaTime);
    this.updatePlayerBullets(deltaTime);
    this.updateAlienFormation(deltaTime);
    this.updateEnemyFire(deltaTime);
    this.updateEnemyBullets(deltaTime);
    this.resolveCollisions();

    const aliveCount = this.getAliveAlienCount();
    if (aliveCount === 0 && this.waveTransition <= 0) {
      this.score += 500 * this.wave;
      this.waveTransition = 1.65;
      this.enemyBullets.length = 0;
    }
  }

  updatePlayer(deltaTime) {
    let direction = 0;
    if (this.input.isDown("ArrowLeft")) direction -= 1;
    if (this.input.isDown("ArrowRight")) direction += 1;

    this.player.x += direction * this.player.speed * deltaTime;
    const halfWidth = this.player.width / 2;
    this.player.x = Math.max(halfWidth + 18, Math.min(this.width - halfWidth - 18, this.player.x));

    if (this.input.isDown("Space") && this.player.shotCooldown <= 0 && this.playerBullets.length < 3) {
      this.playerBullets.push({
        x: this.player.x,
        y: this.player.y - 27,
        width: 5,
        height: 17,
        speed: 660
      });
      this.player.shotCooldown = 0.2;
      this.engine.audio.playArcadeSound("space-invaders", "player_laser");
      this.engine.haptics.shot();
      this.engine.emitToastPulse();
    }
  }

  updatePlayerBullets(deltaTime) {
    for (let index = this.playerBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.playerBullets[index];
      bullet.y -= bullet.speed * deltaTime;
      if (bullet.y + bullet.height < 0) this.playerBullets.splice(index, 1);
    }
  }

  updateAlienFormation(deltaTime) {
    const aliveAliens = this.aliens.filter((alien) => alien.alive);
    if (aliveAliens.length === 0) return;

    const remainingRatio = aliveAliens.length / Math.max(1, this.waveAlienCount);
    const marchInterval = Math.max(0.085, (0.42 - this.wave * 0.012) * (0.45 + remainingRatio * 0.55));
    this.alienAnimationTimer += deltaTime;
    if (this.alienAnimationTimer >= marchInterval) {
      this.alienAnimationTimer %= marchInterval;
      this.alienAnimationFrame = 1 - this.alienAnimationFrame;
      this.engine.audio.playArcadeSound("space-invaders", "invader_march", {
        step: this.alienMarchStep,
        duration: Math.min(0.095, marchInterval * 0.62),
        remainingRatio
      });
      this.alienMarchStep = (this.alienMarchStep + 1) % 4;
    }


    const pressureMultiplier = 1 + (1 - remainingRatio) * 2.35;
    const movement = this.formationDirection * this.formationBaseSpeed * pressureMultiplier * deltaTime;
    const leftEdge = Math.min(...aliveAliens.map((alien) => alien.x - alien.width / 2));
    const rightEdge = Math.max(...aliveAliens.map((alien) => alien.x + alien.width / 2));
    const reachedEdge = leftEdge + movement < 28 || rightEdge + movement > this.width - 28;

    if (reachedEdge) {
      this.formationDirection *= -1;
      const descent = 15 + Math.min(12, this.wave * 1.4);
      for (const alien of aliveAliens) alien.y += descent;
      this.alienAnimationFrame = 1 - this.alienAnimationFrame;
    } else {
      for (const alien of aliveAliens) alien.x += movement;
    }

    const invasionLine = this.player.y - 31;
    if (aliveAliens.some((alien) => alien.y + alien.height / 2 >= invasionLine)) {
      this.lives = 0;
      this.endGame();
    }
  }

  updateEnemyFire(deltaTime) {
    this.enemyShotTimer -= deltaTime;
    if (this.enemyShotTimer > 0 || this.enemyBullets.length >= 8) return;

    const shootersByColumn = new Map();
    for (const alien of this.aliens) {
      if (!alien.alive) continue;
      const current = shootersByColumn.get(alien.column);
      if (!current || alien.y > current.y) shootersByColumn.set(alien.column, alien);
    }

    const shooters = Array.from(shootersByColumn.values());
    if (shooters.length > 0) {
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      this.enemyBullets.push({
        x: shooter.x,
        y: shooter.y + shooter.height / 2 + 5,
        radius: 4,
        speed: 245 + this.wave * 17,
        phase: Math.random() * Math.PI * 2
      });
    }

    const minimumDelay = Math.max(0.3, 0.9 - this.wave * 0.04);
    this.enemyShotTimer = minimumDelay + Math.random() * 0.75;
  }

  updateEnemyBullets(deltaTime) {
    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.enemyBullets[index];
      bullet.y += bullet.speed * deltaTime;
      bullet.phase += deltaTime * 9;
      if (bullet.y - bullet.radius > this.height) this.enemyBullets.splice(index, 1);
    }
  }

  resolveCollisions() {
    for (let bulletIndex = this.playerBullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = this.playerBullets[bulletIndex];
      let targetIndex = -1;

      for (let alienIndex = 0; alienIndex < this.aliens.length; alienIndex += 1) {
        const alien = this.aliens[alienIndex];
        if (!alien.alive) continue;
        if (this.rectanglesOverlap(
          bullet.x - bullet.width / 2,
          bullet.y - bullet.height / 2,
          bullet.width,
          bullet.height,
          alien.x - alien.width / 2,
          alien.y - alien.height / 2,
          alien.width,
          alien.height
        )) {
          targetIndex = alienIndex;
          break;
        }
      }

      if (targetIndex >= 0) {
        const alien = this.aliens[targetIndex];
        alien.alive = false;
        this.playerBullets.splice(bulletIndex, 1);
        this.score += alien.type === 2 ? 220 : 100;
        this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
        this.comboTimer = 1.25;
        if (this.comboCount >= 3) {
          const comboBonus = 100 * (this.comboCount - 2);
          this.score += comboBonus;
          this.engine.showCanvasMessage(`+${comboBonus} COMBO`, {
            x: alien.x,
            y: alien.y - 12,
            color: alien.type === 2 ? "#ff66f7" : "#b7ff3c",
            size: 16,
            duration: 1.05,
            rise: 42,
            blink: 12
          });
        }
        this.createExplosion(alien.x, alien.y, alien.type === 2 ? "#ff3cf7" : "#9dff5a");
        this.engine.audio.playArcadeSound("space-invaders", "invader_death", {
          intensity: alien.type === 2 ? 1.18 : 0.92
        });
        this.screenShake = Math.max(this.screenShake, alien.type === 2 ? 5 : 2.5);
      }
    }

    if (this.player.invulnerable > 0) return;

    const playerHitbox = {
      x: this.player.x - 20,
      y: this.player.y - 17,
      width: 40,
      height: 30
    };

    for (let index = this.enemyBullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.enemyBullets[index];
      if (this.circleIntersectsRectangle(bullet.x, bullet.y, bullet.radius + 2, playerHitbox)) {
        this.enemyBullets.splice(index, 1);
        this.damagePlayer();
        break;
      }
    }
  }

  damagePlayer() {
    this.lives -= 1;
    this.damageFlash = 0.78;
    this.screenShake = 11;
    this.createExplosion(this.player.x, this.player.y, "#42f5ff", 15);
    this.engine.audio.explosion(0.9);
    this.engine.haptics.damage();
    this.engine.showCanvasMessage(this.lives > 0 ? "LIFE LOST" : "FINAL HIT", {
      color: "#ff416d", size: 20, duration: 1.1, blink: 10
    });
    this.enemyBullets.length = 0;

    if (this.lives <= 0) {
      this.endGame();
      return;
    }

    this.player.x = this.width / 2;
    this.player.invulnerable = 2;
  }

  createExplosion(x, y, color, explicitCount = null) {
    const count = explicitCount ?? (10 + Math.floor(Math.random() * 6));
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 210;
      const life = 0.42 + Math.random() * 0.55;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        radius: 1.7 + Math.random() * 3.8,
        color,
        drag: 0.92 + Math.random() * 0.04
      });
    }
  }

  updateParticles(deltaTime) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= deltaTime;
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vx *= Math.pow(particle.drag, deltaTime * 60);
      particle.vy *= Math.pow(particle.drag, deltaTime * 60);
      particle.vy += 22 * deltaTime;
      if (particle.life <= 0) this.particles.splice(index, 1);
    }
  }

  getAliveAlienCount() {
    let count = 0;
    for (const alien of this.aliens) if (alien.alive) count += 1;
    return count;
  }

  getTelemetry() {
    return {
      state: this.state === GAME_STATES.GAME_OVER ? "GAME OVER" : this.state,
      score: this.score.toString().padStart(6, "0"),
      primaryMetric: `${Math.max(0, this.lives)} / 3`,
      secondaryMetric: this.wave.toString().padStart(2, "0"),
      primaryButton: this.state === GAME_STATES.PLAYING ? "ABORT MISSION" : this.state === GAME_STATES.GAME_OVER ? "RETRY MISSION" : "START MISSION"
    };
  }

  draw() {
    const ctx = this.ctx;
    const shakeX = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;
    const shakeY = this.screenShake > 0 ? (Math.random() - 0.5) * this.screenShake : 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);

    if (this.state === GAME_STATES.MENU) {
      this.drawMenu(ctx);
    } else {
      this.drawBattlefield(ctx);
      this.drawParticles(ctx);
      this.drawPlayerBullets(ctx);
      this.drawEnemyBullets(ctx);
      this.drawAliens(ctx);
      this.drawPlayer(ctx);
      this.drawHud(ctx);

      if (this.waveTransition > 0) this.drawWaveTransition(ctx);
      if (this.state === GAME_STATES.GAME_OVER) this.drawGameOver(ctx);
    }

    ctx.restore();

    if (this.damageFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 55, 108, ${this.damageFlash * 0.24})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  drawMenu(ctx) {
    const time = performance.now() * 0.001;
    const pulse = 0.68 + Math.sin(time * 3.2) * 0.18;

    this.drawBattlefield(ctx, true);

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#42f5ff";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 24;
    ctx.font = "900 38px Orbitron, sans-serif";
    ctx.fillText("ALIEN INVADERS", this.width / 2, 112);

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.55)";
    ctx.font = "700 14px Rajdhani, sans-serif";
    ctx.fillText("DEFENSA ORBITAL / PROTOCOLO DE COMBATE NEÓN", this.width / 2, 142);

    this.drawAlienType1(ctx, this.width / 2 - 118, 232, 1.35, this.alienAnimationFrame, "#9dff5a");
    this.drawAlienType2(ctx, this.width / 2 + 118, 230, 1.35, "#ff3cf7");
    this.drawPlayerShip(ctx, this.width / 2, 344, 1.45, false);

    ctx.fillStyle = "rgba(248,247,255,.72)";
    ctx.font = "600 16px Rajdhani, sans-serif";
    ctx.fillText("← → MOVER     ·     ESPACIO DISPARAR     ·     MÁXIMO 3 PROYECTILES", this.width / 2, 420);

    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#42f5ff";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 16;
    ctx.font = "800 14px Orbitron, sans-serif";
    ctx.fillText("PRESS SPACE TO START", this.width / 2, 466);
    ctx.restore();
  }

  drawBattlefield(ctx, subdued = false) {
    const gradient = ctx.createRadialGradient(this.width / 2, 180, 30, this.width / 2, 180, 580);
    gradient.addColorStop(0, subdued ? "rgba(66,245,255,.075)" : "rgba(66,245,255,.055)");
    gradient.addColorStop(0.55, "rgba(255,60,247,.018)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(66,245,255,.075)";
    const horizon = 365;
    for (let y = horizon; y <= this.height; y += 24) {
      const ratio = (y - horizon) / (this.height - horizon);
      const projectedY = horizon + ratio * ratio * (this.height - horizon);
      ctx.beginPath();
      ctx.moveTo(0, projectedY);
      ctx.lineTo(this.width, projectedY);
      ctx.stroke();
    }
    for (let x = -this.width; x <= this.width * 2; x += 86) {
      ctx.beginPath();
      ctx.moveTo(this.width / 2, horizon);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPlayer(ctx) {
    const blinking = this.player.invulnerable > 0 && Math.floor(this.player.invulnerable * 12) % 2 === 0;
    if (blinking) return;
    this.drawPlayerShip(ctx, this.player.x, this.player.y, 1, true);
  }

  drawPlayerShip(ctx, x, y, scale = 1, thrusterActive = true) {
    const flicker = 13 + Math.random() * 12;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (thrusterActive) {
      const flameGradient = ctx.createLinearGradient(0, 13, 0, 13 + flicker);
      flameGradient.addColorStop(0, "rgba(255,255,255,.95)");
      flameGradient.addColorStop(0.35, "rgba(66,245,255,.95)");
      flameGradient.addColorStop(1, "rgba(66,245,255,0)");
      ctx.fillStyle = flameGradient;
      ctx.shadowColor = "#42f5ff";
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.moveTo(-7, 13);
      ctx.quadraticCurveTo(-4, 21 + flicker * 0.45, 0, 15 + flicker);
      ctx.quadraticCurveTo(4, 21 + flicker * 0.45, 7, 13);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(29, 22, 65, .92)";
    ctx.strokeStyle = "#42f5ff";
    ctx.lineWidth = 2.3;

    ctx.beginPath();
    ctx.moveTo(-7, -21);
    ctx.lineTo(-27, 15);
    ctx.lineTo(-11, 10);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(7, -21);
    ctx.lineTo(27, 15);
    ctx.lineTo(11, 10);
    ctx.lineTo(4, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const hullGradient = ctx.createLinearGradient(0, -27, 0, 18);
    hullGradient.addColorStop(0, "rgba(214,252,255,.98)");
    hullGradient.addColorStop(0.24, "rgba(66,245,255,.8)");
    hullGradient.addColorStop(1, "rgba(26,16,63,.95)");
    ctx.fillStyle = hullGradient;
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.quadraticCurveTo(10, -13, 10, 7);
    ctx.lineTo(6, 17);
    ctx.lineTo(-6, 17);
    ctx.lineTo(-10, 7);
    ctx.quadraticCurveTo(-10, -13, 0, -27);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ff3cf7";
    ctx.shadowColor = "#ff3cf7";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(0, -6, 5.4, 8.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(-2.2, -31);
    ctx.lineTo(2.2, -31);
    ctx.lineTo(3.4, -18);
    ctx.lineTo(-3.4, -18);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.76)";
    ctx.lineWidth = 1.3;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-18, 7);
    ctx.lineTo(-10, 5);
    ctx.moveTo(18, 7);
    ctx.lineTo(10, 5);
    ctx.stroke();
    ctx.restore();
  }

  drawAliens(ctx) {
    for (const alien of this.aliens) {
      if (!alien.alive) continue;
      if (alien.type === 1) {
        this.drawAlienType1(ctx, alien.x, alien.y, 1, this.alienAnimationFrame ^ alien.phase, "#9dff5a");
      } else {
        this.drawAlienType2(ctx, alien.x, alien.y, 1, "#ff3cf7");
      }
    }
  }

  drawAlienType1(ctx, x, y, scale = 1, frame = 0, color = "#9dff5a") {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(12, 32, 25, .9)";
    ctx.lineWidth = 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;

    ctx.beginPath();
    ctx.moveTo(-18, 5);
    ctx.quadraticCurveTo(-20, -10, -10, -15);
    ctx.quadraticCurveTo(0, -21, 10, -15);
    ctx.quadraticCurveTo(20, -10, 18, 5);
    ctx.lineTo(12, 12);
    ctx.lineTo(-12, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(-7, -4, 2.6, 0, Math.PI * 2);
    ctx.arc(7, -4, 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    const outerDrop = frame === 0 ? 10 : 16;
    const innerDrop = frame === 0 ? 16 : 10;
    ctx.beginPath();
    ctx.moveTo(-13, 10);
    ctx.lineTo(-18, outerDrop + 9);
    ctx.lineTo(-23, outerDrop + 6);
    ctx.moveTo(-6, 11);
    ctx.lineTo(-8, innerDrop + 8);
    ctx.lineTo(-3, innerDrop + 12);
    ctx.moveTo(6, 11);
    ctx.lineTo(8, innerDrop + 8);
    ctx.lineTo(3, innerDrop + 12);
    ctx.moveTo(13, 10);
    ctx.lineTo(18, outerDrop + 9);
    ctx.lineTo(23, outerDrop + 6);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(-10, -12);
    ctx.quadraticCurveTo(0, -17, 10, -12);
    ctx.stroke();
    ctx.restore();
  }

  drawAlienType2(ctx, x, y, scale = 1, color = "#ff3cf7") {
    const pulse = 0.75 + Math.sin(performance.now() * 0.006 + x * 0.01) * 0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;

    ctx.fillStyle = "rgba(42, 12, 54, .9)";
    ctx.beginPath();
    ctx.moveTo(-24, 3);
    ctx.lineTo(-13, -8);
    ctx.quadraticCurveTo(0, -18, 13, -8);
    ctx.lineTo(24, 3);
    ctx.lineTo(15, 12);
    ctx.lineTo(-15, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.ellipse(0, -6, 10, 8, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-24, 3);
    ctx.lineTo(-31, 8);
    ctx.lineTo(-19, 13);
    ctx.moveTo(24, 3);
    ctx.lineTo(31, 8);
    ctx.lineTo(19, 13);
    ctx.stroke();

    const coreGradient = ctx.createRadialGradient(0, 4, 1, 0, 4, 9);
    coreGradient.addColorStop(0, "rgba(255,255,255,1)");
    coreGradient.addColorStop(0.32, color);
    coreGradient.addColorStop(1, "rgba(255,60,247,0)");
    ctx.globalAlpha = pulse;
    ctx.fillStyle = coreGradient;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(0, 4, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(-14, 5, 2, 0, Math.PI * 2);
    ctx.arc(14, 5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayerBullets(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const bullet of this.playerBullets) {
      const gradient = ctx.createLinearGradient(bullet.x, bullet.y + 10, bullet.x, bullet.y - 12);
      gradient.addColorStop(0, "rgba(66,245,255,0)");
      gradient.addColorStop(0.45, "#42f5ff");
      gradient.addColorStop(1, "rgba(255,255,255,1)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "#42f5ff";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(bullet.x, bullet.y - bullet.height / 2);
      ctx.lineTo(bullet.x + bullet.width / 2, bullet.y + bullet.height / 2);
      ctx.lineTo(bullet.x - bullet.width / 2, bullet.y + bullet.height / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawEnemyBullets(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const bullet of this.enemyBullets) {
      const wobble = Math.sin(bullet.phase) * 3;
      ctx.strokeStyle = "#ff3cf7";
      ctx.shadowColor = "#ff3cf7";
      ctx.shadowBlur = 15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(bullet.x + wobble, bullet.y - 9);
      ctx.quadraticCurveTo(bullet.x - wobble, bullet.y, bullet.x + wobble, bullet.y + 9);
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(bullet.x + wobble, bullet.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of this.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.25, particle.radius * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHud(ctx) {
    const alive = this.getAliveAlienCount();
    ctx.save();
    ctx.fillStyle = "rgba(3,1,7,.72)";
    ctx.strokeStyle = "rgba(66,245,255,.24)";
    ctx.lineWidth = 1;
    ctx.fillRect(18, 16, 924, 52);
    ctx.strokeRect(18.5, 16.5, 923, 51);

    ctx.fillStyle = "rgba(248,247,255,.42)";
    ctx.font = "700 11px Rajdhani, sans-serif";
    ctx.fillText("SCORE", 36, 38);
    ctx.fillText("WAVE", 262, 38);
    ctx.fillText("ALIENS", 405, 38);
    ctx.fillText("LIVES", 710, 38);

    ctx.fillStyle = "#42f5ff";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 10;
    ctx.font = "800 17px Orbitron, sans-serif";
    ctx.fillText(this.score.toString().padStart(6, "0"), 92, 42);
    ctx.fillText(this.wave.toString().padStart(2, "0"), 313, 42);
    ctx.fillText(alive.toString().padStart(2, "0"), 464, 42);

    for (let life = 0; life < this.lives; life += 1) {
      this.drawMiniShip(ctx, 785 + life * 45, 41);
    }
    ctx.restore();
  }

  drawMiniShip(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "#42f5ff";
    ctx.fillStyle = "rgba(66,245,255,.18)";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(11, 8);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 9);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-11, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawWaveTransition(ctx) {
    const alpha = Math.min(1, this.waveTransition * 1.5);
    ctx.save();
    ctx.fillStyle = `rgba(2,1,6,${0.38 * alpha})`;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#9dff5a";
    ctx.shadowColor = "#9dff5a";
    ctx.shadowBlur = 22;
    ctx.font = "900 32px Orbitron, sans-serif";
    ctx.fillText("WAVE CLEARED", this.width / 2, 260);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.62)";
    ctx.font = "700 14px Rajdhani, sans-serif";
    ctx.fillText(`PREPARING WAVE ${(this.wave + 1).toString().padStart(2, "0")}`, this.width / 2, 293);
    ctx.restore();
  }

  drawGameOver(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(2,1,6,.82)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff3cf7";
    ctx.shadowColor = "#ff3cf7";
    ctx.shadowBlur = 28;
    ctx.font = "900 45px Orbitron, sans-serif";
    ctx.fillText("MISSION FAILED", this.width / 2, 228);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.65)";
    ctx.font = "700 16px Rajdhani, sans-serif";
    ctx.fillText(`FINAL SCORE ${this.score.toString().padStart(6, "0")}  ·  WAVE ${this.wave.toString().padStart(2, "0")}`, this.width / 2, 273);
    ctx.fillStyle = "#42f5ff";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 15;
    ctx.font = "800 14px Orbitron, sans-serif";
    ctx.fillText("PRESS SPACE TO RETRY", this.width / 2, 335);
    ctx.restore();
  }

  rectanglesOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  circleIntersectsRectangle(cx, cy, radius, rectangle) {
    const nearestX = Math.max(rectangle.x, Math.min(cx, rectangle.x + rectangle.width));
    const nearestY = Math.max(rectangle.y, Math.min(cy, rectangle.y + rectangle.height));
    const deltaX = cx - nearestX;
    const deltaY = cy - nearestY;
    return deltaX * deltaX + deltaY * deltaY <= radius * radius;
  }
}

const NEON_MAZE_LAYOUT = Object.freeze([
  "###############################",
  "#o...........................o#",
  "#..####..####..#..####..####..#",
  "#..####..####..#..####..####..#",
  "#..............#..............#",
  "#.............................#",
  "#..###..###############..###..#",
  "#..###..#####.....#####..###..#",
  "#..###......#.....#......###..#",
  "#...........###.###...........#",
  "#........####B.K.I####........#",
  "#..####..####.....####..####..#",
  "#..####..######.######..####..#",
  "#.............................#",
  "#............#####............#",
  "#.............................#",
  "#..####..####..#..####..####..#",
  "#..####..####..P..####..####..#",
  "#..............#..............#",
  "#o...........................o#",
  "###############################"
]);

const MAZE_DIRECTIONS = Object.freeze({
  NONE: Object.freeze({ x: 0, y: 0, angle: 0, name: "NONE" }),
  RIGHT: Object.freeze({ x: 1, y: 0, angle: 0, name: "RIGHT" }),
  DOWN: Object.freeze({ x: 0, y: 1, angle: Math.PI / 2, name: "DOWN" }),
  LEFT: Object.freeze({ x: -1, y: 0, angle: Math.PI, name: "LEFT" }),
  UP: Object.freeze({ x: 0, y: -1, angle: -Math.PI / 2, name: "UP" })
});

const MAZE_DIRECTION_LIST = Object.freeze([
  MAZE_DIRECTIONS.UP,
  MAZE_DIRECTIONS.LEFT,
  MAZE_DIRECTIONS.DOWN,
  MAZE_DIRECTIONS.RIGHT
]);

class NeonPacmanGame {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.input = engine.input;
    this.width = engine.width;
    this.height = engine.height;
    this.columns = NEON_MAZE_LAYOUT[0].length;
    this.rows = NEON_MAZE_LAYOUT.length;
    this.tileSize = 22;
    this.mazeWidth = this.columns * this.tileSize;
    this.mazeHeight = this.rows * this.tileSize;
    this.originX = (this.width - this.mazeWidth) / 2;
    this.originY = 67;
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.gameTime = 0;
    this.frightenedTimer = 0;
    this.frightenedChain = 0;
    this.levelTransition = 0;
    this.roundPauseTimer = 0;
    this.damageFlash = 0;
    this.pelletsRemaining = 0;
    this.maze = [];
    this.particles = [];
    this.playerSpawn = { column: 15, row: 17 };
    this.ghostSpawns = new Map();
    this.player = this.createPlayer();
    this.ghosts = [];
    this.loadLevel();
  }

  createPlayer() {
    return {
      gridX: this.playerSpawn.column,
      gridY: this.playerSpawn.row,
      direction: MAZE_DIRECTIONS.LEFT,
      queuedDirection: MAZE_DIRECTIONS.LEFT,
      speed: 5.35,
      radius: this.tileSize * 0.39,
      invulnerable: 0
    };
  }

  createGhost(name, color, spawn, direction) {
    return {
      name,
      color,
      gridX: spawn.column,
      gridY: spawn.row,
      spawnColumn: spawn.column,
      spawnRow: spawn.row,
      direction,
      speed: 4.25,
      radius: this.tileSize * 0.4,
      respawnTimer: 0,
      personalityOffset: Math.random() * 100
    };
  }

  loadLevel() {
    this.maze = [];
    this.ghostSpawns.clear();
    this.pelletsRemaining = 0;

    for (let row = 0; row < this.rows; row += 1) {
      const mazeRow = [];
      for (let column = 0; column < this.columns; column += 1) {
        const symbol = NEON_MAZE_LAYOUT[row][column];
        if (symbol === "#") {
          mazeRow.push(1);
        } else if (symbol === ".") {
          mazeRow.push(2);
          this.pelletsRemaining += 1;
        } else if (symbol === "o") {
          mazeRow.push(3);
          this.pelletsRemaining += 1;
        } else {
          mazeRow.push(0);
          if (symbol === "P") this.playerSpawn = { column, row };
          if (symbol === "B") this.ghostSpawns.set("Blinky", { column, row });
          if (symbol === "K") this.ghostSpawns.set("Pinky", { column, row });
          if (symbol === "I") this.ghostSpawns.set("Inky", { column, row });
        }
      }
      this.maze.push(mazeRow);
    }

    this.player = this.createPlayer();
    this.ghosts = [
      this.createGhost("Blinky", "#ff334f", this.ghostSpawns.get("Blinky"), MAZE_DIRECTIONS.LEFT),
      this.createGhost("Pinky", "#ff69cf", this.ghostSpawns.get("Pinky"), MAZE_DIRECTIONS.UP),
      this.createGhost("Inky", "#36efff", this.ghostSpawns.get("Inky"), MAZE_DIRECTIONS.RIGHT)
    ];
  }

  start() {
    this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.02 });
    this.engine.audio.playArcadeSound("pac-man", "pacman_intro", { volume: 0.95 });
    this.state = GAME_STATES.PLAYING;
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.gameTime = 0;
    this.frightenedTimer = 0;
    this.frightenedChain = 0;
    this.levelTransition = 0;
    this.roundPauseTimer = 2.9;
    this.damageFlash = 0;
    this.particles.length = 0;
    this.loadLevel();
    this.player.invulnerable = 2.2;
    this.engine.onGameStart();
  }

  resetToMenu() {
    this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.025 });
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.gameTime = 0;
    this.frightenedTimer = 0;
    this.frightenedChain = 0;
    this.levelTransition = 0;
    this.roundPauseTimer = 0;
    this.damageFlash = 0;
    this.particles.length = 0;
    this.loadLevel();
  }

  endGame(playDeathSound = true) {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.state = GAME_STATES.GAME_OVER;
    this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.025 });
    this.frightenedTimer = 0;
    this.roundPauseTimer = 0;
    this.createBurst(this.player.gridX, this.player.gridY, "#ffd83d", 24, 1.1);
    if (playDeathSound) this.engine.audio.playArcadeSound("pac-man", "pacman_death");
    this.engine.onGameOver(this.score);
  }

  handlePrimaryAction() {
    if (this.state === GAME_STATES.MENU || this.state === GAME_STATES.GAME_OVER) {
      this.start();
    } else {
      this.endGame();
    }
  }

  update(deltaTime) {
    this.gameTime += deltaTime;
    this.damageFlash = Math.max(0, this.damageFlash - deltaTime * 2.8);
    this.updateParticles(deltaTime);

    if (this.state === GAME_STATES.MENU) {
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    if (this.state === GAME_STATES.GAME_OVER) {
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    this.player.invulnerable = Math.max(0, this.player.invulnerable - deltaTime);

    if (this.levelTransition > 0) {
      this.levelTransition -= deltaTime;
      if (this.levelTransition <= 0) this.advanceLevel();
      return;
    }

    if (this.roundPauseTimer > 0) {
      this.roundPauseTimer -= deltaTime;
      return;
    }

    if (this.frightenedTimer > 0) {
      this.frightenedTimer = Math.max(0, this.frightenedTimer - deltaTime);
      if (this.frightenedTimer === 0) {
        this.frightenedChain = 0;
        this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.08 });
      }
    }

    this.readDirectionInput();
    this.updatePlayer(deltaTime);
    this.consumePelletAtPlayer();
    this.updateGhosts(deltaTime);
    this.resolveGhostCollisions();

    if (this.pelletsRemaining === 0 && this.levelTransition <= 0) {
      this.score += 1000 * this.level;
      this.levelTransition = 2;
      this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.08 });
      this.frightenedTimer = 0;
      this.createCelebrationBurst();
    }
  }

  readDirectionInput() {
    if (this.input.wasPressed("ArrowUp")) this.player.queuedDirection = MAZE_DIRECTIONS.UP;
    if (this.input.wasPressed("ArrowDown")) this.player.queuedDirection = MAZE_DIRECTIONS.DOWN;
    if (this.input.wasPressed("ArrowLeft")) this.player.queuedDirection = MAZE_DIRECTIONS.LEFT;
    if (this.input.wasPressed("ArrowRight")) this.player.queuedDirection = MAZE_DIRECTIONS.RIGHT;

    if (this.player.direction === MAZE_DIRECTIONS.NONE) {
      if (this.input.isDown("ArrowUp")) this.player.queuedDirection = MAZE_DIRECTIONS.UP;
      else if (this.input.isDown("ArrowDown")) this.player.queuedDirection = MAZE_DIRECTIONS.DOWN;
      else if (this.input.isDown("ArrowLeft")) this.player.queuedDirection = MAZE_DIRECTIONS.LEFT;
      else if (this.input.isDown("ArrowRight")) this.player.queuedDirection = MAZE_DIRECTIONS.RIGHT;
    }
  }

  updatePlayer(deltaTime) {
    const queued = this.player.queuedDirection;
    const current = this.player.direction;
    const isReverse = queued.x === -current.x && queued.y === -current.y;
    if (isReverse && this.canMoveFromPosition(this.player, queued)) this.player.direction = queued;

    this.moveEntityOnGrid(this.player, deltaTime, () => {
      const column = Math.round(this.player.gridX);
      const row = Math.round(this.player.gridY);
      if (this.canEnter(column, row, this.player.queuedDirection)) {
        this.player.direction = this.player.queuedDirection;
      } else if (!this.canEnter(column, row, this.player.direction)) {
        this.player.direction = MAZE_DIRECTIONS.NONE;
      }
    });
  }

  updateGhosts(deltaTime) {
    const normalSpeed = 4.15 + Math.min(1.45, (this.level - 1) * 0.12);
    const frightenedSpeed = 3.25 + Math.min(0.8, (this.level - 1) * 0.07);

    for (const ghost of this.ghosts) {
      if (ghost.respawnTimer > 0) {
        ghost.respawnTimer -= deltaTime;
        if (ghost.respawnTimer <= 0) this.restoreGhost(ghost);
        continue;
      }

      ghost.speed = this.frightenedTimer > 0 ? frightenedSpeed : normalSpeed;
      this.moveEntityOnGrid(ghost, deltaTime, () => {
        ghost.direction = this.chooseGhostDirection(ghost);
      });
    }
  }

  moveEntityOnGrid(entity, deltaTime, centerCallback) {
    let remainingDistance = entity.speed * deltaTime;
    const maximumSubstep = 0.055;

    while (remainingDistance > 0.0001) {
      const step = Math.min(maximumSubstep, remainingDistance);
      const nearestColumn = Math.round(entity.gridX);
      const nearestRow = Math.round(entity.gridY);
      const centerTolerance = 0.046;

      if (
        Math.abs(entity.gridX - nearestColumn) <= centerTolerance &&
        Math.abs(entity.gridY - nearestRow) <= centerTolerance
      ) {
        entity.gridX = nearestColumn;
        entity.gridY = nearestRow;
        centerCallback();
      }

      if (entity.direction === MAZE_DIRECTIONS.NONE) break;

      const candidateX = entity.gridX + entity.direction.x * step;
      const candidateY = entity.gridY + entity.direction.y * step;
      const candidateColumn = Math.round(candidateX);
      const candidateRow = Math.round(candidateY);

      if (this.isWall(candidateColumn, candidateRow)) {
        entity.gridX = Math.round(entity.gridX);
        entity.gridY = Math.round(entity.gridY);
        entity.direction = MAZE_DIRECTIONS.NONE;
        break;
      }

      entity.gridX = candidateX;
      entity.gridY = candidateY;
      remainingDistance -= step;
    }
  }

  chooseGhostDirection(ghost) {
    const column = Math.round(ghost.gridX);
    const row = Math.round(ghost.gridY);
    let options = this.getOpenDirections(column, row);
    const reverse = this.getOppositeDirection(ghost.direction);
    const nonReverseOptions = options.filter((direction) => direction !== reverse);
    if (nonReverseOptions.length > 0) options = nonReverseOptions;
    if (options.length === 0) return reverse;

    if (this.frightenedTimer > 0) {
      if (Math.random() < 0.2) return options[Math.floor(Math.random() * options.length)];
      let bestDirection = options[0];
      let greatestDistance = -Infinity;
      for (const direction of options) {
        const targetX = column + direction.x;
        const targetY = row + direction.y;
        const distance = this.distanceSquared(targetX, targetY, this.player.gridX, this.player.gridY);
        if (distance > greatestDistance) {
          greatestDistance = distance;
          bestDirection = direction;
        }
      }
      return bestDirection;
    }

    const target = this.getGhostTarget(ghost);
    let bestDirection = options[0];
    let shortestDistance = Infinity;

    for (const direction of options) {
      const nextColumn = column + direction.x;
      const nextRow = row + direction.y;
      const distance = this.distanceSquared(nextColumn, nextRow, target.x, target.y) + Math.random() * 0.08;
      if (distance < shortestDistance) {
        shortestDistance = distance;
        bestDirection = direction;
      }
    }

    return bestDirection;
  }

  getGhostTarget(ghost) {
    const playerDirection = this.player.direction === MAZE_DIRECTIONS.NONE
      ? this.player.queuedDirection
      : this.player.direction;

    if (ghost.name === "Blinky") {
      return { x: this.player.gridX, y: this.player.gridY };
    }

    if (ghost.name === "Pinky") {
      return {
        x: this.player.gridX + playerDirection.x * 4,
        y: this.player.gridY + playerDirection.y * 4
      };
    }

    const blinky = this.ghosts.find((candidate) => candidate.name === "Blinky");
    const aheadX = this.player.gridX + playerDirection.x * 2;
    const aheadY = this.player.gridY + playerDirection.y * 2;
    return {
      x: aheadX * 2 - (blinky ? blinky.gridX : this.player.gridX),
      y: aheadY * 2 - (blinky ? blinky.gridY : this.player.gridY)
    };
  }

  consumePelletAtPlayer() {
    const column = Math.round(this.player.gridX);
    const row = Math.round(this.player.gridY);
    const centered = Math.abs(this.player.gridX - column) < 0.3 && Math.abs(this.player.gridY - row) < 0.3;
    if (!centered || row < 0 || row >= this.rows || column < 0 || column >= this.columns) return;

    const tile = this.maze[row][column];
    if (tile === 2) {
      this.maze[row][column] = 0;
      this.pelletsRemaining -= 1;
      this.score += 10;
      this.createPelletSpark(column, row, "#ffe75b", 3);
      this.engine.audio.playArcadeSound("pac-man", "waka_waka", {
        brightness: 0.86 + (this.score % 40) / 200
      });
    } else if (tile === 3) {
      this.maze[row][column] = 0;
      this.pelletsRemaining -= 1;
      this.score += 50;
      this.frightenedTimer = 7;
      this.frightenedChain = 0;
      for (const ghost of this.ghosts) {
        if (ghost.respawnTimer <= 0) ghost.direction = this.getOppositeDirection(ghost.direction);
      }
      this.createBurst(column, row, "#ffe75b", 18, 0.75);
      this.engine.audio.playArcadeSound("pac-man", "waka_waka", { brightness: 1.22 });
      this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: true });
      this.engine.showCanvasMessage("POWER MODE", {
        color: "#ffe75b", size: 18, duration: 1.15, blink: 9
      });
      this.engine.showToast("POWER PELLET · GHOSTS VULNERABLE FOR 7 SECONDS");
    }
  }

  resolveGhostCollisions() {
    for (const ghost of this.ghosts) {
      if (ghost.respawnTimer > 0) continue;
      const distance = Math.hypot(this.player.gridX - ghost.gridX, this.player.gridY - ghost.gridY);
      if (distance > 0.72) continue;

      if (this.frightenedTimer > 0) {
        this.frightenedChain += 1;
        const ghostScore = 200 * Math.pow(2, Math.min(3, this.frightenedChain - 1));
        this.score += ghostScore;
        this.createBurst(ghost.gridX, ghost.gridY, ghost.color, 20, 0.95);
        this.engine.audio.explosion(0.52);
        this.engine.showCanvasMessage(`+${ghostScore} COMBO`, {
          x: this.gridToWorldX(ghost.gridX),
          y: this.gridToWorldY(ghost.gridY) - 8,
          color: ghost.color,
          size: 15,
          duration: 1.2,
          rise: 38,
          blink: 11
        });
        ghost.respawnTimer = 2.15;
        ghost.gridX = ghost.spawnColumn;
        ghost.gridY = ghost.spawnRow;
        ghost.direction = MAZE_DIRECTIONS.NONE;
        this.engine.showToast(`${ghost.name.toUpperCase()} CAPTURED · +${ghostScore}`);
      } else if (this.player.invulnerable <= 0) {
        this.loseLife();
        break;
      }
    }
  }

  loseLife() {
    this.lives -= 1;
    this.damageFlash = 1;
    this.createBurst(this.player.gridX, this.player.gridY, "#ffd83d", 26, 1.05);
    this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.025 });
    this.engine.audio.playArcadeSound("pac-man", "pacman_death");
    this.engine.haptics.damage();
    this.engine.showCanvasMessage(this.lives > 0 ? "LIFE LOST" : "FINAL LIFE", {
      color: "#ff416d", size: 20, duration: 1.15, blink: 10
    });
    this.frightenedTimer = 0;
    this.frightenedChain = 0;

    if (this.lives <= 0) {
      this.endGame(false);
      return;
    }

    this.resetEntityPositions();
    this.roundPauseTimer = 1.45;
    this.player.invulnerable = 2.3;
    this.engine.showToast(`LIFE LOST · ${this.lives} REMAINING`);
  }

  resetEntityPositions() {
    this.player.gridX = this.playerSpawn.column;
    this.player.gridY = this.playerSpawn.row;
    this.player.direction = MAZE_DIRECTIONS.LEFT;
    this.player.queuedDirection = MAZE_DIRECTIONS.LEFT;

    const initialDirections = [MAZE_DIRECTIONS.LEFT, MAZE_DIRECTIONS.UP, MAZE_DIRECTIONS.RIGHT];
    this.ghosts.forEach((ghost, index) => {
      ghost.gridX = ghost.spawnColumn;
      ghost.gridY = ghost.spawnRow;
      ghost.direction = initialDirections[index];
      ghost.respawnTimer = 0;
    });
  }

  restoreGhost(ghost) {
    ghost.gridX = ghost.spawnColumn;
    ghost.gridY = ghost.spawnRow;
    ghost.direction = ghost.name === "Pinky" ? MAZE_DIRECTIONS.UP : MAZE_DIRECTIONS.LEFT;
    ghost.respawnTimer = 0;
  }

  advanceLevel() {
    this.engine.audio.playArcadeSound("pac-man", "ghost_vulnerable", { active: false, fade: 0.04 });
    this.level += 1;
    this.frightenedTimer = 0;
    this.frightenedChain = 0;
    this.particles.length = 0;
    this.loadLevel();
    this.roundPauseTimer = 1.25;
    this.player.invulnerable = 2.3;
  }

  canMoveFromPosition(entity, direction) {
    const column = Math.round(entity.gridX);
    const row = Math.round(entity.gridY);
    return this.canEnter(column, row, direction);
  }

  canEnter(column, row, direction) {
    if (direction === MAZE_DIRECTIONS.NONE) return false;
    return !this.isWall(column + direction.x, row + direction.y);
  }

  getOpenDirections(column, row) {
    return MAZE_DIRECTION_LIST.filter((direction) => this.canEnter(column, row, direction));
  }

  getOppositeDirection(direction) {
    if (direction === MAZE_DIRECTIONS.UP) return MAZE_DIRECTIONS.DOWN;
    if (direction === MAZE_DIRECTIONS.DOWN) return MAZE_DIRECTIONS.UP;
    if (direction === MAZE_DIRECTIONS.LEFT) return MAZE_DIRECTIONS.RIGHT;
    if (direction === MAZE_DIRECTIONS.RIGHT) return MAZE_DIRECTIONS.LEFT;
    return MAZE_DIRECTIONS.NONE;
  }

  isWall(column, row) {
    if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) return true;
    return this.maze[row][column] === 1;
  }

  distanceSquared(x1, y1, x2, y2) {
    const deltaX = x1 - x2;
    const deltaY = y1 - y2;
    return deltaX * deltaX + deltaY * deltaY;
  }

  gridToWorldX(gridX) {
    return this.originX + (gridX + 0.5) * this.tileSize;
  }

  gridToWorldY(gridY) {
    return this.originY + (gridY + 0.5) * this.tileSize;
  }

  createPelletSpark(column, row, color, count) {
    const x = this.gridToWorldX(column);
    const y = this.gridToWorldY(row);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 25 + Math.random() * 55;
      const life = 0.22 + Math.random() * 0.18;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        radius: 1 + Math.random() * 1.6,
        color
      });
    }
  }

  createBurst(gridX, gridY, color, count, lifeScale = 1) {
    const x = this.gridToWorldX(gridX);
    const y = this.gridToWorldY(gridY);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 55 + Math.random() * 165;
      const life = (0.38 + Math.random() * 0.52) * lifeScale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        radius: 1.6 + Math.random() * 3.8,
        color
      });
    }
  }

  createCelebrationBurst() {
    const colors = ["#ffd83d", "#36efff", "#ff69cf", "#755cff"];
    for (let burst = 0; burst < 7; burst += 1) {
      const gridX = 3 + Math.random() * (this.columns - 6);
      const gridY = 3 + Math.random() * (this.rows - 6);
      this.createBurst(gridX, gridY, colors[burst % colors.length], 12, 0.85);
    }
  }

  updateParticles(deltaTime) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= deltaTime;
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      particle.vx *= Math.pow(0.94, deltaTime * 60);
      particle.vy *= Math.pow(0.94, deltaTime * 60);
      if (particle.life <= 0) this.particles.splice(index, 1);
    }
  }

  getTelemetry() {
    const secondary = this.frightenedTimer > 0
      ? `L${this.level} · ${this.frightenedTimer.toFixed(1)}s`
      : `L${this.level} · ${this.pelletsRemaining}`;
    return {
      state: this.state === GAME_STATES.GAME_OVER ? "GAME OVER" : this.frightenedTimer > 0 ? "POWER MODE" : this.state,
      score: this.score.toString().padStart(6, "0"),
      primaryMetric: `${Math.max(0, this.lives)} / 3`,
      secondaryMetric: secondary,
      primaryButton: this.state === GAME_STATES.PLAYING ? "END MAZE RUN" : this.state === GAME_STATES.GAME_OVER ? "RETRY MAZE" : "START MAZE"
    };
  }

  draw() {
    const ctx = this.ctx;
    if (this.state === GAME_STATES.MENU) {
      this.drawMenu(ctx);
      return;
    }

    this.drawBackdrop(ctx);
    this.drawMaze(ctx, 1);
    this.drawPellets(ctx);
    this.drawGhosts(ctx);
    this.drawPlayer(ctx);
    this.drawParticles(ctx);
    this.drawHud(ctx);

    if (this.roundPauseTimer > 0) this.drawReadyOverlay(ctx);
    if (this.levelTransition > 0) this.drawLevelTransition(ctx);
    if (this.state === GAME_STATES.GAME_OVER) this.drawGameOver(ctx);

    if (this.damageFlash > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 45, 88, ${this.damageFlash * 0.22})`;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  drawBackdrop(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(2, 1, 8, .94)";
    ctx.fillRect(0, 0, this.width, this.height);
    const glow = ctx.createRadialGradient(this.width / 2, this.height / 2, 30, this.width / 2, this.height / 2, 520);
    glow.addColorStop(0, "rgba(38, 26, 106, .16)");
    glow.addColorStop(0.58, "rgba(9, 20, 66, .08)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  drawMenu(ctx) {
    const pulse = 0.7 + Math.sin(this.gameTime * 3.1) * 0.18;
    this.drawBackdrop(ctx);

    ctx.save();
    ctx.globalAlpha = 0.24;
    this.drawMaze(ctx, 0.42);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 25;
    ctx.font = "900 40px Orbitron, sans-serif";
    ctx.fillText("NEON PAC-MAN", this.width / 2, 112);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.58)";
    ctx.font = "700 14px Rajdhani, sans-serif";
    ctx.fillText("SYMMETRIC MAZE / THREE-GHOST PURSUIT PROTOCOL", this.width / 2, 142);

    this.drawPacmanShape(ctx, this.width / 2 - 130, 260, 34, MAZE_DIRECTIONS.RIGHT);
    this.drawGhostShape(ctx, this.width / 2 - 26, 260, 30, "#ff334f", MAZE_DIRECTIONS.RIGHT, false, 0);
    this.drawGhostShape(ctx, this.width / 2 + 48, 260, 30, "#ff69cf", MAZE_DIRECTIONS.LEFT, false, 0);
    this.drawGhostShape(ctx, this.width / 2 + 122, 260, 30, "#36efff", MAZE_DIRECTIONS.UP, false, 0);

    ctx.fillStyle = "rgba(248,247,255,.72)";
    ctx.font = "600 16px Rajdhani, sans-serif";
    ctx.fillText("ARROWS MOVE  ·  SMALL PELLET +10  ·  POWER PELLET +50 / 7 SECONDS", this.width / 2, 390);

    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 16;
    ctx.font = "800 14px Orbitron, sans-serif";
    ctx.fillText("PRESS SPACE TO START", this.width / 2, 450);
    ctx.restore();
  }

  drawMaze(ctx, intensity = 1) {
    ctx.save();
    ctx.globalAlpha = intensity;

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        if (!this.isWall(column, row)) continue;
        const x = this.originX + column * this.tileSize;
        const y = this.originY + row * this.tileSize;
        ctx.fillStyle = "rgba(5, 8, 35, .74)";
        ctx.fillRect(x, y, this.tileSize, this.tileSize);
      }
    }

    ctx.strokeStyle = "#2c6bff";
    ctx.shadowColor = "#2477ff";
    ctx.shadowBlur = 10;
    ctx.lineWidth = 1.65;
    ctx.lineCap = "round";

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        if (!this.isWall(column, row)) continue;
        const x = this.originX + column * this.tileSize;
        const y = this.originY + row * this.tileSize;
        if (!this.isWall(column, row - 1)) this.drawDoubleWallEdge(ctx, x, y, "TOP");
        if (!this.isWall(column, row + 1)) this.drawDoubleWallEdge(ctx, x, y, "BOTTOM");
        if (!this.isWall(column - 1, row)) this.drawDoubleWallEdge(ctx, x, y, "LEFT");
        if (!this.isWall(column + 1, row)) this.drawDoubleWallEdge(ctx, x, y, "RIGHT");
      }
    }

    ctx.restore();
  }

  drawDoubleWallEdge(ctx, x, y, side) {
    const insetA = 3.2;
    const insetB = 7.4;
    const size = this.tileSize;
    ctx.beginPath();

    if (side === "TOP") {
      ctx.moveTo(x + 1, y + insetA);
      ctx.lineTo(x + size - 1, y + insetA);
      ctx.moveTo(x + 2, y + insetB);
      ctx.lineTo(x + size - 2, y + insetB);
    } else if (side === "BOTTOM") {
      ctx.moveTo(x + 1, y + size - insetA);
      ctx.lineTo(x + size - 1, y + size - insetA);
      ctx.moveTo(x + 2, y + size - insetB);
      ctx.lineTo(x + size - 2, y + size - insetB);
    } else if (side === "LEFT") {
      ctx.moveTo(x + insetA, y + 1);
      ctx.lineTo(x + insetA, y + size - 1);
      ctx.moveTo(x + insetB, y + 2);
      ctx.lineTo(x + insetB, y + size - 2);
    } else {
      ctx.moveTo(x + size - insetA, y + 1);
      ctx.lineTo(x + size - insetA, y + size - 1);
      ctx.moveTo(x + size - insetB, y + 2);
      ctx.lineTo(x + size - insetB, y + size - 2);
    }

    ctx.stroke();
  }

  drawPellets(ctx) {
    ctx.save();
    ctx.fillStyle = "#ffe75b";
    ctx.shadowColor = "#ffe75b";
    ctx.shadowBlur = 8;

    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const tile = this.maze[row][column];
        if (tile !== 2 && tile !== 3) continue;
        const x = this.gridToWorldX(column);
        const y = this.gridToWorldY(row);
        const radius = tile === 3
          ? 5.4 + Math.sin(this.gameTime * 7 + column) * 1.15
          : 2.15;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  drawPlayer(ctx) {
    const blinking = this.player.invulnerable > 0 && Math.floor(this.player.invulnerable * 11) % 2 === 0;
    if (blinking) return;
    this.drawPacmanShape(
      ctx,
      this.gridToWorldX(this.player.gridX),
      this.gridToWorldY(this.player.gridY),
      this.player.radius,
      this.player.direction === MAZE_DIRECTIONS.NONE ? this.player.queuedDirection : this.player.direction
    );
  }

  drawPacmanShape(ctx, x, y, radius, direction) {
    const mouthWave = (Math.sin(this.gameTime * 13) + 1) * 0.5;
    const mouthAngle = 0.08 + mouthWave * 0.34;
    const facingAngle = direction.angle;

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, facingAngle + mouthAngle, facingAngle + Math.PI * 2 - mouthAngle);
    ctx.closePath();
    ctx.fill();

    const eyeAngle = facingAngle - Math.PI / 2;
    const eyeX = Math.cos(eyeAngle) * radius * 0.33 + Math.cos(facingAngle) * radius * 0.2;
    const eyeY = Math.sin(eyeAngle) * radius * 0.33 + Math.sin(facingAngle) * radius * 0.2;
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#130b1c";
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, Math.max(1.5, radius * 0.105), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawGhosts(ctx) {
    for (const ghost of this.ghosts) {
      if (ghost.respawnTimer > 0) continue;
      const vulnerable = this.frightenedTimer > 0;
      this.drawGhostShape(
        ctx,
        this.gridToWorldX(ghost.gridX),
        this.gridToWorldY(ghost.gridY),
        ghost.radius,
        ghost.color,
        ghost.direction,
        vulnerable,
        this.frightenedTimer
      );
    }
  }

  drawGhostShape(ctx, x, y, radius, color, direction, vulnerable, vulnerableTime) {
    const flash = vulnerable && vulnerableTime < 2 && Math.floor(vulnerableTime * 8) % 2 === 0;
    const bodyColor = vulnerable ? (flash ? "#f5f5ff" : "#275dff") : color;
    const footWave = Math.sin(this.gameTime * 10 + x * 0.025) * radius * 0.08;

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = bodyColor;
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = 17;
    ctx.beginPath();
    ctx.moveTo(-radius, radius * 0.82);
    ctx.lineTo(-radius, -radius * 0.04);
    ctx.arc(0, -radius * 0.04, radius, Math.PI, 0, false);
    ctx.lineTo(radius, radius * 0.82);
    ctx.quadraticCurveTo(radius * 0.72, radius * 0.48 + footWave, radius * 0.5, radius * 0.82);
    ctx.quadraticCurveTo(radius * 0.25, radius * 1.12 - footWave, 0, radius * 0.82);
    ctx.quadraticCurveTo(-radius * 0.25, radius * 0.48 + footWave, -radius * 0.5, radius * 0.82);
    ctx.quadraticCurveTo(-radius * 0.74, radius * 1.1 - footWave, -radius, radius * 0.82);
    ctx.closePath();
    ctx.fill();

    if (vulnerable) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = flash ? "#275dff" : "#f4f7ff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-radius * 0.46, radius * 0.2);
      ctx.lineTo(-radius * 0.24, radius * 0.08);
      ctx.lineTo(0, radius * 0.2);
      ctx.lineTo(radius * 0.24, radius * 0.08);
      ctx.lineTo(radius * 0.46, radius * 0.2);
      ctx.stroke();
      ctx.fillStyle = flash ? "#275dff" : "#f4f7ff";
      ctx.beginPath();
      ctx.arc(-radius * 0.36, -radius * 0.12, radius * 0.08, 0, Math.PI * 2);
      ctx.arc(radius * 0.36, -radius * 0.12, radius * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const pupilOffsetX = direction.x * radius * 0.13;
    const pupilOffsetY = direction.y * radius * 0.13;
    const eyeY = -radius * 0.22;
    const eyeSpacing = radius * 0.38;

    ctx.shadowBlur = 4;
    ctx.shadowColor = "white";
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.ellipse(-eyeSpacing, eyeY, radius * 0.28, radius * 0.36, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeSpacing, eyeY, radius * 0.28, radius * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = "#080a18";
    ctx.beginPath();
    ctx.arc(-eyeSpacing + pupilOffsetX, eyeY + pupilOffsetY, radius * 0.12, 0, Math.PI * 2);
    ctx.arc(eyeSpacing + pupilOffsetX, eyeY + pupilOffsetY, radius * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const particle of this.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, Math.max(0.3, particle.radius * alpha), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHud(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(3,1,10,.84)";
    ctx.strokeStyle = "rgba(45,108,255,.45)";
    ctx.lineWidth = 1;
    ctx.fillRect(139, 14, 682, 42);
    ctx.strokeRect(139.5, 14.5, 681, 41);

    ctx.font = "700 10px Rajdhani, sans-serif";
    ctx.fillStyle = "rgba(248,247,255,.42)";
    ctx.fillText("SCORE", 158, 32);
    ctx.fillText("LEVEL", 365, 32);
    ctx.fillText("PELLETS", 488, 32);
    ctx.fillText("LIVES", 665, 32);

    ctx.font = "800 15px Orbitron, sans-serif";
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 8;
    ctx.fillText(this.score.toString().padStart(6, "0"), 205, 37);
    ctx.fillStyle = "#36efff";
    ctx.shadowColor = "#36efff";
    ctx.fillText(this.level.toString().padStart(2, "0"), 413, 37);
    ctx.fillText(this.pelletsRemaining.toString().padStart(3, "0"), 553, 37);

    for (let life = 0; life < this.lives; life += 1) {
      this.drawPacmanLife(ctx, 725 + life * 27, 35);
    }

    if (this.frightenedTimer > 0) {
      const ratio = this.frightenedTimer / 7;
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,.1)";
      ctx.fillRect(139, 57, 682, 3);
      ctx.fillStyle = "#275dff";
      ctx.shadowColor = "#275dff";
      ctx.shadowBlur = 8;
      ctx.fillRect(139, 57, 682 * ratio, 3);
    }

    ctx.restore();
  }

  drawPacmanLife(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 7, 0.34, Math.PI * 2 - 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawReadyOverlay(ctx) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(2,1,8,.28)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 18;
    ctx.font = "900 24px Orbitron, sans-serif";
    ctx.fillText("READY!", this.width / 2, this.height / 2 + 10);
    ctx.restore();
  }

  drawLevelTransition(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(2,1,8,.72)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#36efff";
    ctx.shadowColor = "#36efff";
    ctx.shadowBlur = 24;
    ctx.font = "900 34px Orbitron, sans-serif";
    ctx.fillText("MAZE CLEARED", this.width / 2, 250);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.62)";
    ctx.font = "700 15px Rajdhani, sans-serif";
    ctx.fillText(`LOADING LEVEL ${(this.level + 1).toString().padStart(2, "0")}`, this.width / 2, 286);
    ctx.restore();
  }

  drawGameOver(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(2,1,8,.84)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff69cf";
    ctx.shadowColor = "#ff69cf";
    ctx.shadowBlur = 28;
    ctx.font = "900 44px Orbitron, sans-serif";
    ctx.fillText("MAZE OVERRUN", this.width / 2, 225);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.66)";
    ctx.font = "700 16px Rajdhani, sans-serif";
    ctx.fillText(`FINAL SCORE ${this.score.toString().padStart(6, "0")}  ·  LEVEL ${this.level.toString().padStart(2, "0")}`, this.width / 2, 272);
    ctx.fillStyle = "#ffd83d";
    ctx.shadowColor = "#ffd83d";
    ctx.shadowBlur = 15;
    ctx.font = "800 14px Orbitron, sans-serif";
    ctx.fillText("PRESS SPACE TO RETRY", this.width / 2, 333);
    ctx.restore();
  }
}

class NeonAsteroidsGame {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.input = engine.input;
    this.width = 800;
    this.height = 600;
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.elapsed = 0;
    this.waveTransition = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.bullets = [];
    this.asteroids = [];
    this.particles = [];
    this.highScoreStorageKey = "arcade_asteroids_highscore";
    this.highScore = this.loadHighScore();
    this.ship = this.createShip();
    this.asteroidProfiles = Object.freeze({
      large: { radius: 50, minSpeed: 34, maxSpeed: 58, points: 20, children: "medium" },
      medium: { radius: 25, minSpeed: 72, maxSpeed: 104, points: 50, children: "small" },
      small: { radius: 12, minSpeed: 118, maxSpeed: 166, points: 100, children: null }
    });
  }

  createShip() {
    return {
      x: this.width / 2,
      y: this.height / 2,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      radius: 17,
      rotationSpeed: 3.9,
      thrustPower: 238,
      drag: 0.985,
      shotCooldown: 0,
      invulnerable: 0,
      thrusting: false
    };
  }

  loadHighScore() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return 0;
      const value = Number(window.localStorage.getItem(this.highScoreStorageKey));
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch (error) {
      return 0;
    }
  }

  persistHighScore() {
    if (this.score <= this.highScore) return false;
    this.highScore = Math.floor(this.score);
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(this.highScoreStorageKey, String(this.highScore));
      }
    } catch (error) {
      return true;
    }
    return true;
  }

  start() {
    this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.02 });
    this.state = GAME_STATES.PLAYING;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.elapsed = 0;
    this.waveTransition = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.bullets.length = 0;
    this.asteroids.length = 0;
    this.particles.length = 0;
    this.resetShip(3);
    this.spawnWave();
    this.engine.onGameStart();
  }

  resetToMenu() {
    this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.02 });
    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.elapsed = 0;
    this.waveTransition = 0;
    this.screenShake = 0;
    this.damageFlash = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.bullets.length = 0;
    this.asteroids.length = 0;
    this.particles.length = 0;
    this.ship = this.createShip();
  }

  resetShip(invulnerabilitySeconds) {
    this.ship.x = this.width / 2;
    this.ship.y = this.height / 2;
    this.ship.vx = 0;
    this.ship.vy = 0;
    this.ship.angle = -Math.PI / 2;
    this.ship.shotCooldown = 0;
    this.ship.invulnerable = invulnerabilitySeconds;
    this.ship.thrusting = false;
  }

  handlePrimaryAction() {
    if (this.state === GAME_STATES.MENU || this.state === GAME_STATES.GAME_OVER) {
      this.start();
    } else {
      this.endGame(true);
    }
  }

  endGame(manual = false) {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.025 });
    this.state = GAME_STATES.GAME_OVER;
    this.createExplosion(this.ship.x, this.ship.y, "#42f5ff", 15, 170);
    this.screenShake = 14;
    this.damageFlash = 0.65;
    this.engine.audio.playArcadeSound("asteroids", "asteroid_explosion", { size: "large" });
    if (manual) {
      this.engine.showCanvasMessage("MISSION ABORTED", {
        y: this.height * 0.35,
        color: "#ffbd3c",
        size: 15,
        duration: 1.4,
        blink: 7,
        fixed: true
      });
    }
    this.persistHighScore();
    this.engine.onGameOver(this.score);
  }

  spawnWave() {
    const count = Math.min(10, 4 + this.wave);
    for (let index = 0; index < count; index += 1) {
      let x = 0;
      let y = 0;
      let attempts = 0;
      do {
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) {
          x = Math.random() * this.width;
          y = 18;
        } else if (edge === 1) {
          x = this.width - 18;
          y = Math.random() * this.height;
        } else if (edge === 2) {
          x = Math.random() * this.width;
          y = this.height - 18;
        } else {
          x = 18;
          y = Math.random() * this.height;
        }
        attempts += 1;
      } while (Math.hypot(x - this.width / 2, y - this.height / 2) < 190 && attempts < 20);

      const angleToCenter = Math.atan2(this.height / 2 - y, this.width / 2 - x);
      const travelAngle = angleToCenter + (Math.random() - 0.5) * 1.5;
      this.asteroids.push(this.createAsteroid("large", x, y, {
        angle: travelAngle,
        speedMultiplier: 1 + Math.min(0.65, (this.wave - 1) * 0.07)
      }));
    }
    this.waveTransition = 0;
  }

  createAsteroid(size, x, y, options = {}) {
    const profile = this.asteroidProfiles[size];
    const sides = 8 + Math.floor(Math.random() * 5);
    const vertices = Array.from({ length: sides }, (_, index) => {
      const phase = index / sides * Math.PI * 2;
      return {
        angle: phase,
        radius: profile.radius * (0.72 + Math.random() * 0.5)
      };
    });
    const speed = (profile.minSpeed + Math.random() * (profile.maxSpeed - profile.minSpeed)) * (options.speedMultiplier || 1);
    const angle = Number.isFinite(options.angle) ? options.angle : Math.random() * Math.PI * 2;
    const inheritedVx = Number(options.inheritedVx) || 0;
    const inheritedVy = Number(options.inheritedVy) || 0;

    return {
      size,
      x,
      y,
      vx: Math.cos(angle) * speed + inheritedVx,
      vy: Math.sin(angle) * speed + inheritedVy,
      radius: profile.radius,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * (size === "large" ? 0.62 : size === "medium" ? 1.15 : 1.9),
      vertices,
      pulseOffset: Math.random() * Math.PI * 2
    };
  }

  update(deltaTime) {
    this.updateParticles(deltaTime);
    this.screenShake = Math.max(0, this.screenShake - deltaTime * 36);
    this.damageFlash = Math.max(0, this.damageFlash - deltaTime * 2.2);
    this.comboTimer = Math.max(0, this.comboTimer - deltaTime);
    if (this.comboTimer === 0) this.comboCount = 0;

    if (this.state === GAME_STATES.MENU) {
      this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.02 });
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    if (this.state === GAME_STATES.GAME_OVER) {
      this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.02 });
      if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) this.start();
      return;
    }

    this.elapsed += deltaTime;
    this.ship.shotCooldown = Math.max(0, this.ship.shotCooldown - deltaTime);
    this.ship.invulnerable = Math.max(0, this.ship.invulnerable - deltaTime);

    this.updateShip(deltaTime);
    this.updateBullets(deltaTime);
    this.updateAsteroids(deltaTime);
    this.resolveBulletCollisions();
    this.resolveShipCollisions();

    if (this.asteroids.length === 0) {
      this.waveTransition += deltaTime;
      if (this.waveTransition < deltaTime * 1.5) {
        const bonus = this.wave * 250;
        this.score += bonus;
        this.engine.showCanvasMessage(`WAVE CLEAR +${bonus}`, {
          y: this.height * 0.43,
          color: "#00ff7f",
          size: 18,
          duration: 1.6,
          blink: 7,
          fixed: true
        });
      }
      if (this.waveTransition >= 1.65) {
        this.wave += 1;
        this.resetShip(Math.max(this.ship.invulnerable, 1.7));
        this.spawnWave();
      }
    } else {
      this.waveTransition = 0;
    }

    this.persistHighScore();
  }

  updateShip(deltaTime) {
    const ship = this.ship;
    const rotationDirection = Number(this.input.isDown("ArrowRight")) - Number(this.input.isDown("ArrowLeft"));
    ship.angle += rotationDirection * ship.rotationSpeed * deltaTime;
    ship.thrusting = this.input.isDown("ArrowUp");
    this.engine.audio.playArcadeSound("asteroids", "ship_thrust", {
      active: ship.thrusting,
      power: ship.thrusting ? Math.min(1, 0.45 + Math.hypot(ship.vx, ship.vy) / 430) : 0
    });

    if (ship.thrusting) {
      ship.vx += Math.cos(ship.angle) * ship.thrustPower * deltaTime;
      ship.vy += Math.sin(ship.angle) * ship.thrustPower * deltaTime;
      if (Math.random() < 0.8) this.createThrusterParticle();
    }

    const dragFactor = Math.pow(ship.drag, deltaTime * 60);
    ship.vx *= dragFactor;
    ship.vy *= dragFactor;

    const speed = Math.hypot(ship.vx, ship.vy);
    const maximumSpeed = 410;
    if (speed > maximumSpeed) {
      ship.vx = ship.vx / speed * maximumSpeed;
      ship.vy = ship.vy / speed * maximumSpeed;
    }

    ship.x += ship.vx * deltaTime;
    ship.y += ship.vy * deltaTime;
    this.wrapEntity(ship);

    if (this.input.isDown("Space") && ship.shotCooldown <= 0 && this.bullets.length < 5) {
      this.fireBullet();
    }
  }

  fireBullet() {
    const ship = this.ship;
    const directionX = Math.cos(ship.angle);
    const directionY = Math.sin(ship.angle);
    this.bullets.push({
      x: ship.x + directionX * 23,
      y: ship.y + directionY * 23,
      vx: ship.vx + directionX * 540,
      vy: ship.vy + directionY * 540,
      life: 1.08,
      radius: 3
    });
    ship.shotCooldown = 0.17;
    this.engine.audio.playArcadeSound("asteroids", "player_laser");
    this.engine.haptics.shot();
  }

  updateBullets(deltaTime) {
    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.bullets[index];
      bullet.life -= deltaTime;
      if (bullet.life <= 0) {
        this.bullets.splice(index, 1);
        continue;
      }
      bullet.x += bullet.vx * deltaTime;
      bullet.y += bullet.vy * deltaTime;
      this.wrapEntity(bullet);
    }
  }

  updateAsteroids(deltaTime) {
    for (const asteroid of this.asteroids) {
      asteroid.x += asteroid.vx * deltaTime;
      asteroid.y += asteroid.vy * deltaTime;
      asteroid.rotation += asteroid.rotationSpeed * deltaTime;
      this.wrapEntity(asteroid);
    }
  }

  wrapEntity(entity) {
    if (entity.x < 0) entity.x += this.width;
    if (entity.x >= this.width) entity.x -= this.width;
    if (entity.y < 0) entity.y += this.height;
    if (entity.y >= this.height) entity.y -= this.height;
  }

  toroidalDistance(first, second) {
    let deltaX = Math.abs(first.x - second.x);
    let deltaY = Math.abs(first.y - second.y);
    deltaX = Math.min(deltaX, this.width - deltaX);
    deltaY = Math.min(deltaY, this.height - deltaY);
    return Math.hypot(deltaX, deltaY);
  }

  resolveBulletCollisions() {
    for (let bulletIndex = this.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = this.bullets[bulletIndex];
      let impacted = false;

      for (let asteroidIndex = this.asteroids.length - 1; asteroidIndex >= 0; asteroidIndex -= 1) {
        const asteroid = this.asteroids[asteroidIndex];
        if (this.toroidalDistance(bullet, asteroid) > bullet.radius + asteroid.radius * 0.88) continue;

        this.bullets.splice(bulletIndex, 1);
        this.asteroids.splice(asteroidIndex, 1);
        this.destroyAsteroid(asteroid);
        impacted = true;
        break;
      }

      if (impacted) continue;
    }
  }

  destroyAsteroid(asteroid) {
    const profile = this.asteroidProfiles[asteroid.size];
    this.score += profile.points;
    this.createExplosion(
      asteroid.x,
      asteroid.y,
      asteroid.size === "large" ? "#00ff7f" : asteroid.size === "medium" ? "#42f5ff" : "#ffbd3c",
      10 + Math.floor(Math.random() * 6),
      asteroid.size === "large" ? 155 : asteroid.size === "medium" ? 190 : 230
    );
    this.screenShake = Math.max(this.screenShake, asteroid.size === "large" ? 8 : 5);
    this.engine.audio.playArcadeSound("asteroids", "asteroid_explosion", { size: asteroid.size });

    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1;
    this.comboTimer = 1.15;
    if (this.comboCount >= 3) {
      const comboBonus = this.comboCount * 25;
      this.score += comboBonus;
      this.engine.showCanvasMessage(`+${comboBonus} COMBO`, {
        x: asteroid.x,
        y: asteroid.y,
        color: "#ffe75b",
        size: 13,
        duration: 1.05,
        rise: 30,
        blink: 9
      });
    }

    if (!profile.children) return;

    const baseAngle = Math.atan2(asteroid.vy, asteroid.vx) + Math.PI / 2 + (Math.random() - 0.5) * 0.55;
    const inheritedVx = asteroid.vx * 0.28;
    const inheritedVy = asteroid.vy * 0.28;
    const speedMultiplier = profile.children === "medium" ? 1.22 : 1.18;

    this.asteroids.push(this.createAsteroid(profile.children, asteroid.x, asteroid.y, {
      angle: baseAngle,
      speedMultiplier,
      inheritedVx,
      inheritedVy
    }));
    this.asteroids.push(this.createAsteroid(profile.children, asteroid.x, asteroid.y, {
      angle: baseAngle + Math.PI,
      speedMultiplier,
      inheritedVx,
      inheritedVy
    }));
  }

  resolveShipCollisions() {
    if (this.ship.invulnerable > 0) return;

    for (const asteroid of this.asteroids) {
      if (this.toroidalDistance(this.ship, asteroid) > this.ship.radius + asteroid.radius * 0.82) continue;
      this.hitShip();
      break;
    }
  }

  hitShip() {
    this.lives -= 1;
    this.createExplosion(this.ship.x, this.ship.y, "#42f5ff", 15, 210);
    this.createExplosion(this.ship.x, this.ship.y, "#ff3cf7", 11, 145);
    this.screenShake = 16;
    this.damageFlash = 0.82;
    this.engine.audio.playArcadeSound("asteroids", "ship_thrust", { active: false, fade: 0.02 });
    this.engine.audio.playArcadeSound("asteroids", "asteroid_explosion", { size: "large" });
    this.engine.haptics.damage();

    if (this.lives <= 0) {
      this.endGame(false);
      return;
    }

    this.resetShip(3);
    this.engine.showCanvasMessage("SHIP LOST", {
      y: this.height * 0.39,
      color: "#ff416d",
      size: 20,
      duration: 1.45,
      blink: 10,
      fixed: true
    });
    this.engine.showCanvasMessage("3s SHIELD", {
      y: this.height * 0.49,
      color: "#42f5ff",
      size: 13,
      duration: 1.45,
      blink: 8,
      fixed: true
    });
  }

  createThrusterParticle() {
    const spread = (Math.random() - 0.5) * 0.68;
    const angle = this.ship.angle + Math.PI + spread;
    const speed = 70 + Math.random() * 100;
    this.particles.push({
      x: this.ship.x - Math.cos(this.ship.angle) * 17,
      y: this.ship.y - Math.sin(this.ship.angle) * 17,
      vx: Math.cos(angle) * speed - this.ship.vx * 0.18,
      vy: Math.sin(angle) * speed - this.ship.vy * 0.18,
      radius: 1.3 + Math.random() * 2.2,
      life: 0.24 + Math.random() * 0.18,
      maxLife: 0.42,
      color: Math.random() > 0.45 ? "#42f5ff" : "#ffbd3c",
      drag: 0.94
    });
  }

  createExplosion(x, y, color, count = 12, maximumSpeed = 180) {
    const particleCount = Math.max(10, Math.min(15, count));
    for (let index = 0; index < particleCount; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * maximumSpeed;
      const life = 0.45 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 3.4,
        life,
        maxLife: life,
        color,
        drag: 0.975
      });
    }
  }

  updateParticles(deltaTime) {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= deltaTime;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      const dragFactor = Math.pow(particle.drag, deltaTime * 60);
      particle.vx *= dragFactor;
      particle.vy *= dragFactor;
      particle.x += particle.vx * deltaTime;
      particle.y += particle.vy * deltaTime;
      this.wrapEntity(particle);
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.save();

    if (this.screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * this.screenShake, (Math.random() - 0.5) * this.screenShake);
    }

    this.drawArena();

    if (this.state === GAME_STATES.MENU) {
      this.drawMenu();
    } else {
      this.drawAsteroids();
      this.drawBullets();
      this.drawParticles();
      if (this.state === GAME_STATES.PLAYING || this.lives > 0) this.drawShip();
      this.drawHud();
      if (this.state === GAME_STATES.GAME_OVER) this.drawGameOverPanel();
    }

    if (this.damageFlash > 0) {
      ctx.globalAlpha = Math.min(0.42, this.damageFlash * 0.55);
      ctx.fillStyle = "#ff245f";
      ctx.fillRect(0, 0, this.width, this.height);
    }

    ctx.restore();
  }

  drawArena() {
    const ctx = this.ctx;
    ctx.save();
    const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, 80, this.width / 2, this.height / 2, 520);
    vignette.addColorStop(0, "rgba(0,255,127,0.018)");
    vignette.addColorStop(0.72, "rgba(255,60,247,0.012)");
    vignette.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(66,245,255,0.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 14]);
    ctx.strokeRect(11.5, 11.5, this.width - 23, this.height - 23);
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawMenu() {
    const ctx = this.ctx;
    const time = performance.now() * 0.001;
    ctx.save();

    const demoAsteroids = [
      { x: 116 + Math.sin(time * 0.55) * 24, y: 125, radius: 48, rotation: time * 0.18, seed: 0.2 },
      { x: 672 + Math.cos(time * 0.43) * 28, y: 158, radius: 30, rotation: -time * 0.3, seed: 1.3 },
      { x: 650 + Math.sin(time * 0.7) * 18, y: 470, radius: 18, rotation: time * 0.55, seed: 2.1 }
    ];

    for (const item of demoAsteroids) this.drawDecorativeAsteroid(item);

    ctx.translate(this.width / 2, 218);
    ctx.rotate(-Math.PI / 2 + Math.sin(time * 0.7) * 0.08);
    this.drawShipVector(ctx, true, time);
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.shadowColor = "#00ff7f";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#00ff7f";
    ctx.font = '900 38px "Orbitron", sans-serif';
    ctx.fillText("NEON ASTEROIDS", this.width / 2, 350);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,0.62)";
    ctx.font = '700 15px "Rajdhani", sans-serif';
    ctx.fillText("VECTOR INERTIA · INFINITE WRAP FIELD · FRACTURE SYSTEM", this.width / 2, 384);

    const alpha = 0.6 + Math.abs(Math.sin(time * 3.2)) * 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#42f5ff";
    ctx.font = '700 14px "Press Start 2P", monospace';
    ctx.fillText("PRESS SPACE OR ENTER", this.width / 2, 452);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(248,247,255,0.46)";
    ctx.font = '700 13px "Rajdhani", sans-serif';
    ctx.fillText("← → ROTATE   ↑ THRUST   SPACE FIRE", this.width / 2, 495);
    ctx.restore();
  }

  drawDecorativeAsteroid(item) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation);
    ctx.strokeStyle = "#00ff7f";
    ctx.shadowColor = "#00ff7f";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const sides = 10;
    for (let index = 0; index < sides; index += 1) {
      const angle = index / sides * Math.PI * 2;
      const radius = item.radius * (0.78 + 0.18 * Math.sin(index * 2.3 + item.seed));
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  drawShip() {
    if (this.ship.invulnerable > 0 && Math.floor(this.ship.invulnerable * 10) % 2 === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.ship.x, this.ship.y);
    ctx.rotate(this.ship.angle);
    this.drawShipVector(ctx, this.ship.thrusting, this.elapsed);
    ctx.restore();
  }

  drawShipVector(ctx, thrusting, time) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#42f5ff";
    ctx.fillStyle = "rgba(66,245,255,0.055)";
    ctx.shadowColor = "#42f5ff";
    ctx.shadowBlur = 15;
    ctx.lineWidth = 2.4;

    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-14, -14);
    ctx.lineTo(-8, -4);
    ctx.lineTo(-13, 0);
    ctx.lineTo(-8, 4);
    ctx.lineTo(-14, 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#ff3cf7";
    ctx.shadowColor = "#ff3cf7";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-9, 0);
    ctx.stroke();

    ctx.fillStyle = "#ffe75b";
    ctx.shadowColor = "#ffe75b";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(4, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();

    if (thrusting) {
      const flicker = 8 + Math.abs(Math.sin(time * 33)) * 11 + Math.random() * 5;
      const gradient = ctx.createLinearGradient(-10, 0, -10 - flicker, 0);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.25, "#42f5ff");
      gradient.addColorStop(1, "rgba(255,189,60,0)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "#42f5ff";
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(-10 - flicker, 0);
      ctx.lineTo(-10, 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  drawAsteroids() {
    for (const asteroid of this.asteroids) this.drawAsteroid(asteroid);
  }

  drawAsteroid(asteroid) {
    const ctx = this.ctx;
    const pulse = 0.8 + Math.sin(this.elapsed * 2.4 + asteroid.pulseOffset) * 0.2;
    ctx.save();
    ctx.translate(asteroid.x, asteroid.y);
    ctx.rotate(asteroid.rotation);
    ctx.lineJoin = "bevel";
    ctx.strokeStyle = "#00ff7f";
    ctx.fillStyle = `rgba(0,255,127,${0.018 + pulse * 0.018})`;
    ctx.shadowColor = "#00ff7f";
    ctx.shadowBlur = 12 + pulse * 8;
    ctx.lineWidth = asteroid.size === "large" ? 2.6 : asteroid.size === "medium" ? 2.2 : 1.7;

    ctx.beginPath();
    asteroid.vertices.forEach((vertex, index) => {
      const x = Math.cos(vertex.angle) * vertex.radius;
      const y = Math.sin(vertex.angle) * vertex.radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = 0.35;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let index = 0; index < asteroid.vertices.length; index += 3) {
      const vertex = asteroid.vertices[index];
      const x = Math.cos(vertex.angle) * vertex.radius * 0.68;
      const y = Math.sin(vertex.angle) * vertex.radius * 0.68;
      ctx.moveTo(x * 0.28, y * 0.28);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBullets() {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "#ffe75b";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffe75b";
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.2;
    for (const bullet of this.bullets) {
      const speed = Math.hypot(bullet.vx, bullet.vy) || 1;
      const tailX = bullet.x - bullet.vx / speed * 10;
      const tailY = bullet.y - bullet.vy / speed * 10;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    for (const particle of this.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (0.45 + alpha * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawHud() {
    const ctx = this.ctx;
    ctx.save();
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(248,247,255,0.48)";
    ctx.font = '700 11px "Orbitron", sans-serif';
    ctx.fillText("SCORE", 28, 24);
    ctx.fillText("WAVE", this.width / 2 - 25, 24);
    ctx.textAlign = "right";
    ctx.fillText("LIVES", this.width - 28, 24);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffe75b";
    ctx.shadowColor = "#ffe75b";
    ctx.shadowBlur = 9;
    ctx.font = '800 20px "Orbitron", sans-serif';
    ctx.fillText(String(this.score).padStart(6, "0"), 28, 42);

    ctx.textAlign = "center";
    ctx.fillStyle = "#00ff7f";
    ctx.shadowColor = "#00ff7f";
    ctx.fillText(String(this.wave).padStart(2, "0"), this.width / 2, 42);

    ctx.textAlign = "right";
    ctx.fillStyle = "#42f5ff";
    ctx.shadowColor = "#42f5ff";
    ctx.fillText(String(this.lives), this.width - 28, 42);

    ctx.shadowBlur = 0;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(248,247,255,0.36)";
    ctx.font = '700 10px "Rajdhani", sans-serif';
    ctx.fillText(`ROCKS ${String(this.asteroids.length).padStart(2, "0")}`, 28, this.height - 30);
    ctx.textAlign = "center";
    ctx.fillText(`BULLETS ${this.bullets.length}/5`, this.width / 2, this.height - 30);
    ctx.textAlign = "right";
    ctx.fillText(this.ship.invulnerable > 0 ? `SHIELD ${this.ship.invulnerable.toFixed(1)}s` : "SHIELD OFF", this.width - 28, this.height - 30);
    ctx.restore();
  }

  drawGameOverPanel() {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(2,1,8,0.58)";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(248,247,255,0.62)";
    ctx.font = '700 14px "Rajdhani", sans-serif';
    ctx.fillText(`FINAL SCORE ${String(this.score).padStart(6, "0")} · WAVE ${this.wave}`, this.width / 2, this.height * 0.61);
    ctx.fillStyle = "#42f5ff";
    ctx.font = '700 11px "Press Start 2P", monospace';
    ctx.fillText("SPACE TO RESTART", this.width / 2, this.height * 0.69);
    ctx.restore();
  }

  getTelemetry() {
    return {
      state: this.state === GAME_STATES.GAME_OVER ? "GAME OVER" : this.state,
      score: String(this.score).padStart(6, "0"),
      primaryMetric: `LIVES ${this.lives}`,
      secondaryMetric: `WAVE ${this.wave}`,
      primaryButton: this.state === GAME_STATES.PLAYING ? "ABORT MISSION" : this.state === GAME_STATES.GAME_OVER ? "RETRY MISSION" : "START MISSION"
    };
  }
}

class PlaceholderGame {
  constructor(engine, config) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.input = engine.input;
    this.config = config;
    this.state = GAME_STATES.MENU;
  }

  update() {
    if (this.input.wasPressed("Space") || this.input.wasPressed("Enter")) {
      this.engine.showToast(`${this.config.title} · DISPONIBLE EN UNA PRÓXIMA FASE`);
    }
  }

  draw() {
    const ctx = this.ctx;
    const pulse = 0.58 + Math.sin(performance.now() * 0.003) * 0.16;
    ctx.save();
    ctx.textAlign = "center";
    ctx.strokeStyle = this.config.accent;
    ctx.shadowColor = this.config.accent;
    ctx.shadowBlur = 22;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.engine.width / 2, 215, 82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([8, 12]);
    ctx.strokeStyle = this.config.secondary;
    ctx.beginPath();
    ctx.arc(this.engine.width / 2, 215, 105, performance.now() * 0.0005, Math.PI * 1.5 + performance.now() * 0.0005);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = this.config.accent;
    ctx.font = "900 30px Orbitron, sans-serif";
    ctx.fillText(this.config.title, this.engine.width / 2, 355);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(248,247,255,.55)";
    ctx.font = "700 15px Rajdhani, sans-serif";
    ctx.fillText("MODULE RESERVED FOR A FUTURE DEVELOPMENT PHASE", this.engine.width / 2, 391);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = this.config.accent;
    ctx.font = "800 13px Orbitron, sans-serif";
    ctx.fillText("PRESS SPACE FOR STATUS", this.engine.width / 2, 449);
    ctx.restore();
  }

  handlePrimaryAction() {
    this.engine.showToast(`${this.config.title} · MÓDULO TODAVÍA BLOQUEADO`);
  }

  resetToMenu() {
    this.state = GAME_STATES.MENU;
  }

  getTelemetry() {
    return {
      state: "LOCKED",
      score: "------",
      primaryMetric: "--",
      secondaryMetric: "--",
      primaryButton: "MODULE PENDING"
    };
  }
}

class CRTVisualController {
  constructor(frame) {
    this.frame = frame;
    this.timer = null;
    this.running = false;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (!this.frame || this.running) return;
    this.running = true;
    this.tick();
  }

  tick() {
    if (!this.running || !this.frame) return;
    const luminance = 0.99 + Math.random() * 0.02;
    const jitterChance = Math.random();
    const jitterX = jitterChance > 0.965 ? (Math.random() - 0.5) * 0.7 : 0;
    const jitterY = jitterChance > 0.982 ? (Math.random() - 0.5) * 0.45 : 0;
    this.frame.style.setProperty("--crt-flicker", luminance.toFixed(4));
    this.frame.style.setProperty("--crt-jitter-x", `${jitterX.toFixed(3)}px`);
    this.frame.style.setProperty("--crt-jitter-y", `${jitterY.toFixed(3)}px`);
    this.timer = window.setTimeout(this.tick, 70 + Math.random() * 85);
  }

  stop() {
    this.running = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.frame) return;
    this.frame.style.setProperty("--crt-flicker", "1");
    this.frame.style.setProperty("--crt-jitter-x", "0px");
    this.frame.style.setProperty("--crt-jitter-y", "0px");
  }
}


const SCORE_INTEGRITY_RULES = Object.freeze({
  "space-invaders": Object.freeze({ maxFrameDelta: 60000, baseAllowance: 10000, maxPerSecond: 42000, absoluteMaximum: 50000000 }),
  "pac-man": Object.freeze({ maxFrameDelta: 40000, baseAllowance: 10000, maxPerSecond: 36000, absoluteMaximum: 50000000 }),
  asteroids: Object.freeze({ maxFrameDelta: 50000, baseAllowance: 10000, maxPerSecond: 40000, absoluteMaximum: 50000000 })
});

class ScoreIntegrityGuard {
  constructor() {
    this.reset("space-invaders", 0);
  }

  reset(gameId, initialScore = 0) {
    this.gameId = String(gameId || "space-invaders");
    this.rule = SCORE_INTEGRITY_RULES[this.gameId] || SCORE_INTEGRITY_RULES["space-invaders"];
    this.startedAt = performance.now();
    this.lastCheckedAt = this.startedAt;
    this.initialScore = Math.max(0, Math.floor(Number(initialScore) || 0));
    this.lastValidScore = this.initialScore;
    this.compromised = false;
    this.reason = "";
  }

  validate(score, state = GAME_STATES.PLAYING, now = performance.now()) {
    if (this.compromised) return { valid: false, reason: this.reason, score: this.lastValidScore };
    if (state !== GAME_STATES.PLAYING) return { valid: true, score: this.lastValidScore };

    const normalized = Number(score);
    if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
      return this.block("INVALID SCORE FORMAT");
    }
    if (normalized > this.rule.absoluteMaximum) return this.block("SCORE LIMIT EXCEEDED");
    if (normalized < this.lastValidScore) return this.block("SCORE ROLLBACK DETECTED");

    const frameDelta = normalized - this.lastValidScore;
    if (frameDelta > this.rule.maxFrameDelta) return this.block("IMPOSSIBLE FRAME INCREMENT");

    const elapsedSeconds = Math.max(0, (now - this.startedAt) / 1000);
    const sessionMaximum = this.initialScore + this.rule.baseAllowance + this.rule.maxPerSecond * elapsedSeconds;
    if (normalized > sessionMaximum) return this.block("IMPOSSIBLE SCORE RATE");

    this.lastValidScore = normalized;
    this.lastCheckedAt = now;
    return { valid: true, score: normalized };
  }

  finalize(score, now = performance.now()) {
    if (this.compromised) return { valid: false, reason: this.reason, score: this.lastValidScore };
    const result = this.validate(score, GAME_STATES.PLAYING, now);
    if (!result.valid) return result;
    return { valid: true, score: this.lastValidScore };
  }

  block(reason) {
    this.compromised = true;
    this.reason = String(reason || "INTEGRITY FAILURE");
    return { valid: false, reason: this.reason, score: this.lastValidScore };
  }
}

class ArcadeEngine {
  constructor(canvas, input, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.input = input;
    this.ui = ui;
    this.width = 800;
    this.height = 600;
    this.dpr = 1;
    this.isRunning = false;
    this.animationId = null;
    this.lastTimestamp = 0;
    this.telemetryAccumulator = 0;
    this.maxSubstep = 1 / 120;
    this.maxFrameDelta = 0.05;
    this.scoreIntegrity = new ScoreIntegrityGuard();
    this.integrityAlertShown = false;
    this.activeGame = GAME_CATALOG["space-invaders"];
    this.scoreStore = new HighScoreStore();
    this.audio = new RetroAudio();
    this.haptics = new ArcadeHaptics();
    this.module = new AlienInvadersGame(this);
    this.stars = [];
    this.floatingMessages = [];
    this.toastPulseCooldown = 0;
    this.lastReportedScore = 0;
    this.sessionStartHighScore = this.scoreStore.get(this.activeGame.id);

    this.loop = this.loop.bind(this);
    this.resizeCanvas = this.resizeCanvas.bind(this);
    this.canvasScaler = new ResponsiveCanvasController(
      this.canvas,
      document.getElementById("canvasFrame"),
      document.getElementById("gameModal")
    );
    this.createStarField();
    this.resizeCanvas();
    this.refreshHighScoreUi();
    this.syncAudioUi();
    this.syncUi(true);
    this.draw();
  }

  resizeCanvas() {
    this.width = 800;
    this.height = 600;
    this.dpr = 1;
    this.canvasScaler.setLogicalSize(this.width, this.height);
    this.ctx.imageSmoothingEnabled = true;
    this.draw();
  }

  resizeVisualCanvas(immediate = false) {
    this.canvasScaler.requestResize(immediate);
  }

  createStarField() {
    this.stars = Array.from({ length: 96 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      size: 0.35 + Math.random() * 1.55,
      speed: 8 + Math.random() * 22,
      alpha: 0.15 + Math.random() * 0.58
    }));
  }

  setGame(gameConfig) {
    this.audio.stopAllSounds(0.025);
    this.haptics.stop();
    this.activeGame = gameConfig;
    this.width = 800;
    this.height = 600;
    this.floatingMessages.length = 0;
    this.lastReportedScore = 0;
    this.integrityAlertShown = false;
    this.scoreIntegrity.reset(gameConfig.id, 0);
    this.sessionStartHighScore = this.scoreStore.get(gameConfig.id);
    if (gameConfig.id === "space-invaders") {
      this.module = new AlienInvadersGame(this);
    } else if (gameConfig.id === "pac-man") {
      this.module = new NeonPacmanGame(this);
    } else if (gameConfig.id === "asteroids") {
      this.module = new NeonAsteroidsGame(this);
    } else {
      this.module = new PlaceholderGame(this, gameConfig);
    }
    this.createStarField();
    this.resizeCanvas();
    this.input.clear();
    this.syncUi(true);
    this.draw();
  }

  startLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTimestamp = performance.now();
    this.animationId = requestAnimationFrame(this.loop);
  }

  stopLoop() {
    this.isRunning = false;
    this.audio.stopAllSounds(0.035);
    this.haptics.stop();
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.animationId = null;
    this.input.clear();
    this.releaseTransientArrays();
  }

  releaseTransientArrays() {
    const arrayNames = ["particles", "bullets", "playerBullets", "enemyBullets", "floatingMessages"];
    for (const name of arrayNames) {
      const target = name === "floatingMessages" ? this : this.module;
      const value = target?.[name];
      if (Array.isArray(value) && value.length > 0) value.splice(0, value.length);
    }
  }

  loop() {
    if (!this.isRunning) return;
    const now = performance.now();
    let remaining = Math.min(Math.max(0, (now - this.lastTimestamp) / 1000), this.maxFrameDelta);
    this.lastTimestamp = now;

    while (remaining > 0) {
      const deltaTime = Math.min(remaining, this.maxSubstep);
      this.update(deltaTime);
      remaining -= deltaTime;
    }

    this.draw();
    this.input.endFrame();
    this.animationId = requestAnimationFrame(this.loop);
  }

  update(deltaTime) {
    this.updateStars(deltaTime);
    this.updateFloatingMessages(deltaTime);
    this.toastPulseCooldown = Math.max(0, this.toastPulseCooldown - deltaTime);
    this.module.update(deltaTime);
    const rawLiveScore = Number(this.module.score);
    const integrity = this.scoreIntegrity.validate(rawLiveScore, this.module.state, performance.now());
    if (!integrity.valid) {
      this.handleIntegrityFailure(integrity.reason);
    } else if (integrity.score > this.lastReportedScore) {
      this.lastReportedScore = integrity.score;
    }

    this.telemetryAccumulator += deltaTime;
    if (this.telemetryAccumulator >= 0.08) {
      this.telemetryAccumulator = 0;
      this.syncUi(false);
    }
  }

  updateStars(deltaTime) {
    const multiplier = this.module.state === GAME_STATES.PLAYING ? 1.3 : 0.55;
    for (const star of this.stars) {
      star.y += star.speed * multiplier * deltaTime;
      if (star.y > this.height + 3) {
        star.y = -3;
        star.x = Math.random() * this.width;
      }
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#020106";
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawAmbientGlow();
    this.drawStars();
    this.module.draw();
    this.drawFloatingMessages();
  }

  drawAmbientGlow() {
    const gradient = this.ctx.createRadialGradient(this.width * 0.5, this.height * 0.34, 20, this.width * 0.5, this.height * 0.34, 520);
    gradient.addColorStop(0, this.hexToRgba(this.activeGame.accent, 0.07));
    gradient.addColorStop(0.5, this.hexToRgba(this.activeGame.secondary, 0.018));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  drawStars() {
    this.ctx.save();
    this.ctx.shadowColor = this.activeGame.accent;
    this.ctx.shadowBlur = 5;
    for (const star of this.stars) {
      this.ctx.globalAlpha = star.alpha;
      this.ctx.fillStyle = "#f8f7ff";
      this.ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    this.ctx.restore();
  }

  syncUi(force) {
    const telemetry = this.module.getTelemetry();
    this.ui.stateChip.textContent = telemetry.state;
    this.ui.telemetryState.textContent = telemetry.state;
    this.ui.telemetryScore.textContent = telemetry.score;
    if (this.ui.telemetryHighScore) {
      this.ui.telemetryHighScore.textContent = this.formatScore(this.scoreStore.get(this.activeGame.id));
    }
    this.ui.telemetryLives.textContent = telemetry.primaryMetric;
    this.ui.telemetryWave.textContent = telemetry.secondaryMetric;
    if (force || this.ui.primaryButton.textContent !== telemetry.primaryButton) {
      this.ui.primaryButton.textContent = telemetry.primaryButton;
      this.ui.primaryButton.disabled = !this.activeGame.playable;
      this.ui.primaryButton.style.opacity = this.activeGame.playable ? "1" : ".5";
      this.ui.primaryButton.style.cursor = this.activeGame.playable ? "pointer" : "not-allowed";
    }
  }

  handlePrimaryAction() {
    this.audio.unlock();
    this.module.handlePrimaryAction();
    this.syncUi(true);
  }

  resetToMenu() {
    this.audio.stopAllLoops(0.035);
    this.module.resetToMenu();
    this.floatingMessages.length = 0;
    this.input.clear();
    this.syncUi(true);
    this.draw();
  }

  formatScore(score) {
    return Math.max(0, Math.floor(Number(score) || 0)).toString().padStart(6, "0");
  }

  refreshHighScoreUi() {
    document.querySelectorAll("[data-high-score]").forEach((element) => {
      element.textContent = this.formatScore(this.scoreStore.get(element.dataset.highScore));
    });
    if (this.ui.telemetryHighScore) {
      this.ui.telemetryHighScore.textContent = this.formatScore(this.scoreStore.get(this.activeGame.id));
    }
  }

  syncAudioUi() {
    if (!this.ui.audioButton) return;
    const enabled = this.audio.enabled;
    this.ui.audioButton.textContent = enabled ? "SOUND: ON" : "SOUND: OFF";
    this.ui.audioButton.setAttribute("aria-pressed", enabled ? "true" : "false");
    this.ui.audioButton.dataset.enabled = enabled ? "true" : "false";
  }

  toggleAudio() {
    const enabled = this.audio.toggle();
    this.syncAudioUi();
    this.showToast(enabled ? "RETRO AUDIO ENABLED" : "RETRO AUDIO MUTED");
  }

  onGameStart() {
    this.audio.unlock();
    this.floatingMessages.length = 0;
    this.lastReportedScore = 0;
    this.integrityAlertShown = false;
    this.scoreIntegrity.reset(this.activeGame.id, 0);
    this.sessionStartHighScore = this.scoreStore.get(this.activeGame.id);
    this.showCanvasMessage("READY?", {
      y: this.height * 0.44,
      color: this.activeGame.accent,
      size: 28,
      duration: 1.45,
      blink: 8,
      fixed: true
    });
  }

  onGameOver(score) {
    const integrity = this.scoreIntegrity.finalize(Number(score), performance.now());
    if (!integrity.valid) {
      this.handleIntegrityFailure(integrity.reason);
      this.audio.stopAllLoops(0.04);
      return;
    }

    const normalizedScore = integrity.score;
    const isNewRecord = normalizedScore > this.sessionStartHighScore;
    this.scoreStore.submit(this.activeGame.id, normalizedScore);
    this.refreshHighScoreUi();
    this.showCanvasMessage("GAME OVER", {
      y: this.height * 0.43,
      color: "#ff416d",
      size: 32,
      duration: 3.1,
      blink: 6,
      fixed: true,
      priority: true
    });
    if (isNewRecord && normalizedScore > 0) {
      this.showCanvasMessage("NEW HIGH SCORE", {
        y: this.height * 0.53,
        color: "#ffe75b",
        size: 17,
        duration: 3.1,
        blink: 9,
        fixed: true,
        priority: false
      });
    }
    this.audio.stopAllLoops(0.04);
    if (this.activeGame.id !== "pac-man") this.audio.playArcadeSound(this.activeGame.id, "game_over");

    const secureResult = Object.freeze({
      game: this.activeGame.id,
      score: normalizedScore,
      isLocalRecord: isNewRecord,
      localHighScore: this.scoreStore.get(this.activeGame.id)
    });
    if (globalLeaderboard) {
      globalLeaderboard.handleGameOver(secureResult).catch((error) => {
        console.error("Global Game Over processing failed:", error);
        this.showToast("GLOBAL SCOREBOARD ERROR");
      });
    } else {
      pendingSecureGameOvers.push(secureResult);
    }
  }

  handleIntegrityFailure(reason) {
    if (this.integrityAlertShown) return;
    this.integrityAlertShown = true;
    this.scoreIntegrity.block(reason);
    this.input.clear();
    if (this.module) this.module.state = GAME_STATES.GAME_OVER;
    this.releaseTransientArrays();
    this.audio.stopAllSounds(0.025);
    this.haptics.damage();
    this.showCanvasMessage("CHEAT DETECTED", {
      y: this.height * 0.43,
      color: "#ff416d",
      size: 25,
      duration: 4.2,
      blink: 13,
      fixed: true,
      priority: true
    });
    this.showCanvasMessage("SCORE BLOCKED", {
      y: this.height * 0.54,
      color: "#ffe75b",
      size: 14,
      duration: 4.2,
      blink: 8,
      fixed: true
    });
    this.showToast(`DETECTADO USO DE CHEATS · ${reason}`);
  }

  showCanvasMessage(text, options = {}) {
    const message = {
      text: String(text),
      x: Number.isFinite(options.x) ? options.x : this.width / 2,
      y: Number.isFinite(options.y) ? options.y : this.height * 0.48,
      color: options.color || this.activeGame.accent,
      size: options.size || 20,
      duration: Math.max(0.2, options.duration || 1.2),
      elapsed: 0,
      rise: Number.isFinite(options.rise) ? options.rise : 18,
      blink: options.blink || 0,
      fixed: Boolean(options.fixed),
      priority: Boolean(options.priority)
    };
    if (message.priority) this.floatingMessages = this.floatingMessages.filter((item) => !item.priority);
    this.floatingMessages.push(message);
  }

  updateFloatingMessages(deltaTime) {
    for (let index = this.floatingMessages.length - 1; index >= 0; index -= 1) {
      const message = this.floatingMessages[index];
      message.elapsed += deltaTime;
      if (!message.fixed) message.y -= message.rise * deltaTime;
      if (message.elapsed >= message.duration) this.floatingMessages.splice(index, 1);
    }
  }

  drawFloatingMessages() {
    if (this.floatingMessages.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    for (const message of this.floatingMessages) {
      const progress = message.elapsed / message.duration;
      const fadeIn = Math.min(1, message.elapsed / 0.12);
      const fadeOut = Math.min(1, (message.duration - message.elapsed) / 0.28);
      const blinkAlpha = message.blink > 0
        ? 0.58 + Math.abs(Math.sin(message.elapsed * message.blink)) * 0.42
        : 1;
      const scale = 0.88 + Math.min(1, message.elapsed / 0.18) * 0.12;
      ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut)) * blinkAlpha;
      ctx.translate(message.x, message.y);
      ctx.scale(scale, scale);
      ctx.font = `400 ${message.size}px "Press Start 2P", "Courier New", monospace`;
      ctx.lineWidth = Math.max(3, message.size * 0.16);
      ctx.strokeStyle = "rgba(2, 1, 8, .9)";
      ctx.shadowColor = message.color;
      ctx.shadowBlur = 16 + Math.sin(progress * Math.PI) * 12;
      ctx.strokeText(message.text, 0, 0);
      ctx.fillStyle = message.color;
      ctx.fillText(message.text, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
    }
    ctx.restore();
  }

  emitToastPulse() {
    if (this.toastPulseCooldown > 0) return;
    this.toastPulseCooldown = 0.7;
  }

  showToast(message) {
    showToast(message);
  }

  hexToRgba(hex, alpha) {
    const normalized = hex.replace("#", "");
    const full = normalized.length === 3
      ? normalized.split("").map((character) => character + character).join("")
      : normalized;
    const value = Number.parseInt(full, 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }
}

const modal = document.getElementById("gameModal");
const dialog = document.getElementById("gameDialog");
const modalTitle = document.getElementById("modalGameTitle");
const closeModalButton = document.getElementById("closeModalButton");
const primaryGameButton = document.getElementById("primaryGameButton");
const resetGameButton = document.getElementById("resetGameButton");
const audioToggleButton = document.getElementById("audioToggleButton");
const toast = document.getElementById("toast");
const systemClock = document.getElementById("systemClock");
const exploreButton = document.getElementById("exploreButton");
const canvas = document.getElementById("gameCanvas");
const controlDescription = document.getElementById("controlDescription");

const ui = {
  stateChip: document.getElementById("stateChip"),
  telemetryState: document.getElementById("telemetryState"),
  telemetryScore: document.getElementById("telemetryScore"),
  telemetryHighScore: document.getElementById("telemetryHighScore"),
  telemetryLives: document.getElementById("telemetryLives"),
  telemetryWave: document.getElementById("telemetryWave"),
  primaryButton: primaryGameButton,
  audioButton: audioToggleButton
};

const input = new InputManager();
const engine = new ArcadeEngine(canvas, input, ui);
const crtVisuals = new CRTVisualController(document.getElementById("canvasFrame"));
const touchControls = new TouchArcadeControls(input, modal, () => engine.resizeVisualCanvas(true));
let lastFocusedElement = null;
let toastTimer = null;

function openGame(gameId) {
  const game = GAME_CATALOG[gameId];
  if (!game) return;

  lastFocusedElement = document.activeElement;
  modal.style.setProperty("--modal-accent", game.accent);
  modal.style.setProperty("--modal-accent-rgb", game.accentRgb);
  modal.style.setProperty("--modal-secondary", game.secondary);
  modalTitle.textContent = game.title;
  controlDescription.textContent = game.controls || game.hint;
  engine.audio.unlock();
  engine.setGame(game);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  input.setEnabled(true);
  touchControls.setVisible(true);
  crtVisuals.start();
  engine.startLoop();

  requestAnimationFrame(() => {
    engine.resizeVisualCanvas(true);
    dialog.focus({ preventScroll: true });
  });
  showToast(`${game.title} · ${game.playable ? "COMBAT CORE READY" : "MODULE LOCKED"}`);
}

function closeGame() {
  if (!modal.classList.contains("is-open")) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  touchControls.setVisible(false);
  crtVisuals.stop();
  input.setEnabled(false);
  engine.stopLoop();
  engine.resetToMenu();
  globalLeaderboard?.closeInitialsModal();
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus({ preventScroll: true });
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function trapModalFocus(event) {
  if (event.key !== "Tab" || !modal.classList.contains("is-open")) return;
  const focusable = Array.from(
    dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
  ).filter((element) => element.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updateClock() {
  systemClock.textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

document.querySelectorAll("[data-open-game]").forEach((button) => {
  button.addEventListener("click", () => openGame(button.dataset.openGame));
});

document.querySelectorAll("[data-close-modal]").forEach((element) => element.addEventListener("click", closeGame));
closeModalButton.addEventListener("click", closeGame);
primaryGameButton.addEventListener("click", () => engine.handlePrimaryAction());
if (audioToggleButton) audioToggleButton.addEventListener("click", () => engine.toggleAudio());
resetGameButton.addEventListener("click", () => {
  engine.resetToMenu();
  showToast("CORE RESET · MENU RESTORED");
});
exploreButton.addEventListener("click", () => {
  document.getElementById("catalog").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("is-open")) {
    event.preventDefault();
    closeGame();
    return;
  }
  trapModalFocus(event);
});

updateClock();
window.setInterval(updateClock, 1000);


async function initializeGlobalLeaderboardLayer() {
  const [firebaseAppSdk, firebaseAuthSdk, firebaseFirestoreSdk, firebaseAppCheckSdk] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js"),
    appCheckSiteKey
      ? import("https://www.gstatic.com/firebasejs/12.17.0/firebase-app-check.js")
      : Promise.resolve(null)
  ]);

  const { initializeApp, getApp, getApps } = firebaseAppSdk;
  const { getAuth, signInAnonymously } = firebaseAuthSdk;
  const initializeAppCheck = firebaseAppCheckSdk?.initializeAppCheck;
  const ReCaptchaEnterpriseProvider = firebaseAppCheckSdk?.ReCaptchaEnterpriseProvider;
  const {
    getFirestore,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    onSnapshot,
    doc,
    getDoc,
    setDoc,
    serverTimestamp
  } = firebaseFirestoreSdk;

const runtimeArcadeConfig = globalThis.__NEON_ARCADE_CONFIG__ || {};
const runtimeFirebaseConfig = runtimeArcadeConfig.firebase;
const appCheckSiteKey = String(runtimeArcadeConfig.recaptchaEnterpriseSiteKey || "").trim();
const firebaseConfig = Object.freeze(runtimeFirebaseConfig || {
  apiKey: "AIzaSyBtYxqH238gnZLi0N6NYM61SEYbUMGkG-I",
  authDomain: "neon-arcade-d53be.firebaseapp.com",
  projectId: "neon-arcade-d53be",
  storageBucket: "neon-arcade-d53be.firebasestorage.app",
  messagingSenderId: "1076198889450",
  appId: "1:1076198889450:web:54cfbbc4e4a356b0ccc493",
  measurementId: "G-8LVBQJCEC7"
});
try {
  delete globalThis.__NEON_ARCADE_CONFIG__;
} catch (error) {
  globalThis.__NEON_ARCADE_CONFIG__ = undefined;
}

const COLLECTION_NAME = "arcade_leaderboard";
const GLOBAL_CACHE_KEY = "neonNexus.globalLeaderboardCache.v1";
const PLAYER_INITIALS_KEY = "neonNexus.playerInitials.v1";
const VALID_GAMES = Object.freeze(["invaders", "pacman", "asteroids"]);
const GAME_ALIASES = Object.freeze({
  "space-invaders": "invaders",
  invaders: "invaders",
  "pac-man": "pacman",
  pacman: "pacman",
  asteroids: "asteroids"
});
const GAME_META = Object.freeze({
  invaders: { title: "ALIEN INVADERS", accent: "#42f5ff", rgb: "66,245,255" },
  pacman: { title: "PAC-MAN NEÓN", accent: "#ffbd3c", rgb: "255,189,60" },
  asteroids: { title: "ASTEROIDS NEÓN", accent: "#00ff7f", rgb: "0,255,127" }
});

function normalizeGame(game) {
  const normalized = GAME_ALIASES[String(game || "").trim().toLowerCase()];
  if (!normalized || !VALID_GAMES.includes(normalized)) {
    throw new Error("Juego no válido para el leaderboard global.");
  }
  return normalized;
}

function normalizeScore(score) {
  const value = Math.floor(Number(score));
  if (!Number.isFinite(value) || value < 0) throw new Error("La puntuación debe ser un número positivo.");
  return Math.min(value, 50000000);
}

function normalizeUsername(username) {
  const clean = String(username || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
  if (!/^[A-Z0-9]{1,3}$/.test(clean)) throw new Error("Ingresa entre 1 y 3 letras o números.");
  return clean;
}

function isFirebaseConfigured(config) {
  return Object.values(config).every((value) => {
    const text = String(value || "");
    return text.length > 0 && !/YOUR_|YOUR-|REPLACE|PROJECT_ID/i.test(text);
  });
}

function scoreToText(score) {
  return String(Math.max(0, Math.floor(Number(score) || 0))).padStart(6, "0");
}

function safeUsername(username) {
  try {
    return normalizeUsername(username);
  } catch (error) {
    return "???";
  }
}

function timestampToDate(timestamp) {
  if (timestamp && typeof timestamp.toDate === "function") return timestamp.toDate();
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

class GlobalLeaderboardService {
  constructor(config) {
    this.config = config;
    this.configured = isFirebaseConfigured(config);
    this.app = null;
    this.auth = null;
    this.db = null;
    this.appCheck = null;
    this.user = null;
    this.ready = false;
    this.initializing = null;
    this.unsubscribers = new Map();
    this.topScores = this.readCache();
    this.boards = new Map();
    this.pendingEntry = null;
    this.promptOpen = false;
    this.destroyed = false;
    this.injectStyles();
    this.injectScoreboards();
    this.injectInitialsModal();
    this.bindPortalEvents();
    this.renderAllBoards(this.configured ? "CONNECTING" : "CONFIG REQUIRED");
  }

  readCache() {
    const initial = { invaders: [], pacman: [], asteroids: [] };
    try {
      const parsed = JSON.parse(window.localStorage.getItem(GLOBAL_CACHE_KEY) || "{}");
      for (const game of VALID_GAMES) {
        if (!Array.isArray(parsed[game])) continue;
        initial[game] = parsed[game]
          .map((entry) => ({
            username: safeUsername(entry.username),
            score: normalizeScore(entry.score),
            timestamp: entry.timestamp || null
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      }
    } catch (error) {
      console.warn("No se pudo leer la caché global:", error);
    }
    return initial;
  }

  persistCache() {
    try {
      window.localStorage.setItem(GLOBAL_CACHE_KEY, JSON.stringify(this.topScores));
    } catch (error) {
      console.warn("No se pudo guardar la caché global:", error);
    }
  }

  injectStyles() {
    if (document.getElementById("globalLeaderboardStyles")) return;
    const style = document.createElement("style");
    style.id = "globalLeaderboardStyles";
    style.textContent = `
      .global-leaderboard-layout{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:1.35rem!important}
      .arcade-terminal-slot{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(250px,.62fr);gap:1rem;align-items:stretch}
      .global-scoreboard{--board-accent:#42f5ff;--board-rgb:66,245,255;position:relative;overflow:hidden;border:1px solid rgba(var(--board-rgb),.45);border-radius:1.7rem;background:linear-gradient(155deg,rgba(5,2,10,.92),rgba(12,5,22,.78));box-shadow:inset 0 0 28px rgba(var(--board-rgb),.045),0 0 24px rgba(var(--board-rgb),.09);padding:1rem;isolation:isolate}
      .global-scoreboard::before{position:absolute;inset:-2px;z-index:-1;content:"";border-radius:inherit;background:conic-gradient(from 90deg,transparent,rgba(var(--board-rgb),.85),transparent 28%,transparent 72%,rgba(255,0,127,.5),transparent);filter:blur(7px);opacity:.42;animation:globalBoardPulse 3.8s linear infinite}
      .global-scoreboard::after{position:absolute;inset:0;z-index:-1;content:"";pointer-events:none;background:linear-gradient(transparent 50%,rgba(var(--board-rgb),.025) 50%);background-size:100% 4px;opacity:.7}
      .global-board-header{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding:.25rem .15rem .8rem;border-bottom:1px solid rgba(var(--board-rgb),.18)}
      .global-board-kicker{font-family:"Press Start 2P",monospace;font-size:7px;letter-spacing:.14em;color:rgba(255,255,255,.35)}
      .global-board-title{margin-top:.55rem;font-family:"Orbitron",sans-serif;font-size:.9rem;font-weight:900;letter-spacing:.08em;color:var(--board-accent);text-shadow:0 0 12px rgba(var(--board-rgb),.72)}
      .global-board-status{display:inline-flex;align-items:center;gap:.35rem;border:1px solid rgba(var(--board-rgb),.22);border-radius:999px;padding:.35rem .5rem;font-family:"Press Start 2P",monospace;font-size:5px;line-height:1.35;letter-spacing:.08em;color:rgba(255,255,255,.54);background:rgba(var(--board-rgb),.055);text-align:right}
      .global-board-status::before{width:6px;height:6px;border-radius:50%;content:"";background:var(--board-accent);box-shadow:0 0 9px var(--board-accent)}
      .global-board-status[data-state="offline"]::before,.global-board-status[data-state="error"]::before{background:#ff416d;box-shadow:0 0 9px #ff416d}
      .global-board-status[data-state="config"]::before{background:#ffbd3c;box-shadow:0 0 9px #ffbd3c}
      .global-board-list{display:grid;gap:.42rem;margin-top:.85rem}
      .global-score-row{display:grid;grid-template-columns:25px minmax(0,1fr) auto;align-items:center;gap:.55rem;min-height:38px;border:1px solid rgba(255,255,255,.07);border-radius:.75rem;padding:.45rem .55rem;background:rgba(255,255,255,.025);transition:transform .16s ease,border-color .16s ease,background .16s ease}
      .global-score-row:hover{transform:translateX(2px);border-color:rgba(var(--board-rgb),.32);background:rgba(var(--board-rgb),.055)}
      .global-score-rank{font-family:"Press Start 2P",monospace;font-size:7px;color:rgba(255,255,255,.32)}
      .global-score-name{font-family:"Orbitron",sans-serif;font-size:.72rem;font-weight:900;letter-spacing:.18em;color:#fff;text-shadow:0 0 8px rgba(255,255,255,.18)}
      .global-score-value{font-family:"Press Start 2P",monospace;font-size:7px;color:var(--board-accent);text-shadow:0 0 8px rgba(var(--board-rgb),.65)}
      .global-score-empty{display:grid;place-items:center;min-height:214px;padding:1rem;text-align:center;font-family:"Press Start 2P",monospace;font-size:7px;line-height:1.9;letter-spacing:.08em;color:rgba(255,255,255,.28)}
      .global-score-foot{display:flex;justify-content:space-between;gap:.75rem;margin-top:.8rem;padding:.7rem .15rem .1rem;border-top:1px solid rgba(var(--board-rgb),.13);font-size:.65rem;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.28)}
      .global-initials-shell{position:fixed;inset:0;z-index:220;display:grid;place-items:center;padding:1rem;visibility:hidden;opacity:0;transition:opacity .2s ease,visibility .2s ease}
      .global-initials-shell.is-open{visibility:visible;opacity:1}
      .global-initials-backdrop{position:absolute;inset:0;background:rgba(2,1,5,.88);backdrop-filter:blur(14px)}
      .global-initials-panel{--entry-accent:#42f5ff;--entry-rgb:66,245,255;position:relative;width:min(92vw,480px);overflow:hidden;border:1px solid rgba(var(--entry-rgb),.52);border-radius:1.5rem;background:linear-gradient(145deg,rgba(15,7,27,.98),rgba(5,2,10,.98));box-shadow:0 0 55px rgba(var(--entry-rgb),.18),inset 0 0 30px rgba(var(--entry-rgb),.045);padding:clamp(1.2rem,4vw,2rem)}
      .global-initials-panel::before{position:absolute;top:0;left:0;width:100%;height:2px;content:"";background:linear-gradient(90deg,transparent,var(--entry-accent),#ff007f,transparent);box-shadow:0 0 18px var(--entry-accent);animation:entryScan 2.2s linear infinite}
      .global-entry-kicker{font-family:"Press Start 2P",monospace;font-size:7px;letter-spacing:.15em;color:rgba(255,255,255,.36)}
      .global-entry-title{margin-top:.9rem;font-family:"Orbitron",sans-serif;font-size:clamp(1.15rem,5vw,1.75rem);font-weight:900;line-height:1.12;color:var(--entry-accent);text-shadow:0 0 16px rgba(var(--entry-rgb),.7)}
      .global-entry-copy{margin-top:.8rem;font-size:.95rem;font-weight:600;line-height:1.55;color:rgba(255,255,255,.58)}
      .global-entry-score{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:1rem;border:1px solid rgba(var(--entry-rgb),.2);border-radius:.9rem;padding:.8rem 1rem;background:rgba(var(--entry-rgb),.045)}
      .global-entry-score span:first-child{font-family:"Press Start 2P",monospace;font-size:6px;color:rgba(255,255,255,.4)}
      .global-entry-score strong{font-family:"Press Start 2P",monospace;font-size:.85rem;color:#fff;text-shadow:0 0 12px rgba(var(--entry-rgb),.6)}
      .global-entry-input{width:100%;margin-top:1rem;border:1px solid rgba(var(--entry-rgb),.44);border-radius:1rem;padding:1rem;text-align:center;font-family:"Press Start 2P",monospace;font-size:clamp(1.5rem,8vw,2.4rem);letter-spacing:.35em;text-transform:uppercase;color:#fff;background:#05020a;box-shadow:inset 0 0 22px rgba(var(--entry-rgb),.08),0 0 20px rgba(var(--entry-rgb),.08);outline:none;caret-color:var(--entry-accent)}
      .global-entry-input:focus{border-color:var(--entry-accent);box-shadow:inset 0 0 22px rgba(var(--entry-rgb),.12),0 0 25px rgba(var(--entry-rgb),.2)}
      .global-entry-error{min-height:1.3rem;margin-top:.65rem;font-family:"Press Start 2P",monospace;font-size:6px;line-height:1.6;color:#ff6b8f}
      .global-entry-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:.7rem;margin-top:.7rem}
      .global-entry-button{border:1px solid rgba(255,255,255,.14);border-radius:.85rem;padding:.85rem .65rem;font-family:"Orbitron",sans-serif;font-size:.68rem;font-weight:900;letter-spacing:.12em;color:rgba(255,255,255,.58);background:rgba(255,255,255,.045);transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
      .global-entry-button:hover,.global-entry-button:focus-visible{transform:translateY(-1px);filter:brightness(1.18);outline:none}
      .global-entry-button.primary{border-color:rgba(var(--entry-rgb),.48);color:#05020a;background:var(--entry-accent);box-shadow:0 0 22px rgba(var(--entry-rgb),.25)}
      .global-entry-button:disabled{cursor:wait;opacity:.5;transform:none}
      @keyframes globalBoardPulse{to{transform:rotate(360deg)}}
      @keyframes entryScan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
      @media(max-width:1020px){.arcade-terminal-slot{grid-template-columns:minmax(0,1fr)}.global-scoreboard{min-height:auto}.global-score-empty{min-height:150px}}
    `;
    document.head.appendChild(style);
  }

  injectScoreboards() {
    const buttons = Array.from(document.querySelectorAll("[data-open-game]"));
    if (buttons.length === 0) return;
    const catalogGrid = buttons[0].closest("#catalog .grid");
    if (catalogGrid) catalogGrid.classList.add("global-leaderboard-layout");

    for (const button of buttons) {
      const article = button.closest("article");
      if (!article || article.closest(".arcade-terminal-slot")) continue;
      const game = normalizeGame(button.dataset.openGame);
      const meta = GAME_META[game];
      const slot = document.createElement("div");
      slot.className = "arcade-terminal-slot";
      article.parentNode.insertBefore(slot, article);
      slot.appendChild(article);

      const board = document.createElement("aside");
      board.className = "global-scoreboard";
      board.dataset.globalBoard = game;
      board.style.setProperty("--board-accent", meta.accent);
      board.style.setProperty("--board-rgb", meta.rgb);
      board.setAttribute("aria-label", `Top 5 mundial de ${meta.title}`);
      board.innerHTML = `
        <div class="global-board-header">
          <div>
            <p class="global-board-kicker">GLOBAL NETWORK</p>
            <h4 class="global-board-title">WORLD TOP 5</h4>
          </div>
          <span class="global-board-status" data-global-status="${game}" data-state="loading">CONNECTING</span>
        </div>
        <div class="global-board-list" data-global-list="${game}"></div>
        <div class="global-score-foot"><span>${meta.title}</span><span>LIVE FIRESTORE</span></div>
      `;
      slot.appendChild(board);
      this.boards.set(game, board);
    }
  }

  injectInitialsModal() {
    if (document.getElementById("globalInitialsModal")) return;
    const shell = document.createElement("div");
    shell.id = "globalInitialsModal";
    shell.className = "global-initials-shell";
    shell.setAttribute("aria-hidden", "true");
    shell.innerHTML = `
      <div class="global-initials-backdrop" data-entry-cancel></div>
      <section class="global-initials-panel" role="dialog" aria-modal="true" aria-labelledby="globalEntryTitle">
        <p class="global-entry-kicker">GLOBAL RANKING QUALIFIER</p>
        <h2 id="globalEntryTitle" class="global-entry-title">ENTER INITIALS</h2>
        <p id="globalEntryCopy" class="global-entry-copy">Tu puntuación puede entrar en el registro mundial. Identifica tu piloto antes de transmitirla.</p>
        <div class="global-entry-score"><span>FINAL SCORE</span><strong id="globalEntryScore">000000</strong></div>
        <form id="globalEntryForm" novalidate>
          <label class="sr-only" for="globalInitialsInput">Iniciales del jugador</label>
          <input id="globalInitialsInput" class="global-entry-input" type="text" inputmode="text" maxlength="3" minlength="1" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-describedby="globalEntryError" placeholder="AAA" />
          <p id="globalEntryError" class="global-entry-error" role="alert"></p>
          <div class="global-entry-actions">
            <button type="button" class="global-entry-button" data-entry-cancel>CANCEL</button>
            <button id="globalEntrySubmit" type="submit" class="global-entry-button primary">UPLOAD SCORE</button>
          </div>
        </form>
      </section>
    `;
    document.body.appendChild(shell);
    this.entryShell = shell;
    this.entryPanel = shell.querySelector(".global-initials-panel");
    this.entryTitle = shell.querySelector("#globalEntryTitle");
    this.entryCopy = shell.querySelector("#globalEntryCopy");
    this.entryScore = shell.querySelector("#globalEntryScore");
    this.entryForm = shell.querySelector("#globalEntryForm");
    this.entryInput = shell.querySelector("#globalInitialsInput");
    this.entryError = shell.querySelector("#globalEntryError");
    this.entrySubmit = shell.querySelector("#globalEntrySubmit");

    this.entryInput.addEventListener("input", () => {
      const selection = this.entryInput.selectionStart;
      this.entryInput.value = this.entryInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
      const cursor = Math.min(selection ?? this.entryInput.value.length, this.entryInput.value.length);
      this.entryInput.setSelectionRange(cursor, cursor);
      this.entryError.textContent = "";
    });

    shell.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeInitialsModal();
      }
    });

    shell.querySelectorAll("[data-entry-cancel]").forEach((element) => {
      element.addEventListener("click", () => this.closeInitialsModal());
    });
    this.entryForm.addEventListener("submit", (event) => this.submitInitials(event));
  }

  bindPortalEvents() {
    document.addEventListener("visibilitychange", () => {
      if (!this.ready) return;
      if (document.hidden) this.stopRealtime();
      else this.startRealtime();
    });
    window.addEventListener("pagehide", () => this.stopRealtime());
  }

  notify(message) {
    showToast(message);
  }

  async initialize() {
    if (this.ready) return this;
    if (this.initializing) return this.initializing;
    if (!this.configured) {
      this.renderAllBoards("CONFIG REQUIRED", "config");
      return this;
    }

    this.initializing = (async () => {
      try {
        this.app = getApps().length > 0 ? getApp() : initializeApp(this.config);
        if (appCheckSiteKey && initializeAppCheck && ReCaptchaEnterpriseProvider) {
          this.appCheck = initializeAppCheck(this.app, {
            provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
            isTokenAutoRefreshEnabled: true
          });
        }
        this.auth = getAuth(this.app);
        const credential = this.auth.currentUser ? { user: this.auth.currentUser } : await signInAnonymously(this.auth);
        this.user = credential.user;
        this.db = getFirestore(this.app);
        this.ready = true;
        this.renderAllBoards("LIVE", "online");
        this.startRealtime();
        return this;
      } catch (error) {
        this.ready = false;
        const status = error?.code === "auth/operation-not-allowed" ? "ENABLE ANON AUTH" : "NETWORK ERROR";
        this.renderAllBoards(status, "error");
        console.error("Firebase leaderboard initialization failed:", error);
        throw error;
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  async ensureReady() {
    await this.initialize();
    if (!this.configured) throw new Error("Reemplaza los marcadores de firebaseConfig antes de usar el ranking global.");
    if (!this.ready || !this.db || !this.user) throw new Error("El servicio global de puntuaciones no está disponible.");
  }

  async saveGlobalHighScore(game, username, score) {
    await this.ensureReady();
    const normalizedGame = normalizeGame(game);
    const normalizedUsername = normalizeUsername(username);
    const normalizedScore = normalizeScore(score);
    if (normalizedScore <= 0) return { saved: false, reason: "zero-score", score: normalizedScore };

    const recordRef = doc(this.db, COLLECTION_NAME, `${normalizedGame}_${this.user.uid}`);
    try {
      const current = await getDoc(recordRef);
      const currentScore = current.exists() ? normalizeScore(current.data().score || 0) : 0;
      if (normalizedScore <= currentScore) {
        return { saved: false, reason: "not-higher", score: normalizedScore, currentScore };
      }

      await setDoc(recordRef, {
        username: normalizedUsername,
        game: normalizedGame,
        score: normalizedScore,
        timestamp: serverTimestamp(),
        uid: this.user.uid
      });
      return { saved: true, score: normalizedScore, previousScore: currentScore };
    } catch (error) {
      console.error(`Error saving ${normalizedGame} high score:`, error);
      throw new Error(this.describeFirebaseError(error));
    }
  }

  async fetchGlobalTopScores(game) {
    await this.ensureReady();
    const normalizedGame = normalizeGame(game);
    const topQuery = query(
      collection(this.db, COLLECTION_NAME),
      where("game", "==", normalizedGame),
      orderBy("score", "desc"),
      limit(5)
    );

    try {
      const snapshot = await getDocs(topQuery);
      const scores = snapshot.docs.map((snapshotDoc) => this.mapScoreDocument(snapshotDoc)).slice(0, 5);
      this.updateScores(normalizedGame, scores, "LIVE", "online");
      return scores;
    } catch (error) {
      this.renderBoard(normalizedGame, this.topScores[normalizedGame], this.describeFirebaseError(error), "error");
      console.error(`Error fetching ${normalizedGame} leaderboard:`, error);
      throw new Error(this.describeFirebaseError(error));
    }
  }

  mapScoreDocument(snapshotDoc) {
    const data = snapshotDoc.data();
    return {
      id: snapshotDoc.id,
      username: safeUsername(data.username),
      game: normalizeGame(data.game),
      score: normalizeScore(data.score || 0),
      timestamp: timestampToDate(data.timestamp)?.toISOString() || null
    };
  }

  startRealtime() {
    if (!this.ready || !this.db || document.hidden) return;
    for (const game of VALID_GAMES) {
      if (this.unsubscribers.has(game)) continue;
      const topQuery = query(
        collection(this.db, COLLECTION_NAME),
        where("game", "==", game),
        orderBy("score", "desc"),
        limit(5)
      );
      const unsubscribe = onSnapshot(
        topQuery,
        (snapshot) => {
          const scores = snapshot.docs.map((snapshotDoc) => this.mapScoreDocument(snapshotDoc)).slice(0, 5);
          this.updateScores(game, scores, "LIVE", "online");
        },
        (error) => {
          const message = this.describeFirebaseError(error);
          this.renderBoard(game, this.topScores[game], message, "error");
          console.error(`Realtime ${game} leaderboard failed:`, error);
        }
      );
      this.unsubscribers.set(game, unsubscribe);
    }
  }

  stopRealtime() {
    for (const unsubscribe of this.unsubscribers.values()) {
      try {
        unsubscribe();
      } catch (error) {
        console.warn("Could not unsubscribe leaderboard listener:", error);
      }
    }
    this.unsubscribers.clear();
  }

  updateScores(game, scores, status = "LIVE", state = "online") {
    const normalizedGame = normalizeGame(game);
    this.topScores[normalizedGame] = scores
      .map((entry) => ({
        username: safeUsername(entry.username),
        score: normalizeScore(entry.score),
        timestamp: entry.timestamp || null
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    this.persistCache();
    this.renderBoard(normalizedGame, this.topScores[normalizedGame], status, state);
  }

  renderAllBoards(status, state = "loading") {
    for (const game of VALID_GAMES) this.renderBoard(game, this.topScores[game], status, state);
  }

  renderBoard(game, scores, status, state = "loading") {
    const board = this.boards.get(game);
    if (!board) return;
    const list = board.querySelector(`[data-global-list="${game}"]`);
    const statusNode = board.querySelector(`[data-global-status="${game}"]`);
    statusNode.textContent = status;
    statusNode.dataset.state = state;

    if (!Array.isArray(scores) || scores.length === 0) {
      list.innerHTML = `<div class="global-score-empty">${this.configured ? "NO GLOBAL SCORES YET" : "ADD FIREBASE CONFIG<br>TO ACTIVATE WORLD RANKING"}</div>`;
      return;
    }

    list.innerHTML = scores
      .slice(0, 5)
      .map((entry, index) => `
        <div class="global-score-row">
          <span class="global-score-rank">${String(index + 1).padStart(2, "0")}</span>
          <span class="global-score-name">${entry.username}</span>
          <span class="global-score-value">${scoreToText(entry.score)}</span>
        </div>
      `)
      .join("");
  }

  describeFirebaseError(error) {
    const code = String(error?.code || "");
    if (code.includes("failed-precondition")) return "INDEX REQUIRED";
    if (code.includes("permission-denied")) return "RULES DENIED";
    if (code.includes("unavailable")) return "OFFLINE CACHE";
    if (code.includes("operation-not-allowed")) return "ENABLE ANON AUTH";
    return "NETWORK ERROR";
  }

  async handleGameOver(detail = {}) {
    const game = normalizeGame(detail.game);
    const score = normalizeScore(detail.score);
    if (score <= 0 || this.promptOpen) return;

    let scores = this.topScores[game] || [];
    if (this.configured && this.ready && scores.length === 0) {
      try {
        scores = await this.fetchGlobalTopScores(game);
      } catch (error) {
        console.warn("Using cached scores after fetch failure:", error);
      }
    }

    const cutoff = scores.length < 5 ? 0 : scores[scores.length - 1].score;
    const qualifiesGlobal = scores.length < 5 || score > cutoff;
    const qualifiesLocal = Boolean(detail.isLocalRecord);
    if (!qualifiesGlobal && !qualifiesLocal) return;

    if (!this.configured) {
      this.notify("GLOBAL RANKING · FIREBASE CONFIG REQUIRED");
      return;
    }

    try {
      await this.ensureReady();
      this.openInitialsModal({ game, score, qualifiesGlobal, qualifiesLocal, cutoff });
    } catch (error) {
      this.notify("GLOBAL RANKING OFFLINE");
      console.error(error);
    }
  }

  openInitialsModal(entry) {
    const meta = GAME_META[entry.game];
    this.pendingEntry = entry;
    this.promptOpen = true;
    this.entryPanel.style.setProperty("--entry-accent", meta.accent);
    this.entryPanel.style.setProperty("--entry-rgb", meta.rgb);
    this.entryTitle.textContent = entry.qualifiesGlobal ? "WORLD TOP 5 SIGNAL" : "LOCAL RECORD SIGNAL";
    this.entryCopy.textContent = entry.qualifiesGlobal
      ? `Tu resultado en ${meta.title} supera el corte mundial actual. Ingresa hasta tres iniciales para transmitirlo.`
      : `Lograste un nuevo récord local en ${meta.title}. Puedes sincronizarlo con la red global.`;
    this.entryScore.textContent = scoreToText(entry.score);
    this.entryInput.value = window.localStorage.getItem(PLAYER_INITIALS_KEY) || "";
    this.entryError.textContent = "";
    this.entrySubmit.disabled = false;
    this.entrySubmit.textContent = "UPLOAD SCORE";
    this.entryShell.classList.add("is-open");
    this.entryShell.setAttribute("aria-hidden", "false");
    window.dispatchEvent(new CustomEvent("arcade:score-entry-state", { detail: { open: true } }));
    window.requestAnimationFrame(() => this.entryInput.focus({ preventScroll: true }));
  }

  closeInitialsModal() {
    if (!this.promptOpen || !this.entryShell) return;
    this.promptOpen = false;
    this.pendingEntry = null;
    this.entryShell.classList.remove("is-open");
    this.entryShell.setAttribute("aria-hidden", "true");
    this.entryError.textContent = "";
    window.dispatchEvent(new CustomEvent("arcade:score-entry-state", { detail: { open: false } }));
  }

  async submitInitials(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.pendingEntry || this.entrySubmit.disabled) return;

    let username;
    try {
      username = normalizeUsername(this.entryInput.value);
    } catch (error) {
      this.entryError.textContent = error.message;
      this.entryInput.focus();
      return;
    }

    this.entrySubmit.disabled = true;
    this.entrySubmit.textContent = "TRANSMITTING";
    this.entryError.textContent = "";
    try {
      const result = await this.saveGlobalHighScore(this.pendingEntry.game, username, this.pendingEntry.score);
      window.localStorage.setItem(PLAYER_INITIALS_KEY, username);
      if (result.saved) {
        this.notify("GLOBAL HIGH SCORE TRANSMITTED");
        await this.fetchGlobalTopScores(this.pendingEntry.game).catch(() => this.topScores[this.pendingEntry.game]);
      } else {
        this.notify("EXISTING GLOBAL RECORD IS HIGHER");
      }
      this.closeInitialsModal();
    } catch (error) {
      this.entryError.textContent = error.message || "No se pudo subir el puntaje.";
      this.entrySubmit.disabled = false;
      this.entrySubmit.textContent = "RETRY UPLOAD";
    }
  }
}

globalLeaderboard = new GlobalLeaderboardService(firebaseConfig);
const globalLeaderboardReady = globalLeaderboard.initialize().catch((error) => {
  console.warn("Global leaderboard remains in offline/configuration mode:", error);
  return globalLeaderboard;
});

await globalLeaderboardReady;
while (pendingSecureGameOvers.length > 0) {
  const secureResult = pendingSecureGameOvers.shift();
  globalLeaderboard.handleGameOver(secureResult).catch((error) => console.error(error));
}
return globalLeaderboard;

}

initializeGlobalLeaderboardLayer().catch((error) => {
  console.error("Global leaderboard layer failed to load:", error);
  showToast("GLOBAL SCOREBOARD OFFLINE");
});
})();
