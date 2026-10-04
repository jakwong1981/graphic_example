#version 300 es

in vec3 aPosition;
in vec3 aNormal;
in vec3 aTangent;
in vec2 aUV;

uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;

out vec3 vNormal;
out vec3 vTangent;
out vec3 vWorldPos;
out vec2 vUV;

// The donut sits at the origin, so model space is world space
void main() {
  vNormal = aNormal;
  vTangent = aTangent;
  vWorldPos = aPosition;
  vUV = aUV;
  gl_Position = uProjectionMatrix * uViewMatrix * vec4(aPosition, 1.0);
}
