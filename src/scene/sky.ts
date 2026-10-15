// Sky layer, drawn in art pixels: a gradient with faint painted streaks and
// sun glow, flat Ghibli-style cumulus clouds that drift; at night, twinkling
// stars and a crescent moon that hides behind passing clouds but still glows.
import type { ScenePalette } from './palette';
import { fbm, noise2, pick, pixelCanvas, put, ramp, type RGB } from './pixel';
import { rng } from './wind';

interface Cloud { img: HTMLCanvasElement; x: number; y: number; speed: number }
interface Star { x: number; y: number; p: number; big: boolean }

const MOON = ramp('#cfc79a', '#ece5bd', '#fbf6dc');

/**
 * One cumulus cloud in a flat, painted style: mostly white, with a few soft
 * tones that follow each puff (a pale shade on its lower side, a blue-gray
 * underside, warm light on the tops), with edges that wander like brush
 * strokes. `tall` makes a towering cumulus.
 */
function paintCloud(w: number, h: number, seed: number, pal: ScenePalette, tall: boolean) {
  const r = rng(seed);
  const n = noise2(seed);
  const puffs: { x: number; y: number; r: number; base?: boolean }[] = [];
  const tower = 0.35 + r() * 0.3;
  const count = tall ? 26 : 14;
  for (let i = 0; i < count; i++) {
    const u = r();
    const top = Math.exp(-(((u - tower) / (tall ? 0.18 : 0.24)) ** 2));
    const pr = h * (tall ? 0.1 + 0.08 * r() + 0.1 * top : 0.17 + 0.1 * r() + 0.14 * top);
    const lift = tall ? top * h * (0.1 + 0.35 * r()) : top * h * 0.25 * r();
    puffs.push({ x: w * (0.12 + 0.76 * u), y: h * 0.8 - pr * 0.6 - lift, r: pr });
  }
  // a flat base under the puffs
  for (let i = 0; i < 12; i++) puffs.push({ x: w * (0.14 + 0.72 * (i / 11)), y: h * 0.8, r: h * (tall ? 0.11 : 0.17), base: true });
  // Make room above for puffs that rise past the top (the canvas grows upward).
  const extra = Math.max(0, Math.ceil(-Math.min(...puffs.map((p) => p.y - p.r * 1.15))));
  for (const p of puffs) p.y += extra;
  const oh = h; // the original height: bands below are measured from the bottom
  h += extra;

  const { canvas, ctx, img } = pixelCanvas(Math.ceil(w), Math.ceil(h));
  const base = h - oh * 0.1;
  for (let y = 0; y < canvas.height && y <= base; y++) {
    for (let x = 0; x < canvas.width; x++) {
      let best = -1, bp = puffs[0], bd = 2;
      const wob = (n(x * 0.12, y * 0.12) - 0.5) * 0.16;
      for (const p of puffs) {
        // cheap box test first; most puffs are far from this pixel
        const dx = x - p.x, dy = y - p.y, lim = p.r * (1 - wob);
        if (Math.abs(dx) >= lim || Math.abs(dy) >= lim || dx * dx + dy * dy >= lim * lim) continue;
        const d = Math.sqrt(dx * dx + dy * dy) / p.r + wob;
        if (1 - d > best) { best = 1 - d; bp = p; bd = d; }
      }
      if (best < 0) continue;
      const brush = n(x * 0.06 + 7, y * 0.06) - 0.5; // wavy tone edges
      // position inside this puff: lit from the upper left, shaded lower right
      const lx = (x - bp.x) / bp.r, ly = (y - bp.y) / bp.r;
      const side = ly * 0.85 + lx * 0.35;
      const under = (y - (h - oh * 0.38)) / (oh * 0.3); // 0..1 across the cloud's underside
      let tone = 3;
      if (!bp.base) {
        if (side > 0.42 + brush * 0.5) tone = 2;
        if (under > 0.35 + brush * 0.6 && side > 0.1 + brush * 0.4) tone = 1;
        if (side < -0.55 + brush * 0.3) tone = 4;
      } else if (under > 0.3 + brush * 0.5) {
        tone = 2;
      }
      if (under > 0.72 + brush * 0.4) tone = Math.min(tone, 1);
      put(img, x, y, pal.cloud[tone], bd > 0.93 ? 150 : 255); // soft outer edge
    }
  }
  ctx.putImageData(img, 0, 0);
  return { img: canvas, extra };
}

