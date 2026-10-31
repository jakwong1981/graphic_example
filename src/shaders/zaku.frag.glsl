#version 300 es
precision highp float;
precision highp sampler2DShadow;
// Showroom shading for glTF metallic-roughness materials: GGX key light with PCF shadows, fill and rim lights,
// hemisphere ambient with a gradient "studio" reflection, emissive, ACES tone mapping.
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec4 vShadow;
uniform sampler2D uTex;
uniform int uHasTex;
uniform sampler2D uMRTex; // metallic-roughness: G = roughness, B = metallic
uniform int uHasMR;
uniform sampler2D uNormalTex; // tangent-space normal map
uniform int uHasNormal;
uniform vec4 uColor; // linear base colour factor
uniform float uMetallic;
uniform float uRoughness;
uniform vec3 uEmissive;
uniform vec3 uCamPos;
uniform vec3 uKeyDir; // towards the light
uniform vec3 uKeyColor;
uniform vec3 uFillDir;
uniform vec3 uFillColor;
uniform vec3 uRimDir;
uniform vec3 uRimColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uBgColor;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;
uniform int uGround; // 1: the studio floor (fades into the background)
out vec4 fragColor;

const float PI = 3.14159265;

float shadow() {
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) s += texture(uShadow, vec3(p.xy + vec2(x, y) * uShadowTexel, p.z - 0.0015));
  return s / 25.0;
}

// GGX specular + Lambert diffuse for one light
vec3 light(vec3 N, vec3 V, vec3 L, vec3 color, vec3 albedo, float metal, float rough) {
  float NL = max(dot(N, L), 0.0);
  if (NL <= 0.0) return vec3(0.0);
  vec3 H = normalize(L + V);
  float a = rough * rough;
  float a2 = a * a;
  float NH = max(dot(N, H), 0.0);
  float d = NH * NH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * d * d);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float NV = max(dot(N, V), 1e-3);
  float G = NL / (NL * (1.0 - k) + k) * NV / (NV * (1.0 - k) + k);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = D * G * F / (4.0 * NL * NV + 1e-4);
  vec3 diff = (1.0 - F) * (1.0 - metal) * albedo / PI;
  return (diff + spec) * color * NL;
}

// Normal mapping without stored tangents: build the tangent frame from screen-space derivatives
vec3 perturb(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 du1 = dFdx(uv), du2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * du1.x + dp1perp * du2.x;
  vec3 B = dp2perp * du1.y + dp1perp * du2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  vec3 m = texture(uNormalTex, uv).xyz * 2.0 - 1.0;
  return normalize(mat3(T * invmax, B * invmax, N) * m);
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N; // double-sided parts
  if (uHasNormal == 1) N = perturb(N, vWorld, vUV);
  vec4 base = uColor;
  if (uHasTex == 1) base *= vec4(pow(texture(uTex, vUV).rgb, vec3(2.2)), 1.0);
  vec3 albedo = base.rgb;
  float metal = uMetallic;
  float rough = uRoughness;
  if (uHasMR == 1) {
    vec3 mr = texture(uMRTex, vUV).rgb;
    rough *= mr.g;
    metal *= mr.b;
  }
  rough = clamp(rough, 0.05, 1.0);

  float sh = shadow();
  vec3 c = light(N, V, uKeyDir, uKeyColor * PI, albedo, metal, rough) * sh;
  c += light(N, V, uFillDir, uFillColor * PI, albedo, metal, rough);
  c += light(N, V, uRimDir, uRimColor * PI, albedo, metal, rough);
  // Ambient: hemisphere diffuse plus a soft studio reflection (bright top, dark floor)
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float NV = max(dot(N, V), 0.0);
  vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NV, 5.0);
  vec3 hemi = mix(uGroundColor, uSkyColor, N.y * 0.5 + 0.5);
  vec3 R = reflect(-V, N);
  vec3 env = mix(uGroundColor * 0.5, uSkyColor * 1.6, smoothstep(-0.3, 0.6, R.y)) * (1.0 - rough * 0.6);
  c += (1.0 - F) * (1.0 - metal) * albedo * hemi + F * env * (0.35 + 0.65 * sh);
  c += uEmissive;

  if (uGround == 1) {
    float r = length(vWorld.xz);
    c = mix(c, uBgColor, smoothstep(6.0, 16.0, r));
  }
  fragColor = vec4(pow(aces(c), vec3(1.0 / 2.2)), 1.0);
}
