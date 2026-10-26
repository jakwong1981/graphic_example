#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
uniform sampler2D uTex;
uniform int uMaterial; // 0 = solid, 1 = water, 2 = emissive
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogColor;
uniform vec3 uSkyTop;
uniform vec3 uCamPos;
uniform float uFogDensity;
uniform float uTime;
uniform float uWet;
uniform float uFlash;
// Night lighting
uniform sampler2D uEmit; // emission map (black = unlit)
uniform float uEmitK; // 0..1 lights on
const int MAX_LAMPS = 16;
const int MAX_SPOTS = 12;
uniform int uLampCount;
uniform vec4 uLamps[MAX_LAMPS]; // street lamps: position, intensity
uniform vec3 uLampColor;
uniform int uSpotCount;
uniform vec4 uSpotPos[MAX_SPOTS]; // headlights: position, intensity
uniform vec4 uSpotDir[MAX_SPOTS];
uniform vec3 uSpotColor;
out vec4 fragColor;

// Diffuse + specular from street lamps and headlights. `spec` gets the highlights (strong on wet ground).
vec3 localLights(vec3 N, vec3 V, float wet, out vec3 spec) {
  vec3 diff = vec3(0.0);
  spec = vec3(0.0);
  float shine = 0.15 + wet * 2.5;
  for (int i = 0; i < MAX_LAMPS; i++) {
    if (i >= uLampCount) break;
    vec3 L = uLamps[i].xyz - vWorld;
    float d = length(L);
    L /= d;
    float a = uLamps[i].w * (1.0 - smoothstep(9.0, 26.0, d)) / (1.0 + 0.045 * d * d);
    // lamps shine downwards: a soft cone so facades above the lamp stay dim
    a *= 0.25 + 0.75 * smoothstep(-0.2, 0.6, -L.y);
    diff += uLampColor * a * max(dot(N, L), 0.0);
    spec += uLampColor * a * pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * shine;
  }
  for (int i = 0; i < MAX_SPOTS; i++) {
    if (i >= uSpotCount) break;
    vec3 L = uSpotPos[i].xyz - vWorld;
    float d = length(L);
    L /= d;
    float cone = smoothstep(0.86, 0.96, dot(-L, uSpotDir[i].xyz));
    float a = uSpotPos[i].w * cone * (1.0 - smoothstep(18.0, 45.0, d)) / (1.0 + 0.012 * d * d);
    diff += uSpotColor * a * (max(dot(N, L), 0.0) * 0.7 + 0.3); // wrapped so the beam shows on the road
    spec += uSpotColor * a * pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * shine;
  }
  return diff;
}

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 skyColor(vec3 d) { return mix(uFogColor, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.5)) + uFlash * 0.5; }

// Sum of directional waves; returns the slope (d height / dx, dz)
vec2 waveSlope(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = normalize(vec2(1.0, 0.3)), d2 = normalize(vec2(-0.4, 1.0));
  vec2 d3 = normalize(vec2(0.7, -0.8)), d4 = normalize(vec2(-1.0, -0.2));
  g += d1 * 0.08 * cos(dot(d1, p) * 0.09 + t * 1.1);
  g += d2 * 0.06 * cos(dot(d2, p) * 0.17 + t * 1.7);
  g += d3 * 0.05 * cos(dot(d3, p) * 0.33 + t * 2.3);
  g += d4 * 0.04 * cos(dot(d4, p) * 0.71 + t * 3.1);
  return g;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 albedo = toLinear(texture(uTex, vUV).rgb * vColor);
  vec3 color;

  if (uMaterial == 2) {
    // Emissive (neon signs): unlit, slightly over-bright so they glow on dull days, brighter at night
    color = albedo * (1.35 + uEmitK * 1.4) + uFlash * 0.2;
  } else if (uMaterial == 1) {
    // Water: animated normals, Fresnel mix of sky reflection and the water body, sun glint
    vec2 g = waveSlope(vWorld.xz, uTime) * (1.0 + uWet * 1.5);
    N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 R = reflect(-V, N);
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 body = albedo * (uAmbSky * 0.6 + uSunColor * max(dot(N, uSunDir), 0.0) * 0.4);
    color = mix(body, skyColor(R), fresnel);
    color += uSunColor * pow(max(dot(R, uSunDir), 0.0), 300.0) * 3.0;
  } else {
    // Wet roads and roofs get darker and reflective in the rain
    float wet = uWet * smoothstep(0.7, 0.95, N.y);
    albedo *= 1.0 - 0.45 * wet;
    vec3 ambient = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) + uFlash;
    float diffuse = max(dot(N, uSunDir), 0.0);
    vec3 H = normalize(V + uSunDir);
    float spec = pow(max(dot(N, H), 0.0), 64.0) * (0.15 + wet * 1.5) * diffuse;
    vec3 localSpec;
    vec3 local = localLights(N, V, uWet * smoothstep(0.7, 0.95, N.y), localSpec);
    color = albedo * (ambient + uSunColor * diffuse + local) + uSunColor * spec;
    if (wet > 0.0) {
      float fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
      color = mix(color, skyColor(reflect(-V, N)), fresnel * wet * 0.6);
    }
    color += localSpec;
    // Lit windows, shop interiors and lamp glass
    color += toLinear(texture(uEmit, vUV).rgb) * uEmitK * 1.1;
  }

  // Exponential distance fog
  float fog = 1.0 - exp(-uFogDensity * dist);
  color = mix(color, uFogColor + uFlash * 0.3, clamp(fog, 0.0, 1.0));
  fragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
