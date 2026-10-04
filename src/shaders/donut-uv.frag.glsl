#version 300 es
precision highp float;

in vec3 vNormal;
in vec3 vTangent;
in vec3 vWorldPos;
in vec2 vUV;

uniform sampler2D uDough;
uniform sampler2D uIcing;
uniform sampler2D uChocolate;
uniform sampler2D uNormalMap;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform float uTile;
uniform int uShowIcing;
uniform int uShowChocolate;
uniform int uUseNormalMap;

out vec4 fragColor;

void main() {
  // Dough is tiled to expose filtering; the topping layers use the plain UVs
  vec3 dough = texture(uDough, vUV * uTile).rgb;
  vec4 icing = texture(uIcing, vUV);
  vec4 chocolate = texture(uChocolate, vUV);

  float icingA = uShowIcing == 1 ? icing.a : 0.0;
  float chocA = uShowChocolate == 1 ? chocolate.a : 0.0;
  float topping = max(icingA, chocA);

  vec3 albedo = mix(dough, icing.rgb, icingA);
  albedo = mix(albedo, chocolate.rgb, chocA);

  vec3 N = normalize(vNormal);
  if (uUseNormalMap == 1) {
    vec3 T = normalize(vTangent - N * dot(vTangent, N));
    vec3 B = cross(T, N);
    vec3 n = texture(uNormalMap, vUV).xyz * 2.0 - 1.0;
    N = normalize(mix(N, normalize(mat3(T, B, N) * n), topping));
  }

  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos - vWorldPos);
  vec3 H = normalize(L + V);

  float diffuse = max(dot(N, L), 0.0);
  float shininess = mix(8.0, 64.0, topping);
  float specular = mix(0.1, 0.6, topping) * pow(max(dot(N, H), 0.0), shininess);

  fragColor = vec4((0.3 + diffuse) * albedo + vec3(specular), 1.0);
}
