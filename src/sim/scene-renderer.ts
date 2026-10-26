// Owns GL programs and draws sky, textured meshes, particles and rain with the current weather
import worldVert from '../shaders/sim-world.vert.glsl?raw';
import worldFrag from '../shaders/sim-world.frag.glsl?raw';
import skyVert from '../shaders/sim-sky.vert.glsl?raw';
import skyFrag from '../shaders/sim-sky.frag.glsl?raw';
import particleVert from '../shaders/sim-particle.vert.glsl?raw';
import particleFrag from '../shaders/sim-particle.frag.glsl?raw';
import rainVert from '../shaders/sim-rain.vert.glsl?raw';
import rainFrag from '../shaders/sim-rain.frag.glsl?raw';
import crowdVert from '../shaders/crowd.vert.glsl?raw';
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
  /** Emission map (lit windows, shop interiors, lamp glass), added when the lights are on */
  emitTexture?: WebGLTexture;
  water?: boolean;
  emissive?: boolean;
  /** Draw both faces (scanned / photogrammetry meshes with mixed winding) */
  doubleSided?: boolean;
}

// Instanced crowd: per-vertex aPart = (colour slot, body part); per-instance attributes below
export interface CrowdMesh { positions: Float32Array; normals: Float32Array; parts: Float32Array; indices: Uint16Array }
export interface Crowd { instances: Float32Array; count: number; draw(n: number): void }
export const CROWD_LAYOUT: [string, number][] = [['iPose', 4], ['iAnim', 4], ['iShirt', 3], ['iPants', 3], ['iSkin', 4], ['iUmb', 3]];
export const CROWD_STRIDE = CROWD_LAYOUT.reduce((s, [, n]) => s + n, 0);

export const MAX_LAMPS = 16;
export const MAX_SPOTS = 12;

// Night lighting: street lamps (point lights) and vehicle headlights (spot lights)
export interface SceneLights {
  emit: number; // 0..1: how strongly emission maps and neon glow (shops, windows)
  lamps: Float32Array; // MAX_LAMPS x vec4: position, intensity
  lampCount: number;
  lampColor: V3; // linear
  spotPos: Float32Array; // MAX_SPOTS x vec4: position, intensity
  spotDir: Float32Array; // MAX_SPOTS x vec4: direction, unused
  spotCount: number;
  spotColor: V3; // linear
}

