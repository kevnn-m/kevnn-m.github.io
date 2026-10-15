// Grass blades drawn with WebGL2 (one draw call, one instance per blade).
// Each blade bends with the shared wind model and turns lighter where a gust
// passes, so you can see waves of wind roll across the field.
// Without WebGL2 the blades are drawn once with Canvas 2D (a still image).
import type { RGB } from './palette';
import { GUST_GLSL, gust } from './wind';

/** Per blade: root x, root y (CSS px), height, width, seed 0..1, depth 0..1 (far..near). */
export const BLADE_FLOATS = 6;

const SEGMENTS = 6;

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;    // x: -1..1 across the blade, y: 0..1 along it
in vec4 aRoot;   // x, y, height, width
in vec2 aSeed;   // seed, depth
uniform vec2 uRes;
uniform float uTime;
uniform float uGust;
out float vT;
out float vGust;
out float vSeed;
out float vDepth;
${GUST_GLSL}
void main() {
  float t = aPos.y;
  float seed = aSeed.x;
  float g = gust(aRoot.xy, uTime);
  float sway = sin(uTime * 1.3 + aRoot.x * 0.012 + seed * 6.283) * 0.16
             + sin(uTime * 2.3 + seed * 12.0) * 0.05;
  float bend = 0.18 + (seed - 0.5) * 0.5 + sway + g * uGust;
  float h = aRoot.z;
  float x = aRoot.x + bend * h * pow(t, 1.7) * 0.7 + aPos.x * aRoot.w * 0.5 * (1.0 - t * 0.94);
  float y = aRoot.y - h * t * (1.0 - 0.2 * bend * bend * t);
  gl_Position = vec4(x / uRes.x * 2.0 - 1.0, 1.0 - y / uRes.y * 2.0, 0.0, 1.0);
  vT = t; vGust = g; vSeed = seed; vDepth = aSeed.y;
}`;

const FRAG = /* glsl */ `#version 300 es
precision mediump float;
in float vT;
in float vGust;
in float vSeed;
in float vDepth;
uniform vec3 uBase;
uniform vec3 uTip;
uniform vec3 uGustColor;
uniform vec3 uFar;
out vec4 outColor;
void main() {
  vec3 c = mix(uBase, uTip, smoothstep(0.0, 1.0, vT));
  c *= 0.82 + 0.32 * vSeed;
  c = mix(c, uGustColor, vGust * vT * 0.6);
  c = mix(c, uFar, (1.0 - vDepth) * 0.45);
  outColor = vec4(c, 1.0);
}`;

export interface GrassColors { base: RGB; tip: RGB; gust: RGB; far: RGB }

export interface GrassRenderer {
  readonly webgl: boolean;
  setBlades(data: Float32Array): void;
  resize(W: number, H: number, dpr: number): void;
  draw(t: number, colors: GrassColors, gustStrength: number): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

class WebGLGrass implements GrassRenderer {
  readonly webgl = true;
  private prog: WebGLProgram;
  private inst: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private count = 0;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private W = 1;
  private H = 1;

  constructor(private canvas: HTMLCanvasElement, private gl: WebGL2RenderingContext) {
    const prog = (this.prog = gl.createProgram()!);
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    for (const n of ['uRes', 'uTime', 'uGust', 'uBase', 'uTip', 'uGustColor', 'uFar']) this.u[n] = gl.getUniformLocation(prog, n);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    // One blade: a triangle strip, two vertices per row.
    const shape: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) shape.push(-1, i / SEGMENTS, 1, i / SEGMENTS);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shape), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    const stride = BLADE_FLOATS * 4;
    const aRoot = gl.getAttribLocation(prog, 'aRoot');
    gl.enableVertexAttribArray(aRoot);
    gl.vertexAttribPointer(aRoot, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(aRoot, 1);
    const aSeed = gl.getAttribLocation(prog, 'aSeed');
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 2, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(aSeed, 1);
    gl.bindVertexArray(null);
  }

  setBlades(data: Float32Array) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / BLADE_FLOATS;
  }

  resize(W: number, H: number, dpr: number) {
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(t: number, c: GrassColors, gustStrength: number) {
    const { gl, u } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uRes, this.W, this.H);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uGust, gustStrength);
    gl.uniform3fv(u.uBase, c.base);
    gl.uniform3fv(u.uTip, c.tip);
    gl.uniform3fv(u.uGustColor, c.gust);
    gl.uniform3fv(u.uFar, c.far);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, this.count);
    gl.bindVertexArray(null);
  }
}

/** Fallback: the same blades as simple 2D strokes. */
class CanvasGrass implements GrassRenderer {
  readonly webgl = false;
  private data: Float32Array = new Float32Array(0);
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private dpr = 1;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }
  setBlades(data: Float32Array) { this.data = data; }
  resize(W: number, H: number, dpr: number) {
    Object.assign(this, { W, H, dpr });
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
  }
  draw(t: number, c: GrassColors, gustStrength: number) {
    const { ctx, data } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const lerp = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as RGB;
    ctx.lineCap = 'round';
    for (let i = 0; i < data.length; i += BLADE_FLOATS) {
      const [x, y, h, w, seed, depth] = data.subarray(i, i + BLADE_FLOATS);
      const bend = 0.18 + (seed - 0.5) * 0.5 + gust(x, y, t) * gustStrength;
      const col = lerp(lerp(c.base, c.tip, 0.6), c.far, (1 - depth) * 0.45);
      ctx.strokeStyle = `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`;
      ctx.lineWidth = w * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x, y - h * 0.6, x + bend * h * 0.7, y - h);
      ctx.stroke();
    }
  }
}

export function createGrass(canvas: HTMLCanvasElement): GrassRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return new CanvasGrass(canvas);
  try {
    return new WebGLGrass(canvas, gl);
  } catch (e) {
    console.warn('Grass: WebGL setup failed, using a still image.', e);
    // A canvas that has a WebGL context can't give a 2D one, so use a new canvas.
    const fresh = canvas.cloneNode() as HTMLCanvasElement;
    canvas.replaceWith(fresh);
    return new CanvasGrass(fresh);
  }
}
