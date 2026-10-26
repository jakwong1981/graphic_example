#version 300 es
// Instanced pedestrians: one low-poly person (faces +x, 1.75 m tall), animated per instance.
// aPart.x = colour slot (0 skin, 1 shirt, 2 trousers, 3 hair, 4 shoes, 5 umbrella, 6 bag, 7 umbrella pole)
// aPart.y = body part (0 rigid, 1 left leg, 2 right leg, 3 left arm, 4 right arm)
in vec3 aPosition;
in vec3 aNormal;
in vec2 aPart;
in vec4 iPose; // x, y, z, heading (rotation about y; 0 faces +x)
in vec4 iAnim; // walk phase, swing amplitude, scale, flags (1 umbrella open, 2 carrying a bag)
in vec3 iShirt;
in vec3 iPants;
in vec4 iSkin; // skin colour, hair lightness
in vec3 iUmb;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;

vec2 rot(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  int slot = int(aPart.x + 0.5);
  int part = int(aPart.y + 0.5);
  int flags = int(iAnim.w + 0.5);
  bool umbrella = (flags & 1) != 0;
  bool hidden = ((slot == 5 || slot == 7) && !umbrella) || (slot == 6 && (flags & 2) == 0);

  vec3 p = aPosition;
  vec3 n = aNormal;
  // Limbs swing about the hip / shoulder (rotation about z: positive moves the foot or hand forward)
  float sw = sin(iAnim.x) * iAnim.y;
  float a = 0.0;
  vec2 pivot = vec2(0.0);
  if (part == 1) { a = sw; pivot = vec2(0.0, 0.9); }
  if (part == 2) { a = -sw; pivot = vec2(0.0, 0.9); }
  if (part == 3) { a = -sw * 0.8; pivot = vec2(0.0, 1.42); }
  if (part == 4) { a = umbrella ? 0.35 : sw * 0.8; pivot = vec2(0.0, 1.42); }
  if (part != 0) {
    p.xy = pivot + rot(p.xy - pivot, a);
    n.xy = rot(n.xy, a);
  }
  p.y += abs(cos(iAnim.x)) * iAnim.y * 0.05; // bob while walking
  if (hidden) p = vec3(0.0);

  p *= iAnim.z;
  float c = cos(iPose.w), s = sin(iPose.w);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vec3 w = iPose.xyz + p;

  vec3 hair = mix(vec3(0.06, 0.05, 0.045), vec3(0.42, 0.3, 0.18), iSkin.w);
  vec3 col = slot == 0 ? iSkin.rgb : slot == 1 ? iShirt : slot == 2 ? iPants : slot == 3 ? hair
    : slot == 4 ? vec3(0.12, 0.11, 0.1) : slot == 5 ? iUmb : slot == 6 ? iUmb * 0.7 + 0.1 : vec3(0.2);
  vWorld = w;
  vNormal = n;
  vUV = vec2(0.5);
  vColor = col;
  gl_Position = uProj * uView * vec4(w, 1.0);
}
