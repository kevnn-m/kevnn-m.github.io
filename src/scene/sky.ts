// Sky layer: gradient, sun glow, soft cumulus clouds that drift; at night,
// stars and a crescent moon.
import type { ScenePalette } from './palette';
import { rng } from './wind';

interface Cloud { img: HTMLCanvasElement; pad: number; x: number; y: number; speed: number }
interface Star { x: number; y: number; r: number; p: number }

/**
 * Paint one cumulus cloud into its own canvas: a solid shape made of puffs,
 * shaded blue-gray underneath, lit on top, then softened with a slight blur.
 */
function paintCloud(w: number, h: number, seed: number, pal: ScenePalette, dpr: number) {
  const r = rng(seed);
  const puffs: { x: number; y: number; r: number }[] = [];
  const tower = 0.3 + r() * 0.4; // where the cloud is tallest
  for (let i = 0; i < 22; i++) {
    const u = r();
    const top = Math.exp(-(((u - tower) / 0.2) ** 2));
    const pr = h * (0.14 + 0.12 * r() + 0.16 * top);
    puffs.push({ x: w * (0.12 + 0.76 * u), y: h * 0.8 - pr * 0.55 - top * h * 0.3 * r(), r: pr });
  }
  const main = puffs.slice();
  // a flat base
  for (let i = 0; i < 6; i++) puffs.push({ x: w * (0.15 + 0.7 * (i / 5)), y: h * 0.8, r: h * 0.12 });

  const pad = h * 0.15;
  const cw = w + pad * 2, ch = h + pad * 2;
  const shape = document.createElement('canvas');
  shape.width = Math.ceil(cw * dpr);
  shape.height = Math.ceil(ch * dpr);
  const s = shape.getContext('2d')!;
  s.scale(dpr, dpr);
  s.translate(pad, pad);
  const disc = (x: number, y: number, rad: number) => { s.beginPath(); s.arc(x, y, rad, 0, Math.PI * 2); s.fill(); };
  // 1. silhouette
  s.fillStyle = pal.cloudShadow;
  for (const p of puffs) disc(p.x, p.y, p.r);
  s.fillRect(w * 0.15, h * 0.8 - 1, w * 0.7, h * 0.12);
  // 2. inside it: light at the top fading to shadow underneath
  s.globalCompositeOperation = 'source-atop';
  const shade = s.createLinearGradient(0, h * 0.25, 0, h * 0.86);
  shade.addColorStop(0, pal.cloudLight);
  shade.addColorStop(0.45, pal.cloudLight);
  shade.addColorStop(1, pal.cloudShadow);
  s.fillStyle = shade;
  s.fillRect(-pad, -pad, cw, ch);
  // 3. shadow pockets under each puff, then lit caps toward the sun (upper left)
  s.globalAlpha = 0.35;
  s.fillStyle = pal.cloudShadow;
  for (const p of main) disc(p.x + p.r * 0.2, p.y + p.r * 0.45, p.r * 0.75);
  s.globalAlpha = 0.9;
  s.fillStyle = pal.cloudLight;
  for (const p of main) disc(p.x - p.r * 0.2, p.y - p.r * 0.35, p.r * 0.7);
  s.globalAlpha = 1;
  // 4. a cut along the bottom
  s.globalCompositeOperation = 'destination-out';
  s.fillRect(-pad, h * 0.86, w + pad * 2, h);

  // Soften the edges a little (ignored where the browser lacks canvas filters).
  const out = document.createElement('canvas');
  out.width = shape.width;
  out.height = shape.height;
  const o = out.getContext('2d')!;
  o.filter = `blur(${(1.2 * dpr).toFixed(1)}px)`;
  o.drawImage(shape, 0, 0);
  return { img: out, pad };
}

export class Sky {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private pal!: ScenePalette;
  private clouds: Cloud[] = [];
  private stars: Star[] = [];
  private bg?: HTMLCanvasElement;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(W: number, H: number, dpr: number, pal: ScenePalette) {
    Object.assign(this, { W, H, dpr, pal });
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.paintBackground();
    const r = rng(11);
    const n = Math.max(3, Math.round(W / 320));
    this.clouds = Array.from({ length: n }, (_, i) => {
      const big = i === 1;
      const w = (big ? 0.32 : 0.16 + r() * 0.12) * Math.max(W, 700);
      const h = w * (big ? 0.62 : 0.42);
      return {
        ...paintCloud(w, h, 100 + i * 17, pal, dpr),
        x: (i / n) * (W + w) - w * 0.3 + r() * 80,
        y: H * (big ? 0.02 : 0.04 + r() * 0.22),
        speed: 3 + r() * 5,
      };
    });
    this.stars = Array.from({ length: Math.round((W * H) / 2600) }, () => ({
      x: r() * W, y: r() * H * 0.6, r: 0.4 + r() * 1.1, p: r() * 6.28,
    }));
  }

  /** The gradient, sun glow and moon don't move, so they are painted once. */
  private paintBackground() {
    const { W, H, dpr, pal } = this;
    const c = (this.bg ??= document.createElement('canvas'));
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyHorizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (pal.sunGlow) {
      const s = ctx.createRadialGradient(W * 0.08, -H * 0.1, 0, W * 0.08, -H * 0.1, Math.max(W, H) * 0.7);
      s.addColorStop(0, pal.sunGlow);
      s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, W, H);
    }
    if (pal.night) this.paintMoon(ctx);
  }

  private paintMoon(ctx: CanvasRenderingContext2D) {
    const { W, H } = this;
    const R = Math.max(14, Math.min(W, H) * 0.045);
    const mx = W * 0.82, my = H * 0.16;
    const glow = ctx.createRadialGradient(mx, my, R * 0.5, mx, my, R * 4);
    glow.addColorStop(0, 'rgba(240, 236, 200, 0.28)');
    glow.addColorStop(1, 'rgba(240, 236, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - R * 4, my - R * 4, R * 8, R * 8);
    // Crescent: a disc with an offset disc cut out, drawn on its own canvas.
    const m = document.createElement('canvas');
    const size = Math.ceil(R * 2 + 4);
    m.width = m.height = size * this.dpr;
    const mc = m.getContext('2d')!;
    mc.scale(this.dpr, this.dpr);
    mc.fillStyle = '#f6f1cf';
    mc.beginPath();
    mc.arc(size / 2, size / 2, R, 0, Math.PI * 2);
    mc.fill();
    mc.globalCompositeOperation = 'destination-out';
    mc.beginPath();
    mc.arc(size / 2 + R * 0.48, size / 2 - R * 0.12, R * 0.92, 0, Math.PI * 2);
    mc.fill();
    ctx.drawImage(m, mx - size / 2, my - size / 2, size, size);
  }

  draw(t: number) {
    const { ctx, W, dpr, pal } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (pal.night) {
      for (const s of this.stars) {
        ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.7 + s.p));
        ctx.fillStyle = '#eef2ff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = pal.cloudAlpha;
    for (const c of this.clouds) {
      const w = c.img.width / dpr;
      const span = W + w + 40;
      const x = ((((c.x + t * c.speed) % span) + span) % span) - w - 20;
      ctx.drawImage(c.img, x, c.y - c.pad, w, c.img.height / dpr);
    }
    ctx.globalAlpha = 1;
  }
}
