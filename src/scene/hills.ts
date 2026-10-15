// Hill layers, painted once per resize: far mountains, middle hills with
// tree clumps, and the near field the grass grows on. Each layer is its own
// canvas, so the scene can move them at different speeds (parallax).
import type { ScenePalette } from './palette';
import { rng } from './wind';

export type Ridge = (x: number) => number;

/** Ridge lines as a fraction of the layer height, for u = x / width in 0..1. */
const RIDGES = {
  // distant mountains, tallest on the right where the view opens up
  far: (u: number) =>
    0.4 + 0.04 * Math.sin(u * 5.2 + 0.8) + 0.02 * Math.sin(u * 11 + 2.1) + 0.01 * Math.sin(u * 23 + 0.3)
    - 0.08 * Math.exp(-(((u - 0.75) / 0.18) ** 2)),
  // rolling hills across the valley; only the right side shows past the near slope
  mid: (u: number) =>
    0.55 - 0.03 * u + 0.02 * Math.sin(u * 6 + 1) + 0.008 * Math.sin(u * 15 + 2) - 0.07 * Math.exp(-(((u - 0.86) / 0.2) ** 2)),
  // the hillside we lie on: its crest runs diagonally from upper left to lower right
  near: (u: number) => 0.34 + 0.38 * u ** 1.25 + 0.015 * Math.sin(u * 8 + 0.5),
};

export const ridge = (kind: keyof typeof RIDGES, W: number, H: number): Ridge => (x) => RIDGES[kind](x / W) * H;

function setup(canvas: HTMLCanvasElement, W: number, H: number, dpr: number) {
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  return ctx;
}

function hillPath(ctx: CanvasRenderingContext2D, top: Ridge, W: number, H: number) {
  ctx.beginPath();
  ctx.moveTo(-10, H + 10);
  for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, top(x));
  ctx.lineTo(W + 10, H + 10);
  ctx.closePath();
}

/** Fill a hill with a vertical gradient and short brush strokes for texture. */
function paintHill(ctx: CanvasRenderingContext2D, top: Ridge, W: number, H: number, colors: [string, string], seed: number, strokes: number, strength = 0.1) {
  let minY = H;
  for (let x = 0; x <= W; x += 20) minY = Math.min(minY, top(x));
  hillPath(ctx, top, W, H);
  const g = ctx.createLinearGradient(0, minY, 0, H);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.save();
  hillPath(ctx, top, W, H);
  ctx.clip();
  const r = rng(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < strokes; i++) {
    const x = r() * W;
    const y = top(x) + r() * (H - top(x));
    const slope = (top(x + 4) - top(x - 4)) / 8;
    const len = 5 + r() * 14;
    ctx.strokeStyle = r() < 0.5 ? `rgba(255, 255, 230, ${strength})` : `rgba(10, 30, 10, ${strength})`;
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y + slope * len * 0.5 - 2, x + len, y + slope * len);
    ctx.stroke();
  }
  ctx.restore();
}

function clump(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, pal: ScenePalette, r: () => number) {
  const n = 5 + Math.floor(r() * 5);
  const blobs = Array.from({ length: n }, () => ({
    dx: (r() - 0.5) * size * 1.6, dy: -r() * size * 0.7, rad: size * (0.35 + r() * 0.35),
  }));
  ctx.fillStyle = pal.tree[0];
  for (const b of blobs) { ctx.beginPath(); ctx.arc(x + b.dx, y + b.dy, b.rad, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = pal.tree[1];
  for (const b of blobs) {
    ctx.beginPath();
    ctx.arc(x + b.dx - b.rad * 0.25, y + b.dy - b.rad * 0.3, b.rad * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, pal: ScenePalette) {
  ctx.fillStyle = pal.rock[0];
  ctx.beginPath();
  ctx.ellipse(x, y, w, w * 0.55, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = pal.rock[1];
  ctx.beginPath();
  ctx.ellipse(x - w * 0.2, y - w * 0.25, w * 0.6, w * 0.25, -0.15, 0, Math.PI * 2);
  ctx.fill();
}

export function paintFar(canvas: HTMLCanvasElement, W: number, H: number, dpr: number, pal: ScenePalette) {
  const ctx = setup(canvas, W, H, dpr);
  const top = ridge('far', W, H);
  paintHill(ctx, top, W, H, pal.far, 3, (W * H) / 900, 0.035);
  // Mist at the foot of the mountains.
  const mist = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.66);
  mist.addColorStop(0, 'rgba(0,0,0,0)');
  mist.addColorStop(1, pal.haze);
  ctx.fillStyle = mist;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);
}

export function paintMid(canvas: HTMLCanvasElement, W: number, H: number, dpr: number, pal: ScenePalette) {
  const ctx = setup(canvas, W, H, dpr);
  const top = ridge('mid', W, H);
  paintHill(ctx, top, W, H, pal.mid, 5, (W * H) / 500, 0.07);
  const r = rng(21);
  const size = Math.max(8, H * 0.025);
  for (let i = 0; i < Math.round(W / 110); i++) {
    const x = r() * W;
    clump(ctx, x, top(x) + size * (1 + r() * 3), size * (0.8 + r() * 0.8), pal, r);
  }
  for (let i = 0; i < Math.round(W / 160); i++) {
    const x = r() * W;
    rock(ctx, x, top(x) + size * (2 + r() * 4), size * (0.4 + r() * 0.3), pal);
  }
}

export function paintNear(canvas: HTMLCanvasElement, W: number, H: number, dpr: number, pal: ScenePalette) {
  const ctx = setup(canvas, W, H, dpr);
  const top = ridge('near', W, H);
  paintHill(ctx, top, W, H, pal.near, 7, (W * H) / 300);
  // Sunlight catching the crest.
  ctx.save();
  hillPath(ctx, top, W, H);
  ctx.clip();
  ctx.beginPath();
  for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, top(x) + 3);
  ctx.strokeStyle = pal.night ? 'rgba(160, 190, 230, 0.12)' : 'rgba(255, 250, 210, 0.35)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
  // Bushes on the slope, like the reference paintings.
  const r = rng(31);
  const size = Math.max(10, H * 0.03);
  for (const u of [0.05, 0.3, 0.62, 0.9]) {
    const x = W * u;
    clump(ctx, x, top(x) + size * (1.2 + r() * 1.5), size * (0.9 + r() * 0.6), pal, r);
  }
}
