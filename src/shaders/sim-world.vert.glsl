#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
in vec3 aColor; // per-building tint; meshes without it get the constant (1,1,1)
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
void main() {
  vec4 w = uModel * vec4(aPosition, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal; // models use uniform scale only
  vUV = aUV;
  vColor = aColor;
  gl_Position = uProj * uView * w;
}
