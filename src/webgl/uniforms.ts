// Cached uniform setter; unknown names resolve to null, which WebGL ignores

export interface Uniforms {
  f(name: string, value: number): void;
  i(name: string, value: number): void;
  v3(name: string, value: ArrayLike<number>): void;
  m4(name: string, value: Float32Array): void;
}

export function createUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Uniforms {
  const cache = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name) ?? null;
  };

  return {
    f: (name, value) => gl.uniform1f(loc(name), value),
    i: (name, value) => gl.uniform1i(loc(name), value),
    v3: (name, value) => gl.uniform3f(loc(name), value[0], value[1], value[2]),
    m4: (name, value) => gl.uniformMatrix4fv(loc(name), false, value),
  };
}
