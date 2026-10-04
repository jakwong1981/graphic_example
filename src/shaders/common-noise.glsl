const float TAU = 6.28318530718;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 3D value noise sampled at the surface point, so the u seam never shows
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 s = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), s.x),
        mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), s.x), s.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), s.x),
        mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), s.x), s.y),
    s.z);
}

float fbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * vnoise3(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return sum / 0.9375;
}

// Sum of integer-frequency sines: periodic in u by construction
float icingEdge(float u) {
  float g = 0.5 + 0.25 * sin(TAU * 3.0 * u) + 0.15 * sin(TAU * 7.0 * u + 1.3) + 0.1 * sin(TAU * 13.0 * u + 4.0);
  return 0.35 - 0.7 * g;
}

float icingMask(vec2 uv) {
  float e = icingEdge(uv.x);
  return smoothstep(e - 0.03, e + 0.03, sin(TAU * uv.y));
}
