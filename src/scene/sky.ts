// Sky layer, drawn in art pixels: a dithered gradient with faint painted
// streaks, sun glow, cumulus clouds lit like clusters of spheres; at night,
// a crescent moon with a dithered halo and twinkling stars.
import type { ScenePalette } from './palette';
import { fbm, noise2, pick, pixelCanvas, put, ramp, bayer, type RGB } from './pixel';
import { rng } from './wind';

interface Cloud { img: HTMLCanvasElement; x: number; y: number; speed: number }
interface Star { x: number; y: number; p: number; big: boolean }

const MOON = ramp('#cfc79a', '#ece5bd', '#fbf6dc');
// Sunlight comes from the upper left.
const L = (() => { const v = [-0.45, -0.75, 0.5]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

/** One cumulus cloud: puffs shaded as spheres, snapped to the cloud ramp. */
function paintCloud(w: number, h: number, seed: number, pal: ScenePalette) {
  const r = rng(seed);
  const n = noise2(seed);
  const puffs: { x: number; y: number; r: number }[] = [];
  const tower = 0.3 + r() * 0.4;
  for (let i = 0; i < 18; i++) {
    const u = r();
    const top = Math.exp(-(((u - tower) / 0.2) ** 2));
    const pr = h * (0.16 + 0.12 * r() + 0.16 * top);
    puffs.push({ x: w * (0.14 + 0.72 * u), y: h * 0.78 - pr * 0.5 - top * h * 0.28 * r(), r: pr });
  }
  for (let i = 0; i < 10; i++) puffs.push({ x: w * (0.15 + 0.7 * (i / 9)), y: h * 0.78, r: h * 0.17 });

  const { canvas, ctx, img } = pixelCanvas(Math.ceil(w), Math.ceil(h));
  const base = h * 0.86;
  for (let y = 0; y < canvas.height; y++) {
    if (y > base) break;
    for (let x = 0; x < canvas.width; x++) {
      let best = -1, bp = puffs[0], bd = 2;
      const wob = (n(x * 0.22, y * 0.22) - 0.5) * 0.22;
      for (const p of puffs) {
        const d = Math.hypot(x - p.x, y - p.y) / p.r + wob;
        if (d < 1) {
          const hgt = Math.sqrt(1 - d * d) * p.r;
          if (hgt > best) { best = hgt; bp = p; bd = d; }
        }
      }
      if (best < 0) continue;
      // soft, dithered rim
      if (bd > 0.9 && bayer(x, y) < (bd - 0.9) / 0.1) continue;
      const nx = (x - bp.x) / bp.r, ny = (y - bp.y) / bp.r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      let v = 0.12 + 0.88 * lam;
      v -= Math.max(0, Math.min(1, (y / h - 0.5) / 0.4)) * 0.3; // darker underneath
      v += (fbm(n, x * 0.15, y * 0.15, 2) - 0.5) * 0.12; // painted texture
      put(img, x, y, pick(pal.cloud, v, x, y));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export class Sky {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private pal!: ScenePalette;
  private bg?: HTMLCanvasElement;
  private moon?: { img: HTMLCanvasElement; x: number; y: number };
  private clouds: Cloud[] = [];
  private stars: Star[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Sizes are in art pixels. */
  resize(W: number, H: number, pal: ScenePalette) {
    Object.assign(this, { W, H, pal });
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this.bg = this.paintBackground();
    const r = rng(11);
    const count = Math.max(3, Math.round(W / 110));
    this.clouds = Array.from({ length: count }, (_, i) => {
      const big = i === 1;
      const w = Math.round((big ? 0.3 : 0.14 + r() * 0.1) * Math.max(W, 240));
      const h = Math.round(w * (big ? 0.6 : 0.42));
      return {
        img: paintCloud(w, h, 100 + i * 17, pal),
        x: (i / count) * (W + w) - w * 0.3 + r() * 30,
        y: Math.round(H * (big ? 0.0 : 0.03 + r() * 0.18)),
        speed: 1 + r() * 1.8,
      };
    });
    this.stars = Array.from({ length: Math.round((W * H) / 900) }, () => ({
      x: Math.floor(r() * W), y: Math.floor(r() * H * 0.55), p: r() * 6.28, big: r() < 0.08,
    }));
  }

  private paintBackground() {
    const { W, H, pal } = this;
    const { canvas, ctx, img } = pixelCanvas(W, H);
    const n = noise2(5);
    const horizon = H * 0.62;
    const mx = W * 0.82, my = H * 0.13, R = Math.max(6, Math.round(Math.min(W, H) * 0.06));
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = Math.min(1, y / horizon) ** 0.9;
        v += (fbm(n, x * 0.006, y * 0.05, 2) - 0.5) * 0.05; // faint painted streaks
        if (!pal.night) {
          const d = Math.hypot(x - W * 0.06, y + H * 0.15) / Math.max(W, H);
          v += Math.max(0, 0.75 - d) * 0.3; // sun glow, upper left
        } else {
          const d = Math.hypot(x - mx, y - my) / (R * 3.2);
          v += Math.max(0, 1 - d) * 0.45; // moon halo
        }
        put(img, x, y, pick(pal.sky, v, x, y));
      }
    }
    ctx.putImageData(img, 0, 0);
    this.moon = undefined;
    if (pal.night) {
      // Crescent: a disc with an offset disc cut out, lit from the right.
      const size = R * 2 + 3;
      const m = pixelCanvas(size, size);
      const c = size / 2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          const cut = Math.hypot(x + 0.5 - (c - R * 0.55), y + 0.5 - (c - R * 0.18)) < R * 0.86;
          if (d <= R && !cut) put(m.img, x, y, pick(MOON, 0.3 + 0.7 * ((x - (c - R)) / (R * 2)), x, y));
        }
      }
      m.ctx.putImageData(m.img, 0, 0);
      this.moon = { img: m.canvas, x: Math.round(mx - c), y: Math.round(my - c) };
    }
    return canvas;
  }

  draw(t: number) {
    const { ctx, W, pal } = this;
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    if (pal.night) {
      for (const s of this.stars) {
        const tw = Math.sin(t * 1.6 + s.p);
        if (tw < -0.6) continue;
        const c: RGB = tw > 0.5 ? [255, 255, 255] : [168, 182, 220];
        ctx.fillStyle = `rgb(${c})`;
        ctx.fillRect(s.x, s.y, 1, 1);
        if (s.big && tw > 0.2) {
          ctx.fillStyle = 'rgb(120, 136, 186)';
          ctx.fillRect(s.x - 1, s.y, 1, 1);
          ctx.fillRect(s.x + 1, s.y, 1, 1);
          ctx.fillRect(s.x, s.y - 1, 1, 1);
          ctx.fillRect(s.x, s.y + 1, 1, 1);
        }
      }
    }
    for (const c of this.clouds) {
      const w = c.img.width;
      const span = W + w + 20;
      const x = Math.round(((((c.x + t * c.speed) % span) + span) % span) - w - 10);
      ctx.drawImage(c.img, x, c.y);
    }
    if (this.moon) ctx.drawImage(this.moon.img, this.moon.x, this.moon.y);
  }
}
