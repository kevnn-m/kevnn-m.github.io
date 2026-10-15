// Effects layer (art pixels): whole pages that blow off the paper stack when
// a gust passes, and fireflies at night.
//
// A page is a flat sheet turned in 3D (seen straight on, no perspective) that
// bends and flutters as it flies. Each frame it is drawn pixel by pixel: its
// surface is sampled densely and each sample lands in a pixel (nearest one
// wins), then the pixels are shaded from the surface normal, lined with text
// on the front, and outlined where the page ends or folds over.
import { pick, ramp, type Ramp } from './pixel';
import { gust, rng } from './wind';

/** Where pages start: the top sheet of the stack, in art px. */
export interface PageSource {
  x: number; // center
  y: number;
  w: number; // page size
  d: number;
  roll: number; // turn in the screen plane (rad)
}

/** The drawing shows a flat sheet at 0.42 of its depth, so a page on the stack is turned this far from facing us. */
const FLAT = Math.acos(0.42);
/** Sunlight from the upper left, toward us (x right, y down, z toward the viewer). */
const LIGHT = (() => { const v = [-0.5, -0.7, 0.5]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const STEP = 0.45; // sample spacing on the page (art px); below 0.5 so no pixel is missed
const MAX_PAGES = 2;
const MAX_BEND = 0.34; // largest curl and twist (see update), for the size of the drawing box
const MAX_TWIST = 0.25;

// The text shows faintly through from the back of the page.
const DAY = { paper: ramp('#b8a98e', '#dcd2bd', '#f0e9da', '#fffdf7'), edge: ramp('#6f5c44')[0], text: ramp('#8ea3c4')[0], through: ramp('#d5d6d6')[0] };
// At night the drawing is shown at 0.6 brightness (see HomeScene.astro); match it.
const dim = (r: Ramp): Ramp => r.map((c) => c.map((v) => Math.round(v * 0.6)) as Ramp[number]);
const NIGHT = { paper: dim(DAY.paper), edge: dim([DAY.edge])[0], text: dim([DAY.text])[0], through: dim([DAY.through])[0] };

interface Page {
  x: number; y: number; vx: number; vy: number; // center and speed, art px
  w: number; d: number;
  turn: number; // spin in the page's own plane (rad)
  pitch: number; // tip toward or away from us; FLAT = lying flat
  roll: number; // turn in the screen plane
  spin: number; // tumble speed (rad/s)
  twirl: number; // turn speed (rad/s)
  age: number;
  seed: number;
  bend: number; // current curl along the width, and twist (fractions of the size)
  twist: number;
}
interface Fly { x: number; y: number; p: number; speed: number }

export class Flyers {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private px = 1;
  private pages: Page[] = [];
  private flies: Fly[] = [];
  private cooldown = 2;
  private r = rng(51);
  private scratch = document.createElement('canvas');
  private sctx = this.scratch.getContext('2d')!;
  // Per-pixel buffers for drawing one page, reused between frames.
  private depth = new Float32Array(0);
  private us = new Float32Array(0);
  private vs = new Float32Array(0);
  private face = new Int8Array(0); // 0 empty, 1 front, -1 back
  private img: ImageData | null = null;
  private N = [0, 0, 0]; // a surface normal, reused
  night = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** W, H in art px; px = CSS px per art px. */
  resize(W: number, H: number, px: number) {
    Object.assign(this, { W, H, px });
    this.canvas.width = W;
    this.canvas.height = H;
    const r = rng(61);
    this.flies = Array.from({ length: Math.max(6, Math.round(W / 24)) }, () => ({
      x: r() * W, y: H * (0.5 + r() * 0.45), p: r() * 100, speed: 0.3 + r() * 0.5,
    }));
  }

  private wind(x: number, y: number, t: number) {
    return gust(x * this.px, y * this.px, t);
  }

  /**
   * Advance and draw one frame.
   * @param src the top sheet of the stack (art px), or null to start no new pages
   */
  update(t: number, dt: number, src: PageSource | null) {
    const { ctx, W, H, r } = this;
    ctx.clearRect(0, 0, W, H);

    // A new page: only during a gust at the stack, some seconds apart, a few in the air at most.
    this.cooldown -= dt;
    if (src && this.cooldown <= 0 && this.pages.length < MAX_PAGES && this.wind(src.x, src.y, t) > 0.55) {
      this.pages.push({
        x: src.x, y: src.y, vx: 4 + r() * 6, vy: -(18 + r() * 8), w: src.w, d: src.d,
        turn: 0, pitch: FLAT, roll: src.roll, spin: (r() < 0.5 ? -1 : 1) * (1.4 + r() * 1.8), twirl: (r() - 0.5) * 1.2,
        age: 0, seed: r(), bend: 0, twist: 0,
      });
      this.cooldown = 8 + r() * 6;
    }

    for (const p of this.pages) {
      const g = this.wind(p.x, p.y, t);
      // Carried along by the wind, lifted by gusts, sinking slowly between them.
      p.vx += (12 + g * 60 - p.vx) * Math.min(1, dt * 0.9);
      p.vy += (5 - g * 18 + Math.sin(p.age * 2.6 + p.seed * 7) * 10) * dt;
      p.vy = Math.max(-35, Math.min(22, p.vy * Math.exp(-0.5 * dt)));
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
      // Tumbles faster in a gust; flutters (curls and twists) all the time. The
      // flutter grows in over the first second, so the page leaves the stack flat.
      const grow = Math.min(1, p.age);
      p.pitch += p.spin * dt * (0.5 + g);
      p.turn += p.twirl * dt;
      p.roll += Math.sin(p.age * 1.3 + p.seed * 6) * 0.4 * dt;
      p.bend = grow * (0.22 * Math.sin(p.age * 4.2 + p.seed * 9) + 0.12 * g);
      p.twist = grow * 0.25 * Math.sin(p.age * 3.1 + p.seed * 5);
      this.drawPage(p);
    }
    const out = (p: Page) => p.w + p.d;
    this.pages = this.pages.filter((p) => p.x < W + out(p) && p.y > -out(p) && p.y < H + out(p));

    if (this.night) {
      for (const f of this.flies) {
        const x = Math.round(f.x + Math.sin(t * f.speed + f.p) * 10 + Math.sin(t * 0.13 + f.p) * 20);
        const y = Math.round(f.y + Math.cos(t * f.speed * 1.3 + f.p) * 6);
        const glow = 0.5 + 0.5 * Math.sin(t * 2.2 + f.p * 3);
        if (glow < 0.15) continue;
        if (glow > 0.45) {
          ctx.fillStyle = 'rgba(255, 236, 140, 0.35)';
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
        ctx.fillStyle = glow > 0.6 ? '#fff6b0' : '#d9c96a';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /** Draw one page into its bounding box, then onto the layer. */
  private drawPage(p: Page) {
    const hw = p.w / 2, hd = p.d / 2;
    // Turning keeps lengths, so no point of the page is farther from its center than this.
    const R = Math.ceil(Math.hypot(hw, hd, MAX_BEND * hw + MAX_TWIST * hd)) + 1;
    const B = 2 * R + 1; // the box is B x B pixels, centered on the page
    const n = B * B;
    if (this.depth.length < n) {
      this.depth = new Float32Array(n);
      this.us = new Float32Array(n);
      this.vs = new Float32Array(n);
      this.face = new Int8Array(n);
    }
    const { depth, us, vs, face } = this;
    face.fill(0, 0, n);
    depth.fill(-Infinity, 0, n);

    const ct = Math.cos(p.turn), st = Math.sin(p.turn);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
    const x0 = Math.round(p.x) - R, y0 = Math.round(p.y) - R;
    const ox = p.x - x0, oy = p.y - y0;
    // Page point (u, v) with its curl z, turned in its plane, tipped, then rolled.
    const z = (s: number, q: number) => p.bend * hw * (s * s - 1 / 3) + p.twist * hd * s * q;
    for (let u = -hw; u <= hw; u += STEP) {
      const s = u / hw;
      for (let v = -hd; v <= hd; v += STEP) {
        const zz = z(s, v / hd);
        const u1 = u * ct - v * st, v1 = u * st + v * ct;
        const Y = v1 * cp - zz * sp, Z = v1 * sp + zz * cp;
        const i = Math.floor(oy + u1 * sr + Y * cr) * B + Math.floor(ox + u1 * cr - Y * sr);
        if (i < 0 || i >= n || Z <= depth[i]) continue;
        depth[i] = Z;
        us[i] = u;
        vs[i] = v;
        face[i] = 1; // which side shows is decided below, from the normal
      }
    }

    const pal = this.night ? NIGHT : DAY;
    if (this.img?.width !== B) this.img = this.sctx.createImageData(B, B);
    const img = this.img;
    const data = img.data;
    data.fill(0);
    const set = (i: number, c: readonly number[]) => { data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255; };
    // Surface normal at (u, v), turned like the page: from the slopes of the curl.
    const N = this.N;
    const normal = (u: number, v: number) => {
      const s = u / hw, q = v / hd;
      const nx = -(2 * p.bend * s + p.twist * q * (hd / hw)), ny = -p.twist * s, nz = 1;
      const u1 = nx * ct - ny * st, v1 = nx * st + ny * ct;
      const Y = v1 * cp - nz * sp, Z = v1 * sp + nz * cp;
      const X2 = u1 * cr - Y * sr, Y2 = u1 * sr + Y * cr;
      const l = Math.hypot(X2, Y2, Z);
      N[0] = X2 / l; N[1] = Y2 / l; N[2] = Z / l;
    };
    for (let i = 0; i < n; i++) {
      if (!face[i]) continue;
      normal(us[i], vs[i]);
      face[i] = N[2] >= 0 ? 1 : -1;
    }
    // Text: a few lines across the front, like the top sheet of the stack.
    const LENS = [0.75, 1, 0.92, 0.55], margin = p.w * 0.12;
    const lineAt = (u: number, v: number) => {
      const k = ((v + hd - margin) / (p.d - 2 * margin)) * (LENS.length - 1);
      const row = Math.round(k);
      if (row < 0 || row >= LENS.length || Math.abs(k - row) > 0.22) return false;
      return u > -hw + margin && u < -hw + margin + (p.w - 2 * margin) * LENS[row];
    };
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const i = y * B + x, f = face[i];
        if (!f) continue;
        // Outline where the page ends or folds over to its other side.
        const edge = x === 0 || y === 0 || x === B - 1 || y === B - 1
          || face[i - 1] !== f || face[i + 1] !== f || face[i - B] !== f || face[i + B] !== f;
        if (edge) { set(i, pal.edge); continue; }
        normal(us[i], vs[i]);
        const lit = Math.max(0, f * (N[0] * LIGHT[0] + N[1] * LIGHT[1] + N[2] * LIGHT[2]));
        if (Math.abs(N[2]) > 0.3 && lineAt(us[i], vs[i])) { set(i, f > 0 ? pal.text : pal.through); continue; }
        set(i, pick(pal.paper, (f > 0 ? 0.5 : 0.38) + 0.6 * lit, x0 + x, y0 + y));
      }
    }
    if (this.scratch.width < B || this.scratch.height < B) {
      this.scratch.width = Math.max(this.scratch.width, B);
      this.scratch.height = Math.max(this.scratch.height, B);
    }
    this.sctx.putImageData(img, 0, 0);
    this.ctx.drawImage(this.scratch, 0, 0, B, B, x0, y0, B, B);
  }
}
