#version 300 es
precision highp float;

// Fragment Shader with Full Phong Lighting
// Demonstrates: Ambient + Diffuse + Specular calculations

in vec3 vColor;
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uLightPosition;
uniform vec3 uViewPosition;

out vec4 fragColor;

void main() {
  // ========== PHONG LIGHTING MODEL ==========
  
  // 1. AMBIENT: Base illumination (30%)
  float ambientStrength = 0.3;
  vec3 ambient = ambientStrength * vec3(1.0);
  
  // 2. DIFFUSE: Lambertian reflection
  vec3 norm = normalize(vNormal);
  vec3 lightDir = normalize(uLightPosition - vWorldPos);
  float diff = max(dot(norm, lightDir), 0.0);
  vec3 diffuse = diff * vec3(1.0);
  
  // 3. SPECULAR: Blinn-Phong highlights
  float specularStrength = 0.5;
  vec3 viewDir = normalize(uViewPosition - vWorldPos);
  vec3 halfDir = normalize(lightDir + viewDir);
  float spec = pow(max(dot(norm, halfDir), 0.0), 32.0);
  vec3 specular = specularStrength * spec * vec3(1.0);
  
  // Combine all lighting components
  vec3 result = (ambient + diffuse + specular) * vColor;
  fragColor = vec4(result, 1.0);
}
