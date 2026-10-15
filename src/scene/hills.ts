// Hill layers, painted per art pixel once per resize: far mountains, middle
// hills with bushes, and the near hillside the grass grows on. Each layer is
// its own canvas, so the scene can move them at different speeds (parallax).
import type { ScenePalette } from './palette';
import { bayer, fbm, noise2, pick, pixelCanvas, put, type Ramp } from './pixel';
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

export const ridge = (kind: keyof typeof RIDGES, W: number, H: number): Ridge => (x) =>
  RIDGES[kind](Math.min(1, Math.max(0, x / W))) * H;

// Sunlight from the upper left.
const L = (() => { const v = [-0.5, -0.7, 0.5]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

interface HillStyle {
  ramp: Ramp;
  seed: number;
  top: number; // value at the crest
  fall: number; // how much darker it gets going down
  fallDepth: number; // over how many px (fraction of H)
  texture: number; // strength of the brush-mass noise
  scale: number; // size of the brush masses (smaller = bigger patches)
  stretch: number; // how much the strokes are drawn out sideways
}

/** Base shading of a hill: crest light, darker going down, painted patches, lit slopes. */
function paintHill(img: ImageData, top: Ridge, W: number, H: number, s: HillStyle) {
  const n = noise2(s.seed);
  const fall = 1 / (H * s.fallDepth);
  for (let x = 0; x < W; x++) {
    const tx = top(x);
    const t0 = Math.max(0, Math.ceil(tx));
    const slope = top(x + 1) - top(x - 1); // < 0 where the ground rises to the right (faces the sun)
    for (let y = t0; y < H; y++) {
      const depth = Math.min(1, (y - tx) * fall);
      let v = s.top - depth * s.fall;
      v += (fbm(n, x * s.scale, y * s.scale * s.stretch, 3) - 0.5) * s.texture;
      v -= slope * 0.08;
      if (y - tx < 1.5) v += 0.25; // rim light on the crest
      put(img, x, y, pick(s.ramp, v, x, y));
    }
  }
}

/** A cluster of lit spheres: a bush (or, flattened, a rock). */
function blobs(img: ImageData, cx: number, cy: number, size: number, rmp: Ramp, seed: number, flat = 1) {
  const r = rng(seed);
  const n = noise2(seed);
  const parts = Array.from({ length: 4 + Math.floor(r() * 4) }, () => ({
    x: cx + (r() - 0.5) * size * 1.5, y: cy - r() * size * 0.6 * flat, r: size * (0.38 + r() * 0.3),
  }));
  const x0 = Math.floor(cx - size * 1.6), x1 = Math.ceil(cx + size * 1.6);
  const y0 = Math.floor(cy - size * 1.5), y1 = Math.ceil(cy + size * 0.6);
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x++) {
      let best = -1, nx = 0, ny = 0, nz = 0, bd = 2;
      const wob = (n(x * 0.5, y * 0.5) - 0.5) * 0.35; // leafy, uneven edge
      for (const p of parts) {
        const dx = (x - p.x) / p.r, dy = (y - p.y) / (p.r * flat);
        const d = Math.hypot(dx, dy) + wob;
        if (d < 1) {
          const h = Math.sqrt(1 - Math.min(1, dx * dx + dy * dy));
          if (h > best) { best = h; nx = dx; ny = dy; nz = h; bd = d; }
        }
      }
      if (best < 0) continue;
      if (bd > 0.85 && bayer(x, y) < (bd - 0.85) / 0.15) continue;
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const v = 0.08 + 0.85 * lam + (n(x * 0.9, y * 0.9) - 0.5) * 0.25;
      put(img, x, y, pick(rmp, v, x, y));
    }
  }
}

function finish(canvas: HTMLCanvasElement, img: ImageData) {
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
}

/** Sizes are in art pixels. */
export function paintFar(canvas: HTMLCanvasElement, W: number, H: number, pal: ScenePalette) {
  const { img } = pixelCanvas(W, H);
  const top = ridge('far', W, H);
  // Haze: the lower slopes fade toward the sky (lighter), like distant air.
  paintHill(img, top, W, H, { ramp: pal.far, seed: 3, top: 0.75, fall: -0.35, fallDepth: 0.3, texture: 0.25, scale: 0.03, stretch: 2.2 });
  finish(canvas, img);
}

export function paintMid(canvas: HTMLCanvasElement, W: number, H: number, pal: ScenePalette) {
  const { img } = pixelCanvas(W, H);
  const top = ridge('mid', W, H);
  paintHill(img, top, W, H, { ramp: pal.mid, seed: 5, top: 0.85, fall: 0.5, fallDepth: 0.35, texture: 0.45, scale: 0.035, stretch: 2.5 });
  const r = rng(21);
  const size = Math.max(3, H * 0.022);
  for (let i = 0; i < Math.round(W / 40); i++) {
    const x = r() * W;
    blobs(img, x, top(x) + size * (1.2 + r() * 3), size * (0.8 + r() * 0.8), pal.bush, 40 + i);
  }
  for (let i = 0; i < Math.round(W / 60); i++) {
    const x = r() * W;
    blobs(img, x, top(x) + size * (2 + r() * 4), size * (0.35 + r() * 0.25), pal.rock, 90 + i, 0.6);
  }
  finish(canvas, img);
}

export function paintNear(canvas: HTMLCanvasElement, W: number, H: number, pal: ScenePalette) {
  const { img } = pixelCanvas(W, H);
  const top = ridge('near', W, H);
  paintHill(img, top, W, H, { ramp: pal.near, seed: 7, top: 0.95, fall: 0.65, fallDepth: 0.55, texture: 0.5, scale: 0.025, stretch: 1.8 });
  const r = rng(31);
  const size = Math.max(4, H * 0.03);
  for (const u of [0.05, 0.3, 0.62, 0.9]) {
    const x = W * u;
    blobs(img, x, top(x) + size * (1.4 + r() * 1.5), size * (0.9 + r() * 0.6), pal.bush, 60 + Math.round(u * 10));
  }
  finish(canvas, img);
}
