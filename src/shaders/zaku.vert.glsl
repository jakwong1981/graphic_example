#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uLightVP; // key light view-projection for the shadow map
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec4 vShadow;
void main() {
  vec4 w = uModel * vec4(aPosition, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal; // uniform scale only
  vUV = aUV;
  vShadow = uLightVP * w;
  gl_Position = uProj * uView * w;
}
