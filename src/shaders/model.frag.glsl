#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
in vec2 vUV;
uniform sampler2D uBaseColor;
uniform int uHasTexture;
uniform vec4 uBaseColorFactor;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform int uViewMode; // 0 lit, 1 albedo, 2 normals, 3 UVs
out vec4 fragColor;

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }

void main() {
  // Double-sided material: flip the normal for back faces
  vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  if (uViewMode == 2) { fragColor = vec4(N * 0.5 + 0.5, 1.0); return; }
  if (uViewMode == 3) { fragColor = vec4(fract(vUV), 0.0, 1.0); return; }

  // glTF base color textures are sRGB; light in linear space
  vec3 albedo = uBaseColorFactor.rgb;
  if (uHasTexture == 1) albedo *= toLinear(texture(uBaseColor, vUV).rgb);
  if (uViewMode == 1) { fragColor = vec4(toSRGB(albedo), 1.0); return; }

  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos - vWorldPos);
  vec3 H = normalize(L + V);
  float diffuse = max(dot(N, L), 0.0);
  float hemi = 0.5 + 0.5 * N.y; // sky/ground ambient
  vec3 ambient = mix(vec3(0.08, 0.07, 0.06), vec3(0.25, 0.27, 0.32), hemi);
  float specular = 0.15 * pow(max(dot(N, H), 0.0), 32.0) * step(0.0, diffuse);
  vec3 color = albedo * (ambient + diffuse) + specular;
  fragColor = vec4(toSRGB(color), 1.0);
}
