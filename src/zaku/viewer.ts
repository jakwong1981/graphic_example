// Showroom renderer for an editable glTF scene: one draw per material, a studio floor and a shadow map
import vert from '../shaders/zaku.vert.glsl?raw';
import frag from '../shaders/zaku.frag.glsl?raw';
import depthFrag from '../shaders/zaku-depth.frag.glsl?raw';
import { createProgram } from '../webgl/shader-program';
import { createUniforms, Uniforms } from '../webgl/uniforms';
import { lookAt, multiply } from '../math/matrix';
import { GltfScene, Material, flatten } from './gltf-scene';

type V3 = [number, number, number];
const SHADOW = 2048;
const srgb = (r: number, g: number, b: number): V3 => [r ** 2.2, g ** 2.2, b ** 2.2];
const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };

interface Batch {
  vao: WebGLVertexArrayObject; depthVao: WebGLVertexArrayObject; count: number; material: Material;
  texture: WebGLTexture | null; mrTexture: WebGLTexture | null; normalTexture: WebGLTexture | null;
}
export interface Model {
  batches: Batch[]; min: number[]; max: number[]; dispose(): void;
  /** Resolves once every texture has been decoded and uploaded */
  ready: Promise<void>;
}

function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

export class Viewer {
  private prog: WebGLProgram;
  private depthProg: WebGLProgram;
  private u: Uniforms;
  private ud: Uniforms;
  private shadowTex: WebGLTexture;
  private shadowFbo: WebGLFramebuffer;
  private floor: Model;
  readonly bg = srgb(0.12, 0.13, 0.16);
  keyDir: V3 = norm([0.55, 0.85, 0.6]);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, vert, frag);
    this.depthProg = createProgram(gl, vert, depthFrag);
    this.u = createUniforms(gl, this.prog);
    this.ud = createUniforms(gl, this.depthProg);
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // Studio floor: a big disc at y = 0
    const n = 64, R = 18;
    const p = [0, 0, 0], nn = [0, 1, 0], uv = [0, 0], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      p.push(Math.cos(a) * R, 0, Math.sin(a) * R);
      nn.push(0, 1, 0);
      uv.push(0, 0);
      if (i) idx.push(0, i + 1, i);
    }
    const floorMat: Material = { color: [...srgb(0.3, 0.31, 0.34), 1] as [number, number, number, number], metallic: 0, roughness: 0.75, emissive: [0, 0, 0] };
    this.floor = this.upload({ root: { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], primitives: [{ positions: new Float32Array(p), normals: new Float32Array(nn), uvs: new Float32Array(uv), indices: new Uint32Array(idx), material: 0 }], children: [] }, materials: [floorMat] });
  }

  /** Uploads a scene (decodes its textures asynchronously; parts draw untextured until then) */
  upload(scene: GltfScene): Model {
    const gl = this.gl;
    const { batches, min, max } = flatten(scene);
    const buffers: WebGLBuffer[] = [];
    const pending: Promise<void>[] = [];
    const out: Batch[] = batches.map((b) => {
      const make = (prog: WebGLProgram) => {
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        const attr = (name: string, data: Float32Array, size: number) => {
          const loc = gl.getAttribLocation(prog, name);
          if (loc < 0) return;
          const buf = gl.createBuffer()!;
          buffers.push(buf);
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        };
        attr('aPosition', b.positions, 3);
        attr('aNormal', b.normals, 3);
        attr('aUV', b.uvs, 2);
        const ib = gl.createBuffer()!;
        buffers.push(ib);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
        return vao;
      };
      const m = scene.materials[b.material];
      const batch: Batch = { vao: make(this.prog), depthVao: make(this.depthProg), count: b.indices.length, material: m, texture: null, mrTexture: null, normalTexture: null };
      const load = (img: Blob | undefined, slot: 'texture' | 'mrTexture' | 'normalTexture') => {
        if (!img) return;
        pending.push(createImageBitmap(img, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).then((bmp) => {
          const t = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          bmp.close();
          batch[slot] = t;
        }));
      };
      load(m.image, 'texture');
      load(m.mrImage, 'mrTexture');
      load(m.normalImage, 'normalTexture');
      return batch;
    });
    return {
      batches: out, min, max, ready: Promise.all(pending).then(() => undefined),
      dispose: () => {
        for (const b of out) {
          gl.deleteVertexArray(b.vao);
          gl.deleteVertexArray(b.depthVao);
          for (const t of [b.texture, b.mrTexture, b.normalTexture]) if (t) gl.deleteTexture(t);
        }
        buffers.forEach((x) => gl.deleteBuffer(x));
      },
    };
  }

  /** Draws models (each with its own model matrix) seen from eye -> target */
  render(items: { model: Model; matrix: Float32Array }[], eye: V3, target: V3, proj: Float32Array, width: number, height: number) {
    const gl = this.gl;
    // Shadow map from the key light, fitted around everything drawn
    let r = 4;
    for (const it of items) r = Math.max(r, Math.abs(it.matrix[12]) + 4, Math.abs(it.matrix[14]) + 4);
    const centre: V3 = [0, 2.5, 0];
    const lightPos: V3 = [centre[0] + this.keyDir[0] * 30, centre[1] + this.keyDir[1] * 30, centre[2] + this.keyDir[2] * 30];
    const lightVP = multiply(ortho(-r, r, -r, r, 1, 60), lookAt(lightPos, centre, [0, 1, 0]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(false, false, false, false);
    gl.useProgram(this.depthProg);
    this.ud.m4('uView', lightVP);
    this.ud.m4('uProj', new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    this.ud.m4('uLightVP', lightVP);
    for (const it of items) {
      this.ud.m4('uModel', it.matrix);
      for (const b of it.model.batches) { gl.bindVertexArray(b.depthVao); gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0); }
    }
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, width, height);
    gl.clearColor(this.bg[0] ** (1 / 2.2), this.bg[1] ** (1 / 2.2), this.bg[2] ** (1 / 2.2), 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const u = this.u;
    gl.useProgram(this.prog);
    u.m4('uView', lookAt(eye, target, [0, 1, 0]));
    u.m4('uProj', proj);
    u.m4('uLightVP', lightVP);
    u.v3('uCamPos', eye);
    u.v3('uKeyDir', this.keyDir);
    u.v3('uKeyColor', [2.6, 2.45, 2.25]);
    u.v3('uFillDir', norm([-0.7, 0.35, 0.5]));
    u.v3('uFillColor', [0.42, 0.48, 0.62]);
    u.v3('uRimDir', norm([-0.2, 0.5, -1]));
    u.v3('uRimColor', [1.1, 1.05, 1.2]);
    u.v3('uSkyColor', srgb(0.62, 0.66, 0.74));
    u.v3('uGroundColor', srgb(0.22, 0.2, 0.2));
    u.v3('uBgColor', this.bg);
    u.f('uShadowTexel', 1 / SHADOW);
    u.i('uTex', 0);
    u.i('uShadow', 1);
    u.i('uMRTex', 2);
    u.i('uNormalTex', 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    const draw = (model: Model, matrix: Float32Array, ground: boolean) => {
      u.m4('uModel', matrix);
      u.i('uGround', ground ? 1 : 0);
      for (const b of model.batches) {
        const m = b.material;
        gl.uniform4f(gl.getUniformLocation(this.prog, 'uColor'), m.color[0], m.color[1], m.color[2], m.color[3]);
        u.f('uMetallic', m.metallic);
        u.f('uRoughness', m.roughness);
        u.v3('uEmissive', m.emissive);
        u.i('uHasTex', b.texture ? 1 : 0);
        u.i('uHasMR', b.mrTexture ? 1 : 0);
        u.i('uHasNormal', b.normalTexture ? 1 : 0);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, b.mrTexture);
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, b.normalTexture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, b.texture);
        gl.bindVertexArray(b.vao);
        gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
      }
    };
    draw(this.floor, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), true);
    for (const it of items) draw(it.model, it.matrix, false);
    gl.bindVertexArray(null);
  }
}
