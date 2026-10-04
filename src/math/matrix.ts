// 4x4 Matrix operations for 3D transformations
// Matrices are stored in column-major order (WebGL convention)

export type Mat4 = Float32Array;

export function create(): Mat4 {
  return new Float32Array(16);
}

export function identity(): Mat4 {
  const out = create();
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

// Perspective projection matrix
// Maps 3D view space to clip space with perspective division
export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const out = create();
  const f = 1.0 / Math.tan(fovY / 2);
  const rangeInv = 1.0 / (near - far);

  out[0] = f / aspect;
  out[5] = f;
  out[10] = (near + far) * rangeInv;
  out[11] = -1;
  out[14] = 2 * near * far * rangeInv;
  return out;
}

// Look-at view matrix
// Positions camera at 'eye', looking at 'center', with 'up' direction
export function lookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Mat4 {
  const out = create();
  
  // Forward vector (camera looks down -Z)
  const fx = center[0] - eye[0];
  const fy = center[1] - eye[1];
  const fz = center[2] - eye[2];
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  const fwdX = fx / fl, fwdY = fy / fl, fwdZ = fz / fl;
  
  // Right vector = forward × up
  const rx = fwdY * up[2] - fwdZ * up[1];
  const ry = fwdZ * up[0] - fwdX * up[2];
  const rz = fwdX * up[1] - fwdY * up[0];
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const rightX = rx / rl, rightY = ry / rl, rightZ = rz / rl;
  
  // True up vector = right × forward
  const ux = rightY * fwdZ - rightZ * fwdY;
  const uy = rightZ * fwdX - rightX * fwdZ;
  const uz = rightX * fwdY - rightY * fwdX;
  
  // Column-major layout
  out[0] = rightX;
  out[1] = ux;
  out[2] = -fwdX;
  out[3] = 0;
  
  out[4] = rightY;
  out[5] = uy;
  out[6] = -fwdY;
  out[7] = 0;
  
  out[8] = rightZ;
  out[9] = uz;
  out[10] = -fwdZ;
  out[11] = 0;
  
  out[12] = -(rightX * eye[0] + rightY * eye[1] + rightZ * eye[2]);
  out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[14] = fwdX * eye[0] + fwdY * eye[1] + fwdZ * eye[2];
  out[15] = 1;
  
  return out;
}

// Rotation around Y axis
export function rotateY(angle: number): Mat4 {
  const out = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

// Rotation around X axis
export function rotateX(angle: number): Mat4 {
  const out = identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

// Matrix multiplication: out = a × b
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = create();
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        a[0 * 4 + j] * b[i * 4 + 0] +
        a[1 * 4 + j] * b[i * 4 + 1] +
        a[2 * 4 + j] * b[i * 4 + 2] +
        a[3 * 4 + j] * b[i * 4 + 3];
    }
  }
  return out;
}

// Format matrix for display
export function formatMatrix(m: Mat4): string {
  const rows: string[] = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      row.push(m[j * 4 + i].toFixed(3));
    }
    rows.push(`[${row.join(', ')}]`);
  }
  return rows.join('\n');
}
