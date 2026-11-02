// Traffic light timing for the signal crossings, in the Hong Kong order:
//   red -> red + amber (get ready) -> green -> amber -> red
// Each main colour lasts about a minute. The green man shows while the traffic has red, then flashes for the
// last few seconds as a warning; both directions of traffic share one phase (it is a pedestrian crossing).

export type VehicleAspect = 'red' | 'redAmber' | 'green' | 'amber';

const GREEN = 57; // s
const AMBER = 3;
const RED = 58;
const RED_AMBER = 2;
export const SIGNAL_CYCLE = GREEN + AMBER + RED + RED_AMBER; // 120 s: the lights change about every minute
const ALL_RED = 1; // s after the traffic gets red before the green man comes on
const FLASH = 6; // s of flashing green man before the red man

export interface SignalState {
  vehicle: VehicleAspect;
  /** lamps lit on the traffic head */
  red: boolean; amber: boolean; green: boolean;
  /** lamps lit on the pedestrian head */
  pedRed: boolean; pedGreen: boolean;
  /** people may step off the kerb (steady green man; not while it flashes) */
  walk: boolean;
  /** seconds until the vehicle aspect changes */
  left: number;
}

/** Signal state `t` seconds into the cycle (any t; it repeats) */
export function signalAt(t: number): SignalState {
  const s = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  let vehicle: VehicleAspect, left: number;
  if (s < GREEN) { vehicle = 'green'; left = GREEN - s; }
  else if (s < GREEN + AMBER) { vehicle = 'amber'; left = GREEN + AMBER - s; }
  else if (s < GREEN + AMBER + RED) { vehicle = 'red'; left = GREEN + AMBER + RED - s; }
  else { vehicle = 'redAmber'; left = SIGNAL_CYCLE - s; }
  // green man inside the red phase, after a moment of all-red; flashes, then the red man before red + amber
  const r = s - (GREEN + AMBER); // seconds into red
  const manOn = vehicle === 'red' && r >= ALL_RED && r < RED - 2;
  const flashing = manOn && r >= RED - 2 - FLASH;
  const blink = Math.floor(s * 2) % 2 === 0; // twice a second
  return {
    vehicle, left,
    red: vehicle === 'red' || vehicle === 'redAmber',
    amber: vehicle === 'amber' || vehicle === 'redAmber',
    green: vehicle === 'green',
    pedGreen: manOn && (!flashing || blink),
    pedRed: !manOn,
    walk: manOn && !flashing,
  };
}

/**
 * Must a vehicle stop at the line? `gap` is the distance from its front to the stop line (m), `v` its speed and
 * `decel` a comfortable braking rate. Red and red + amber: always. Amber: only if it can still stop comfortably,
 * otherwise it carries on through (as drivers do).
 */
export function mustStop(s: SignalState, gap: number, v: number, decel: number): boolean {
  if (s.vehicle === 'green') return false;
  if (s.vehicle === 'amber') return gap > (v * v) / (2 * decel) - 0.5;
  return true;
}
