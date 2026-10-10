#version 300 es
in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCamPos;
out float vDist;
void main() {
  vDist = length(aPos - uCamPos);
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}
