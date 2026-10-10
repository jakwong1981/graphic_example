#version 300 es
precision highp float;
in float vLife;
in float vAlpha;
in float vShade;
in float vDist;
uniform int uMode; // 0 = flame (additive), 1 = smoke (alpha)
uniform vec3 uLight; // linear light colour for smoke
uniform vec3 uFogColor;
uniform float uFogDensity;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float fog = 1.0 - exp(-uFogDensity * vDist);
  if (uMode == 0) {
    // Jet flame: white-blue core -> orange -> dark red as the particle ages
    vec3 hot = vec3(0.75, 0.85, 1.0) * 2.5;
    vec3 mid = vec3(1.0, 0.55, 0.15) * 1.6;
    vec3 cool = vec3(0.7, 0.15, 0.03);
    vec3 col = vLife < 0.35 ? mix(hot, mid, vLife / 0.35) : mix(mid, cool, (vLife - 0.35) / 0.65);
    float a = (1.0 - r) * (1.0 - r) * vAlpha * (1.0 - vLife);
    fragColor = vec4(col * a * (1.0 - fog), 1.0);
  } else {
    float a = (1.0 - r) * vAlpha * (1.0 - vLife) * (1.0 - fog * 0.7);
    vec3 col = mix(uLight * vShade, uFogColor, fog);
    fragColor = vec4(pow(col, vec3(1.0 / 2.2)), a);
  }
}
