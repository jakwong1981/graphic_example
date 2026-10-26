#version 300 es
precision highp float;
// Cab view post-process: the scene seen through the tram's front window, with rain beads, running
// drops and a water film on the glass; the wiper clears its sweep. Glass coordinates g = tram-local (z, y).
in vec2 vNdc;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform vec3 uTramPos;
uniform float uTramDir; // +1 / -1: tram faces +x / -x
uniform float uGlassX; // front plane, tram-local x
uniform vec2 uPaneY; // bottom / top of the front window row (tram-local y)
uniform int uWiper; // 1: this window has the wiper
uniform vec2 uPivot;
uniform vec2 uBlade; // swept radii
uniform vec2 uSweep; // swept angles
uniform vec4 uWipe[32]; // 128 bins: last time each angle was wiped
uniform float uTime;
uniform float uWet; // 0..1 water on the glass
uniform float uRate; // how fast beads build up again after a wipe (1/s)
uniform vec3 uWall; // linear light inside the cab
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float lastWipe(vec2 g) {
  if (uWiper == 0) return -1e4;
  vec2 r = g - uPivot;
  float d = length(r);
  if (d < uBlade.x || d > uBlade.y) return -1e4;
  float s = (atan(r.y, r.x) - uSweep.x) / (uSweep.y - uSweep.x);
  if (s < 0.0 || s > 1.0) return -1e4;
  int i = int(min(s * 128.0, 127.0));
  vec4 v = uWipe[i >> 2];
  int k = i & 3;
  return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
}

// Fraction of the glass covered at g: full in unwiped corners, rebuilding behind the blade
float coverage(vec2 g) { return uWet * (1.0 - exp(-(uTime - lastWipe(g)) * uRate)); }

// Static beads on a grid of cell size cs (metres). Returns lens normal xy and mask.
vec3 beads(vec2 g, float cs, float seed, float cover) {
  vec2 cell = floor(g / cs);
  vec2 f = fract(g / cs) - 0.5;
  float h0 = hash(cell + seed);
  float life = 4.0 + 5.0 * h0; // beads merge, run off and re-form
  float age = uTime / life + h0;
  float gen = floor(age);
  float present = step(hash(cell * 1.7 + seed + gen * 3.1), cover);
  vec2 c = (vec2(hash(cell + gen * 7.3 + seed), hash(cell + gen * 5.1 + seed + 19.0)) - 0.5) * 0.3;
  float r = 0.2 + 0.18 * hash(cell + gen * 2.9 + seed * 2.0);
  vec2 d = (f - c) / r;
  float fa = fract(age);
  float m = (1.0 - smoothstep(0.7, 1.0, dot(d, d))) * present * smoothstep(0.0, 0.08, fa) * (1.0 - smoothstep(0.9, 1.0, fa));
  return vec3(d * m, m);
}

// Bigger drops running down in columns, leaving a thin trail
vec3 runners(vec2 g, float cover) {
  float w = 0.05;
  float col = floor(g.x / w);
  float h = hash(vec2(col, 3.7));
  if (h > uWet * 0.6) return vec3(0.0);
  float speed = 0.05 + 0.12 * hash(vec2(col, 9.1));
  float yd = 4.3 - mod(uTime * speed + h * 13.0, 3.4);
  float cx = (col + 0.3 + 0.4 * hash(vec2(col, 1.3))) * w + 0.004 * sin(g.y * 40.0 + h * 6.0);
  vec2 d = vec2((g.x - cx) / 0.011, (g.y - yd) / 0.015);
  float k = clamp(cover / max(uWet, 1e-3), 0.0, 1.0);
  float drop = 1.0 - smoothstep(0.7, 1.0, dot(d, d));
  if (drop > 0.0) return vec3(d * drop * k, drop * k);
  float trail = step(yd, g.y) * (1.0 - smoothstep(0.0, 0.25, g.y - yd)) * (1.0 - smoothstep(0.002, 0.004, abs(g.x - cx))) * 0.6 * k;
  return vec3((g.x - cx) / 0.004 * trail, 0.0, trail);
}

vec3 scene(vec2 uv, float blur) {
  vec3 c = texture(uScene, uv).rgb;
  if (blur < 0.5) return c;
  vec2 o = uTexel * blur;
  c += texture(uScene, uv + vec2(o.x, o.y)).rgb + texture(uScene, uv + vec2(-o.x, o.y)).rgb;
  c += texture(uScene, uv + vec2(o.x, -o.y)).rgb + texture(uScene, uv + vec2(-o.x, -o.y)).rgb;
  return c / 5.0;
}

void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  // View ray -> tram-local space -> hit point on the front plane
  vec3 dir = normalize(uCamFwd + vNdc.x * uAspect * uTanHalf * uCamRight + vNdc.y * uTanHalf * uCamUp);
  vec3 s = vec3(uTramDir, 1.0, uTramDir);
  vec3 o = (uCamPos - uTramPos) * s;
  vec3 dl = dir * s;
  if (dl.x < 1e-4) { fragColor = vec4(texture(uScene, uv).rgb, 1.0); return; }
  vec2 g = (o + dl * ((uGlassX - o.x) / dl.x)).zy;
  float az = abs(g.x);
  if (az > 1.0 || g.y < 0.45 || g.y > 4.3) { fragColor = vec4(texture(uScene, uv).rgb, 1.0); return; }

  bool inRow = g.y > uPaneY.x && g.y < uPaneY.y;
  bool pane = inRow && (az < 0.35 || (az > 0.45 && az < 0.9));
  if (!pane) {
    // Cab front wall: aluminium window frames, varnished teak panels, dark dashboard under the window
    bool frame = g.y > uPaneY.x - 0.04 && g.y < uPaneY.y + 0.04 && (az < 0.39 || (az > 0.41 && az < 0.94));
    vec3 albedo = vec3(0.2, 0.09, 0.035) * (0.85 + 0.3 * hash(vec2(floor(g.x * 60.0), 1.0)));
    if (g.y < uPaneY.x - 0.04) albedo = vec3(0.035, 0.037, 0.04);
    if (frame) albedo = vec3(0.4, 0.42, 0.45);
    fragColor = vec4(pow(albedo * uWall, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  float cover = coverage(g);
  vec3 b1 = beads(g, 0.045, 1.0, cover);
  vec3 b2 = beads(g, 0.018, 5.0, cover * 1.3);
  vec3 rn = runners(g, cover);
  vec2 n = b1.xy + b2.xy * 0.7 + rn.xy;
  float m = clamp(b1.z + b2.z + rn.z, 0.0, 1.0);
  // Each drop is a small lens showing a flipped, wider view of the street behind it
  vec2 off = -n * vec2(0.09 / uAspect, 0.12);
  vec3 col = scene(uv + off, cover * 5.0 * (1.0 - m));
  col = mix(col, col * 1.12 + 0.03, m); // drops gather light
  col *= 1.0 - 0.3 * m * smoothstep(0.6, 1.0, length(n)); // dark rims
  vec3 nn = normalize(vec3(n * 0.8, 1.0));
  col += 0.6 * m * pow(max(dot(nn, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 30.0); // glint
  col = mix(col, col * 0.88 + 0.06, cover * 0.5); // misty water film
  // Pane edges darken slightly where the rubber seal sits
  float edge = min(min(g.y - uPaneY.x, uPaneY.y - g.y), az < 0.4 ? 0.35 - az : min(az - 0.45, 0.9 - az));
  col *= 0.75 + 0.25 * smoothstep(0.0, 0.015, edge);
  fragColor = vec4(col, 1.0);
}
