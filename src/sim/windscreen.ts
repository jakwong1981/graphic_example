// Renders the scene into an offscreen multisampled buffer, then draws it through the tram's wet front window
import vert from '../shaders/sim-sky.vert.glsl?raw';
import frag from '../shaders/windscreen.frag.glsl?raw';
import { createProgram } from '../webgl/shader-program';
import { createUniforms, Uniforms } from '../webgl/uniforms';
import { Camera } from './scene-renderer';
import { V3 } from './math';

export interface GlassParams {
  cam: Camera;
  tramPos: V3;
  tramDir: number;
  glassX: number;
  paneY: [number, number];
  wiper: boolean;
  pivot: [number, number];
  blade: [number, number];
  sweep: [number, number];
  wipe: Float32Array; // 128 floats
  time: number;
  wet: number;
  rate: number;
  wall: V3;
}

export class Windscreen {
  private program: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private msFbo: WebGLFramebuffer;
  private msColor: WebGLRenderbuffer;
  private msDepth: WebGLRenderbuffer;
  private fbo: WebGLFramebuffer;
  private tex: WebGLTexture;
  private w = 0;
  private h = 0;
  private samples: number;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, vert, frag);
    this.u = createUniforms(gl, this.program);
    this.vao = gl.createVertexArray()!;
    this.msFbo = gl.createFramebuffer()!;
    this.msColor = gl.createRenderbuffer()!;
    this.msDepth = gl.createRenderbuffer()!;
    this.fbo = gl.createFramebuffer()!;
    this.tex = gl.createTexture()!;
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
  }

  private ensure(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  /** Redirects the following scene drawing into the offscreen buffer */
  begin(w: number, h: number) {
    this.ensure(w, h);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.msFbo);
  }

  /** Resolves the scene and draws it to the screen through the glass */
  end(p: GlassParams) {
    const { gl, u } = this;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    u.i('uScene', 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'uTexel'), 1 / this.w, 1 / this.h);
    const c = p.cam;
    u.v3('uCamPos', c.pos);
    u.v3('uCamRight', c.right);
    u.v3('uCamUp', c.up);
    u.v3('uCamFwd', c.fwd);
    u.f('uTanHalf', Math.tan(c.fov / 2));
    u.f('uAspect', c.aspect);
    u.v3('uTramPos', p.tramPos);
    u.f('uTramDir', p.tramDir);
    u.f('uGlassX', p.glassX);
    const v2 = (name: string, a: [number, number]) => gl.uniform2f(gl.getUniformLocation(this.program, name), a[0], a[1]);
    v2('uPaneY', p.paneY);
    v2('uPivot', p.pivot);
    v2('uBlade', p.blade);
    v2('uSweep', p.sweep);
    u.i('uWiper', p.wiper ? 1 : 0);
    u.v4v('uWipe', p.wipe);
    u.f('uTime', p.time);
    u.f('uWet', p.wet);
    u.f('uRate', p.rate);
    u.v3('uWall', p.wall);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }
}
