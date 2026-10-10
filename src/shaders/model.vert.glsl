#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
uniform mat4 uModelMatrix; // fit-to-view: uniform scale + translation only
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
out vec3 vNormal;
out vec3 vWorldPos;
out vec2 vUV;
void main() {
  vec4 world = uModelMatrix * vec4(aPosition, 1.0);
  // Uniform scale keeps normals perpendicular, so mat3(model) is a valid normal matrix
  vNormal = mat3(uModelMatrix) * aNormal;
  vWorldPos = world.xyz;
  vUV = aUV;
  gl_Position = uProjectionMatrix * uViewMatrix * world;
}