export class Sky {
  private ctx: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private pal!: ScenePalette;
  private bg?: HTMLCanvasElement;
  private moon?: { img: HTMLCanvasElement; glow: HTMLCanvasElement; x: number; y: number; gx: number; gy: number };
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
    // One big cumulus rising from behind the hills on the left, plus smaller
    // clouds at different heights.
    const big = Math.round(Math.max(W, 240) * 0.3);
    // It sits above the valley, between our hillside and the far mountains.
    const tower = paintCloud(big, Math.round(big * 0.72), 101, pal, true);
    const clouds: Cloud[] = [{
      img: tower.img, x: W * 0.4, y: Math.round(H * 0.46 - big * 0.72 * 0.88) - tower.extra, speed: 0.5,
    }];
    const count = Math.max(3, Math.round(W / 150));
    for (let i = 0; i < count; i++) {
      const w = Math.round((0.1 + r() * 0.12) * Math.max(W, 240));
      const c = paintCloud(w, Math.round(w * (0.42 + r() * 0.12)), 120 + i * 17, pal, false);
      clouds.push({
        img: c.img,
        x: ((i + 0.5) / count) * W + (r() - 0.5) * W * 0.12,
        y: Math.round(H * (0.02 + r() * 0.26)) - c.extra,
        speed: 1 + r() * 1.6,
      });
    }
    this.clouds = clouds;
    this.stars = Array.from({ length: Math.round((W * H) / 900) }, () => ({
      x: Math.floor(r() * W), y: Math.floor(r() * H * 0.55), p: r() * 6.28, big: r() < 0.08,
    }));
  }

  private paintBackground() {
    const { W, H, pal } = this;
    const { canvas, ctx, img } = pixelCanvas(W, H);
    const n = noise2(5);
    const horizon = H * 0.62;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = Math.min(1, y / horizon) ** 0.9;
        v += (fbm(n, x * 0.006, y * 0.05, 2) - 0.5) * 0.05; // faint painted streaks
        if (!pal.night) {
          const d = Math.hypot(x - W * 0.06, y + H * 0.15) / Math.max(W, H);
          v += Math.max(0, 0.75 - d) * 0.3; // sun glow, upper left
        }
        put(img, x, y, pick(pal.sky, v, x, y));
      }
    }
    ctx.putImageData(img, 0, 0);

    this.moon = undefined;
    if (pal.night) {
      const mx = W * 0.82, my = H * 0.13, R = Math.max(6, Math.round(Math.min(W, H) * 0.06));
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
      // The halo is drawn over the clouds, so a cloud passing in front still glows.
      const gs = R * 9;
      const glow = document.createElement('canvas');
      glow.width = glow.height = gs;
      const g = glow.getContext('2d')!;
      const grad = g.createRadialGradient(gs / 2, gs / 2, R * 0.6, gs / 2, gs / 2, gs / 2);
      grad.addColorStop(0, pal.moonGlow);
      grad.addColorStop(1, 'rgba(255, 244, 200, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, gs, gs);
      this.moon = { img: m.canvas, glow, x: Math.round(mx - c), y: Math.round(my - c), gx: Math.round(mx - gs / 2), gy: Math.round(my - gs / 2) };
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
    if (this.moon) ctx.drawImage(this.moon.img, this.moon.x, this.moon.y);
    for (const c of this.clouds) {
      const w = c.img.width;
      const span = W + w + 20;
      const x = Math.round(((((c.x + t * c.speed) % span) + span) % span) - w - 10);
      ctx.drawImage(c.img, x, c.y);
    }
    if (this.moon) {
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(this.moon.glow, this.moon.gx, this.moon.gy);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}
