#version 300 es

// Simple Vertex Shader: Geometry transformation only
// Demonstrates: Model → View → Projection pipeline

in vec3 aPosition;
in vec3 aNormal;
in vec3 aColor;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;

out vec3 vColor;
out vec3 vNormal;
out vec3 vWorldPos;

void main() {
  // Transform vertex position through the pipeline
  vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
  vec4 viewPos = uViewMatrix * worldPos;
  vec4 clipPos = uProjectionMatrix * viewPos;
  
  gl_Position = clipPos;
  
  // Pass data to fragment shader
  vColor = aColor;
  
  // Transform normal to world space
  mat3 normalMatrix = transpose(inverse(mat3(uModelMatrix)));
  vNormal = normalize(normalMatrix * aNormal);
  
  vWorldPos = worldPos.xyz;
}
