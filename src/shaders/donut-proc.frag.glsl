in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vObjPos;
in vec2 vUV;

uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform int uMode; // 0 final, 1 dough, 2 icing mask, 3 fbm noise, 4 chocolate mask

out vec4 fragColor;

void main() {
  vec3 p = vObjPos;
  float top = sin(TAU * vUV.y);

  // Dough: baked gradient from the top, modulated by fbm and fine grain
  vec3 dough = mix(vec3(0.62, 0.38, 0.16), vec3(0.85, 0.58, 0.27), smoothstep(-1.0, 0.6, top));
  dough *= 0.75 + 0.5 * fbm3(p * 6.0);
  dough *= 0.95 + 0.1 * hash31(floor(p * 180.0));

  // Icing: mask from the drip edge function, plus sprinkles from a hashed UV grid
  float icingMaskV = icingMask(vUV);
  vec3 icing = mix(vec3(0.93, 0.45, 0.62), vec3(0.98, 0.65, 0.78), fbm3(p * 4.0));

  vec2 g = vUV * vec2(60.0, 24.0);
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float id = hash21(cell);
  float angle = id * 62.8;
  vec2 q = vec2(f.x * cos(angle) + f.y * sin(angle), -f.x * sin(angle) + f.y * cos(angle));
  float sprinkle = id < 0.1 && abs(q.x) < 0.32 && abs(q.y) < 0.09 ? 1.0 : 0.0;
  icing = mix(icing, 0.5 + 0.5 * cos(TAU * (id * 10.0 + vec3(0.0, 0.33, 0.67))), sprinkle);

  // Chocolate: wavy stripes running across the ring, only on the upper icing
  float w = vUV.x * 14.0 + 1.5 * sin(TAU * 2.0 * vUV.y) + 1.2 * fbm3(p * 3.0);
  float stripe = smoothstep(0.8, 0.88, 0.5 + 0.5 * sin(TAU * w));
  float chocMask = stripe * smoothstep(0.3, 0.4, top) * icingMaskV;
  vec3 chocolate = vec3(0.25, 0.12, 0.06);

  vec3 albedo = mix(dough, icing, icingMaskV);
  albedo = mix(albedo, chocolate, chocMask);

  if (uMode == 1) albedo = dough;
  if (uMode == 2) albedo = vec3(icingMaskV);
  if (uMode == 3) albedo = vec3(fbm3(p * 6.0));
  if (uMode == 4) albedo = vec3(chocMask);

  // Bump mapping from a height field via screen-space derivatives (no tangents needed)
  float h = icingMaskV * (0.015 * fbm3(p * 12.0) + 0.01 * sprinkle) + 0.01 * chocMask;
  vec3 N = normalize(vNormal);
  vec3 dpdx = dFdx(vWorldPos);
  vec3 dpdy = dFdy(vWorldPos);
  vec3 r1 = cross(dpdy, N);
  vec3 r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  N = normalize(abs(det) * N - grad);

  vec3 L = normalize(uLightPos - vWorldPos);
  vec3 V = normalize(uViewPos - vWorldPos);
  vec3 H = normalize(L + V);

  float topping = max(icingMaskV, chocMask);
  float diffuse = max(dot(N, L), 0.0);
  float specular = mix(0.1, 0.6, topping) * pow(max(dot(N, H), 0.0), mix(8.0, 64.0, topping));

  vec3 color = (0.3 + diffuse) * albedo + vec3(specular);
  fragColor = vec4(uMode == 0 ? color : albedo, 1.0);
}
