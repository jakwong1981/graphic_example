#version 300 es
precision highp float;

// Fragment Shader: Calculates final pixel color using lighting
// Runs once per fragment (potential pixel) covered by the triangle

// Input from vertex shader (interpolated across triangle)
in vec3 vColor;      // Interpolated vertex color
in vec3 vNormal;     // Interpolated surface normal (world space)
in vec3 vWorldPos;   // Interpolated world position

// Uniforms
uniform vec3 uLightPosition;   // Light source position (world space)
uniform vec3 uViewPosition;    // Camera position (world space)

// Output
out vec4 fragColor;

void main() {
  // ========== PHONG LIGHTING MODEL ==========
  // Three components: Ambient + Diffuse + Specular
  
  // 1. AMBIENT: Base illumination (simulates indirect light)
  float ambientStrength = 0.3;
  vec3 ambient = ambientStrength * vec3(1.0);
  
  // 2. DIFFUSE: Lambertian reflection
  // Depends on angle between surface normal and light direction
  // More light hits surface when normal points toward light
  
  // Normalize interpolated normal (interpolation can denormalize)
  vec3 norm = normalize(vNormal);
  
  // Light direction: from fragment to light
  vec3 lightDir = normalize(uLightPosition - vWorldPos);
  
  // Lambert's cosine law: max(0, dot(N, L))
  // dot(N, L) = cos(angle between normal and light)
  // When parallel: 1.0 (full light)
  // When perpendicular: 0.0 (no light)
  // When opposite: negative (clamped to 0)
  float diff = max(dot(norm, lightDir), 0.0);
  vec3 diffuse = diff * vec3(1.0);
  
  // 3. SPECULAR: Shiny highlights (Blinn-Phong)
  // Depends on view direction and half-vector
  float specularStrength = 0.5;
  
  // View direction: from fragment to camera
  vec3 viewDir = normalize(uViewPosition - vWorldPos);
  
  // Half-vector: between light and view directions
  vec3 halfDir = normalize(lightDir + viewDir);
  
  // Specular = (N · H)^shininess
  // Sharp highlights with high shininess exponent
  float spec = pow(max(dot(norm, halfDir), 0.0), 32.0);
  vec3 specular = specularStrength * spec * vec3(1.0);
  
  // Combine all components
  vec3 result = (ambient + diffuse + specular) * vColor;
  
  // Output final color with full opacity
  fragColor = vec4(result, 1.0);
}
