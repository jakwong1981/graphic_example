#version 300 es
precision highp float;
// Planar shadow of a walking mecha: flat translucent dark, faded with distance like the fog.
// A stencil test makes every pixel darken once, however many triangles overlap there.
in vec3 vWorld;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uShadowAlpha;
out vec4 fragColor;
void main() {
  float fog = 1.0 - exp(-uFogDensity * length(uCamPos - vWorld));
  fragColor = vec4(0.0, 0.0, 0.0, uShadowAlpha * (1.0 - fog));
}
