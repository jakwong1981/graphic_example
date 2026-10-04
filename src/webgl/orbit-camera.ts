// Drag to orbit, wheel to zoom

import { Mat4, lookAt } from '../math/matrix';

export interface OrbitCamera {
  view(): Mat4;
  position(): [number, number, number];
}

export function createOrbitCamera(canvas: HTMLCanvasElement, distance = 3): OrbitCamera {
  let yaw = 0.6;
  let pitch = 0.6;
  let dist = distance;
  let dragging = false;

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
      dist = Math.max(1.5, Math.min(8, dist * Math.exp(e.deltaY * 0.001)));
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
  };
}
