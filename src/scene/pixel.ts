// Tools for the painted-pixel look: color ramps, ordered dithering, and noise.
//
// Each material (sky, cloud, hill, bush, grass) has a short ramp of colors from
// dark to light. Shading is a value 0..1 that is snapped to one ramp color;
// a 4x4 Bayer pattern dithers the step between neighbors, the way pixel
// artists suggest soft light with few colors.

export type RGB = [number, number, number];
export type Ramp = RGB[];

export const ramp = (...hex: string[]): Ramp =>
  hex.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER4[((y & 3) << 2) | (x & 3)];

/** The ramp color for value v (0..1) at pixel (x, y), dithered. */
export function pick(r: Ramp, v: number, x: number, y: number): RGB {
  const f = v * (r.length - 1) + (bayer(x, y) - 0.5);
  return r[Math.max(0, Math.min(r.length - 1, Math.round(f)))];
}

/** Write one pixel into ImageData. */
export function put(img: ImageData, x: number, y: number, c: RGB, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = a;
}

/** Smooth 2D value noise in 0..1. */
export function noise2(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** A few octaves of noise added together (0..1). */
export function fbm(n: (x: number, y: number) => number, x: number, y: number, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * f, y * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Make a canvas with an ImageData of the given art-pixel size. */
export function pixelCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d')!;
  return { canvas: c, ctx, img: ctx.createImageData(c.width, c.height) };
}
