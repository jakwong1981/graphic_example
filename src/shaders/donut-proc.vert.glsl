in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;

uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform float uThickness;

out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vObjPos;
out vec2 vUV;

// Icing is pushed out along the normal; the normal itself is left unchanged
void main() {
  float bump = 0.6 + 0.4 * fbm3(aPosition * 6.0);
  vec3 displaced = aPosition + aNormal * uThickness * icingMask(aUV) * bump;

  vNormal = aNormal;
  vWorldPos = displaced;
  vObjPos = aPosition;
  vUV = aUV;
  gl_Position = uProjectionMatrix * uViewMatrix * vec4(displaced, 1.0);
}
