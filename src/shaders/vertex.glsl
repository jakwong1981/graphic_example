#version 300 es

// Vertex Shader: Transforms 3D model coordinates to 2D screen space
// Pipeline: Model Space -> World Space -> View Space -> Clip Space -> NDC -> Screen Space

// Input attributes (per-vertex data from CPU)
in vec3 aPosition;    // Vertex position in model space
in vec3 aNormal;      // Vertex normal for lighting
in vec3 aColor;       // Per-vertex color

// Uniforms (same for all vertices in this frame)
uniform mat4 uModelMatrix;      // Model transformation (rotation, scale, translation)
uniform mat4 uViewMatrix;       // Camera transformation
uniform mat4 uProjectionMatrix; // Perspective projection

// Output to fragment shader (interpolated across triangle)
out vec3 vColor;        // Interpolated color
out vec3 vNormal;       // Interpolated normal (in world space)
out vec3 vWorldPos;     // Vertex position in world space

void main() {
  // Step 1: Transform position from model space to world space
  // Model matrix encodes: rotation * scale * translation
  vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
  
  // Step 2: Transform to view (camera) space
  // View matrix = inverse(camera transform)
  vec4 viewPos = uViewMatrix * worldPos;
  
  // Step 3: Transform to clip space via projection matrix
  // Projection matrix applies perspective division (near/far, FOV)
  vec4 clipPos = uProjectionMatrix * viewPos;
  
  // Step 4: Perspective division (hardware does this after vertex shader)
  // NDC = clipPos.xyz / clipPos.w
  // gl_Position is in clip space, GPU handles the rest
  gl_Position = clipPos;
  
  // Pass color to fragment shader (will be interpolated)
  vColor = aColor;
  
  // Transform normal to world space
  // Use transpose(inverse(model)) for correct normal transformation
  // Simplified: if model is uniform scale + rotation, use upper-left 3x3
  mat3 normalMatrix = transpose(inverse(mat3(uModelMatrix)));
  vNormal = normalize(normalMatrix * aNormal);
  
  // Pass world position for lighting calculations
  vWorldPos = worldPos.xyz;
}
