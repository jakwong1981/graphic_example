// Drag to orbit, wheel to zoom

import { Mat4, lookAt } from '../math/matrix';

export interface OrbitCamera {
  view(): Mat4;
  position(): [number, number, number];
  setDistance(distance: number): void;
}

export function createOrbitCamera(canvas: HTMLCanvasElement, distance = 3): OrbitCamera {
  let yaw = 0.6;
  let pitch = 0.6;
  let dist = distance;
  let dragging = false;
  let minDist = 1.5;
  let maxDist = 10;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw -= e.movementX * 0.01;
    pitch = Math.max(-1.4, Math.min(1.4, pitch + e.movementY * 0.01));
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      dist = Math.max(minDist, Math.min(maxDist, dist * Math.exp(e.deltaY * 0.001)));
    },
    { passive: false }
  );

  const position = (): [number, number, number] => [
    dist * Math.cos(pitch) * Math.sin(yaw),
    dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw),
  ];

  return {
    view: () => lookAt(position(), [0, 0, 0], [0, 1, 0]),
    position,
    setDistance: (d) => {
      dist = d;
      // widen the wheel zoom range for large models (the bus and tram need ~20 m)
      maxDist = Math.max(10, d * 2.5);
      minDist = Math.min(1.5, d * 0.3);
    },
  };
}
