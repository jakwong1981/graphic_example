#version 300 es
in vec3 aPos;
in vec4 aData; // size (m), life 0..1, alpha, shade
uniform mat4 uView;
uniform mat4 uProj;
uniform float uScale; // viewport height / (2 tan(fov/2)): metres -> pixels at distance 1
uniform vec3 uCamPos;
out float vLife;
out float vAlpha;
out float vShade;
out float vDist;
void main() {
  vec4 vp = uView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(aData.x * uScale / max(-vp.z, 0.5), 1.0, 400.0);
  vLife = aData.y;
  vAlpha = aData.z;
  vShade = aData.w;
  vDist = length(aPos - uCamPos);
}
