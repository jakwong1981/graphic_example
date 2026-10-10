// 2D texture creation with selectable minification filter

export type FilterMode = 'nearest' | 'linear' | 'mipmap';

export function createTexture(gl: WebGL2RenderingContext, image: TexImageSource): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  setFilter(gl, texture, 'mipmap');
  return texture;
}

export function setFilter(gl: WebGL2RenderingContext, texture: WebGLTexture, mode: FilterMode): void {
  const min = { nearest: gl.NEAREST, linear: gl.LINEAR, mipmap: gl.LINEAR_MIPMAP_LINEAR }[mode];
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mode === 'nearest' ? gl.NEAREST : gl.LINEAR);
}
