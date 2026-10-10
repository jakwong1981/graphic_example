// Owns GL programs and draws sky, textured meshes, particles and rain with the current weather
import worldVert from '../shaders/sim-world.vert.glsl?raw';
import worldFrag from '../shaders/sim-world.frag.glsl?raw';
import skyVert from '../shaders/sim-sky.vert.glsl?raw';
import skyFrag from '../shaders/sim-sky.frag.glsl?raw';
import particleVert from '../shaders/sim-particle.vert.glsl?raw';
import particleFrag from '../shaders/sim-particle.frag.glsl?raw';
import rainVert from '../shaders/sim-rain.vert.glsl?raw';
import rainFrag from '../shaders/sim-rain.frag.glsl?raw';
import { createProgram } from '../webgl/shader-program';
import { createMesh, Mesh, MeshData } from '../webgl/mesh';
import { createUniforms, Uniforms } from '../webgl/uniforms';
import { createTexture } from '../webgl/texture';
import { drawAtlas } from '../models/atlas';
import { ModelDef } from '../models/types';
import { V3 } from './math';
import { WeatherParams } from './weather';
import { ParticlePool } from './particles';

export interface Camera {
  pos: V3;
  right: V3;
  up: V3;
  fwd: V3;
  view: Float32Array;
  proj: Float32Array;
  fov: number;
  aspect: number;
}

export interface Drawable {
  mesh: Mesh;
  texture: WebGLTexture;
  water?: boolean;
}

export interface FrameState {
  cam: Camera;
  weather: WeatherParams;
  sunDir: V3;
  time: number;
  flash: number;
  height: number; // drawing buffer height in pixels
}

export class SceneRenderer {
  readonly world: WebGLProgram;
  readonly particle: WebGLProgram;
  private sky: WebGLProgram;
  private rain: WebGLProgram;
  private uw: Uniforms;
  private us: Uniforms;
  private up: Uniforms;
  private ur: Uniforms;
  private emptyVao: WebGLVertexArrayObject;
  private rainVao: WebGLVertexArrayObject;
  private rainBuf: WebGLBuffer;
  private aniso: number;
  private anisoExt: EXT_texture_filter_anisotropic | null;

  constructor(private gl: WebGL2RenderingContext) {
    this.world = createProgram(gl, worldVert, worldFrag);
    this.sky = createProgram(gl, skyVert, skyFrag);
    this.particle = createProgram(gl, particleVert, particleFrag);
    this.rain = createProgram(gl, rainVert, rainFrag);
    this.uw = createUniforms(gl, this.world);
    // Disabled attribute arrays read this constant, so untinted meshes render with white
    const colorLoc = gl.getAttribLocation(this.world, 'aColor');
    if (colorLoc >= 0) gl.vertexAttrib3f(colorLoc, 1, 1, 1);
    this.us = createUniforms(gl, this.sky);
    this.up = createUniforms(gl, this.particle);
    this.ur = createUniforms(gl, this.rain);
    this.emptyVao = gl.createVertexArray()!;
    this.rainVao = gl.createVertexArray()!;
    this.rainBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.rainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rainBuf);
    const loc = gl.getAttribLocation(this.rain, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
    this.aniso = this.anisoExt ? Math.min(8, gl.getParameter(this.anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 1;
  }

  // Repeating city texture (UVs are in world units / tile size)
  tileTexture(source: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const t = createTexture(gl, source);
    if (this.anisoExt) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso);
    return t;
  }

  // UV-atlas model (plane, ship, taxi) from the model library
  model(def: ModelDef): Drawable & { data: MeshData } {
    const gl = this.gl;
    const canvas = document.createElement('canvas');
    drawAtlas(canvas, def.regions, def.painters, def.paint, 'painted');
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const texture = createTexture(gl, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const data = def.build();
    return { mesh: createMesh(gl, this.world, data), texture, data };
  }

  mesh(data: MeshData, texture: WebGLTexture, water = false): Drawable {
    return { mesh: createMesh(this.gl, this.world, data), texture, water };
  }

  drawSky(f: FrameState) {
    const { gl, us } = this;
    const w = f.weather;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky);
    us.v3('uCamPos', f.cam.pos);
    us.v3('uCamRight', f.cam.right);
    us.v3('uCamUp', f.cam.up);
    us.v3('uCamFwd', f.cam.fwd);
    us.f('uTanHalf', Math.tan(f.cam.fov / 2));
    us.f('uAspect', f.cam.aspect);
    us.v3('uSkyTop', w.skyTop);
    us.v3('uFogColor', w.fog);
    us.v3('uSunDir', f.sunDir);
    us.v3('uSunColor', w.sunColor);
    us.f('uSunVis', w.sunVis);
    us.f('uCloudCover', w.cloudCover);
    us.f('uTime', f.time);
    us.f('uFlash', f.flash);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  beginWorld(f: FrameState) {
    const { gl, uw } = this;
    const w = f.weather;
    gl.useProgram(this.world);
    uw.m4('uView', f.cam.view);
    uw.m4('uProj', f.cam.proj);
    uw.v3('uCamPos', f.cam.pos);
    uw.v3('uSunDir', f.sunDir);
    uw.v3('uSunColor', w.sunColor);
    uw.v3('uAmbSky', w.ambSky);
    uw.v3('uAmbGround', w.ambGround);
    uw.v3('uFogColor', w.fog);
    uw.v3('uSkyTop', w.skyTop);
    uw.f('uFogDensity', w.fogDensity);
    uw.f('uTime', f.time);
    uw.f('uWet', w.wet);
    uw.f('uFlash', f.flash);
    uw.i('uTex', 0);
    gl.activeTexture(gl.TEXTURE0);
  }

  draw(d: Drawable, model: Float32Array) {
    const gl = this.gl;
    this.uw.m4('uModel', model);
    this.uw.i('uMaterial', d.water ? 1 : 0);
    gl.bindTexture(gl.TEXTURE_2D, d.texture);
    d.mesh.draw();
  }

  drawParticles(f: FrameState, smoke: ParticlePool, flame: ParticlePool) {
    const { gl, up } = this;
    const w = f.weather;
    gl.useProgram(this.particle);
    up.m4('uView', f.cam.view);
    up.m4('uProj', f.cam.proj);
    up.v3('uCamPos', f.cam.pos);
    up.f('uScale', f.height / (2 * Math.tan(f.cam.fov / 2)));
    up.v3('uFogColor', w.fog);
    up.f('uFogDensity', w.fogDensity);
    up.v3('uLight', w.ambSky.map((a, i) => a + w.sunColor[i] * 0.5 + f.flash));
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    up.i('uMode', 1);
    smoke.draw();
    gl.blendFunc(gl.ONE, gl.ONE);
    up.i('uMode', 0);
    flame.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawRain(f: FrameState, lines: Float32Array, intensity: number) {
    if (intensity < 0.02) return;
    const { gl, ur } = this;
    gl.useProgram(this.rain);
    ur.m4('uView', f.cam.view);
    ur.m4('uProj', f.cam.proj);
    ur.v3('uCamPos', f.cam.pos);
    ur.f('uIntensity', intensity);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.rainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}