export interface FrameState {
  cam: Camera;
  weather: WeatherParams;
  sunDir: V3;
  time: number;
  flash: number;
  height: number; // drawing buffer height in pixels
  lights?: SceneLights;
  /** 0..1, stars in the sky */
  night?: number;
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
  private black: WebGLTexture;
  private crowdProgram: WebGLProgram | null = null;
  private uc: Uniforms | null = null;
  private white: WebGLTexture | null = null;

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
    // 1x1 black emission map for everything that does not glow
    this.black = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Repeating city texture (UVs are in world units / tile size)
  tileTexture(source: TexImageSource): WebGLTexture {
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
    us.f('uNight', f.night ?? 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  beginWorld(f: FrameState) {
    this.gl.useProgram(this.world);
    this.worldUniforms(this.uw, f);
    this.gl.activeTexture(this.gl.TEXTURE0);
  }

  // Camera, sun, weather and night lights for the world shader (shared by the instanced crowd program)
  private worldUniforms(uw: Uniforms, f: FrameState) {
    const w = f.weather;
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
    uw.i('uEmit', 1);
    const L = f.lights;
    uw.f('uEmitK', L?.emit ?? 0);
    uw.i('uLampCount', L ? Math.min(MAX_LAMPS, L.lampCount) : 0);
    uw.i('uSpotCount', L ? Math.min(MAX_SPOTS, L.spotCount) : 0);
    if (L) {
      uw.v4v('uLamps', L.lamps);
      uw.v3('uLampColor', L.lampColor);
      uw.v4v('uSpotPos', L.spotPos);
      uw.v4v('uSpotDir', L.spotDir);
      uw.v3('uSpotColor', L.spotColor);
    }
  }

  /** GPU side of an instanced crowd: one shared person mesh, per-instance pose and colours */
  crowd(mesh: CrowdMesh, capacity: number): Crowd {
    const gl = this.gl;
    if (!this.crowdProgram) {
      this.crowdProgram = createProgram(gl, crowdVert, worldFrag);
      this.uc = createUniforms(gl, this.crowdProgram);
      this.white = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.white);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    const prog = this.crowdProgram;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const attrib = (name: string, data: Float32Array, size: number) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attrib('aPosition', mesh.positions, 3);
    attrib('aNormal', mesh.normals, 3);
    attrib('aPart', mesh.parts, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const instances = new Float32Array(capacity * CROWD_STRIDE);
    const ibuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
    let offset = 0;
    for (const [name, size] of CROWD_LAYOUT) {
      const loc = gl.getAttribLocation(prog, name);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, CROWD_STRIDE * 4, offset * 4);
        gl.vertexAttribDivisor(loc, 1);
      }
      offset += size;
    }
    gl.bindVertexArray(null);
    const count = mesh.indices.length;
    return {
      instances,
      count: 0,
      draw(n: number) {
        if (n <= 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances, 0, n * CROWD_STRIDE);
        gl.bindVertexArray(vao);
        gl.drawElementsInstanced(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0, n);
        gl.bindVertexArray(null);
      },
    };
  }

  drawCrowd(f: FrameState, crowd: Crowd) {
    if (!crowd.count || !this.crowdProgram) return;
    const gl = this.gl;
    gl.useProgram(this.crowdProgram);
    this.worldUniforms(this.uc!, f);
    this.uc!.i('uMaterial', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.white!);
    crowd.draw(crowd.count);
    gl.useProgram(this.world);
  }

  draw(d: Drawable, model: Float32Array) {
    const gl = this.gl;
    this.uw.m4('uModel', model);
    this.uw.i('uMaterial', d.water ? 1 : d.emissive ? 2 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, d.emitTexture ?? this.black);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, d.texture);
    if (d.doubleSided) gl.disable(gl.CULL_FACE);
    d.mesh.draw();
    if (d.doubleSided) gl.enable(gl.CULL_FACE);
  }

  // Additive light halos (street lamps, headlights, tail lights) as point sprites of one colour
  drawGlows(f: FrameState, glows: ParticlePool, color: ArrayLike<number>) {
    if (!glows.count) return;
    const { gl, up } = this;
    const w = f.weather;
    gl.useProgram(this.particle);
    up.m4('uView', f.cam.view);
    up.m4('uProj', f.cam.proj);
    up.v3('uCamPos', f.cam.pos);
    up.f('uScale', f.height / (2 * Math.tan(f.cam.fov / 2)));
    up.v3('uFogColor', w.fog);
    up.f('uFogDensity', w.fogDensity);
    up.v3('uLight', color);
    up.i('uMode', 3);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    glows.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
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

  // Falling sakura petals (alpha blended point sprites)
  drawPetals(f: FrameState, petals: ParticlePool) {
    const { gl, up } = this;
    const w = f.weather;
    gl.useProgram(this.particle);
    up.m4('uView', f.cam.view);
    up.m4('uProj', f.cam.proj);
    up.v3('uCamPos', f.cam.pos);
    up.f('uScale', f.height / (2 * Math.tan(f.cam.fov / 2)));
    up.v3('uFogColor', w.fog);
    up.f('uFogDensity', w.fogDensity);
    up.v3('uLight', w.ambSky.map((a, i) => a + w.sunColor[i] * 0.6 + f.flash));
    up.i('uMode', 2);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    petals.draw();
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
    const amb = (f.weather.ambSky[0] + f.weather.ambSky[1] + f.weather.ambSky[2]) / 3;
    ur.f('uLight', Math.min(1, 0.25 + 6 * amb));
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
