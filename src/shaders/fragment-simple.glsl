#version 300 es
precision highp float;

// Simple Fragment Shader: Flat coloring, NO lighting
// Demonstrates: Just outputs vertex color directly

in vec3 vColor;
in vec3 vNormal;
in vec3 vWorldPos;

out vec4 fragColor;

void main() {
  // No lighting calculations - just output the vertex color
  // This shows what the vertex shader provides before lighting
  fragColor = vec4(vColor, 1.0);
}
