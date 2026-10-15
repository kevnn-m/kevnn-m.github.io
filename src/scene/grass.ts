// Grass blades drawn with WebGL2 (one draw call, one instance per blade) on a
// low-resolution canvas, so every blade is made of chunky art pixels. Colors
// are snapped to the grass ramp with ordered dithering. Each blade bends with
// the shared wind and turns lighter where a gust passes, so waves of wind roll
// across the hill. Without WebGL2 the blades are drawn once with Canvas 2D.
import type { Ramp } from './pixel';
import { GUST_GLSL, gust } from './wind';

/** Per blade, in art px: root x, root y, height, width, seed 0..1, depth 0..1 (far..near). */
export const BLADE_FLOATS = 6;

const SEGMENTS = 5;
const MAX_RAMP = 8;

const VERT = /* glsl */ `#version 300 es
in vec2 aPos;    // x: -1..1 across the blade, y: 0..1 along it
in vec4 aRoot;   // x, y, height, width (art px)
in vec2 aSeed;   // seed, depth
uniform vec2 uRes;
uniform float uTime;
uniform float uGust;
uniform float uPx;   // CSS px per art px (the wind is defined in CSS px)
out float vT;
out float vGust;
out float vSeed;
out float vDepth;
${GUST_GLSL}
void main() {
  float t = aPos.y;
  float seed = aSeed.x;
  float g = gust(aRoot.xy * uPx, uTime);
  float sway = sin(uTime * 1.3 + aRoot.x * uPx * 0.012 + seed * 6.283) * 0.16
             + sin(uTime * 2.3 + seed * 12.0) * 0.05;
  float bend = 0.2 + (seed - 0.5) * 0.5 + sway + g * uGust;
  float h = aRoot.z;
  float x = aRoot.x + bend * h * pow(t, 1.7) * 0.7 + aPos.x * aRoot.w * 0.5 * (1.0 - t * 0.85);
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
uniform vec3 uRamp[${MAX_RAMP}];
uniform int uRampN;
uniform vec3 uFlowers[3];
out vec4 outColor;
float bayer4(vec2 p) {
  const float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  ivec2 q = ivec2(mod(p, 4.0));
  return (m[q.y * 4 + q.x] + 0.5) / 16.0;
}
void main() {
  // A few blades carry a small flower at the tip.
  if (vSeed > 0.986 && vT > 0.78) {
    outColor = vec4(uFlowers[int(mod(vSeed * 1000.0, 3.0))], 1.0);
    return;
  }
  float v = mix(0.08, 0.78, vT) + (vSeed - 0.5) * 0.22 + vGust * vT * 0.5;
  v = mix(v, 0.62 + vT * 0.25, (1.0 - vDepth) * 0.55); // far grass is lighter, flatter
  float n = float(uRampN - 1);
  // dithered step between ramp colors (0.5 = narrow dithered zone, like DITHER in pixel.ts)
  int i = int(clamp(floor(v * n + 0.5 + (bayer4(gl_FragCoord.xy) - 0.5) * 0.5), 0.0, n));
  outColor = vec4(uRamp[i], 1.0);
}`;

export interface GrassColors { ramp: Ramp; flowers: Ramp }

export interface GrassRenderer {
  readonly webgl: boolean;
  setBlades(data: Float32Array): void;
  /** W, H in art px; px = CSS px per art px. */
  resize(W: number, H: number, px: number): void;
  draw(t: number, colors: GrassColors, gustStrength: number): void;
}

const flat = (r: Ramp, n: number) => {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = r[Math.min(i, r.length - 1)];
    out.set([c[0] / 255, c[1] / 255, c[2] / 255], i * 3);
  }
  return out;
};

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
  private px = 1;

  constructor(private canvas: HTMLCanvasElement, private gl: WebGL2RenderingContext) {
    const prog = (this.prog = gl.createProgram()!);
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link error');
    for (const n of ['uRes', 'uTime', 'uGust', 'uPx', 'uRamp', 'uRampN', 'uFlowers']) this.u[n] = gl.getUniformLocation(prog, n);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
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
    if (gl.isContextLost()) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.count = data.length / BLADE_FLOATS;
  }

  resize(W: number, H: number, px: number) {
    Object.assign(this, { W, H, px });
    this.canvas.width = W;
    this.canvas.height = H;
    this.gl.viewport(0, 0, W, H);
  }

  draw(t: number, c: GrassColors, gustStrength: number) {
    const { gl, u } = this;
    if (gl.isContextLost()) return; // wait for the restore event
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(u.uRes, this.W, this.H);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uGust, gustStrength);
    gl.uniform1f(u.uPx, this.px);
    gl.uniform3fv(u.uRamp, flat(c.ramp, MAX_RAMP));
    gl.uniform1i(u.uRampN, Math.min(MAX_RAMP, c.ramp.length));
    gl.uniform3fv(u.uFlowers, flat(c.flowers, 3));
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEGMENTS + 1) * 2, this.count);
    gl.bindVertexArray(null);
  }
}

/** Fallback: the same blades as simple 2D strokes, redrawn only when something changed. */
class CanvasGrass implements GrassRenderer {
  readonly webgl = false;
  private data: Float32Array = new Float32Array(0);
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private px = 1;
  private drawn = '';
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }
  setBlades(data: Float32Array) { this.data = data; this.drawn = ''; }
  resize(W: number, H: number, px: number) {
    Object.assign(this, { W, H, px });
    this.canvas.width = W;
    this.canvas.height = H;
    this.drawn = '';
  }
  draw(t: number, c: GrassColors, gustStrength: number) {
    const key = `${t}|${gustStrength}|${c.ramp[0]}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const { ctx, data } = this;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.lineCap = 'butt';
    for (let i = 0; i < data.length; i += BLADE_FLOATS) {
      const [x, y, h, w, seed, depth] = data.subarray(i, i + BLADE_FLOATS);
      const bend = 0.2 + (seed - 0.5) * 0.5 + gust(x * this.px, y * this.px, t) * gustStrength;
      const col = c.ramp[Math.min(c.ramp.length - 1, Math.round((0.35 + seed * 0.3 + (1 - depth) * 0.2) * (c.ramp.length - 1)))];
      ctx.strokeStyle = `rgb(${col})`;
      ctx.lineWidth = Math.max(1, w * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x, y - h * 0.6, x + bend * h * 0.7, y - h);
      ctx.stroke();
    }
  }
}

export function createGrass(canvas: HTMLCanvasElement): GrassRenderer {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true });
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
