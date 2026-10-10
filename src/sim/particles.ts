// CPU particle pool rendered as GL point sprites. Flame uses additive blending, smoke uses alpha blending.
import { V3 } from './math';

const STRIDE = 12; // px py pz vx vy vz age life size0 size1 alpha shade
const GPU_STRIDE = 7; // px py pz size life01 alpha shade

export interface EmitOptions {
  life: number;
  size0: number;
  size1: number;
  alpha?: number;
  shade?: number;
}

export class ParticlePool {
  private cpu: Float32Array;
  private gpu: Float32Array;
  count = 0;
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext, program: WebGLProgram, private capacity: number, private drag: number, private buoyancy: number) {
    this.cpu = new Float32Array(capacity * STRIDE);
    this.gpu = new Float32Array(capacity * GPU_STRIDE);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.gpu.byteLength, gl.DYNAMIC_DRAW);
    const pos = gl.getAttribLocation(program, 'aPos');
    const data = gl.getAttribLocation(program, 'aData');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, GPU_STRIDE * 4, 0);
    gl.enableVertexAttribArray(data);
    gl.vertexAttribPointer(data, 4, gl.FLOAT, false, GPU_STRIDE * 4, 12);
    gl.bindVertexArray(null);
  }

  emit(p: V3, v: V3, o: EmitOptions) {
    if (this.count >= this.capacity) return;
    const i = this.count++ * STRIDE;
    this.cpu.set([p[0], p[1], p[2], v[0], v[1], v[2], 0, o.life, o.size0, o.size1, o.alpha ?? 1, o.shade ?? 1], i);
  }

  update(dt: number) {
    const c = this.cpu;
    const damp = Math.exp(-this.drag * dt);
    for (let k = 0; k < this.count; ) {
      const i = k * STRIDE;
      c[i + 6] += dt;
      if (c[i + 6] >= c[i + 7]) {
        // swap-remove with the last particle
        this.count--;
        c.copyWithin(i, this.count * STRIDE, this.count * STRIDE + STRIDE);
        continue;
      }
      c[i + 3] *= damp;
      c[i + 4] = c[i + 4] * damp + this.buoyancy * dt;
      c[i + 5] *= damp;
      c[i] += c[i + 3] * dt;
      c[i + 1] += c[i + 4] * dt;
      c[i + 2] += c[i + 5] * dt;
      k++;
    }
  }

  draw() {
    const { gl, cpu, gpu } = this;
    for (let k = 0; k < this.count; k++) {
      const i = k * STRIDE;
      const o = k * GPU_STRIDE;
      const t = cpu[i + 6] / cpu[i + 7];
      gpu[o] = cpu[i];
      gpu[o + 1] = cpu[i + 1];
      gpu[o + 2] = cpu[i + 2];
      gpu[o + 3] = cpu[i + 8] + (cpu[i + 9] - cpu[i + 8]) * t;
      gpu[o + 4] = t;
      gpu[o + 5] = cpu[i + 10];
      gpu[o + 6] = cpu[i + 11];
    }
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, gpu, 0, this.count * GPU_STRIDE);
    gl.drawArrays(gl.POINTS, 0, this.count);
    gl.bindVertexArray(null);
  }
}
