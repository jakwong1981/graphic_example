// Procedural car engine for the flying car, made with Web Audio (no sound files).
//
// A V8 fires 4 times per crankshaft turn, so the note is rpm / 60 * 4 Hz: about 60 Hz at idle, 470 Hz near
// the red line. Three oscillators at that pitch and half of it are driven through a soft clipper (the grit of
// the exhaust pulses) and a low-pass filter that opens with the throttle. Filtered noise adds the intake and
// exhaust roar under load. A simple six-speed gearbox turns road speed into rpm and shifts up near the red
// line, with a short dip in power at each shift.

const IDLE = 900; // rpm
const REDLINE = 7000;
const SHIFT_UP = 6600;
const SHIFT_DOWN = 2600;
// top speed of each gear at the red line (m/s); the car tops out at about 46 m/s
const GEAR_TOP = [9, 16, 23, 31, 39, 48];

export class EngineSound {
  private ctx: AudioContext;
  private out: GainNode;
  private oscs: OscillatorNode[] = [];
  private filter: BiquadFilterNode;
  private roar: GainNode;
  private roarFilter: BiquadFilterNode;
  private tone: GainNode;
  private gear = 0;
  private rpm = IDLE;
  private shift = 0; // seconds left of a gear change (power cut)
  private load = 0;

  constructor(ctx: AudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // tone: fundamental, a sub-octave (the burble of a cross-plane V8) and a slightly detuned octave
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.5);
    this.tone = ctx.createGain();
    this.tone.gain.value = 0.35;
    shaper.connect(this.filter).connect(this.tone).connect(this.out);
    for (const [type, gain] of [['sawtooth', 0.5], ['square', 0.35], ['sawtooth', 0.18]] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(shaper);
      o.start();
      this.oscs.push(o);
    }
    this.oscs[2].detune.value = 7;

    // roar: looped noise through a band-pass that follows the rpm
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0, b = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; } // brownish
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.Q.value = 0.8;
    this.roar = ctx.createGain();
    this.roar.gain.value = 0;
    src.connect(this.roarFilter).connect(this.roar).connect(this.out);
    src.start();
  }

  /**
   * `speed` in m/s, `throttle` -1..1, `volume` 0..1 (distance from the listener, muted when off screen etc.).
   * Call once a frame.
   */
  update(dt: number, speed: number, throttle: number, volume: number) {
    const t = this.ctx.currentTime;
    const push = Math.abs(throttle);
    // gearbox
    const inGear = () => IDLE + (REDLINE - IDLE) * Math.min(1, speed / GEAR_TOP[this.gear]);
    let target = inGear();
    if (target > SHIFT_UP && this.gear < GEAR_TOP.length - 1 && push > 0) { this.gear++; this.shift = 0.18; target = inGear(); }
    else if (target < SHIFT_DOWN && this.gear > 0) { this.gear--; target = inGear(); }
    // pulling away the clutch slips and the revs rise ahead of the road speed
    target = Math.max(target, IDLE + 2600 * push * (this.gear === 0 ? 1 : 0.3));
    if (this.shift > 0) { this.shift -= dt; target *= 0.94; }
    // revs follow quickly when rising, a little slower when falling
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt * (target > this.rpm ? 9 : 5)));
    this.load += ((this.shift > 0 ? 0.1 : push) - this.load) * (1 - Math.exp(-dt * 8));

    const f = (this.rpm / 60) * 4; // firing frequency of a V8
    const k = 0.04; // smoothing time constant (s) for the audio parameters
    this.oscs[0].frequency.setTargetAtTime(f, t, k);
    this.oscs[1].frequency.setTargetAtTime(f / 2, t, k);
    this.oscs[2].frequency.setTargetAtTime(f * 2, t, k);
    this.filter.frequency.setTargetAtTime(f * (2.2 + 4 * this.load), t, k);
    this.roarFilter.frequency.setTargetAtTime(f * 1.5, t, k);
    this.roar.gain.setTargetAtTime(0.05 + 0.3 * this.load, t, k);
    this.tone.gain.setTargetAtTime(0.25 + 0.2 * this.load, t, k);
    const rev = (this.rpm - IDLE) / (REDLINE - IDLE);
    this.out.gain.setTargetAtTime(volume * (0.35 + 0.35 * this.load + 0.3 * rev), t, 0.08);
  }

  /** Current revs and gear (1-based), for a gauge */
  get state() { return { rpm: this.rpm, gear: this.gear + 1 }; }
}

/** tanh-like curve: soft clipping adds odd harmonics, like a loud exhaust */
function softClip(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return c;
}
