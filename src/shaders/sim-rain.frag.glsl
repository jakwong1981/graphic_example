#version 300 es
precision highp float;
in float vDist;
uniform float uIntensity;
uniform float uLight; // 0..1 scene brightness, so rain is not bright white at night
out vec4 fragColor;
void main() {
  float a = 0.35 * uIntensity * (1.0 - smoothstep(30.0, 85.0, vDist));
  fragColor = vec4(vec3(0.75, 0.8, 0.86) * uLight, a);
}
