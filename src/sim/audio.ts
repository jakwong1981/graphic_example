// Procedural sound with Web Audio: no audio files, everything is filtered noise and oscillators.
// Browsers only allow audio after a user gesture, so call start() from a key or click handler.
export class SimAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engine!: { gain: GainNode; filter: BiquadFilterNode };
  private whine!: { gain: GainNode; osc: OscillatorNode };
  private burner!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private beep!: GainNode;
  muted = false;

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // 2 s of white noise, looped by every noise voice
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Jet roar: low-passed noise, cutoff and level follow the throttle
    this.engine = this.noiseVoice('lowpass', 400, 0.7);
    // Turbine whine: a quiet sawtooth through a band-pass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 8;
    bp.frequency.value = 1800;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    osc.connect(bp).connect(wg).connect(this.master);
    osc.start();
    this.whine = { gain: wg, osc };
    // Afterburner: deep rumble
    this.burner = this.noiseVoice('lowpass', 140, 1.2).gain;
    // Wind over the airframe: band-passed noise that grows with airspeed
    this.wind = this.noiseVoice('bandpass', 900, 0.6);
    // Rain on the canopy: high-passed hiss
    this.rain = this.noiseVoice('highpass', 3000, 0.3).gain;
    // Stall warning horn
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 820;
    this.beep = ctx.createGain();
    this.beep.gain.value = 0;
    horn.connect(this.beep).connect(this.master);
    horn.start();
  }

  private noiseVoice(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(0, Math.random() * 2); // random offset so voices do not phase together
    return { gain, filter };
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  // Call every frame with the flight state
  update(s: { throttle: number; airspeed: number; stalled: boolean; rain: number; crashed: boolean; cockpit: boolean }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = 0.08; // smoothing time constant
    const alive = s.crashed ? 0 : 1;
    const thr = s.throttle;
    const ab = Math.max(0, (thr - 0.85) / 0.15);
    // Engine is louder from the chase camera (we are behind the nozzles)
    const near = s.cockpit ? 0.6 : 1;
    this.engine.gain.gain.setTargetAtTime(alive * near * (0.12 + 0.45 * thr), t, k);
    this.engine.filter.frequency.setTargetAtTime(300 + 1500 * thr, t, k);
    this.whine.gain.gain.setTargetAtTime(alive * (0.008 + 0.02 * thr), t, k);
    this.whine.osc.frequency.setTargetAtTime(180 + 520 * thr, t, k);
    this.burner.gain.setTargetAtTime(alive * near * ab * 0.9, t, k);
    const v = Math.min(1, s.airspeed / 250);
    this.wind.gain.gain.setTargetAtTime(alive * v * v * (s.cockpit ? 0.35 : 0.2), t, k);
    this.wind.filter.frequency.setTargetAtTime(500 + 1500 * v, t, k);
    this.rain.gain.setTargetAtTime(s.rain * (s.cockpit ? 0.25 : 0.12), t, 0.3);
    // Stall horn pulses ~4 times a second
    const on = s.stalled && !s.crashed && Math.floor(t * 8) % 2 === 0;
    this.beep.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.01);
  }

  // One-shot noise burst through a falling low-pass: explosions and thunder
  private burst(delay: number, duration: number, level: number, from: number, to: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.1);
  }

  explosion() {
    this.burst(0, 2.5, 1.5, 3000, 60);
    this.burst(0.15, 3.5, 0.8, 600, 40);
  }

  // Thunder arrives after the flash (sound is slower than light)
  thunder() {
    const delay = 0.5 + Math.random() * 2.5;
    this.burst(delay, 0.4, 0.5, 4000, 400); // crack
    this.burst(delay + 0.1, 4 + Math.random() * 2, 0.7, 500, 40); // rumble
  }
}
