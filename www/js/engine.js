// RetroAmp · Motor de audio (Web Audio API, procesamiento en coma flotante 32 bits)
export const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_LABELS = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];

export const PRESETS = {
  'Normal':            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Clásica':           [0, 0, 0, 0, 0, 0, -4, -4, -4, -6],
  'Club':              [0, 0, 4, 3, 3, 3, 2, 0, 0, 0],
  'Dance':             [6, 4, 1, 0, 0, -3, -4, -4, 0, 0],
  'Full Bass':         [7, 7, 5, 2, 0, -2, -4, -5, -6, -6],
  'Bass y Treble':     [5, 4, 0, -3, -2, 1, 5, 7, 7, 7],
  'Full Treble':       [-6, -6, -6, -2, 1, 6, 9, 9, 9, 10],
  'Audífonos':         [3, 6, 3, -2, -1, 1, 3, 6, 7, 8],
  'Sala grande':       [6, 6, 3, 3, 0, -2, -2, -2, 0, 0],
  'En vivo':           [-3, 0, 2, 3, 3, 3, 2, 1, 1, 1],
  'Fiesta':            [4, 4, 0, 0, 0, 0, 0, 0, 4, 4],
  'Pop':               [-1, 3, 4, 5, 3, 0, -1, -1, -1, -1],
  'Reggae':            [0, 0, 0, -4, 0, 4, 4, 0, 0, 0],
  'Rock':              [5, 3, -3, -5, -2, 2, 5, 7, 7, 7],
  'Cumbia / Salsa':    [3, 4, 2, 0, 1, 3, 4, 3, 2, 2],
  'Suave':             [3, 1, 0, -1, 0, 2, 5, 6, 7, 8],
  'Techno':            [5, 4, 0, -4, -3, 0, 5, 6, 6, 5],
  'Voz / Podcast':     [-3, -2, 0, 3, 5, 5, 3, 1, 0, -2],
};

export const DEFAULT_DSP = {
  eqOn: true, autoHeadroom: true, preamp: 0, eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preset: 'Normal',
  bass: 0, treble: 0, loudness: false, width: 1, reverbMix: 0, reverbSize: 2.2,
  limiter: true, balance: 0, volume: 0.8, pure: false,
};

const dbToGain = db => Math.pow(10, db / 20);

export class AudioEngine {
  constructor(el) {
    this.el = el;
    this.ctx = null;
    this.s = structuredClone(DEFAULT_DSP);
    this._irSize = null;
  }

