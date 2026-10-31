#version 300 es
// A static scanned mesh made to walk: each leg swings about its hip and bends at the knee (rotation about
// the model's x axis). aRig.x = leg weight, negative for the right leg (model -x), positive for the left;
// aRig.y = how much of the vertex lies below the knee. Everything else stays rigid.
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
in vec3 aColor;
in vec2 aRig;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uHipR;
uniform vec3 uHipL;
uniform vec3 uKneeR;
uniform vec3 uKneeL;
uniform float uHipAngleR; // radians about +x; negative swings the foot forward (+z)
uniform float uHipAngleL;
uniform float uKneeAngleR; // positive bends the shin back
uniform float uKneeAngleL;
// Shadow pass: flatten the posed mesh onto the ground along uShadowDir (the direction the light travels)
uniform int uShadow;
uniform vec3 uShadowDir;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

void main() {
  vec3 p = aPosition;
  vec3 n = aNormal;
  float w = abs(aRig.x);
  if (w > 0.0) {
    bool right = aRig.x < 0.0;
    vec3 hip = right ? uHipR : uHipL;
    vec3 knee = right ? uKneeR : uKneeL;
    mat3 K = rotX((right ? uKneeAngleR : uKneeAngleL) * aRig.y);
    mat3 H = rotX((right ? uHipAngleR : uHipAngleL) * w);
    // knee first (in the rest pose), then the whole leg about the hip
    p = K * (p - knee) + knee;
    p = H * (p - hip) + hip;
    n = H * (K * n);
  }
  vec4 world = uModel * vec4(p, 1.0);
  if (uShadow == 1) {
    // road at y = 0, pavements (|z| > 7) at 0.15; lift the shadow a little above either
    float ground = abs(world.z) > 7.0 ? 0.17 : 0.025;
    world.xyz -= uShadowDir * ((world.y - ground) / uShadowDir.y);
  }
  vWorld = world.xyz;
  vNormal = mat3(uModel) * n;
  vUV = aUV;
  vColor = aColor;
  gl_Position = uProj * uView * world;
}
