#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uSkyTop;
uniform vec3 uFogColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVis;
uniform float uCloudCover;
uniform float uTime;
uniform float uFlash;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(uCamFwd + vNdc.x * uAspect * uTanHalf * uCamRight + vNdc.y * uTanHalf * uCamUp);
  vec3 color = mix(uFogColor, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.5));

  // Sun disk + halo
  float s = max(dot(d, uSunDir), 0.0);
  color += uSunColor * (pow(s, 1500.0) * 20.0 + pow(s, 8.0) * 0.25) * uSunVis;

  // Cloud layer: a plane at 1800 m textured with fbm; coverage comes from the weather
  float cloudY = 1800.0;
  if (abs(d.y) > 0.01) {
    float t = (cloudY - uCamPos.y) / d.y;
    if (t > 0.0) {
      vec2 p = (uCamPos.xz + d.xz * t) / 1400.0 + vec2(uTime * 0.004, uTime * 0.002);
      float n = fbm(p);
      float c = smoothstep(1.0 - uCloudCover - 0.1, 1.0 - uCloudCover + 0.35, n);
      float shade = fbm(p * 2.0 + 3.0);
      vec3 lit = uSunColor * 0.6 + uFogColor * 0.6;
      vec3 cloud = mix(uFogColor * 0.7, lit, shade * uSunVis + (1.0 - uSunVis) * 0.45);
      color = mix(color, cloud, c * exp(-t * 0.00008));
    }
  }
  color += uFlash * 0.6;
  fragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