  get ready() { return !!this.ctx; }

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    const c = this.ctx = new AC({ latencyHint: 'playback' });
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}

    this.src = c.createMediaElementSource(this.el);

    // Pre-amplificador: fuerza 2 canales (mono -> estéreo) para que el procesado M/S sea correcto
    this.preamp = c.createGain();
    this.preamp.channelCount = 2;
    this.preamp.channelCountMode = 'explicit';
    this.preamp.channelInterpretation = 'speakers';

    this.eq = EQ_FREQS.map((f, i) => {
      const b = c.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.05;
      b.gain.value = 0;
      return b;
    });
    for (let i = 0; i < this.eq.length - 1; i++) this.eq[i].connect(this.eq[i + 1]);

    this.bassF = c.createBiquadFilter(); this.bassF.type = 'lowshelf'; this.bassF.frequency.value = 110;
    this.trebF = c.createBiquadFilter(); this.trebF.type = 'highshelf'; this.trebF.frequency.value = 7500;
    this.loudLo = c.createBiquadFilter(); this.loudLo.type = 'lowshelf'; this.loudLo.frequency.value = 80;
    this.loudHi = c.createBiquadFilter(); this.loudHi.type = 'highshelf'; this.loudHi.frequency.value = 11000;
    this.bassF.connect(this.trebF); this.trebF.connect(this.loudLo); this.loudLo.connect(this.loudHi);

    // Matriz estéreo (ancho): L' = aL + bR ; R' = bL + aR
    this.split = c.createChannelSplitter(2);
    this.merge = c.createChannelMerger(2);
    this.gLL = c.createGain(); this.gRL = c.createGain(); this.gLR = c.createGain(); this.gRR = c.createGain();
    this.split.connect(this.gLL, 0); this.split.connect(this.gLR, 0);
    this.split.connect(this.gRL, 1); this.split.connect(this.gRR, 1);
    this.gLL.connect(this.merge, 0, 0); this.gRL.connect(this.merge, 0, 0);
    this.gLR.connect(this.merge, 0, 1); this.gRR.connect(this.merge, 0, 1);
    this.loudHi.connect(this.split);

    // Reverb (convolución con respuesta generada)
    this.revIn = c.createGain();
    this.dry = c.createGain();
    this.wet = c.createGain();
    this.conv = c.createConvolver();
    this.revOut = c.createGain();
    this.merge.connect(this.revIn);
    this.revIn.connect(this.dry); this.revIn.connect(this.conv); this.conv.connect(this.wet);
    this.dry.connect(this.revOut); this.wet.connect(this.revOut);

    this.pan = c.createStereoPanner ? c.createStereoPanner() : c.createGain();

    // Medidor de saturación previo al limitador
    this.clipMeter = c.createAnalyser(); this.clipMeter.fftSize = 1024;

    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1.2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;

    this.master = c.createGain();
    this.master.connect(c.destination);

    this._clipBuf = new Float32Array(this.clipMeter.fftSize);
    this.route();
    this.applyAll();
    return c;
  }

  async resume() { if (this.ctx && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch {} } }

  _disconnectAll() {
    const nodes = [this.src, this.preamp, this.eq[this.eq.length - 1], this.loudHi, this.revOut, this.pan, this.limiter, this.analyser, this.clipMeter];
    nodes.forEach(n => { try { n.disconnect(); } catch {} });
  }

  // Reconstruye la cadena según los interruptores
  route() {
    if (!this.ctx) return;
    this._disconnectAll();
    const s = this.s;
    if (s.pure) {
      // Modo puro: sin procesamiento salvo volumen y balance
      this.src.connect(this.pan);
      this.pan.connect(this.analyser);
      this.analyser.connect(this.master);
      return;
    }
    this.src.connect(this.preamp);
    if (s.eqOn) { this.preamp.connect(this.eq[0]); this.eq[this.eq.length - 1].connect(this.bassF); }
    else this.preamp.connect(this.bassF);
    this.loudHi.connect(this.split);
    this.revOut.connect(this.pan);
    this.pan.connect(this.clipMeter);
    if (s.limiter) { this.pan.connect(this.limiter); this.limiter.connect(this.analyser); }
    else this.pan.connect(this.analyser);
    this.analyser.connect(this.master);
  }

  _set(param, v, t = 0.03) {
    if (!this.ctx) return;
    param.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  headroomDb() {
    const s = this.s;
    if (!s.autoHeadroom || s.pure) return 0;
    const eqMax = s.eqOn ? Math.max(0, ...s.eq) : 0;
    const boost = Math.max(eqMax, 0) + Math.max(0, s.bass) * 0.8 + Math.max(0, s.treble) * 0.5 + (s.loudness ? 3 : 0);
    return -Math.min(12, boost * 0.6);
  }

  applyAll() {
    if (!this.ctx) return;
    const s = this.s;
    this.eq.forEach((b, i) => this._set(b.gain, s.eq[i]));
    this.applyGains();
    this.applyWidth();
    this.applyReverb();
    this.applyBalance();
    this.route();
  }

  applyGains() {
    if (!this.ctx) return;
    const s = this.s;
    this._set(this.preamp.gain, dbToGain(s.preamp + this.headroomDb()));
    this._set(this.bassF.gain, s.bass);
    this._set(this.trebF.gain, s.treble);
    // Loudness: compensa la curva de Fletcher-Munson, más intenso a volumen bajo
    const k = s.loudness ? Math.max(0.25, 1 - s.volume * 0.75) : 0;
    this._set(this.loudLo.gain, 9 * k);
    this._set(this.loudHi.gain, 4 * k);
    // Volumen con curva perceptual
    this._set(this.master.gain, Math.pow(s.volume, 2));
  }

  applyWidth() {
    if (!this.ctx) return;
    const w = this.s.width;
    const a = (1 + w) / 2, b = (1 - w) / 2;
    const norm = 1 / Math.max(1, Math.abs(a) + Math.abs(b));
    this._set(this.gLL.gain, a * norm); this._set(this.gRR.gain, a * norm);
    this._set(this.gRL.gain, b * norm); this._set(this.gLR.gain, b * norm);
  }

  applyReverb() {
    if (!this.ctx) return;
    const s = this.s;
    if (this._irSize !== s.reverbSize) {
      this.conv.buffer = this._makeIR(s.reverbSize);
      this._irSize = s.reverbSize;
    }
    const m = s.reverbMix;
    this._set(this.dry.gain, 1 - m * 0.4);
    this._set(this.wet.gain, m * 0.85);
  }

  applyBalance() {
    if (!this.ctx || !this.pan.pan) return;
    this._set(this.pan.pan, this.s.balance);
  }

  _makeIR(seconds) {
    const c = this.ctx;
    const rate = c.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = c.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (ch ? 0.97 : 1);
      }
    }
    return buf;
  }

  update(patch) {
    Object.assign(this.s, patch);
    if (!this.ctx) return;
    const keys = Object.keys(patch);
    if (keys.some(k => k === 'eq')) this.eq.forEach((b, i) => this._set(b.gain, this.s.eq[i]));
    if (keys.some(k => ['eq', 'preamp', 'bass', 'treble', 'loudness', 'volume', 'autoHeadroom', 'eqOn', 'pure'].includes(k))) this.applyGains();
    if (keys.includes('width')) this.applyWidth();
    if (keys.includes('reverbMix') || keys.includes('reverbSize')) this.applyReverb();
    if (keys.includes('balance')) this.applyBalance();
    if (keys.some(k => ['eqOn', 'limiter', 'pure'].includes(k))) this.route();
  }

  setBand(i, db) { this.s.eq[i] = db; this.s.preset = ''; if (this.ctx) { this._set(this.eq[i].gain, db); this.applyGains(); } }

  // Indicadores: saturación antes del limitador y reducción de ganancia
  meters() {
    if (!this.ctx) return { clip: false, gr: 0 };
    this.clipMeter.getFloatTimeDomainData(this._clipBuf);
    let peak = 0;
    for (let i = 0; i < this._clipBuf.length; i++) { const v = Math.abs(this._clipBuf[i]); if (v > peak) peak = v; }
    const gr = this.s.limiter && !this.s.pure ? this.limiter.reduction : 0;
    return { clip: peak >= 0.995, peak, gr: typeof gr === 'number' ? gr : 0 };
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }
}

// Curva de respuesta combinada para dibujar
export function responseCurve(engine, freqs) {
  if (!engine.ctx) return null;
  const n = freqs.length;
  const mag = new Float32Array(n), ph = new Float32Array(n), total = new Float32Array(n).fill(1);
  const filters = [...(engine.s.eqOn ? engine.eq : []), engine.bassF, engine.trebF, engine.loudLo, engine.loudHi];
  for (const f of filters) {
    f.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < n; i++) total[i] *= mag[i];
  }
  return total;
}
